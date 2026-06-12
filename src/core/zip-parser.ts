import type { ZipLocalFileHeader, ZipCentralDirectory, ZipFileEntry } from '@/types'
import { ZIP_SIGNATURES, COMPRESSION_METHOD, ZIP_FLAG_BITS, CHUNK_SIZE } from './constants'

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(`ZIP Format Error: ${message}`)
    this.name = 'ZipFormatError'
  }
}

const textDecoder = new TextDecoder('utf-8', { fatal: false })
const cp437Decoder = new TextDecoder('ibm866')

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

function readUint64LE(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true)
}

function decodeString(bytes: Uint8Array, useUtf8: boolean): string {
  try {
    if (useUtf8) {
      return textDecoder.decode(bytes)
    }
    return cp437Decoder.decode(bytes)
  } catch {
    return Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  }
}

function parseDOSDateTime(dosTime: number, dosDate: number): Date {
  const year = ((dosDate >> 9) & 0x7F) + 1980
  const month = (dosDate >> 5) & 0x0F
  const day = dosDate & 0x1F
  const hours = (dosTime >> 11) & 0x1F
  const minutes = (dosTime >> 5) & 0x3F
  const seconds = (dosTime & 0x1F) * 2

  return new Date(
    Math.min(year, 2107),
    Math.max(0, Math.min(11, month - 1)),
    Math.max(1, Math.min(31, day)),
    Math.min(23, hours),
    Math.min(59, minutes),
    Math.min(59, seconds)
  )
}

