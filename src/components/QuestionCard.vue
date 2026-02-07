<template>
  <div style="background:white; border:1px solid #e2e8f0; padding:20px; margin-bottom:15px; border-radius:12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <span style="background:#f1f5f9; color:#475569; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:bold;">{{ question.subject }}</span>
      <small style="color:#94a3b8;">{{ question.sender }}</small>
    </div>
    <p style="margin:10px 0; font-size:16px; color:#1e293b; line-height:1.5;">{{ question.content }}</p>
    <div style="display:flex; gap:10px; margin-top:15px;">
      <button @click="$emit('like', question)" style="background:#fef2f2; border:1px solid #fee2e2; color:#ef4444; border-radius:8px; padding:6px 15px; cursor:pointer;">❤️ {{ question.likes || 0 }}</button>
      <button v-if="isStaff" @click="$emit('delete', question)" style="background:#f8fafc; border:1px solid #e2e8f0; color:#64748b; border-radius:8px; padding:6px 15px; cursor:pointer;">🗑️ Sil</button>
    </div>
  </div>
</template>

<script setup>
defineProps(['question', 'isStaff', 'currentUser']);
defineEmits(['like', 'delete']);
</script>