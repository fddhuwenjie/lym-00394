<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ZipFileEntry, TreeData, ProgressData } from '@/types'
import { getZipWorkerClient } from '@/core/worker-client'
import { extractFileToStream } from '@/core/stream-utils'
import { downloadStream, formatFileSize } from '@/utils/download'
import FileTree from '@/components/FileTree.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import PasswordModal from '@/components/PasswordModal.vue'
import PackPanel from '@/components/PackPanel.vue'

const activeTab = ref<'extract' | 'pack'>('extract')
const isDragging = ref(false)
const isParsing = ref(false)
const isCreating = ref(false)
const isExtracting = ref(false)

const zipFile = ref<File | null>(null)
const zipEntries = ref<ZipFileEntry[]>([])
const treeData = ref<TreeData[]>([])
const currentPassword = ref('')
const passwordModalShow = ref(false)
const passwordError = ref('')
const pendingPasswordAction = ref<null | { type: 'parse' | 'extract'; entry?: ZipFileEntry }>(null)

const packFiles = ref<File[]>([])

const fileInputRef = ref<HTMLInputElement | null>(null)
const packFileInputRef = ref<HTMLInputElement | null>(null)

const parseProgress = ref<ProgressData>({
  bytesProcessed: 0,
  totalBytes: 0,
  percentage: 0
})

const extractProgress = ref<ProgressData>({
  bytesProcessed: 0,
  totalBytes: 0,
  percentage: 0,
  fileName: ''
})

const createProgress = ref<ProgressData>({
  bytesProcessed: 0,
  totalBytes: 0,
  percentage: 0,
  filesCompleted: 0,
  totalFiles: 0
})

const workerClient = getZipWorkerClient()

const zipInfo = computed(() => {
  if (!zipFile.value) return null
  return {
    name: zipFile.value.name,
    size: zipFile.value.size,
    entryCount: zipEntries.value.length
  }
})

function convertToTreeData(entries: ZipFileEntry[]): TreeData[] {
  const root: Map<string, TreeData> = new Map()
  const directories: Map<string, TreeData> = new Map()

  const ensureDirectory = (path: string, parentPath: string = ''): TreeData => {
    if (directories.has(path)) return directories.get(path)!

    const dirEntry: TreeData = {
      name: getFileNameFromPath(path) || path,
      path: path.endsWith('/') ? path : path + '/',
      isDirectory: true,
      size: 0,
      children: [],
      selected: false,
      expanded: false
    }

    directories.set(path, dirEntry)

    if (parentPath) {
      const parent = ensureDirectory(parentPath)
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
        Object.assign(existing, { entry, children: existing.children || [] })
      } else {
        const dir = ensureDirectory(normalizedPath, parentPath)
        Object.assign(dir, { entry, children: dir.children || [] })
      }
    } else {
      const idx = entry.path.lastIndexOf('/')
      const treeItem: TreeData = {
        name: entry.name,
        path: entry.path,
        isDirectory: false,
        size: entry.size,
        children: [],
        entry,
        selected: false,
        expanded: false
      }

      if (idx < 0) {
        root.set(entry.path, treeItem)
      } else {
        const parentPath = entry.path.slice(0, idx)
        const parent = ensureDirectory(parentPath)
        parent.children.push(treeItem)
      }
    }
  }

  const sortItems = (items: TreeData[]) => {
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    for (const item of items) {
      if (item.children && item.children.length > 0) {
        sortItems(item.children)
      }
    }
  }

  const result = Array.from(root.values())
  sortItems(result)
  return result
}

function getFileNameFromPath(path: string): string {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false

  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  if (activeTab.value === 'extract') {
    const zipFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.zip'))
    if (zipFiles.length > 0) {
      loadZipFile(zipFiles[0])
    }
  } else {
    packFiles.value = Array.from(files)
  }
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

function triggerPackFileInput() {
  packFileInputRef.value?.click()
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  if (activeTab.value === 'extract') {
    loadZipFile(files[0])
  }
  input.value = ''
}

function handlePackFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  packFiles.value = [...packFiles.value, ...Array.from(files)]
  input.value = ''
}

