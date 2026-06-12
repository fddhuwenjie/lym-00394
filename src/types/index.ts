export interface ZipFileEntry {
  id: string
  name: string
  path: string
  size: number
  compressedSize: number
  isDirectory: boolean
  compressionMethod: number
  lastModified: Date
  crc32: number
  localHeaderOffset: number
  encrypted: boolean
  encryptionMode?: 'aes256' | 'zipcrypto' | 'none'
  children?: ZipFileEntry[]
  extraField?: ArrayBuffer
  fileComment?: string
}

export interface ZipCentralDirectory {
  entries: ZipFileEntry[]
  comment: string
  size: number
  offset: number
}

export interface ZipLocalFileHeader {
  signature: number
  versionNeeded: number
  flags: number
  compressionMethod: number
  lastModTime: number
  lastModDate: number
  crc32: number
  compressedSize: number
  uncompressedSize: number
  fileNameLength: number
  extraFieldLength: number
  fileName: string
  extraField: ArrayBuffer
  dataOffset: number
}

export interface ZipDataDescriptor {
  crc32: number
  compressedSize: number
  uncompressedSize: number
}

export type WorkerCommandType =
  | 'PARSE_ZIP'
  | 'EXTRACT_FILE'
  | 'EXTRACT_ALL'
  | 'CREATE_ZIP'
  | 'CANCEL'

export type WorkerStatusType =
  | 'IDLE'
  | 'PARSING'
  | 'EXTRACTING'
  | 'CREATING'
  | 'CANCELLED'
  | 'ERROR'

export interface WorkerCommand {
  type: WorkerCommandType
  id: string
  payload: any
}

export interface WorkerResponse {
  type: 'PROGRESS' | 'RESULT' | 'ERROR' | 'STATUS' | 'LOG'
  commandId: string
  payload: any
}

export interface ParseZipPayload {
  file: File
  password?: string
}

export interface ExtractFilePayload {
  file: File
  entry: ZipFileEntry
  password?: string
  mode: 'blob' | 'stream'
}

export interface CreateZipPayload {
  files: File[]
  password?: string
  encryptionMode: 'aes256' | 'zipcrypto' | 'none'
  compressionLevel: number
}

export interface ProgressData {
  bytesProcessed: number
  totalBytes: number
  percentage: number
  fileName?: string
  filesCompleted?: number
  totalFiles?: number
}

export interface ExtractResult {
  entry: ZipFileEntry
  blob?: Blob
  stream?: ReadableStream
}

export interface CreateZipResult {
  blob: Blob
  size: number
}

export type TreeData = {
  name: string
  path: string
  isDirectory: boolean
  size: number
  children: TreeData[]
  entry?: ZipFileEntry
  selected: boolean
  expanded: boolean
}
