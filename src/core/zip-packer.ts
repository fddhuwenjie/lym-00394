import type { CreateZipPayload, SplitVolumeFile } from '@/types'
import { ZIP_SIGNATURES, COMPRESSION_METHOD, ZIP_FLAG_BITS, AES_MODES } from './constants'
import { crc32, encryptAES256Stream, encryptZipCryptoStream } from './crypto'

export interface ZipEntryInfo {
  fileName: string
  uncompressedSize: number
  compressedSize: number
  crc32: number
  offset: number
  flags: number
  compressionMethod: number
  lastModTime: number
  lastModDate: number
  extraField?: Uint8Array
  isDirectory: boolean
  encrypted: boolean
  encryptionMode: 'aes256' | 'zipcrypto' | 'none'
}

function writeUint16LE(array: Uint8Array, offset: number, value: number): void {
  array[offset] = value & 0xFF
  array[offset + 1] = (value >>> 8) & 0xFF
}

function writeUint32LE(array: Uint8Array, offset: number, value: number): void {
  array[offset] = value & 0xFF
  array[offset + 1] = (value >>> 8) & 0xFF
  array[offset + 2] = (value >>> 16) & 0xFF
  array[offset + 3] = (value >>> 24) & 0xFF
}

function toDOSDateTime(date: Date): { time: number; date: number } {
  const dosTime = (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (date.getSeconds() >> 1)

  const dosDate = ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()

  return { time: dosTime, date: dosDate }
}

function createCompressStream(): TransformStream<Uint8Array, Uint8Array> {
  try {
    return new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>
  } catch {
    return new CompressionStream('deflate') as unknown as TransformStream<Uint8Array, Uint8Array>
  }
}

function writeLocalFileHeader(info: ZipEntryInfo): Uint8Array {
  const fileNameBytes = new TextEncoder().encode(info.fileName)
  const extraField = info.extraField || new Uint8Array(0)
  const headerSize = 30 + fileNameBytes.length + extraField.length
  const header = new Uint8Array(headerSize)

  writeUint32LE(header, 0, ZIP_SIGNATURES.LOCAL_FILE_HEADER)
  writeUint16LE(header, 4, 0x0014)
  writeUint16LE(header, 6, info.flags)
  writeUint16LE(header, 8, info.compressionMethod)
  writeUint16LE(header, 10, info.lastModTime)
  writeUint16LE(header, 12, info.lastModDate)
  writeUint32LE(header, 14, info.crc32)
  writeUint32LE(header, 18, info.compressedSize)
  writeUint32LE(header, 22, info.uncompressedSize)
  writeUint16LE(header, 26, fileNameBytes.length)
  writeUint16LE(header, 28, extraField.length)

  header.set(fileNameBytes, 30)
  if (extraField.length > 0) {
    header.set(extraField, 30 + fileNameBytes.length)
  }

  return header
}

function writeCentralDirectoryEntry(info: ZipEntryInfo): Uint8Array {
  const fileNameBytes = new TextEncoder().encode(info.fileName)
  const extraField = info.extraField || new Uint8Array(0)
  const headerSize = 46 + fileNameBytes.length + extraField.length
  const header = new Uint8Array(headerSize)

  writeUint32LE(header, 0, ZIP_SIGNATURES.CENTRAL_DIRECTORY_FILE_HEADER)
  writeUint16LE(header, 4, 0x003f)
  writeUint16LE(header, 6, 0x0014)
  writeUint16LE(header, 8, info.flags)
  writeUint16LE(header, 10, info.compressionMethod)
  writeUint16LE(header, 12, info.lastModTime)
  writeUint16LE(header, 14, info.lastModDate)
  writeUint32LE(header, 16, info.crc32)
  writeUint32LE(header, 20, info.compressedSize)
  writeUint32LE(header, 24, info.uncompressedSize)
  writeUint16LE(header, 28, fileNameBytes.length)
  writeUint16LE(header, 30, extraField.length)
  writeUint16LE(header, 32, 0)
  writeUint16LE(header, 34, 0)
  writeUint16LE(header, 36, 0)
  writeUint32LE(header, 38, info.isDirectory ? 0x00000010 : 0x00000000)
  writeUint32LE(header, 42, info.offset)

  header.set(fileNameBytes, 46)
  if (extraField.length > 0) {
    header.set(extraField, 46 + fileNameBytes.length)
  }

  return header
}

function writeEndOfCentralDirectory(
  entriesOnDisk: number,
  totalEntries: number,
  centralDirSize: number,
  centralDirOffset: number,
  comment: string = ''
): Uint8Array {
  const commentBytes = new TextEncoder().encode(comment)
  const recordSize = 22 + commentBytes.length
  const record = new Uint8Array(recordSize)

  writeUint32LE(record, 0, ZIP_SIGNATURES.END_OF_CENTRAL_DIRECTORY)
  writeUint16LE(record, 4, 0)
  writeUint16LE(record, 6, 0)
  writeUint16LE(record, 8, entriesOnDisk)
  writeUint16LE(record, 10, totalEntries)
  writeUint32LE(record, 12, centralDirSize)
  writeUint32LE(record, 16, centralDirOffset)
  writeUint16LE(record, 20, commentBytes.length)

  if (commentBytes.length > 0) {
    record.set(commentBytes, 22)
  }

  return record
}

function createAESExtraField(): Uint8Array {
  const extra = new Uint8Array(11)
  writeUint16LE(extra, 0, ZIP_SIGNATURES.AES_EXTRA_DATA)
  writeUint16LE(extra, 2, 7)
  writeUint16LE(extra, 4, 0x0002)
  extra[6] = 3
  writeUint16LE(extra, 7, COMPRESSION_METHOD.DEFLATED)
  writeUint16LE(extra, 9, COMPRESSION_METHOD.AES_ENCRYPTED)
  return extra
}

async function processFile(
  file: File,
  options: {
    compressionMethod: number
    encryptionMode: 'aes256' | 'zipcrypto' | 'none'
    password?: string
  }
): Promise<{
  info: ZipEntryInfo
  dataStream: ReadableStream<Uint8Array>
}> {
  const { time, date } = toDOSDateTime(new Date(file.lastModified))

  const fileReader = file.stream() as ReadableStream<Uint8Array>

  let crc = 0
  let uncompressedSize = 0
  const crcTracker = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      crc = _crc32(chunk, crc)
      uncompressedSize += chunk.length
      controller.enqueue(chunk)
    }
  })

  const trackedStream = fileReader.pipeThrough(crcTracker)

  let processedStream = trackedStream
  let flags = ZIP_FLAG_BITS.LANGUAGE_ENCODING
  let compressionMethod = options.compressionMethod
  const extraFields: Uint8Array[] = []

  if (options.encryptionMode === 'aes256' && options.password) {
    const aesExtra = createAESExtraField()
    extraFields.push(aesExtra)
    compressionMethod = COMPRESSION_METHOD.AES_ENCRYPTED
    flags |= ZIP_FLAG_BITS.ENCRYPTED

    const compressResult = await bufferAndCompress(processedStream, COMPRESSION_METHOD.DEFLATED)
    const compressedData = compressResult.data
    const compressedBeforeEncrypt = compressedData.length

    const encryptResult = await encryptAES256Stream(
      new Blob([compressedData]).stream() as ReadableStream<Uint8Array>,
      options.password
    )
    const encryptedData = await readStreamToBytes(encryptResult.stream)

    const info: ZipEntryInfo = {
      fileName: file.webkitRelativePath || file.name,
      uncompressedSize,
      compressedSize: encryptedData.length + AES_MODES.AES_256.authCodeLen,
      crc32: crc >>> 0,
      offset: 0,
      flags,
      compressionMethod,
      lastModTime: time,
      lastModDate: date,
      extraField: concatUint8Arrays(extraFields),
      isDirectory: false,
      encrypted: true,
      encryptionMode: 'aes256'
    }

    const finalData = concatUint8Arrays([encryptedData, new Uint8Array(AES_MODES.AES_256.authCodeLen)])
    return {
      info,
      dataStream: new Blob([finalData]).stream() as ReadableStream<Uint8Array>
    }
  }

  if (options.encryptionMode === 'zipcrypto' && options.password) {
    flags |= ZIP_FLAG_BITS.ENCRYPTED

    const compressResult = await bufferAndCompress(processedStream, options.compressionMethod)
    const compressedData = compressResult.data

    const encryptResult = await encryptZipCryptoStream(
      new Blob([compressedData]).stream() as ReadableStream<Uint8Array>,
      options.password,
      crc >>> 0
    )
    const encryptedData = await readStreamToBytes(encryptResult.stream)

    const info: ZipEntryInfo = {
      fileName: file.webkitRelativePath || file.name,
      uncompressedSize,
      compressedSize: encryptedData.length,
      crc32: crc >>> 0,
      offset: 0,
      flags,
      compressionMethod,
      lastModTime: time,
      lastModDate: date,
      isDirectory: false,
      encrypted: true,
      encryptionMode: 'zipcrypto'
    }

    return {
      info,
      dataStream: new Blob([encryptedData]).stream() as ReadableStream<Uint8Array>
    }
  }

  if (compressionMethod === COMPRESSION_METHOD.STORED) {
    const data = await readStreamToBytes(processedStream)

    const info: ZipEntryInfo = {
      fileName: file.webkitRelativePath || file.name,
      uncompressedSize,
      compressedSize: uncompressedSize,
      crc32: crc >>> 0,
      offset: 0,
      flags,
      compressionMethod,
      lastModTime: time,
      lastModDate: date,
      extraField: extraFields.length > 0 ? concatUint8Arrays(extraFields) : undefined,
      isDirectory: false,
      encrypted: false,
      encryptionMode: 'none'
    }

    return {
      info,
      dataStream: new Blob([data]).stream() as ReadableStream<Uint8Array>
    }
  }

  const compressResult = await bufferAndCompress(processedStream, compressionMethod)
  const compressedData = compressResult.data

  const info: ZipEntryInfo = {
    fileName: file.webkitRelativePath || file.name,
    uncompressedSize,
    compressedSize: compressedData.length,
    crc32: crc >>> 0,
    offset: 0,
    flags,
    compressionMethod,
    lastModTime: time,
    lastModDate: date,
    extraField: extraFields.length > 0 ? concatUint8Arrays(extraFields) : undefined,
    isDirectory: false,
    encrypted: false,
    encryptionMode: 'none'
  }

  return {
    info,
    dataStream: new Blob([compressedData]).stream() as ReadableStream<Uint8Array>
  }
}

