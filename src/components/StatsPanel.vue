<template>
  <div class="stats-panel glass-premium fade-in">
    <div class="stats-header">
      <h3>📈 Akademik Rapor</h3>
      <div class="s-btns">
        <button @click="$emit('download-json')" class="btn-xs">JSON İndir</button>
        <button @click="$emit('download-ai')" class="btn-xs">🤖 AI Veri Seti</button>
      </div>
    </div>
    <div class="charts-grid">
      <div class="c-box"><Pie :data="chartData" :options="{responsive:true}" /></div>
      <div class="c-box"><Bar :data="goalData" :options="{responsive:true}" /></div>
    </div>
  </div>
</template>

<script setup>
import { Pie, Bar } from 'vue-chartjs';
defineProps(['chartData', 'goalData']);
defineEmits(['download-json', 'download-ai']);
</script>

<style scoped>
.stats-panel { padding: 12px; margin-bottom: 15px; text-align: center; } 
.stats-header { display: flex; justify-content: space-between; margin-bottom: 5px; }
.charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; } 
.c-box { background: white; padding: 5px; border-radius: 8px; }
.s-btns { display: flex; gap: 5px; } 
.btn-xs { padding: 4px; font-size: 0.6rem; cursor: pointer; background: #34495e; color: white; border: none; border-radius: 4px; }
.glass-premium { background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(12px); border-radius: 10px; border: 1px solid rgba(255,255,255,0.2); }
</style>