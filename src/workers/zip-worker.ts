/// <reference lib="webworker" />

import type {
  WorkerCommand,
  WorkerResponse,
  ParseZipPayload,
  ExtractFilePayload,
  CreateZipPayload,
  ZipFileEntry,
  ZipCentralDirectory,
  ProgressData
} from '@/types'
import {
  findEndOfCentralDirectory,
  parseEndOfCentralDirectory,
  readCentralDirectory,
  parseCentralDirectory,
  buildFileTree
} from '@/core/zip-parser'
import { extractFileToBlob, extractFileToStream } from '@/core/stream-utils'
import { createZipArchive, createSplitZipArchive } from '@/core/zip-packer'

let isCancelled = false
let activeCommandId: string | null = null

function sendProgress(commandId: string, progress: ProgressData): void {
  const response: WorkerResponse = {
    type: 'PROGRESS',
    commandId,
    payload: progress
  }
  postMessage(response)
}

function sendResult(commandId: string, payload: any): void {
  const response: WorkerResponse = {
    type: 'RESULT',
    commandId,
    payload
  }
  postMessage(response)
}

function sendError(commandId: string, error: string | Error): void {
  const response: WorkerResponse = {
    type: 'ERROR',
    commandId,
    payload: error instanceof Error ? error.message : String(error)
  }
  postMessage(response)
}

function sendStatus(commandId: string, status: string): void {
  const response: WorkerResponse = {
    type: 'STATUS',
    commandId,
    payload: status
  }
  postMessage(response)
}

async function handleParseZip(commandId: string, payload: ParseZipPayload): Promise<void> {
  activeCommandId = commandId
  isCancelled = false

  try {
    const { file, password } = payload
    sendStatus(commandId, 'PARSING')

    const eocdr = await findEndOfCentralDirectory(file)
    const eocdrInfo = parseEndOfCentralDirectory(eocdr.view)

    let totalEntries = eocdrInfo.totalEntries
    let centralDirSize = eocdrInfo.centralDirectorySize
    let centralDirOffset = eocdrInfo.centralDirectoryOffset

    if (totalEntries === 0xffff || centralDirSize === 0xffffffff || centralDirOffset === 0xffffffff) {
      sendError(commandId, 'ZIP64 archives are not fully supported in this worker context')
      return
    }

    const onProgress = (bytes: number, total: number) => {
      if (isCancelled) return
      sendProgress(commandId, {
        bytesProcessed: bytes,
        totalBytes: total,
        percentage: total > 0 ? Math.round((bytes / total) * 100) : 0,
        fileName: file.name
      })
    }

    const centralDirBuffer = await readCentralDirectory(
      file,
      centralDirOffset,
      centralDirSize,
      onProgress
    )

    const commentView = new DataView(
      eocdr.view.buffer,
      eocdr.view.byteOffset + 22,
      eocdrInfo.commentLength
    )
    const comment = new TextDecoder('utf-8').decode(
      new Uint8Array(commentView.buffer, commentView.byteOffset, commentView.byteLength)
    )

    const centralDir: ZipCentralDirectory = parseCentralDirectory(
      centralDirBuffer,
      totalEntries,
      comment
    )

    const tree = buildFileTree(centralDir.entries)

    const needsPassword = centralDir.entries.some(e => e.encrypted)
    if (needsPassword && !password) {
      sendResult(commandId, {
        type: 'PASSWORD_REQUIRED',
        entries: centralDir.entries,
        tree,
        file,
        centralDirectory: centralDir
      })
      return
    }

    if (needsPassword && password) {
      const encryptedEntries = centralDir.entries.filter(e => e.encrypted)
      if (encryptedEntries.length > 0) {
        try {
          const firstEncrypted = encryptedEntries[0]
          await extractFileToBlob(file, {
            entry: firstEncrypted,
            password,
            verifyCRC: false
          })
        } catch (e: any) {
          if (e.message && (e.message.includes('assword') || e.message.includes('incorrect'))) {
            sendResult(commandId, {
              type: 'PASSWORD_INCORRECT',
              entries: centralDir.entries,
              tree,
              file,
              centralDirectory: centralDir
            })
            return
          }
        }
      }
    }

    sendResult(commandId, {
      type: 'PARSE_COMPLETE',
      entries: centralDir.entries,
      tree,
      file,
      centralDirectory: centralDir
    })
  } catch (error: any) {
    sendError(commandId, error)
  } finally {
    activeCommandId = null
  }
}