async function bufferAndCompress(
  stream: ReadableStream<Uint8Array>,
  method: number
): Promise<{ data: Uint8Array; uncompressedSize: number; compressedSize: number }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let uncompressedSize = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    uncompressedSize += value.length
  }

  const data = concatUint8Arrays(chunks)

  if (method === COMPRESSION_METHOD.STORED) {
    return { data, uncompressedSize, compressedSize: uncompressedSize }
  }

  try {
    const compressStream = createCompressStream()
    const writer = compressStream.writable.getWriter()
    const inputBlob = new Blob([data])
    writer.write(new Uint8Array(await inputBlob.arrayBuffer()))
    writer.close()

    const outReader = compressStream.readable.getReader()
    const outChunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await outReader.read()
      if (done) break
      outChunks.push(value)
    }

    const compressed = concatUint8Arrays(outChunks)
    return {
      data: compressed,
      uncompressedSize,
      compressedSize: compressed.length
    }
  } catch {
    return { data, uncompressedSize, compressedSize: uncompressedSize }
  }
}

async function readStreamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return concatUint8Arrays(chunks)
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalSize = 0
  for (const arr of arrays) totalSize += arr.length
  const result = new Uint8Array(totalSize)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

function _crc32(data: Uint8Array, crc: number = 0): number {
  return crc32(data, crc)
}

