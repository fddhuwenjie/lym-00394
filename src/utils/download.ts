export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 60000)
  }
}

export async function downloadStream(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  options?: {
    suggestedSize?: number
    mimeType?: string
    onProgress?: (bytesDownloaded: number) => void
  }
): Promise<void> {
  const mimeType = options?.mimeType || guessMimeType(filename)

  if ('showSaveFilePicker' in window) {
    try {
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: getFileDescription(filename),
            accept: {
              [mimeType]: getFileExtensions(filename)
            }
          }
        ]
      })

      const writable = await fileHandle.createWritable()
      const writer = writable.getWriter()
      const reader = stream.getReader()
      let totalBytes = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          await writer.write(value)
          totalBytes += value.length
          options?.onProgress?.(totalBytes)
          await new Promise(resolve => setTimeout(resolve, 0))
        }
        await writer.close()
      } catch (e) {
        try { await writer.abort() } catch {}
        throw e
      }

      return
    } catch (e: any) {
      if (e && e.name === 'AbortError') {
        return
      }
    }
  }

  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalBytes += value.length
    options?.onProgress?.(totalBytes)
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  const blob = new Blob(chunks, { type: mimeType })
  await downloadBlob(blob, filename)
}

export function createDownloadStream(
  onChunk?: (chunk: Uint8Array) => void
): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      onChunk?.(chunk)
      controller.enqueue(chunk)
    }
  })
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

function getFileDescription(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''
  const descriptions: Record<string, string> = {
    txt: 'Text Files',
    html: 'HTML Files',
    htm: 'HTML Files',
    css: 'CSS Files',
    js: 'JavaScript Files',
    json: 'JSON Files',
    xml: 'XML Files',
    png: 'PNG Images',
    jpg: 'JPEG Images',
    jpeg: 'JPEG Images',
    gif: 'GIF Images',
    webp: 'WebP Images',
    svg: 'SVG Images',
    pdf: 'PDF Documents',
    zip: 'ZIP Archives',
    mp3: 'MP3 Audio',
    mp4: 'MP4 Video',
    wav: 'WAV Audio'
  }
  return descriptions[ext] || 'All Files'
}

function getFileExtensions(filename: string): string[] {
  const ext = filename.toLowerCase().split('.').pop() || ''
  if (ext) return [`.${ext}`]
  return ['.*']
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

export function getFilenameFromPath(path: string): string {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

export function getDirectoryFromPath(path: string): string {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(0, idx) : ''
}