async function loadZipFile(file: File) {
  zipFile.value = file
  zipEntries.value = []
  treeData.value = []
  currentPassword.value = ''
  passwordError.value = ''
  isParsing.value = true
  parseProgress.value = { bytesProcessed: 0, totalBytes: 0, percentage: 0 }

  try {
    const result = await workerClient.parseZip(
      { file },
      {
        onProgress: (progress) => {
          parseProgress.value = progress
        }
      }
    )

    if (result.type === 'PASSWORD_REQUIRED') {
      pendingPasswordAction.value = { type: 'parse' }
      passwordModalShow.value = true
      zipEntries.value = result.entries
      treeData.value = convertToTreeData(result.entries)
    } else if (result.type === 'PASSWORD_INCORRECT') {
      passwordError.value = '密码错误，请重试'
      pendingPasswordAction.value = { type: 'parse' }
      passwordModalShow.value = true
      zipEntries.value = result.entries
      treeData.value = convertToTreeData(result.entries)
    } else {
      zipEntries.value = result.entries
      treeData.value = convertToTreeData(result.entries)
    }
  } catch (error: any) {
    console.error('Parse error:', error)
    alert('解析 ZIP 文件失败: ' + error.message)
  } finally {
    isParsing.value = false
  }
}

async function handlePasswordConfirm(password: string) {
  currentPassword.value = password
  passwordError.value = ''

  if (pendingPasswordAction.value?.type === 'parse') {
    passwordModalShow.value = false
    if (zipFile.value) {
      isParsing.value = true
      try {
        const result = await workerClient.parseZip(
          { file: zipFile.value, password },
          {
            onProgress: (progress) => {
              parseProgress.value = progress
            }
          }
        )

        if (result.type === 'PASSWORD_INCORRECT') {
          passwordError.value = '密码错误，请重试'
          passwordModalShow.value = true
          pendingPasswordAction.value = { type: 'parse' }
        } else {
          zipEntries.value = result.entries
          treeData.value = convertToTreeData(result.entries)
        }
      } catch (error: any) {
        alert('解析失败: ' + error.message)
      } finally {
        isParsing.value = false
      }
    }
  } else if (pendingPasswordAction.value?.type === 'extract' && pendingPasswordAction.value.entry) {
    passwordModalShow.value = false
    const entry = pendingPasswordAction.value.entry
    downloadSingleFile(entry, password)
  }

  pendingPasswordAction.value = null
}

function handlePasswordCancel() {
  passwordModalShow.value = false
  passwordError.value = ''
  pendingPasswordAction.value = null
}

async function handleDownload(item: TreeData) {
  if (!item.entry || item.isDirectory) return
  downloadSingleFile(item.entry)
}

async function downloadSingleFile(entry: ZipFileEntry, password?: string) {
  if (!zipFile.value) return

  if (entry.encrypted && !password && !currentPassword.value) {
    pendingPasswordAction.value = { type: 'extract', entry }
    passwordModalShow.value = true
    return
  }

  const pwd = password || currentPassword.value

  isExtracting.value = true
  extractProgress.value = {
    bytesProcessed: 0,
    totalBytes: entry.size,
    percentage: 0,
    fileName: entry.name
  }

  try {
    const result = await extractFileToStream(zipFile.value, {
      entry,
      password: pwd,
      onProgress: (bytes, total) => {
        extractProgress.value = {
          bytesProcessed: bytes,
          totalBytes: total,
          percentage: total > 0 ? Math.round((bytes / total) * 100) : 0,
          fileName: entry.name
        }
      }
    })

    await downloadStream(result.stream, entry.name, {
      suggestedSize: entry.size,
      onProgress: (bytes) => {
        extractProgress.value.bytesProcessed = bytes
        extractProgress.value.percentage = entry.size > 0 ? Math.round((bytes / entry.size) * 100) : 0
      }
    })
  } catch (error: any) {
    if (error.message && (error.message.includes('assword') || error.message.includes('incorrect'))) {
      passwordError.value = '密码错误，请重试'
      pendingPasswordAction.value = { type: 'extract', entry }
      passwordModalShow.value = true
    } else {
      console.error('Extract error:', error)
      alert('解压失败: ' + error.message)
    }
  } finally {
    isExtracting.value = false
  }
}

