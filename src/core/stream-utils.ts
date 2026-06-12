import type { ZipFileEntry } from '@/types'
import { parseLocalFileHeader } from './zip-parser'
import { COMPRESSION_METHOD, CHUNK_SIZE, ZIP_FLAG_BITS } from './constants'
import { decryptAES256Stream, decryptZipCryptoStream, crc32 } from './crypto'

export interface ExtractStreamOptions {
  entry: ZipFileEntry
  password?: string
  onProgress?: (bytesProcessed: number, totalBytes: number) => void
  verifyCRC?: boolean
  returnStream?: boolean
}

export interface ExtractResult {
  stream: ReadableStream<Uint8Array>
  actualSize: number
  computedCRC32: number
  passwordVerified: boolean
  done: Promise<{ actualSize: number; computedCRC32: number }>
}

export function createFileReadStream(
  file: File,
  start: number,
  end: number,
  chunkSize: number = CHUNK_SIZE.READ_CHUNK
): ReadableStream<Uint8Array> {
  let currentPos = start

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (currentPos >= end) {
        controller.close()
        return
      }

      const chunkEnd = Math.min(currentPos + chunkSize, end)
      const blob = file.slice(currentPos, chunkEnd)
      const buffer = await blob.arrayBuffer()
      controller.enqueue(new Uint8Array(buffer))
      currentPos = chunkEnd
    },

    cancel() {
    }
  })
}

export function createDecompressStream(
  compressionMethod: number
): TransformStream<Uint8Array, Uint8Array> {
  if (compressionMethod === COMPRESSION_METHOD.STORED) {
    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk)
      }
    })
  }

  if (compressionMethod === COMPRESSION_METHOD.DEFLATED) {
    try {
      const ds = new DecompressionStream('deflate-raw')
      return ds as unknown as TransformStream<Uint8Array, Uint8Array>
    } catch {
      const ds = new DecompressionStream('deflate')
      return ds as unknown as TransformStream<Uint8Array, Uint8Array>
    }
  }

  throw new Error(`Unsupported compression method: ${compressionMethod}`)
}

export function createProgressStream(
  totalBytes: number,
  onProgress?: (bytes: number, total: number) => void
): TransformStream<Uint8Array, Uint8Array> {
  let processed = 0

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      processed += chunk.length
      onProgress?.(processed, totalBytes)
      controller.enqueue(chunk)
    },
    flush() {
      onProgress?.(totalBytes, totalBytes)
    }
  })
}

export function createCRC32Stream(): {
  stream: TransformStream<Uint8Array, Uint8Array>
  getCRC: () => number
} {
  let crc = 0
  let started = false

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!started) {
        crc = 0
        started = true
      }
      crc = _crc32(chunk, crc)
      controller.enqueue(chunk)
    }
  })

  return {
    stream,
    getCRC: () => crc >>> 0
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c
  }
  return table
})()

function _crc32(data: Uint8Array, crc: number = 0): number {
  crc = crc ^ 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

export function createSizeTracker(): {
  stream: TransformStream<Uint8Array, Uint8Array>
  getSize: () => number
} {
  let size = 0

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.length
      controller.enqueue(chunk)
    }
  })

  return {
    stream,
    getSize: () => size
  }
}

