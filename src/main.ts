import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

const escapeHtml = (value: unknown) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const showFatalError = (title: string, detail: unknown) => {
  const root = document.getElementById('app')
  if (!root || root.dataset.fatalShown === 'true') return
  root.dataset.fatalShown = 'true'
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;padding:24px;font-family:system-ui,sans-serif;">
      <div style="max-width:680px;width:100%;background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;box-shadow:0 20px 50px rgba(15,23,42,0.12);">
        <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 12px;color:#334155;">Uygulama acilirken bir hata olustu. Sayfayi yenileyin. Devam ederse bu metni yoneticiye gonderin.</p>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;background:#f8fafc;border-radius:12px;padding:12px;color:#991b1b;font-size:13px;">${escapeHtml(detail)}</pre>
      </div>
    </div>
  `
}

window.addEventListener('error', (event) => {
  showFatalError('Uygulama yuklenemedi', event.error?.stack || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  showFatalError('Beklenmeyen uygulama hatasi', event.reason?.stack || event.reason)
})

const clearLegacyCaches = async () => {
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith('adab-') && key !== 'adab-v6-20260719-annfont')
        .map((key) => caches.delete(key)),
    )
  }
  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((reg) => reg.update()))
    } catch {
      // ignore
    }
  }
}

const app = createApp(App)
app.use(createPinia())
app.config.errorHandler = (error) => {
  console.error(error)
  showFatalError('Vue uygulama hatasi', error instanceof Error ? error.stack || error.message : error)
}

void clearLegacyCaches()

app.mount('#app')