async function handleCreateZip(options: { password: string; encryptionMode: string; compressionLevel: number }) {
  if (packFiles.value.length === 0) return

  isCreating.value = true
  createProgress.value = {
    bytesProcessed: 0,
    totalBytes: packFiles.value.reduce((sum, f) => sum + f.size, 0),
    percentage: 0,
    filesCompleted: 0,
    totalFiles: packFiles.value.length
  }

  try {
    const result = await workerClient.createZip(
      {
        files: packFiles.value,
        password: options.password || undefined,
        encryptionMode: options.encryptionMode as any,
        compressionLevel: options.compressionLevel
      },
      {
        onProgress: (progress) => {
          createProgress.value = progress
        }
      }
    )

    if (result.type === 'CREATE_COMPLETE') {
      const url = URL.createObjectURL(result.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'archive.zip'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    }
  } catch (error: any) {
    console.error('Create zip error:', error)
    alert('创建 ZIP 失败: ' + error.message)
  } finally {
    isCreating.value = false
  }
}

function handleClearPackFiles() {
  packFiles.value = []
}

function closeZip() {
  zipFile.value = null
  zipEntries.value = []
  treeData.value = []
  currentPassword.value = ''
}

onMounted(() => {
  workerClient.setGlobalHandlers({
    onError: (error) => {
      console.error('Worker error:', error)
    }
  })
})

onUnmounted(() => {
  workerClient.terminate()
})
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <div class="header-content">
        <h1 class="app-title">🗜️ Browser ZIP Tool</h1>
        <p class="app-subtitle">纯浏览器端 ZIP 解压/打包工具 · 流式处理 · Web Worker · AES 加密</p>
      </div>
    </header>

    <main class="app-main">
      <div class="tabs">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'extract' }"
          @click="activeTab = 'extract'"
        >
          📂 解压预览
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'pack' }"
          @click="activeTab = 'pack'"
        >
          📦 打包下载
        </button>
      </div>

      <div class="content-area">
        <div v-if="activeTab === 'extract'" class="extract-panel">
          <div
            class="drop-zone"
            :class="{ 'drag-over': isDragging, 'has-file': zipFile }"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
            @click="triggerFileInput"
          >
            <input
              ref="fileInputRef"
              type="file"
              accept=".zip"
              class="file-input"
              @change="handleFileSelect"
            />
            
            <div v-if="!zipFile" class="drop-content">
              <div class="drop-icon">📁</div>
              <h3 class="drop-title">拖入 ZIP 文件</h3>
              <p class="drop-hint">或点击此处选择文件</p>
              <p class="drop-features">
                <span class="feature-tag">流式解压</span>
                <span class="feature-tag">大文件支持</span>
                <span class="feature-tag">加密支持</span>
              </p>
            </div>

            <div v-else class="file-info">
              <div class="file-icon">📦</div>
              <div class="file-details">
                <div class="file-name" :title="zipInfo?.name">{{ zipInfo?.name }}</div>
                <div class="file-meta">
                  <span>{{ formatFileSize(zipInfo?.size || 0) }}</span>
                  <span>·</span>
                  <span>{{ zipInfo?.entryCount }} 个文件</span>
                </div>
              </div>
              <button class="close-btn" @click.stop="closeZip">✕</button>
            </div>
          </div>

          <div v-if="isParsing" class="progress-section">
            <ProgressBar
              :percentage="parseProgress.percentage"
              label="正在解析..."
              :status="parseProgress.percentage === 100 ? 'success' : 'default'"
            />
          </div>

          <div v-if="zipFile && !isParsing" class="file-tree-section">
            <div class="section-header">
              <h3 class="section-title">📋 文件列表</h3>
              <span class="entry-count">{{ zipEntries.length }} 个项目</span>
            </div>
            <div class="file-tree-wrapper">
              <FileTree
                :items="treeData"
                :show-download="true"
                @download="handleDownload"
              />
            </div>
          </div>

          <div v-if="isExtracting" class="progress-section extracting">
            <div class="extract-info">
              <span class="extract-label">正在解压:</span>
              <span class="extract-name">{{ extractProgress.fileName }}</span>
            </div>
            <ProgressBar
              :percentage="extractProgress.percentage"
              :show-percentage="true"
            />
            <div class="extract-size">
              {{ formatFileSize(extractProgress.bytesProcessed) }} / {{ formatFileSize(extractProgress.totalBytes) }}
            </div>
          </div>
        </div>

        <div v-else class="pack-panel-wrapper">
          <div
            class="drop-zone pack-drop-zone"
            :class="{ 'drag-over': isDragging }"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
            @click="triggerPackFileInput"
          >
            <input
              ref="packFileInputRef"
              type="file"
              multiple
              class="file-input"
              @change="handlePackFileSelect"
            />
            
            <div class="drop-content">
              <div class="drop-icon">📤</div>
              <h3 class="drop-title">拖入文件</h3>
              <p class="drop-hint">或点击选择要打包的文件</p>
            </div>
          </div>

          <PackPanel
            :files="packFiles"
            :disabled="isCreating"
            @create="handleCreateZip"
            @clear="handleClearPackFiles"
          />

          <div v-if="isCreating" class="progress-section">
            <div class="create-info">
              <span class="create-label">正在创建 ZIP...</span>
              <span class="create-count">
                {{ createProgress.filesCompleted }} / {{ createProgress.totalFiles }} 个文件
              </span>
            </div>
            <ProgressBar
              :percentage="createProgress.percentage"
            />
            <div class="create-size">
              {{ formatFileSize(createProgress.bytesProcessed) }} / {{ formatFileSize(createProgress.totalBytes) }}
            </div>
          </div>
        </div>
      </div>
    </main>

    <PasswordModal
      v-model:show="passwordModalShow"
      :error="passwordError"
      @confirm="handlePasswordConfirm"
      @cancel="handlePasswordCancel"
    />
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  background: linear-gradient(135deg, var(--primary-color) 0%, #7c3aed 100%);
  color: white;
  padding: 24px 20px;
  box-shadow: var(--shadow-md);
}

