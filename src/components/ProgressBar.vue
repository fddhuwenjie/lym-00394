<script setup lang="ts">
interface Props {
  percentage: number
  label?: string
  showPercentage?: boolean
  status?: 'default' | 'success' | 'error'
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  showPercentage: true,
  status: 'default',
  size: 'md'
})

const barHeight = {
  sm: '4px',
  md: '8px',
  lg: '12px'
}
</script>

<template>
  <div class="progress-component">
    <div v-if="label || showPercentage" class="progress-header">
      <span v-if="label" class="progress-label">{{ label }}</span>
      <span v-if="showPercentage" class="progress-percentage">{{ percentage }}%</span>
    </div>
    <div class="progress-bar" :style="{ height: barHeight[size] }">
      <div 
        class="progress-bar-fill"
        :class="status"
        :style="{ width: `${Math.min(100, Math.max(0, percentage))}%` }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.progress-component {
  width: 100%;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 13px;
}

.progress-label {
  color: var(--text-secondary);
  font-weight: 500;
}

.progress-percentage {
  color: var(--text-primary);
  font-weight: 600;
}

.progress-bar {
  width: 100%;
  background-color: var(--bg-tertiary);
  border-radius: 9999px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background-color: var(--primary-color);
  border-radius: 9999px;
  transition: width 0.2s ease;
}

.progress-bar-fill.success {
  background-color: var(--success-color);
}

.progress-bar-fill.error {
  background-color: var(--danger-color);
}
</style>
