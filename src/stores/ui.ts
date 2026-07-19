import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * UI state store — manages modal visibility and global UI flags.
 * Extracted from App.vue to share state across future child components.
 */
export const useUIStore = defineStore('ui', () => {
  const showAuthModal = ref(false)
  const showSettingsModal = ref(false)
  const showTeacherSettingsModal = ref(false)
  const showDesignModal = ref(false)
  const showAskModal = ref(false)
  const showStats = ref(false)
  const showPasswordModal = ref(false)
  const authTab = ref<'login' | 'register'>('login')
  const settingsTab = ref('overview')

  const anyModalOpen = computed(() =>
    showAuthModal.value ||
    showSettingsModal.value ||
    showTeacherSettingsModal.value ||
    showDesignModal.value ||
    showAskModal.value ||
    showPasswordModal.value
  )

  function closeAllModals() {
    showAuthModal.value = false
    showSettingsModal.value = false
    showTeacherSettingsModal.value = false
    showDesignModal.value = false
    showAskModal.value = false
    showPasswordModal.value = false
  }

  function openLogin() {
    authTab.value = 'login'
    showAuthModal.value = true
  }

  function openRegister() {
    authTab.value = 'register'
    showAuthModal.value = true
  }

  return {
    showAuthModal,
    showSettingsModal,
    showTeacherSettingsModal,
    showDesignModal,
    showAskModal,
    showStats,
    showPasswordModal,
    authTab,
    settingsTab,
    anyModalOpen,
    closeAllModals,
    openLogin,
    openRegister
  }
})
