<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { agentUrl } from '../lib/agent'
import { setToken } from '../lib/auth'
import { t, locale, setLocale } from '../lib/i18n'

const username = ref('admin')
const password = ref('')
const totp = ref('')
const twoFactor = ref(false)
const error = ref('')
const busy = ref(false)

const mode = ref<'login' | 'change'>('login')
const pendingToken = ref('')
const newPw = ref('')
const confirmPw = ref('')

onMounted(async () => {
  try {
    const r = await fetch(`${agentUrl()}/api/auth/2fa/status`)
    const d = await r.json()
    twoFactor.value = !!d.enabled
  } catch {
    /* ignore */
  }
})

async function login() {
  busy.value = true
  error.value = ''
  try {
    const r = await fetch(`${agentUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.value,
        password: password.value,
        totp: twoFactor.value ? totp.value : undefined,
      }),
    })
    const data = await r.json()
    if (!r.ok) {
      error.value = (data && data.error) || t('login.error')
      return
    }
    if (data.mustChangePassword) {
      pendingToken.value = data.token
      mode.value = 'change'
      return
    }
    setToken(data.token)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function changePassword() {
  if (newPw.value !== confirmPw.value) {
    error.value = t('settings.passwordsMismatch')
    return
  }
  if (newPw.value.length < 4) {
    error.value = t('settings.passwordTooShort')
    return
  }
  busy.value = true
  error.value = ''
  try {
    const r = await fetch(`${agentUrl()}/api/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pendingToken.value}` },
      body: JSON.stringify({ current: password.value, next: newPw.value }),
    })
    const data = await r.json()
    if (!r.ok) {
      error.value = (data && data.error) || t('login.error')
      return
    }
    setToken(pendingToken.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="h-screen flex items-center justify-center p-6 relative overflow-hidden">
    <button
      @click="setLocale(locale === 'ru' ? 'en' : 'ru')"
      class="absolute top-4 right-4 z-20 px-3 py-1.5 rounded-lg bg-ink-900/70 border border-ink-700 text-sm font-medium backdrop-blur hover:bg-ink-800 transition-colors"
      title="Language / Язык"
    >
      {{ locale === 'ru' ? 'EN' : 'RU' }}
    </button>
    <!-- анимированный фон -->
    <div class="login-bg" aria-hidden="true">
      <div class="login-grid"></div>
      <div class="blob blob-1"></div>
      <div class="blob blob-2"></div>
      <div class="blob blob-3"></div>
    </div>

    <div class="relative z-10 card w-full max-w-sm p-8 backdrop-blur-xl bg-ink-900/70 border-ink-700/60 shadow-2xl shadow-black/40">
      <div class="flex items-center gap-3 mb-8">
        <div
          class="w-11 h-11 rounded-xl bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center font-extrabold text-ink-950 text-xl shadow-lg shadow-accent-500/30"
        >
          A
        </div>
        <div>
          <div class="font-bold text-white text-lg leading-none">Aegis</div>
          <div class="text-[11px] text-slate-500 mt-1">{{ t('login.subtitle') }}</div>
        </div>
      </div>

      <!-- ФОРМА ВХОДА -->
      <form v-if="mode === 'login'" @submit.prevent="login" class="space-y-4">
        <div>
          <label class="text-xs text-slate-500 block mb-1.5">{{ t('login.username') }}</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">👤</span>
            <input
              v-model="username"
              class="w-full bg-ink-850/70 border border-ink-700 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 transition"
              autocomplete="username"
            />
          </div>
        </div>
        <div>
          <label class="text-xs text-slate-500 block mb-1.5">{{ t('login.password') }}</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔒</span>
            <input
              v-model="password"
              type="password"
              class="w-full bg-ink-850/70 border border-ink-700 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 transition"
              autocomplete="current-password"
            />
          </div>
        </div>
        <div v-if="twoFactor">
          <label class="text-xs text-slate-500 block mb-1.5">{{ t('login.twoFactorCode') }}</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔐</span>
            <input
              v-model="totp"
              inputmode="numeric"
              maxlength="6"
              :placeholder="t('login.totpPlaceholder')"
              class="w-full bg-ink-850/70 border border-ink-700 rounded-xl pl-10 pr-3 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 transition"
              autocomplete="one-time-code"
            />
          </div>
        </div>
        <div v-if="error" class="text-bad text-sm px-1">{{ error }}</div>
        <button
          type="submit"
          :disabled="busy"
          class="w-full py-2.5 rounded-xl bg-gradient-to-r from-accent-500 to-accent-400 text-ink-950 font-semibold text-sm shadow-lg shadow-accent-500/20 transition-all duration-300 ease-out hover:brightness-110 hover:-translate-y-0.5 hover:shadow-accent-500/40 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ busy ? t('login.signingIn') : t('login.signIn') }}
        </button>
      </form>

      <!-- СМЕНА ПАРОЛЯ ПОСЛЕ ПЕРВОГО ВХОДА -->
      <form v-else @submit.prevent="changePassword" class="space-y-4">
        <div>
          <h3 class="font-semibold text-white text-lg">{{ t('login.changePasswordTitle') }}</h3>
          <p class="text-sm text-slate-400 mt-1">{{ t('login.changePasswordHint') }}</p>
        </div>
        <div>
          <label class="text-xs text-slate-500 block mb-1.5">{{ t('settings.newPassword') }}</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔒</span>
            <input
              v-model="newPw"
              type="password"
              class="w-full bg-ink-850/70 border border-ink-700 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 transition"
              autocomplete="new-password"
            />
          </div>
        </div>
        <div>
          <label class="text-xs text-slate-500 block mb-1.5">{{ t('settings.confirmPassword') }}</label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔒</span>
            <input
              v-model="confirmPw"
              type="password"
              class="w-full bg-ink-850/70 border border-ink-700 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 transition"
              autocomplete="new-password"
            />
          </div>
        </div>
        <div v-if="error" class="text-bad text-sm px-1">{{ error }}</div>
        <button
          type="submit"
          :disabled="busy"
          class="w-full py-2.5 rounded-xl bg-gradient-to-r from-accent-500 to-accent-400 text-ink-950 font-semibold text-sm shadow-lg shadow-accent-500/20 transition-all duration-300 ease-out hover:brightness-110 hover:-translate-y-0.5 hover:shadow-accent-500/40 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ busy ? t('common.loading') : t('settings.changePassword') }}
        </button>
      </form>
    </div>
  </div>
</template>