export async function extractFileToStream(
  file: File,
  options: ExtractStreamOptions
): Promise<ExtractResult> {
  const { entry, password, onProgress } = options

  const { header, dataStart, dataEnd } = await parseLocalFileHeader(file, entry.localHeaderOffset)

  let compressedSize = entry.compressedSize
  let uncompressedSize = entry.size
  const hasDataDescriptor = (header.flags & ZIP_FLAG_BITS.DATA_DESCRIPTOR) !== 0

  if (compressedSize === 0 && hasDataDescriptor) {
    compressedSize = dataEnd - dataStart
  }

  let actualCompressedEnd = dataStart + compressedSize
  if (hasDataDescriptor && compressedSize > 0) {
    actualCompressedEnd = dataStart + compressedSize
  }

  const rawStream = createFileReadStream(file, dataStart, actualCompressedEnd)

  let processedStream: ReadableStream<Uint8Array> = rawStream
  let passwordVerified = true

  if (entry.encrypted && entry.encryptionMode !== 'none') {
    if (entry.encryptionMode === 'aes256') {
      if (!password) {
        throw new Error('Password required for AES-256 encrypted file')
      }
      const result = await decryptAES256Stream(processedStream, password, entry)
      processedStream = result.stream
      passwordVerified = result.verifyPassword()
    } else if (entry.encryptionMode === 'zipcrypto') {
      if (!password) {
        throw new Error('Password required for ZipCrypto encrypted file')
      }
      const result = await decryptZipCryptoStream(processedStream, password, entry)
      processedStream = result.stream
    }
  }

  const { stream: crcStream, getCRC } = createCRC32Stream()
  const { stream: sizeStream, getSize } = createSizeTracker()
  const progressStream = createProgressStream(uncompressedSize, onProgress)

  let doneResolve: (value: { actualSize: number; computedCRC32: number }) => void
  const donePromise = new Promise<{ actualSize: number; computedCRC32: number }>((resolve) => {
    doneResolve = resolve
  })

  try {
    const decompressStream = createDecompressStream(entry.compressionMethod)
    processedStream = processedStream
      .pipeThrough(decompressStream)
      .pipeThrough(crcStream)
      .pipeThrough(sizeStream)
      .pipeThrough(progressStream)

    const reader = processedStream.getReader()
    const outStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            doneResolve({
              actualSize: getSize(),
              computedCRC32: getCRC()
            })
            return
          }
          controller.enqueue(value)
        } catch (e) {
          controller.error(e)
          throw e
        }
      },
      cancel(reason) {
        reader.cancel(reason)
      }
    })

    return {
      stream: outStream,
      actualSize: 0,
      computedCRC32: 0,
      passwordVerified,
      done: donePromise
    }
  } catch {
    throw new Error('Decompression failed: invalid compressed data')
  }
}

export async function extractFileToBlob(
  file: File,
  options: ExtractStreamOptions
): Promise<{ blob: Blob; actualSize: number; computedCRC32: number; passwordVerified: boolean }> {
  const result = await extractFileToStream(file, options)
  const reader = result.stream.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  const finalResult = await result.done

  let totalSize = 0
  for (const c of chunks) totalSize += c.length

  const combined = new Uint8Array(totalSize)
  let offset = 0
  for (const c of chunks) {
    combined.set(c, offset)
    offset += c.length
  }

  const mimeType = guessMimeType(options.entry.name)
  const blob = new Blob([combined], { type: mimeType })

  return {
    blob,
    actualSize: finalResult.actualSize || blob.size,
    computedCRC32: finalResult.computedCRC32,
    passwordVerified: result.passwordVerified
  }
}

function guessMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''
  const mimeTypes: Record<string, string> = {
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    xml: 'application/xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    zip: 'application/zip',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    wav: 'audio/wav',
    csv: 'text/csv',
    md: 'text/markdown'
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

export async function streamToBlob(stream: ReadableStream<Uint8Array>, mimeType: string = 'application/octet-stream'): Promise<Blob> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  return new Blob(chunks, { type: mimeType })
}

export function concatenateStreams(
  streams: ReadableStream<Uint8Array>[]
): ReadableStream<Uint8Array> {
  let index = 0
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (index < streams.length) {
        if (!currentReader) {
          currentReader = streams[index].getReader()
        }

        const { done, value } = await currentReader.read()
        if (done) {
          currentReader = null
          index++
          continue
        }

        controller.enqueue(value)
        return
      }
      controller.close()
    },

    cancel(reason) {
      if (currentReader) {
        currentReader.cancel(reason)
      }
    }
  })
}
