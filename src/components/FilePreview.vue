<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import type { FilePreviewData } from '@/types'
import { formatFileSize } from '@/utils/download'

interface Props {
  previewData: FilePreviewData | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const codeContainerRef = ref<HTMLElement | null>(null)
const highlightedLines = ref<string[]>([])

const languageMap: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  json: 'json',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  kt: 'kotlin',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  vue: 'vue',
  svelte: 'svelte',
  txt: 'plaintext'
}

const simpleKeywords: Record<string, string[]> = {
  javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity'],
  typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'true', 'false', 'null', 'undefined', 'interface', 'type', 'implements', 'public', 'private', 'protected', 'readonly', 'enum', 'namespace', 'declare'],
  python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'class', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'pass', 'yield', 'global', 'nonlocal', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'self'],
  java: ['public', 'private', 'protected', 'class', 'extends', 'implements', 'interface', 'static', 'final', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'String', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package', 'this', 'super', 'true', 'false', 'null'],
  c: ['int', 'char', 'float', 'double', 'void', 'long', 'short', 'unsigned', 'signed', 'const', 'static', 'volatile', 'extern', 'register', 'auto', 'struct', 'union', 'enum', 'typedef', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'goto', 'sizeof', 'NULL', 'true', 'false'],
  cpp: ['int', 'char', 'float', 'double', 'void', 'long', 'short', 'unsigned', 'signed', 'const', 'static', 'volatile', 'extern', 'register', 'auto', 'struct', 'union', 'enum', 'typedef', 'class', 'public', 'private', 'protected', 'virtual', 'override', 'final', 'template', 'typename', 'namespace', 'using', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'goto', 'sizeof', 'new', 'delete', 'this', 'NULL', 'nullptr', 'true', 'false'],
  go: ['package', 'import', 'func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'go', 'chan', 'select', 'defer', 'var', 'const', 'type', 'struct', 'interface', 'map', 'make', 'new', 'true', 'false', 'nil'],
  rust: ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'return', 'if', 'else', 'match', 'for', 'in', 'loop', 'while', 'break', 'continue', 'move', 'ref', 'as', 'where', 'true', 'false', 'None', 'Some', 'Box', 'Vec', 'String', 'i32', 'i64', 'u32', 'u64', 'f32', 'f64', 'bool'],
  css: ['color', 'background', 'background-color', 'background-image', 'width', 'height', 'margin', 'padding', 'border', 'border-radius', 'display', 'position', 'top', 'left', 'right', 'bottom', 'float', 'clear', 'font', 'font-size', 'font-family', 'font-weight', 'text-align', 'line-height', 'overflow', 'z-index', 'opacity', 'transform', 'transition', 'animation', 'flex', 'flex-direction', 'justify-content', 'align-items', 'grid'],
  scss: ['color', 'background', 'width', 'height', 'margin', 'padding', 'border', 'display', 'position', 'flex', 'grid', '@mixin', '@include', '@extend', '@import', '@if', '@else', '@for', '@each', '@while', '$', '#{'],
  html: ['!DOCTYPE', 'html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'form', 'input', 'button', 'select', 'option', 'textarea', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'script', 'style', 'link', 'meta', 'title', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside'],
  xml: ['xml'],
  json: [],
  markdown: [],
  yaml: [],
  toml: [],
  sql: ['SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'AS', 'DISTINCT', 'UNION', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'NULL', 'NOT NULL', 'AUTO_INCREMENT', 'INT', 'VARCHAR', 'TEXT', 'DATE', 'TIMESTAMP'],
  bash: ['echo', 'cd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'find', 'if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'export', 'source', 'alias', 'unset', 'read', 'printf', 'true', 'false'],
  php: ['<?php', 'echo', 'print', 'if', 'else', 'elseif', 'endif', 'for', 'foreach', 'while', 'do', 'endfor', 'endforeach', 'endwhile', 'switch', 'case', 'break', 'continue', 'function', 'return', 'class', 'extends', 'implements', 'public', 'private', 'protected', 'static', 'const', 'new', 'this', 'true', 'false', 'null', 'array', 'isset', 'empty', 'count'],
  ruby: ['def', 'end', 'class', 'module', 'if', 'else', 'elsif', 'unless', 'case', 'when', 'while', 'until', 'for', 'do', 'break', 'next', 'redo', 'retry', 'return', 'yield', 'begin', 'rescue', 'ensure', 'raise', 'throw', 'catch', 'true', 'false', 'nil', 'self', 'super', 'include', 'extend', 'attr_accessor', 'attr_reader', 'attr_writer'],
  swift: ['class', 'struct', 'enum', 'protocol', 'extension', 'func', 'var', 'let', 'if', 'else', 'for', 'in', 'while', 'repeat', 'switch', 'case', 'break', 'continue', 'fallthrough', 'return', 'guard', 'defer', 'do', 'try', 'catch', 'throw', 'throws', 'rethrows', 'import', 'public', 'private', 'fileprivate', 'internal', 'open', 'static', 'final', 'override', 'required', 'convenience', 'weak', 'unowned', 'true', 'false', 'nil'],
  kotlin: ['class', 'interface', 'object', 'fun', 'val', 'var', 'if', 'else', 'for', 'in', 'while', 'do', 'when', 'is', '!is', 'as', 'return', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'import', 'package', 'public', 'private', 'protected', 'internal', 'open', 'final', 'abstract', 'override', 'companion', 'data', 'sealed', 'inner', 'enum', 'annotation', 'true', 'false', 'null'],
  vue: [],
  svelte: [],
  plaintext: []
}

const language = computed(() => {
  if (!props.previewData?.entry?.name) return 'plaintext'
  const ext = props.previewData.entry.name.toLowerCase().split('.').pop() || ''
  return languageMap[ext] || 'plaintext'
})

const lines = computed(() => {
  if (!props.previewData?.content) return []
  return props.previewData.content.split('\n')
})

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function simpleHighlight(line: string, lang: string): string {
  let result = escapeHtml(line)

  const comments: Record<string, { single?: string; multiStart?: string; multiEnd?: string }> = {
    javascript: { single: '//', multiStart: '/*', multiEnd: '*/' },
    typescript: { single: '//', multiStart: '/*', multiEnd: '*/' },
    java: { single: '//', multiStart: '/*', multiEnd: '*/' },
    c: { single: '//', multiStart: '/*', multiEnd: '*/' },
    cpp: { single: '//', multiStart: '/*', multiEnd: '*/' },
    go: { single: '//', multiStart: '/*', multiEnd: '*/' },
    rust: { single: '//', multiStart: '/*', multiEnd: '*/' },
    css: { multiStart: '/*', multiEnd: '*/' },
    scss: { single: '//', multiStart: '/*', multiEnd: '*/' },
    php: { single: '//', multiStart: '/*', multiEnd: '*/' },
    swift: { single: '//', multiStart: '/*', multiEnd: '*/' },
    kotlin: { single: '//', multiStart: '/*', multiEnd: '*/' },
    sql: { single: '--', multiStart: '/*', multiEnd: '*/' },
    bash: { single: '#' },
    python: { single: '#' },
    ruby: { single: '#' },
    yaml: { single: '#' },
    toml: { single: '#' },
    vue: { single: '//', multiStart: '<!--', multiEnd: '-->' },
    html: { multiStart: '<!--', multiEnd: '-->' },
    xml: { multiStart: '<!--', multiEnd: '-->' }
  }

  const commentStyle = comments[lang]
  if (commentStyle?.single) {
    const idx = result.indexOf(commentStyle.single)
    if (idx >= 0) {
      const comment = result.slice(idx)
      result = result.slice(0, idx) + `<span class="token-comment">${comment}</span>`
    }
  }

  result = result.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, '<span class="token-string">"$1"</span>')
  result = result.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, "<span class=\"token-string\">'$1'</span>")
  result = result.replace(/`([^`\\]*(\\.[^`\\]*)*)`/g, '<span class="token-string">`$1`</span>')

  result = result.replace(/\b(\d+\.?\d*)\b/g, '<span class="token-number">$1</span>')

  const keywords = simpleKeywords[lang] || []
  if (keywords.length > 0) {
    for (const kw of keywords) {
      const regex = new RegExp(`\\b(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'g')
      result = result.replace(regex, '<span class="token-keyword">$1</span>')
    }
  }

  if (lang === 'json') {
    result = result.replace(/"([^"]+)"(\s*:)/g, '<span class="token-property">"$1"</span>$2')
  }

  if (lang === 'html' || lang === 'xml' || lang === 'vue' || lang === 'svelte') {
    result = result.replace(/&lt;(\/?)([a-zA-Z0-9-]+)/g, '&lt;$1<span class="token-tag">$2</span>')
    result = result.replace(/([a-zA-Z-]+)=/g, '<span class="token-attr">$1</span>=')
  }

  if (lang === 'css' || lang === 'scss' || lang === 'less') {
    const cssProps = simpleKeywords['css'] || []
    for (const prop of cssProps) {
      const regex = new RegExp(`\\b(${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b(\\s*:)`, 'g')
      result = result.replace(regex, '<span class="token-property">$1</span>$2')
    }
    result = result.replace(/([.#][a-zA-Z_-][a-zA-Z0-9_-]*)/g, '<span class="token-selector">$1</span>')
  }

  if (lang === 'markdown') {
    result = result.replace(/^(#{1,6}\s.+)$/gm, '<span class="token-keyword">$1</span>')
    result = result.replace(/\*\*([^*]+)\*\*/g, '<span class="token-strong">**$1**</span>')
    result = result.replace(/\*([^*]+)\*/g, '<span class="token-emphasis">*$1*</span>')
    result = result.replace(/`([^`]+)`/g, '<span class="token-code">`$1`</span>')
    result = result.replace(/^\s*[-*+]\s/gm, '<span class="token-bullet">$&</span>')
    result = result.replace(/^\s*\d+\.\s/gm, '<span class="token-bullet">$&</span>')
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="token-link">[$1]($2)</span>')
  }

  return result
}

watch(() => props.previewData?.content, () => {
  if (props.previewData?.content && lines.value.length > 0) {
    highlightedLines.value = lines.value.map(line => simpleHighlight(line, language.value))
  } else {
    highlightedLines.value = []
  }
}, { immediate: true })

const isLargeFile = computed(() => {
  return props.previewData?.entry?.size && props.previewData.entry.size > 1024 * 1024
})

const truncatedMessage = computed(() => {
  if (!props.previewData?.content) return ''
  const actualSize = new Blob([props.previewData.content]).size
  const originalSize = props.previewData.entry.size
  if (actualSize < originalSize) {
    return `文件过大，仅预览前 ${formatFileSize(actualSize)} 的内容（共 ${formatFileSize(originalSize)}）`
  }
  return ''
})
</script>

<template>
  <div class="file-preview">
    <div v-if="!previewData" class="empty-preview">
      <div class="empty-icon">👁️</div>
      <div class="empty-text">选择文件查看预览</div>
      <div class="empty-hint">支持文本、代码和图片文件</div>
    </div>

    <div v-else class="preview-content">
      <div class="preview-header">
        <div class="file-info">
          <span class="file-name" :title="previewData.entry.name">{{ previewData.entry.name }}</span>
          <span class="file-size">{{ formatFileSize(previewData.entry.size) }}</span>
          <span v-if="previewData.type === 'code'" class="lang-tag">{{ language }}</span>
          <span v-if="previewData.type === 'image'" class="lang-tag">图片</span>
          <span v-if="previewData.type === 'text'" class="lang-tag">文本</span>
          <span v-if="previewData.type === 'unsupported'" class="lang-tag">不支持</span>
        </div>
        <button class="close-btn" @click="emit('close')" title="关闭预览">✕</button>
      </div>

      <div v-if="previewData.loading" class="loading-preview">
        <div class="spinner"></div>
        <div class="loading-text">正在加载预览...</div>
      </div>

      <div v-else-if="previewData.error" class="error-preview">
        <div class="error-icon">⚠️</div>
        <div class="error-text">{{ previewData.error }}</div>
      </div>

      <div v-else-if="previewData.type === 'unsupported'" class="unsupported-preview">
        <div class="unsupported-icon">📄</div>
        <div class="unsupported-text">此文件类型暂不支持预览</div>
        <div class="unsupported-hint">请点击下载按钮查看完整内容</div>
      </div>

      <div v-else-if="previewData.type === 'image' && previewData.imageUrl" class="image-preview">
        <img :src="previewData.imageUrl" :alt="previewData.entry.name" />
      </div>

      <div v-else-if="(previewData.type === 'text' || previewData.type === 'code') && previewData.content !== undefined" class="text-preview">
        <div v-if="truncatedMessage" class="truncate-hint">{{ truncatedMessage }}</div>
        <div ref="codeContainerRef" class="code-container" :class="{ 'code-view': previewData.type === 'code' }">
          <table class="code-table">
            <tbody>
              <tr v-for="(line, index) in lines" :key="index" class="code-line">
                <td class="line-number">{{ index + 1 }}</td>
                <td class="line-content" v-html="highlightedLines[index] || '&nbsp;'"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else class="empty-preview">
        <div class="empty-icon">📭</div>
        <div class="empty-text">无预览内容</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.empty-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-muted);
  padding: 40px 20px;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.6;
}

.empty-text {
  font-size: 14px;
  color: var(--text-secondary);
}

.empty-hint {
  font-size: 12px;
}

.preview-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
  background-color: var(--bg-secondary);
  flex-shrink: 0;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}

.file-size {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.lang-tag {
  font-size: 11px;
  padding: 2px 8px;
  background-color: var(--primary-light);
  color: var(--primary-color);
  border-radius: 9999px;
  flex-shrink: 0;
  font-weight: 500;
}

.close-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 13px;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.close-btn:hover {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
}

.loading-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  font-size: 13px;
}

.error-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 20px;
}

.error-icon {
  font-size: 40px;
}

.error-text {
  font-size: 13px;
  color: var(--danger-color);
  text-align: center;
}

.unsupported-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 20px;
}

