<script setup lang="ts">import { computed } from 'vue';
import type { TreeData } from '@/types';
import { formatFileSize } from '@/utils/download';
interface Props {
 items: TreeData[];
 selectable?: boolean;
 showDownload?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
 selectable: false,
 showDownload: false
});
const emit = defineEmits<{
 (e: 'toggle', item: TreeData): void;
 (e: 'select', item: TreeData, selected: boolean): void;
 (e: 'download', item: TreeData): void;
 (e: 'itemClick', item: TreeData): void;
}>();
function toggleExpand(item: TreeData) {
 if (item.isDirectory) {
 item.expanded = !item.expanded;
 emit('toggle', item);
 }
}
function handleSelect(item: TreeData, event: Event) {
 event.stopPropagation();
 item.selected = !item.selected;
 emit('select', item, item.selected);
}
function handleDownload(item: TreeData, event: Event) {
 event.stopPropagation();
 emit('download', item);
}
function handleItemClick(item: TreeData) {
 if (item.isDirectory) {
 toggleExpand(item);
 }
 emit('itemClick', item);
}
function getFileIcon(item: TreeData): string {
 if (item.isDirectory) {
 return item.expanded ? '📂' : '📁';
 }
 const ext = item.name.toLowerCase().split('.').pop() || '';
 const iconMap: Record<string, string> = {
 pdf: '📄',
 doc: '📝', docx: '📝',
 xls: '📊', xlsx: '📊',
 ppt: '📽️', pptx: '📽️',
 jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
 mp3: '🎵', wav: '🎵',
 mp4: '🎬', webm: '🎬',
 zip: '🗜️', rar: '🗜️', '7z': '🗜️',
 js: '📜', ts: '📜', json: '📜', html: '📜', css: '📜',
 txt: '📃', md: '📃'
 };
 return iconMap[ext] || '📄';
}
const allItems = computed(() => {
 const items: TreeData[] = [];
 function collect(list: TreeData[]) {
 for (const item of list) {
 items.push(item);
 if (item.children) {
 collect(item.children);
 }
 }
 }
 collect(props.items);
 return items;
});
const selectedCount = computed(() => {
 return allItems.value.filter(i => i.selected && !i.isDirectory).length;
});
defineExpose({
 allItems,
 selectedCount
});
</script>

<template>
  <div class="file-tree">
    <div v-if="items.length === 0" class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="empty-text">暂无文件</div>
    </div>
    
    <div v-else class="tree-container">
      <div v-for="item in items" :key="item.path" class="tree-node">
        <div 
          class="tree-item"
          :class="{ 
            'directory': item.isDirectory,
            'expanded': item.expanded,
            'selected': item.selected,
            'active': item.active
          }"
          @click="handleItemClick(item)"
        >
          <div class="item-content">
            <span v-if="selectable" class="item-checkbox" @click="handleSelect(item, $event)">
              <input type="checkbox" :checked="item.selected" />
            </span>
            
            <span class="item-icon">{{ getFileIcon(item) }}</span>
            
            <span class="item-name" :title="item.name">{{ item.name }}</span>
            
            <span v-if="item.entry?.encrypted" class="item-badge badge badge-warning">
              🔒 {{ item.entry.encryptionMode }}
            </span>
          </div>
          
          <div class="item-actions">
            <span v-if="!item.isDirectory" class="item-size">
              {{ formatFileSize(item.size) }}
            </span>
            
            <button 
              v-if="showDownload && !item.isDirectory" 
              class="item-action-btn"
              title="下载"
              @click="handleDownload(item, $event)"
            >
              ⬇️
            </button>
          </div>
        </div>
        
        <div v-if="item.isDirectory && item.expanded && item.children" class="tree-children">
          <FileTree 
            :items="item.children"
            :selectable="selectable"
            :show-download="showDownload"
            @toggle="(child) => emit('toggle', child)"
            @select="(child, selected) => emit('select', child, selected)"
            @download="(child) => emit('download', child)"
            @item-click="(child) => emit('itemClick', child)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-tree {
  height: 100%;
  overflow-y: auto;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-muted);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-text {
  font-size: 14px;
}

.tree-container {
  padding: 4px 0;
}

.tree-node {
  user-select: none;
}

.tree-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.tree-item:hover {
  background-color: var(--bg-tertiary);
}

.tree-item.selected {
  background-color: var(--primary-light);
}

.tree-item.active {
  background-color: var(--primary-color);
  color: white;
}

.tree-item.active .item-name {
  color: white;
}

.tree-item.active .item-size {
  color: rgba(255, 255, 255, 0.8);
}

.item-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.item-checkbox {
  display: flex;
  align-items: center;
}

.item-checkbox input {
  cursor: pointer;
}

.item-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.item-badge {
  flex-shrink: 0;
  font-size: 11px;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.item-size {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.item-action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 14px;
  opacity: 0;
  transition: all var(--transition-fast);
}

.tree-item:hover .item-action-btn {
  opacity: 1;
}

.item-action-btn:hover {
  background-color: var(--bg-secondary);
}

.tree-children {
  margin-left: 20px;
  border-left: 1px solid var(--border-color);
  padding-left: 4px;
}
</style>
