<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatFileSize } from '@/utils/download'

interface Props {
  files: File[]
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false
})

const emit = defineEmits<{
  (e: 'create', options: { password: string; encryptionMode: string; compressionLevel: number }): void
  (e: 'clear'): void
}>()

const password = ref('')
const showPassword = ref(false)
const encryptionMode = ref<'none' | 'zipcrypto' | 'aes256'>('none')
const compressionLevel = ref(6)

const totalSize = computed(() => {
  return props.files.reduce((sum, f) => sum + f.size, 0)
})

function handleCreate() {
  emit('create', {
    password: password.value,
    encryptionMode: encryptionMode.value,
    compressionLevel: compressionLevel.value
  })
}
</script>

<template>
  <div class="pack-panel">
    <div class="panel-header">
      <h3 class="panel-title">📦 打包下载</h3>
      <span class="file-count">{{ files.length }} 个文件</span>
    </div>
    
    <div v-if="files.length === 0" class="empty-files">
      <div class="empty-icon">📁</div>
      <p>拖拽文件到此处或点击选择文件</p>
    </div>
    
    <div v-else class="files-preview">
      <div class="files-summary">
        <span class="summary-text">
          共 {{ files.length }} 个文件，总计 {{ formatFileSize(totalSize) }}
        </span>
        <button class="btn btn-secondary btn-sm" @click="emit('clear')">
          清空
        </button>
      </div>
      
      <div class="files-list">
        <div v-for="(file, index) in files.slice(0, 5)" :key="index" class="file-item">
          <span class="file-icon">📄</span>
          <span class="file-name" :title="file.name">{{ file.name }}</span>
          <span class="file-size">{{ formatFileSize(file.size) }}</span>
        </div>
        <div v-if="files.length > 5" class="more-files">
          ...还有 {{ files.length - 5 }} 个文件
        </div>
      </div>
    </div>
    
    <div class="options-section">
      <div class="form-group">
        <label class="form-label">压缩级别</label>
        <div class="compression-slider">
          <input 
            v-model.number="compressionLevel" 
            type="range" 
            min="0" 
            max="9" 
            step="1"
            :disabled="disabled"
          />
          <div class="slider-labels">
            <span>存储</span>
            <span class="level-value">级别 {{ compressionLevel }}</span>
            <span>最大</span>
          </div>
        </div>
      </div>
      
      <div class="form-group">
        <label class="form-label">加密方式</label>
        <select 
          v-model="encryptionMode" 
          class="form-input select"
          :disabled="disabled"
        >
          <option value="none">不加密</option>
          <option value="zipcrypto">ZipCrypto (传统)</option>
          <option value="aes256">AES-256 (推荐)</option>
        </select>
      </div>
      
      <div v-if="encryptionMode !== 'none'" class="form-group">
        <label class="form-label">密码</label>
        <div class="password-input-wrapper">
          <input 
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="form-input password-input"
            placeholder="请输入密码"
            :disabled="disabled"
          />
          <button 
            type="button" 
            class="toggle-password"
            @click="showPassword = !showPassword"
            :title="showPassword ? '隐藏密码' : '显示密码'"
          >
            {{ showPassword ? '🙈' : '👁️' }}
          </button>
        </div>
        <p v-if="encryptionMode === 'aes256'" class="hint">
          💡 AES-256 安全性更高，但部分旧版解压软件可能不支持
        </p>
      </div>
    </div>
    
    <button 
      class="btn btn-primary btn-lg create-btn"
      :disabled="files.length === 0 || disabled || (encryptionMode !== 'none' && !password)"
      @click="handleCreate"
    >
      🗜️ 生成 ZIP 文件
    </button>
  </div>
</template>

<style scoped>
.pack-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
}

.file-count {
  font-size: 13px;
  color: var(--text-secondary);
  background-color: var(--bg-tertiary);
  padding: 2px 10px;
  border-radius: 9999px;
}

.empty-files {
  border: 2px dashed var(--border-color);
  border-radius: var(--border-radius-lg);
  padding: 30px 20px;
  text-align: center;
  color: var(--text-muted);
}

.empty-icon {
  font-size: 36px;
  margin-bottom: 8px;
}

.empty-files p {
  font-size: 13px;
}

.files-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.files-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.summary-text {
  color: var(--text-secondary);
}

.files-list {
  background-color: var(--bg-secondary);
  border-radius: var(--border-radius);
  padding: 8px;
  max-height: 120px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.file-item:hover {
  background-color: var(--bg-tertiary);
}

.file-icon {
  flex-shrink: 0;
}

.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.more-files {
  padding: 4px 6px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.options-section {
  background-color: var(--bg-secondary);
  border-radius: var(--border-radius);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.compression-slider {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.compression-slider input[type="range"] {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-tertiary);
  outline: none;
  -webkit-appearance: none;
}

.compression-slider input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  transition: transform var(--transition-fast);
}

.compression-slider input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.compression-slider input[type="range"]:disabled {
  opacity: 0.5;
}

.compression-slider input[type="range"]:disabled::-webkit-slider-thumb {
  cursor: not-allowed;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
}

.level-value {
  font-weight: 500;
  color: var(--text-secondary);
}

.password-input-wrapper {
  position: relative;
}

.password-input {
  padding-right: 40px;
}

.toggle-password {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 16px;
  transition: background-color var(--transition-fast);
}

.toggle-password:hover {
  background-color: var(--bg-tertiary);
}

.hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 6px;
}

.create-btn {
  width: 100%;
}
</style>
