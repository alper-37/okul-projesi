<template>
  <div style="background:#fff7ed; border:2px solid #fb923c; padding:20px; border-radius:15px; margin:20px 0;">
    <h3 style="margin:0 0 15px 0; color:#9a3412;">📜 Onay Kuyruğu</h3>
    <div v-if="questions.length > 0">
      <div v-for="q in questions" :key="q.id" style="background:white; padding:12px; border-radius:10px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; border:1px solid #fed7aa;">
        <span style="font-size:14px;"><strong>{{q.subject}}</strong> - {{q.sender}}</span>
        <div style="display:flex; gap:8px;">
          <button @click="$emit('approve-question', q)" style="background:#22c55e; color:white; border:none; padding:6px 15px; border-radius:6px; cursor:pointer; font-weight:bold;">Onayla</button>
          <button @click="$emit('delete-question', q)" style="background:#ef4444; color:white; border:none; padding:6px 15px; border-radius:6px; cursor:pointer;">Sil</button>
        </div>
      </div>
    </div>
    <div v-else style="color:#9a3412; font-size:14px; font-style:italic;">Bekleyen soru yok.</div>
  </div>
</template>

<script setup>
defineProps(['questions']);
defineEmits(['approve-question', 'delete-question']);
</script>