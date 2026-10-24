<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiPost } from '../lib/api'
import { setToken } from '../lib/auth'

const emit = defineEmits<{ (e: 'close'): void }>()
const enabled = ref(false)
const pending = ref(false)
const secret = ref('')
const otpauthUrl = ref('')
const confirmCode = ref('')
const disableCode = ref('')
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    const r = await apiGet<{ enabled: boolean; pending: boolean }>('/api/auth/2fa/status')
    enabled.value = r.enabled
    pending.value = r.pending
  } catch (e) {
    error.value = (e as Error).message
  }
})

async function enable() {
  busy.value = true
  error.value = ''
  try {
    const r = await apiPost<{ secret: string; otpauthUrl: string }>('/api/auth/2fa/setup')
    secret.value = r.secret
    otpauthUrl.value = r.otpauthUrl
    pending.value = true
    confirmCode.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function confirm() {
  busy.value = true
  error.value = ''
  try {
    const result = await apiPost<{ token: string }>('/api/auth/2fa/confirm', { totp: confirmCode.value }); setToken(result.token)
    enabled.value = true
    pending.value = false
    secret.value = ''
    otpauthUrl.value = ''
    confirmCode.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function disable() {
  busy.value = true
  error.value = ''
  try {
    const result = await apiPost<{ token: string }>('/api/auth/2fa/disable', { totp: disableCode.value }); setToken(result.token)
    enabled.value = false
    pending.value = false
    secret.value = ''
    otpauthUrl.value = ''
    disableCode.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" @click.self="emit('close')">
    <div class="card w-full max-w-md p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold text-white">Двухфакторная аутентификация</h3>
        <button @click="emit('close')" class="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
      </div>

      <div v-if="error" class="mb-3 text-bad text-sm">{{ error }}</div>

      <div class="mb-3 text-sm">
        Статус:
        <span :class="enabled ? 'text-ok' : 'text-slate-500'">{{ enabled ? 'включена' : 'выключена' }}</span>
      </div>

      <!-- выключена: кнопка включить -->
      <div v-if="!enabled && !pending">
        <button @click="enable" :disabled="busy" class="w-full py-2 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm disabled:opacity-50">
          Включить 2FA
        </button>
      </div>

      <!-- сгенерирован, но не подтверждён -->
      <div v-else-if="!enabled && pending">
        <div class="mb-4 p-3 bg-ink-850 rounded-lg">
          <div class="text-xs text-slate-400 mb-1">1. Добавь секрет в приложение-аутентификатор (Google Authenticator, Aegis, 1Password и т.д.):</div>
          <div class="font-mono text-white text-sm break-all">{{ secret }}</div>
          <div v-if="otpauthUrl" class="text-xs text-slate-500 mt-2 mb-1">otpauth URL (можно отсканировать QR):</div>
          <div v-if="otpauthUrl" class="font-mono text-slate-400 text-[11px] break-all">{{ otpauthUrl }}</div>
        </div>
        <div class="text-xs text-slate-400 mb-2">2. Введи текущий 6-значный код из приложения, чтобы подтвердить:</div>
        <div class="flex gap-2">
          <input
            v-model="confirmCode"
            inputmode="numeric"
            maxlength="6"
            class="flex-1 bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500"
            placeholder="6 цифр"
          />
          <button
            @click="confirm"
            :disabled="busy || confirmCode.length !== 6"
            class="px-3 py-2 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm disabled:opacity-50"
          >
            Подтвердить
          </button>
        </div>
      </div>

      <!-- включена: отключить -->
      <div v-else>
        <div class="text-xs text-slate-500 mb-2">Для отключения введите текущий код:</div>
        <div class="flex gap-2">
          <input
            v-model="disableCode"
            inputmode="numeric"
            maxlength="6"
            class="flex-1 bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500"
            placeholder="6 цифр"
          />
          <button
            @click="disable"
            :disabled="busy || disableCode.length !== 6"
            class="px-3 py-2 rounded-lg bg-bad/15 text-bad font-semibold text-sm disabled:opacity-50"
          >
            Отключить
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
