import type {
  WorkerCommand,
  WorkerResponse,
  ParseZipPayload,
  ExtractFilePayload,
  CreateZipPayload,
  ProgressData,
  ZipFileEntry,
  SplitVolumeFile
} from '@/types'
import ZipWorker from '@/workers/zip-worker.ts?worker'

export type EventHandler = {
  onProgress?: (progress: ProgressData) => void
  onResult?: (payload: any) => void
  onError?: (error: string) => void
  onStatus?: (status: string) => void
}

export interface PendingCommand {
  id: string
  type: WorkerCommand['type']
  handlers: EventHandler
}

export class ZipWorkerClient {
  private worker: Worker | null = null
  private pendingCommands: Map<string, PendingCommand> = new Map()
  private globalHandlers: EventHandler = {}

  constructor() {
    this.initWorker()
  }

  private initWorker(): void {
    this.worker = new ZipWorker({
      type: 'module'
    })

    this.worker.addEventListener('message', this.handleMessage.bind(this))
    this.worker.addEventListener('error', this.handleError.bind(this))
  }

  private handleMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data
    const pending = this.pendingCommands.get(response.commandId)

    switch (response.type) {
      case 'PROGRESS':
        pending?.handlers.onProgress?.(response.payload)
        this.globalHandlers.onProgress?.(response.payload)
        break
      case 'RESULT':
        pending?.handlers.onResult?.(response.payload)
        this.globalHandlers.onResult?.(response.payload)
        this.pendingCommands.delete(response.commandId)
        break
      case 'ERROR':
        pending?.handlers.onError?.(response.payload)
        this.globalHandlers.onError?.(response.payload)
        this.pendingCommands.delete(response.commandId)
        break
      case 'STATUS':
        pending?.handlers.onStatus?.(response.payload)
        this.globalHandlers.onStatus?.(response.payload)
        break
    }
  }

  private handleError(event: ErrorEvent): void {
    console.error('Worker error:', event)
    for (const [, pending] of this.pendingCommands) {
      pending.handlers.onError?.(event.message || 'Worker error')
    }
    this.pendingCommands.clear()
  }

  private generateId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }

  sendCommand(command: WorkerCommand): void {
    if (!this.worker) {
      this.initWorker()
    }
    this.worker!.postMessage(command)
  }

  parseZip(
    payload: ParseZipPayload,
    handlers: EventHandler = {}
  ): Promise<{
    type: string
    entries: ZipFileEntry[]
    tree: ZipFileEntry[]
    file: File
    centralDirectory: any
  }> {
    const id = this.generateId()
    const command: WorkerCommand = {
      type: 'PARSE_ZIP',
      id,
      payload
    }

    this.pendingCommands.set(id, {
      id,
      type: 'PARSE_ZIP',
      handlers
    })

    return new Promise((resolve, reject) => {
      this.pendingCommands.get(id)!.handlers.onResult = (result) => {
        handlers.onResult?.(result)
        resolve(result)
      }
      this.pendingCommands.get(id)!.handlers.onError = (error) => {
        handlers.onError?.(error)
        reject(new Error(error))
      }
      this.sendCommand(command)
    })
  }

  extractFile(
    payload: ExtractFilePayload,
    handlers: EventHandler = {}
  ): Promise<{
    type: string
    entry: ZipFileEntry
    blob?: Blob
    stream?: ReadableStream
    actualSize: number
    computedCRC32: number
  }> {
    const id = this.generateId()
    const command: WorkerCommand = {
      type: 'EXTRACT_FILE',
      id,
      payload
    }

    this.pendingCommands.set(id, {
      id,
      type: 'EXTRACT_FILE',
      handlers
    })

    return new Promise((resolve, reject) => {
      this.pendingCommands.get(id)!.handlers.onResult = (result) => {
        handlers.onResult?.(result)
        resolve(result)
      }
      this.pendingCommands.get(id)!.handlers.onError = (error) => {
        handlers.onError?.(error)
        reject(new Error(error))
      }
      this.sendCommand(command)
    })
  }

  createZip(
    payload: CreateZipPayload,
    handlers: EventHandler = {}
  ): Promise<{
    type: string
    blob: Blob
    size: number
    splitVolumes?: SplitVolumeFile[]
  }> {
    const id = this.generateId()
    const command: WorkerCommand = {
      type: 'CREATE_ZIP',
      id,
      payload
    }

    this.pendingCommands.set(id, {
      id,
      type: 'CREATE_ZIP',
      handlers
    })

    return new Promise((resolve, reject) => {
      this.pendingCommands.get(id)!.handlers.onResult = (result) => {
        handlers.onResult?.(result)
        resolve(result)
      }
      this.pendingCommands.get(id)!.handlers.onError = (error) => {
        handlers.onError?.(error)
        reject(new Error(error))
      }
      this.sendCommand(command)
    })
  }

  cancel(): void {
    const id = this.generateId()
    this.sendCommand({
      type: 'CANCEL',
      id,
      payload: null
    })
  }

  setGlobalHandlers(handlers: EventHandler): void {
    this.globalHandlers = handlers
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.pendingCommands.clear()
  }

  restart(): void {
    this.terminate()
    this.initWorker()
  }
}

let workerClientInstance: ZipWorkerClient | null = null

export function getZipWorkerClient(): ZipWorkerClient {
  if (!workerClientInstance) {
    workerClientInstance = new ZipWorkerClient()
  }
  return workerClientInstance
}