export async function createZipArchive(
  payload: CreateZipPayload,
  onProgress?: (bytesProcessed: number, totalBytes: number, filesCompleted: number, totalFiles: number) => void
): Promise<Blob> {
  const { files, password, encryptionMode, compressionLevel } = payload

  const totalFiles = files.length
  const totalUncompressedBytes = files.reduce((sum, f) => sum + f.size, 0)

  let processedFiles = 0
  let processedBytes = 0

  const compressionMethod = compressionLevel > 0 ? COMPRESSION_METHOD.DEFLATED : COMPRESSION_METHOD.STORED

  const results: Array<{
    info: ZipEntryInfo
    dataStream: ReadableStream<Uint8Array>
  }> = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const result = await processFile(file, {
      compressionMethod,
      encryptionMode,
      password
    })
    results.push(result)

    processedFiles++
    processedBytes += result.info.uncompressedSize

    onProgress?.(
      processedBytes,
      totalUncompressedBytes,
      processedFiles,
      totalFiles
    )
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  const allChunks: Uint8Array[] = []
  const entryInfos: ZipEntryInfo[] = []
  let currentOffset = 0

  for (const { info, dataStream } of results) {
    const localHeader = writeLocalFileHeader({
      ...info,
      offset: currentOffset
    })
    allChunks.push(localHeader)
    currentOffset += localHeader.length

    const data = await readStreamToBytes(dataStream)
    allChunks.push(data)
    currentOffset += data.length

    entryInfos.push({
      ...info,
      offset: currentOffset - localHeader.length - data.length
    })
  }

  const centralDirStart = currentOffset
  const centralDirChunks: Uint8Array[] = []

  for (const info of entryInfos) {
    const entry = writeCentralDirectoryEntry(info)
    centralDirChunks.push(entry)
  }

  const centralDirData = concatUint8Arrays(centralDirChunks)
  allChunks.push(centralDirData)

  const eocd = writeEndOfCentralDirectory(
    entryInfos.length,
    entryInfos.length,
    centralDirData.length,
    centralDirStart
  )
  allChunks.push(eocd)

  const finalData = concatUint8Arrays(allChunks)
  return new Blob([finalData], { type: 'application/zip' })
}