.unsupported-icon {
  font-size: 40px;
  opacity: 0.6;
}

.unsupported-text {
  font-size: 14px;
  color: var(--text-secondary);
}

.unsupported-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.image-preview {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: #1e1e1e;
}

.image-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.text-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.truncate-hint {
  padding: 6px 14px;
  background-color: #fef3c7;
  color: #92400e;
  font-size: 12px;
  border-bottom: 1px solid #fcd34d;
}

.code-container {
  flex: 1;
  overflow: auto;
  background-color: #fafafa;
}

.code-container.code-view {
  background-color: #1e1e1e;
}

.code-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', 'Monaco', monospace;
  font-size: 12.5px;
  line-height: 1.6;
}

.code-line {
  vertical-align: top;
}

.code-line:hover {
  background-color: rgba(0, 0, 0, 0.03);
}

.code-view .code-line:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.line-number {
  width: 1%;
  padding: 0 12px;
  text-align: right;
  color: #999;
  user-select: none;
  white-space: nowrap;
  border-right: 1px solid var(--border-color);
  font-variant-numeric: tabular-nums;
  background-color: var(--bg-secondary);
}

.code-view .line-number {
  color: #6e7681;
  border-right-color: #2d2d2d;
  background-color: #252526;
}

.line-content {
  padding: 0 12px;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
  color: var(--text-primary);
}