async function handleExtractFile(commandId: string, payload: ExtractFilePayload): Promise<void> {
  activeCommandId = commandId
  isCancelled = false

  try {
    const { file, entry, password, mode } = payload
    sendStatus(commandId, 'EXTRACTING')

    const onProgress = (bytes: number, total: number) => {
      if (isCancelled) return
      sendProgress(commandId, {
        bytesProcessed: bytes,
        totalBytes: total,
        percentage: total > 0 ? Math.round((bytes / total) * 100) : 0,
        fileName: entry.name
      })
    }

    if (mode === 'blob') {
      const result = await extractFileToBlob(file, {
        entry,
        password,
        onProgress,
        verifyCRC: true
      })

      sendResult(commandId, {
        type: 'EXTRACT_COMPLETE',
        entry,
        blob: result.blob,
        actualSize: result.actualSize,
        computedCRC32: result.computedCRC32
      })
    } else {
      const result = await extractFileToStream(file, {
        entry,
        password,
        onProgress
      })

      sendResult(commandId, {
        type: 'EXTRACT_STREAM_READY',
        entry,
        stream: result.stream,
        actualSize: result.actualSize,
        computedCRC32: result.computedCRC32,
        passwordVerified: result.passwordVerified
      })
    }
  } catch (error: any) {
    sendError(commandId, error)
  } finally {
    activeCommandId = null
  }
}

async function handleCreateZip(commandId: string, payload: CreateZipPayload): Promise<void> {
  activeCommandId = commandId
  isCancelled = false

  try {
    sendStatus(commandId, 'CREATING')

    const onProgress = (
      bytesProcessed: number,
      totalBytes: number,
      filesCompleted: number,
      totalFiles: number
    ) => {
      if (isCancelled) return
      sendProgress(commandId, {
        bytesProcessed,
        totalBytes,
        percentage: totalBytes > 0 ? Math.round((bytesProcessed / totalBytes) * 100) : 0,
        filesCompleted,
        totalFiles
      })
    }

    if (payload.splitVolumeSize && payload.splitVolumeSize > 0) {
      const result = await createSplitZipArchive(payload, onProgress)

      sendResult(commandId, {
        type: 'CREATE_COMPLETE',
        blob: result.blob,
        size: result.blob.size,
        splitVolumes: result.splitVolumes
      })
    } else {
      const blob = await createZipArchive(payload, onProgress)

      sendResult(commandId, {
        type: 'CREATE_COMPLETE',
        blob,
        size: blob.size
      })
    }
  } catch (error: any) {
    sendError(commandId, error)
  } finally {
    activeCommandId = null
  }
}

self.addEventListener('message', async (event: MessageEvent<WorkerCommand>) => {
  const command = event.data

  if (command.type === 'CANCEL') {
    isCancelled = true
    sendStatus(command.id, 'CANCELLED')
    return
  }

  try {
    switch (command.type) {
      case 'PARSE_ZIP':
        await handleParseZip(command.id, command.payload)
        break
      case 'EXTRACT_FILE':
        await handleExtractFile(command.id, command.payload)
        break
      case 'CREATE_ZIP':
        await handleCreateZip(command.id, command.payload)
        break
      default:
        sendError(command.id, `Unknown command type: ${command.type}`)
    }
  } catch (error: any) {
    sendError(command.id, error)
  }
})