export async function createSplitZipArchive(
  payload: CreateZipPayload,
  onProgress?: (bytesProcessed: number, totalBytes: number, filesCompleted: number, totalFiles: number) => void
): Promise<{
  blob: Blob
  splitVolumes: SplitVolumeFile[]
}> {
  const { files, password, encryptionMode, compressionLevel, splitVolumeSize } = payload
  const volumeSize = splitVolumeSize || 100 * 1024 * 1024

  const totalFiles = files.length
  const totalUncompressedBytes = files.reduce((sum, f) => sum + f.size, 0)

  let processedFiles = 0
  let processedBytes = 0

  const compressionMethod = compressionLevel > 0 ? COMPRESSION_METHOD.DEFLATED : COMPRESSION_METHOD.STORED

  const fileResults: Array<{
    info: ZipEntryInfo
    localHeader: Uint8Array
    fileData: Uint8Array
  }> = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const result = await processFile(file, {
      compressionMethod,
      encryptionMode,
      password
    })

    const localHeader = writeLocalFileHeader({
      ...result.info,
      offset: 0
    })
    const fileData = await readStreamToBytes(result.dataStream)

    fileResults.push({
      info: result.info,
      localHeader,
      fileData
    })

    processedFiles++
    processedBytes += result.info.uncompressedSize

    onProgress?.(
      processedBytes,
      totalUncompressedBytes,
      processedFiles,
      totalFiles
    )
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  const entryInfos: ZipEntryInfo[] = []
  let currentOffset = 0

  for (const { info, localHeader, fileData } of fileResults) {
    entryInfos.push({
      ...info,
      offset: currentOffset
    })
    currentOffset += localHeader.length + fileData.length
  }

  const centralDirChunks: Uint8Array[] = []
  for (const info of entryInfos) {
    const entry = writeCentralDirectoryEntry(info)
    centralDirChunks.push(entry)
  }
  const centralDirData = concatUint8Arrays(centralDirChunks)
  const centralDirSize = centralDirData.length
  const centralDirOffset = currentOffset

  const eocd = writeEndOfCentralDirectory(
    entryInfos.length,
    entryInfos.length,
    centralDirSize,
    centralDirOffset
  )

  const totalLocalDataSize = currentOffset
  const metadataSize = centralDirSize + eocd.length

  const dataPieces: { bytes: Uint8Array; type: 'header' | 'data' }[] = []
  for (const { localHeader, fileData } of fileResults) {
    dataPieces.push({ bytes: localHeader, type: 'header' })
    dataPieces.push({ bytes: fileData, type: 'data' })
  }

  const volumes: Uint8Array[][] = [[]]
  let currentVolumeSize = 0

  for (const piece of dataPieces) {
    const pieceSize = piece.bytes.length

    if (currentVolumeSize + pieceSize <= volumeSize || volumes[volumes.length - 1].length === 0) {
      volumes[volumes.length - 1].push(piece.bytes)
      currentVolumeSize += pieceSize
    } else {
      if (pieceSize <= volumeSize) {
        volumes.push([piece.bytes])
        currentVolumeSize = pieceSize
      } else {
        let offset = 0
        while (offset < piece.bytes.length) {
          const remaining = piece.bytes.length - offset
          const spaceLeft = volumeSize - currentVolumeSize
          const chunkSize = Math.min(spaceLeft || volumeSize, remaining)

          if (spaceLeft <= 0 && volumes[volumes.length - 1].length > 0) {
            volumes.push([])
            currentVolumeSize = 0
          }

          const chunk = piece.bytes.slice(offset, offset + chunkSize)
          volumes[volumes.length - 1].push(chunk)
          currentVolumeSize += chunkSize
          offset += chunkSize
        }
      }
    }
  }

  const splitVolumes: SplitVolumeFile[] = []
  const totalVolumes = volumes.length + (metadataSize > 0 ? 1 : 0)

  for (let i = 0; i < volumes.length; i++) {
    const volumeData = concatUint8Arrays(volumes[i])
    const volumeIndex = i + 1
    const isLast = i === volumes.length - 1 && metadataSize === 0
    const volumeName = isLast ? 'archive.zip' : `archive.z${String(volumeIndex).padStart(2, '0')}`

    splitVolumes.push({
      name: volumeName,
      blob: new Blob([volumeData], { type: 'application/zip' }),
      size: volumeData.length,
      index: volumeIndex,
      isLast
    })
  }

  if (metadataSize > 0) {
    const lastVolumeData = concatUint8Arrays([centralDirData, eocd])
    splitVolumes.push({
      name: 'archive.zip',
      blob: new Blob([lastVolumeData], { type: 'application/zip' }),
      size: lastVolumeData.length,
      index: splitVolumes.length + 1,
      isLast: true
    })
  }

  if (splitVolumes.length === 1) {
    const finalData = concatUint8Arrays([
      ...fileResults.flatMap(r => [r.localHeader, r.fileData]),
      centralDirData,
      eocd
    ])
    const singleBlob = new Blob([finalData], { type: 'application/zip' })
    return {
      blob: singleBlob,
      splitVolumes: []
    }
  }

  const allVolumeData = splitVolumes.map(v => new Uint8Array(0))
  const totalData = concatUint8Arrays([
    ...fileResults.flatMap(r => [r.localHeader, r.fileData]),
    centralDirData,
    eocd
  ])
  const fullBlob = new Blob([totalData], { type: 'application/zip' })

  return {
    blob: fullBlob,
    splitVolumes
  }
}

export async function createZipStream(
  payload: CreateZipPayload,
  onProgress?: (bytesProcessed: number, totalBytes: number, filesCompleted: number, totalFiles: number) => void
): Promise<{
  stream: ReadableStream<Uint8Array>
  totalSize: number
}> {
  const blob = await createZipArchive(payload, onProgress)
  return {
    stream: blob.stream() as ReadableStream<Uint8Array>,
    totalSize: blob.size
  }
}
