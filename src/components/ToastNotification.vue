<template>
  <Teleport to="body">
    <div class="toast-container" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="['toast-item', `toast-${toast.type}`]"
          role="alert"
        >
          <span class="toast-icon">{{ iconMap[toast.type] || 'ℹ️' }}</span>
          <span class="toast-message">{{ toast.message }}</span>
          <button class="toast-close" @click="remove(toast.id)" aria-label="Kapat">&times;</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue';

const iconMap = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️'
};

const toasts = ref([]);
let nextId = 0;

const add = (message, type = 'info', duration = 4000) => {
  const id = ++nextId;
  toasts.value.push({ id, message, type });
  if (duration > 0) {
    setTimeout(() => remove(id), duration);
  }
};

const remove = (id) => {
  toasts.value = toasts.value.filter(t => t.id !== id);
};

const success = (msg) => add(msg, 'success');
const error = (msg) => add(msg, 'error', 6000);
const warning = (msg) => add(msg, 'warning', 5000);
const info = (msg) => add(msg, 'info');

defineExpose({ add, remove, success, error, warning, info });
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
  pointer-events: none;
}
.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  background: white;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  font-size: 14px;
  color: #1e293b;
  border-left: 4px solid #94a3b8;
}
.toast-success { border-left-color: #16a085; background: #f0fdf4; }
.toast-error { border-left-color: #ef4444; background: #fef2f2; }
.toast-warning { border-left-color: #f59e0b; background: #fffbeb; }
.toast-info { border-left-color: #3b82f6; background: #eff6ff; }
.toast-icon { font-size: 18px; flex-shrink: 0; }
.toast-message { flex: 1; line-height: 1.4; }
.toast-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #94a3b8;
  padding: 0 4px;
  flex-shrink: 0;
}
.toast-close:hover { color: #475569; }

.toast-enter-active { transition: all 0.3s ease-out; }
.toast-leave-active { transition: all 0.2s ease-in; }
.toast-enter-from { opacity: 0; transform: translateX(100%); }
.toast-leave-to { opacity: 0; transform: translateX(100%); }
</style>
