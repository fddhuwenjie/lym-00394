<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  show: boolean
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  error?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '输入密码',
  description: '该 ZIP 文件已加密，请输入密码以继续',
  confirmText: '确认',
  cancelText: '取消'
})

const emit = defineEmits<{
  (e: 'confirm', password: string): void
  (e: 'cancel'): void
  (e: 'update:show', value: boolean): void
}>()

const password = ref('')
const showPassword = ref(false)

watch(() => props.show, (newVal) => {
  if (newVal) {
    password.value = ''
  }
})

function handleConfirm() {
  if (password.value) {
    emit('confirm', password.value)
  }
}

function handleCancel() {
  emit('cancel')
  emit('update:show', false)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    handleConfirm()
  } else if (e.key === 'Escape') {
    handleCancel()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click.self="handleCancel">
      <div class="modal password-modal" @keydown="handleKeydown" tabindex="-1">
        <div class="modal-header">
          <h3 class="modal-title">🔐 {{ title }}</h3>
          <button class="modal-close" @click="handleCancel">✕</button>
        </div>
        
        <div class="modal-body">
          <p v-if="description" class="description">{{ description }}</p>
          
          <div class="form-group">
            <label class="form-label">密码</label>
            <div class="password-input-wrapper">
              <input 
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                class="form-input password-input"
                placeholder="请输入密码"
                autofocus
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
          </div>
          
          <div v-if="error" class="error-message">
            ⚠️ {{ error }}
          </div>
          
          <div class="hint">
            💡 支持 AES-256 和 ZipCrypto 加密方式
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="handleCancel">
            {{ cancelText }}
          </button>
          <button 
            class="btn btn-primary" 
            :disabled="!password"
            @click="handleConfirm"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.password-modal {
  width: 420px;
}

.description {
  color: var(--text-secondary);
  margin-bottom: 16px;
  font-size: 13px;
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

.error-message {
  background-color: #fef2f2;
  color: var(--danger-color);
  padding: 10px 12px;
  border-radius: var(--border-radius);
  font-size: 13px;
  margin-bottom: 12px;
}

.hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 8px;
}
</style>
