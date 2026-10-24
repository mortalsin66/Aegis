import { ref, computed } from 'vue'

const TOKEN_KEY = 'aegis_token'

export const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
export const role = computed(() => {
  try { return JSON.parse(atob((token.value || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role || 'admin' }
  catch { return 'admin' }
})

export function setToken(t: string | null) {
  token.value = t
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}
