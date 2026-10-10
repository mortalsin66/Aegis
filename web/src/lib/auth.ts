import { ref } from 'vue'

const TOKEN_KEY = 'aegis_token'

export const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))

export function setToken(t: string | null) {
  token.value = t
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}