function generateId(): string {
  return `zip_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export async function findEndOfCentralDirectory(file: File): Promise<{
  offset: number
  view: DataView
}> {
  const fileSize = file.size
  const scanSize = Math.min(fileSize, 65536 + 22)
  const scanStart = fileSize - scanSize
  const buffer = await file.slice(Math.max(0, scanStart), fileSize).arrayBuffer()
  const view = new DataView(buffer)

  for (let i = buffer.byteLength - 22; i >= 0; i--) {
    if (readUint32LE(view, i) === ZIP_SIGNATURES.END_OF_CENTRAL_DIRECTORY) {
      return {
        offset: Math.max(0, scanStart) + i,
        view: new DataView(buffer, i)
      }
    }
  }

  throw new ZipFormatError('End of Central Directory signature not found')
}

export function parseEndOfCentralDirectory(view: DataView): {
  diskNumber: number
  diskWithCentralDir: number
  entriesOnDisk: number
  totalEntries: number
  centralDirectorySize: number
  centralDirectoryOffset: number
  commentLength: number
} {
  if (view.byteLength < 22) {
    throw new ZipFormatError('EOCD record too short')
  }

  return {
    diskNumber: readUint16LE(view, 4),
    diskWithCentralDir: readUint16LE(view, 6),
    entriesOnDisk: readUint16LE(view, 8),
    totalEntries: readUint16LE(view, 10),
    centralDirectorySize: readUint32LE(view, 12),
    centralDirectoryOffset: readUint32LE(view, 16),
    commentLength: readUint16LE(view, 20)
  }
}

export async function readCentralDirectory(
  file: File,
  offset: number,
  size: number,
  onProgress?: (bytes: number, total: number) => void
): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = []
  let readBytes = 0

  while (readBytes < size) {
    const end = Math.min(readBytes + CHUNK_SIZE.SCAN_CHUNK, size)
    const chunk = await file.slice(offset + readBytes, offset + end).arrayBuffer()
    chunks.push(new Uint8Array(chunk))
    readBytes = end
    onProgress?.(readBytes, size)
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  const result = new Uint8Array(size)
  let pos = 0
  for (const chunk of chunks) {
    result.set(chunk, pos)
    pos += chunk.length
  }
  return result.buffer
}

export function parseCentralDirectory(
  buffer: ArrayBuffer,
  totalEntries: number,
  comment: string
): ZipCentralDirectory {
  const view = new DataView(buffer)
  const entries: ZipFileEntry[] = []
  let offset = 0

  for (let i = 0; i < totalEntries && offset < buffer.byteLength - 4; i++) {
    const signature = readUint32LE(view, offset)
    if (signature !== ZIP_SIGNATURES.CENTRAL_DIRECTORY_FILE_HEADER) {
      break
    }

    if (offset + 46 > buffer.byteLength) {
      throw new ZipFormatError('Central directory entry truncated')
    }

    const versionMadeBy = readUint16LE(view, offset + 4)
    const versionNeeded = readUint16LE(view, offset + 6)
    const flags = readUint16LE(view, offset + 8)
    const compressionMethod = readUint16LE(view, offset + 10)
    const lastModTime = readUint16LE(view, offset + 12)
    const lastModDate = readUint16LE(view, offset + 14)
    const crc32 = readUint32LE(view, offset + 16)
    const compressedSize = readUint32LE(view, offset + 20)
    const uncompressedSize = readUint32LE(view, offset + 24)
    const fileNameLength = readUint16LE(view, offset + 28)
    const extraFieldLength = readUint16LE(view, offset + 30)
    const fileCommentLength = readUint16LE(view, offset + 32)
    const diskNumberStart = readUint16LE(view, offset + 34)
    const internalFileAttributes = readUint16LE(view, offset + 36)
    const externalFileAttributes = readUint32LE(view, offset + 38)
    let localHeaderOffset = readUint32LE(view, offset + 42)

    const nameBytes = new Uint8Array(buffer, offset + 46, fileNameLength)
    const useUtf8 = (flags & ZIP_FLAG_BITS.LANGUAGE_ENCODING) !== 0
    const fileName = decodeString(nameBytes, useUtf8)

    let extraField: ArrayBuffer | undefined
    if (extraFieldLength > 0) {
      extraField = buffer.slice(offset + 46 + fileNameLength, offset + 46 + fileNameLength + extraFieldLength)
    }

    let fileComment = ''
    if (fileCommentLength > 0) {
      const commentBytes = new Uint8Array(
        buffer,
        offset + 46 + fileNameLength + extraFieldLength,
        fileCommentLength
      )
      fileComment = decodeString(commentBytes, useUtf8)
    }

    let actualCompressedSize = compressedSize
    let actualUncompressedSize = uncompressedSize
    let actualLocalHeaderOffset = localHeaderOffset

    if (extraField && extraFieldLength > 0) {
      const zip64Info = parseZip64ExtraField(
        extraField,
        compressedSize === 0xffffffff,
        uncompressedSize === 0xffffffff,
        localHeaderOffset === 0xffffffff
      )
      if (zip64Info.compressedSize !== undefined) actualCompressedSize = Number(zip64Info.compressedSize)
      if (zip64Info.uncompressedSize !== undefined) actualUncompressedSize = Number(zip64Info.uncompressedSize)
      if (zip64Info.localHeaderOffset !== undefined) actualLocalHeaderOffset = Number(zip64Info.localHeaderOffset)
    }

    const isEncrypted = (flags & ZIP_FLAG_BITS.ENCRYPTED) !== 0
    const encryptionMode = detectEncryptionMode(isEncrypted, compressionMethod, extraField)

    const isDirectory = fileName.endsWith('/') ||
      (externalFileAttributes !== 0 && (externalFileAttributes & 0x10) !== 0) ||
      (actualUncompressedSize === 0 && compressionMethod === COMPRESSION_METHOD.STORED && fileName.endsWith('/'))

    const entry: ZipFileEntry = {
      id: generateId(),
      name: getFileNameFromPath(fileName),
      path: fileName,
      size: actualUncompressedSize,
      compressedSize: actualCompressedSize,
      isDirectory,
      compressionMethod: compressionMethod === COMPRESSION_METHOD.AES_ENCRYPTED
        ? COMPRESSION_METHOD.DEFLATED
        : compressionMethod,
      lastModified: parseDOSDateTime(lastModTime, lastModDate),
      crc32,
      localHeaderOffset: actualLocalHeaderOffset,
      encrypted: isEncrypted,
      encryptionMode,
      extraField,
      fileComment
    }

    entries.push(entry)

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength
  }

  return {
    entries,
    comment,
    size: buffer.byteLength,
    offset: 0
  }
}

function parseZip64ExtraField(
  buffer: ArrayBuffer,
  needCompressed: boolean,
  needUncompressed: boolean,
  needOffset: boolean
): {
  uncompressedSize?: bigint
  compressedSize?: bigint
  localHeaderOffset?: bigint
} {
  const view = new DataView(buffer)
  const result: {
    uncompressedSize?: bigint
    compressedSize?: bigint
    localHeaderOffset?: bigint
  } = {}

  let offset = 0
  while (offset < buffer.byteLength - 4) {
    const headerId = readUint16LE(view, offset)
    const dataSize = readUint16LE(view, offset + 2)
    offset += 4

    if (headerId === 0x0001) {
      let fieldOffset = offset
      if (needUncompressed && fieldOffset + 8 <= offset + dataSize) {
        result.uncompressedSize = readUint64LE(view, fieldOffset)
        fieldOffset += 8
      }
      if (needCompressed && fieldOffset + 8 <= offset + dataSize) {
        result.compressedSize = readUint64LE(view, fieldOffset)
        fieldOffset += 8
      }
      if (needOffset && fieldOffset + 8 <= offset + dataSize) {
        result.localHeaderOffset = readUint64LE(view, fieldOffset)
        fieldOffset += 8
      }
      break
    }

    offset += dataSize
  }

  return result
}

function detectEncryptionMode(
  isEncrypted: boolean,
  compressionMethod: number,
  extraField?: ArrayBuffer
): 'aes256' | 'zipcrypto' | 'none' {
  if (!isEncrypted) return 'none'

  if (compressionMethod === COMPRESSION_METHOD.AES_ENCRYPTED) {
    return 'aes256'
  }

  if (extraField) {
    const view = new DataView(extraField)
    let offset = 0
    while (offset < extraField.byteLength - 4) {
      const headerId = readUint16LE(view, offset)
      const dataSize = readUint16LE(view, offset + 2)
      if (headerId === ZIP_SIGNATURES.AES_EXTRA_DATA) {
        return 'aes256'
      }
      offset += 4 + dataSize
    }
  }

  return 'zipcrypto'
}

function getFileNameFromPath(path: string): string {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

export async function parseLocalFileHeader(
  file: File,
  offset: number
): Promise<{
  header: ZipLocalFileHeader
  dataStart: number
  dataEnd: number
}> {
  const headerBuffer = await file.slice(offset, offset + 30).arrayBuffer()
  const view = new DataView(headerBuffer)

  const signature = readUint32LE(view, 0)
  if (signature !== ZIP_SIGNATURES.LOCAL_FILE_HEADER) {
    throw new ZipFormatError(`Invalid local file header signature at offset ${offset}`)
  }

  const fileNameLength = readUint16LE(view, 26)
  const extraFieldLength = readUint16LE(view, 28)

  const headerSize = 30 + fileNameLength + extraFieldLength
  const fullBuffer = await file.slice(offset, offset + headerSize).arrayBuffer()
  const fullView = new DataView(fullBuffer)

  const flags = readUint16LE(fullView, 6)
  const useUtf8 = (flags & ZIP_FLAG_BITS.LANGUAGE_ENCODING) !== 0
  const nameBytes = new Uint8Array(fullBuffer, 30, fileNameLength)
  const fileName = decodeString(nameBytes, useUtf8)

  const extraField = fullBuffer.slice(30 + fileNameLength, headerSize)

  const header: ZipLocalFileHeader = {
    signature,
    versionNeeded: readUint16LE(fullView, 4),
    flags,
    compressionMethod: readUint16LE(fullView, 8),
    lastModTime: readUint16LE(fullView, 10),
    lastModDate: readUint16LE(fullView, 12),
    crc32: readUint32LE(fullView, 14),
    compressedSize: readUint32LE(fullView, 18),
    uncompressedSize: readUint32LE(fullView, 22),
    fileNameLength,
    extraFieldLength,
    fileName,
    extraField,
    dataOffset: offset + headerSize
  }

  return {
    header,
    dataStart: offset + headerSize,
    dataEnd: offset + headerSize + header.compressedSize
  }
}

export function buildFileTree(entries: ZipFileEntry[]): ZipFileEntry[] {
  const root: Map<string, ZipFileEntry> = new Map()
  const directories: Map<string, ZipFileEntry> = new Map()

  const ensureDirectory = (path: string, parentPath: string = ''): ZipFileEntry => {
    if (directories.has(path)) return directories.get(path)!

    const dirEntry: ZipFileEntry = {
      id: generateId(),
      name: getFileNameFromPath(path) || path,
      path: path.endsWith('/') ? path : path + '/',
      size: 0,
      compressedSize: 0,
      isDirectory: true,
      compressionMethod: COMPRESSION_METHOD.STORED,
      lastModified: new Date(),
      crc32: 0,
      localHeaderOffset: 0,
      encrypted: false,
      encryptionMode: 'none',
      children: []
    }

    directories.set(path, dirEntry)

    if (parentPath) {
      const parent = ensureDirectory(parentPath)
      if (!parent.children) parent.children = []
      parent.children.push(dirEntry)
    } else {
      root.set(path, dirEntry)
    }

    return dirEntry
  }

  for (const entry of entries) {
    if (entry.isDirectory) {
      const normalizedPath = entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path
      const idx = normalizedPath.lastIndexOf('/')
      const parentPath = idx > 0 ? normalizedPath.slice(0, idx) : ''

      if (directories.has(entry.path) || directories.has(normalizedPath + '/')) {
        const existing = directories.get(entry.path) || directories.get(normalizedPath + '/')!
        Object.assign(existing, entry, { children: existing.children || [] })
      } else {
        const dir = ensureDirectory(normalizedPath, parentPath)
        Object.assign(dir, entry, { children: dir.children || [] })
      }
    } else {
      const idx = entry.path.lastIndexOf('/')
      if (idx < 0) {
        root.set(entry.path, entry)
      } else {
        const parentPath = entry.path.slice(0, idx)
        const parent = ensureDirectory(parentPath)
        if (!parent.children) parent.children = []
        parent.children.push(entry)
      }
    }
  }

  const sortEntries = (entries: ZipFileEntry[]) => {
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    for (const e of entries) {
      if (e.children) sortEntries(e.children)
    }
  }

  const result = Array.from(root.values())
  sortEntries(result)
  return result
}