.header-content {
  max-width: 900px;
  margin: 0 auto;
}

.app-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 4px;
}

.app-subtitle {
  font-size: 13px;
  opacity: 0.9;
}

.app-main {
  flex: 1;
  padding: 20px;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  background-color: var(--bg-primary);
  padding: 4px;
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-sm);
}

.tab-btn {
  flex: 1;
  padding: 10px 16px;
  border-radius: var(--border-radius);
  font-weight: 500;
  font-size: 14px;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}

.tab-btn:hover {
  background-color: var(--bg-secondary);
  color: var(--text-primary);
}

.tab-btn.active {
  background-color: var(--primary-color);
  color: white;
}

.content-area {
  background-color: var(--bg-primary);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 20px;
}

.extract-panel,
.pack-panel-wrapper {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.drop-zone {
  border: 2px dashed var(--border-color);
  border-radius: var(--border-radius-lg);
  padding: 30px 20px;
  text-align: center;
  cursor: pointer;
  transition: all var(--transition-normal);
  background-color: var(--bg-secondary);
}

.drop-zone:hover {
  border-color: var(--primary-color);
  background-color: var(--primary-light);
}

.drop-zone.drag-over {
  border-color: var(--primary-color);
  background-color: var(--primary-light);
  transform: scale(1.01);
}

.drop-zone.has-file {
  cursor: default;
  padding: 16px 20px;
}

.drop-zone.has-file:hover {
  background-color: var(--bg-secondary);
  border-color: var(--border-color);
}

.file-input {
  display: none;
}

.drop-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.drop-icon {
  font-size: 48px;
  margin-bottom: 4px;
}

.drop-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.drop-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.drop-features {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.feature-tag {
  font-size: 11px;
  padding: 3px 10px;
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
  border-radius: 9999px;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 14px;
  text-align: left;
}

.file-icon {
  font-size: 36px;
  flex-shrink: 0;
}

.file-details {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--border-radius);
  color: var(--text-muted);
  font-size: 14px;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.close-btn:hover {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
}

.progress-section {
  padding: 16px;
  background-color: var(--bg-secondary);
  border-radius: var(--border-radius);
}

.progress-section.extracting {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.extract-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.extract-label {
  color: var(--text-secondary);
  font-weight: 500;
}

.extract-name {
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extract-size {
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
}

.file-tree-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
}

.entry-count {
  font-size: 12px;
  color: var(--text-muted);
  background-color: var(--bg-secondary);
  padding: 2px 10px;
  border-radius: 9999px;
}

.file-tree-wrapper {
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  max-height: 400px;
  overflow-y: auto;
  background-color: var(--bg-primary);
}

.pack-drop-zone {
  padding: 24px 20px;
}

.create-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 10px;
}

.create-label {
  color: var(--text-secondary);
  font-weight: 500;
}

.create-count {
  color: var(--text-primary);
  font-weight: 600;
}

.create-size {
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
  margin-top: 8px;
}

@media (max-width: 640px) {
  .app-header {
    padding: 16px;
  }

  .app-title {
    font-size: 20px;
  }

  .app-main {
    padding: 12px;
  }

  .content-area {
    padding: 16px;
  }
}
</style>