.code-view .line-content {
  color: #d4d4d4;
}

:deep(.token-keyword) {
  color: #569cd6;
  font-weight: 500;
}

.code-view :deep(.token-keyword) {
  color: #569cd6;
}

:deep(.token-string) {
  color: #a31515;
}

.code-view :deep(.token-string) {
  color: #ce9178;
}

:deep(.token-number) {
  color: #098658;
}

.code-view :deep(.token-number) {
  color: #b5cea8;
}

:deep(.token-comment) {
  color: #6a9955;
  font-style: italic;
}

.code-view :deep(.token-comment) {
  color: #6a9955;
}

:deep(.token-property) {
  color: #e50000;
}

.code-view :deep(.token-property) {
  color: #9cdcfe;
}

:deep(.token-tag) {
  color: #800000;
}

.code-view :deep(.token-tag) {
  color: #569cd6;
}

:deep(.token-attr) {
  color: #e50000;
}

.code-view :deep(.token-attr) {
  color: #9cdcfe;
}

:deep(.token-selector) {
  color: #800000;
}

.code-view :deep(.token-selector) {
  color: #d7ba7d;
}

:deep(.token-strong) {
  font-weight: 600;
  color: #af00db;
}

:deep(.token-emphasis) {
  font-style: italic;
  color: #af00db;
}

:deep(.token-code) {
  background-color: rgba(27, 31, 35, 0.05);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  color: #24292e;
}

.code-view :deep(.token-code) {
  background-color: rgba(255, 255, 255, 0.1);
  color: #dcdcaa;
}

:deep(.token-bullet) {
  color: #16a34a;
  font-weight: 500;
}

.code-view :deep(.token-bullet) {
  color: #4ec9b0;
}

:deep(.token-link) {
  color: #0366d6;
  text-decoration: underline;
}

.code-view :deep(.token-link) {
  color: #569cd6;
}
</style>
