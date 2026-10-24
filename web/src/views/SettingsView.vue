<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { apiGet, apiPost } from '../lib/api'
import ServerProfiles from '../components/ServerProfiles.vue'
import QRCode from 'qrcode'
import { t } from '../lib/i18n'
import { setToken } from '../lib/auth'

const settings = ref<{ port: number; user: string; twoFactor: boolean; twoFactorPending: boolean } | null>(null)
const error = ref('')
const note = ref('')

// пароль
const pwCurrent = ref('')
const pwNext = ref('')
const pwConfirm = ref('')

// порт
const portValue = ref('')

// 2fa
const secret2 = ref('')
const qrUrl = ref('')
const totpCode = ref('')
const disableCode = ref('')

async function load() {
  error.value = ''
  try {
    settings.value = await apiGet('/api/settings')
    portValue.value = String(settings.value?.port || 9000)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function changePassword() {
  error.value = ''
  note.value = ''
  if (!pwCurrent.value || !pwNext.value) {
    error.value = t('settings.fillPasswords')
    return
  }
  if (pwNext.value !== pwConfirm.value) {
    error.value = t('settings.passwordsMismatch')
    return
  }
  if (pwNext.value.length < 12) {
    error.value = t('settings.passwordTooShort')
    return
  }
  try {
    const result = await apiPost<{ token: string }>('/api/auth/password', { current: pwCurrent.value, next: pwNext.value }); setToken(result.token)
    pwCurrent.value = ''
    pwNext.value = ''
    pwConfirm.value = ''
    note.value = t('passwordChanged')
    setTimeout(() => (note.value = ''), 3000)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function changePort() {
  error.value = ''
  note.value = ''
  const p = Number(portValue.value)
  if (!p || p < 1 || p > 65535) {
    error.value = t('settings.invalidPort')
    return
  }
  if (!window.confirm(t('settings.portConfirm', { port: p, host: window.location.hostname }))) return
  try {
    await apiPost('/api/settings/port', { port: p })
    note.value = t('settings.portChanged', { port: p, host: window.location.hostname })
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function setup2fa() {
  error.value = ''
  try {
    const r = await apiPost<{ secret: string; otpauthUrl: string }>('/api/auth/2fa/setup')
    secret2.value = r.secret
    qrUrl.value = await QRCode.toDataURL(r.otpauthUrl, { width: 220, margin: 1 })
    totpCode.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function confirm2fa() {
  error.value = ''
  try {
    const result = await apiPost<{ token: string }>('/api/auth/2fa/confirm', { totp: totpCode.value }); setToken(result.token)
    secret2.value = ''
    qrUrl.value = ''
    totpCode.value = ''
    note.value = t('twofaEnabled')
    setTimeout(() => (note.value = ''), 3000)
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function disable2fa() {
  error.value = ''
  if (!disableCode.value) {
    error.value = t('settings.enterCode')
    return
  }
  try {
    const result = await apiPost<{ token: string }>('/api/auth/2fa/disable', { totp: disableCode.value }); setToken(result.token)
    disableCode.value = ''
    note.value = t('twofaDisabled')
    setTimeout(() => (note.value = ''), 3000)
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function copySecret() {
  try {
    await navigator.clipboard.writeText(secret2.value)
    note.value = t('settings.secretCopied')
    setTimeout(() => (note.value = ''), 2000)
  } catch {
    /* ignore */
  }
}

// ---- обновление панели (GitHub) ----
const panelInfo = ref<{ version: string; repo: string; update: { latest?: string; available?: boolean; error?: string } | null } | null>(null)
const updatingPanel = ref(false)
const panelLog = ref('')
const panelStatus = ref('')
let panelTimer: ReturnType<typeof setInterval> | undefined

async function loadPanelInfo() {
  try {
    panelInfo.value = await apiGet('/api/panel/info')
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function checkUpdates() {
  error.value = ''
  try {
    const info = await apiGet<{ version: string; repo: string }>('/api/panel/info')
    const update = await apiPost<{ latest?: string; available?: boolean; error?: string }>('/api/panel/update/check', {})
    panelInfo.value = { ...info, update }
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function updatePanel() {
  error.value = ''
  updatingPanel.value = true
  panelStatus.value = 'running'
  panelLog.value = ''
  try {
    const r = await apiPost<{ job: string }>('/api/panel/update')
    if (panelTimer) clearInterval(panelTimer)
    panelTimer = setInterval(async () => {
      try {
        const j = await apiGet<{ status: string; output: string; error?: string }>(`/api/jobs/${r.job}`)
        panelStatus.value = j.status
        if (j.output) panelLog.value = j.output
        if (j.status === 'done' || j.status === 'error') {
          clearInterval(panelTimer)
          panelTimer = undefined
          updatingPanel.value = false
          if (j.status === 'error') error.value = j.error || 'Ошибка'
        }
      } catch {
        /* ignore */
      }
    }, 1000)
  } catch (e) {
    error.value = (e as Error).message
    updatingPanel.value = false
  }
}

onMounted(() => {
  load()
  loadPanelInfo()
})
onUnmounted(() => {
  if (panelTimer) clearInterval(panelTimer)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-3 shrink-0">
      <h2 class="text-xl font-bold text-white">{{ t('settings.title') }}</h2>
    </div>

    <div v-if="note" class="mb-3 px-4 py-3 rounded-lg bg-ok/10 border border-ok/30 text-ok text-sm shrink-0">{{ note }}</div>
    <div v-if="error" class="mb-3 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm shrink-0">{{ error }}</div>

    <div class="card flex-1 min-h-0 overflow-y-auto">
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 p-5">
        <ServerProfiles />
        <!-- УЧЁТНЫЕ ДАННЫЕ -->
        <div class="space-y-3">
          <h3 class="font-semibold text-white">{{ t('settings.credentials') }}</h3>
          <div class="text-sm text-slate-400">{{ t('common.user') }}: <span class="font-mono text-white">{{ settings?.user || '…' }}</span></div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('settings.currentPassword') }}</label>
            <input v-model="pwCurrent" type="password" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('settings.newPassword') }}</label>
            <input v-model="pwNext" type="password" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('settings.confirmPassword') }}</label>
            <input v-model="pwConfirm" type="password" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
          </div>
          <button @click="changePassword" class="px-4 py-2 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('settings.changePassword') }}</button>
        </div>

        <!-- ПОРТ -->
        <div class="space-y-3">
          <h3 class="font-semibold text-white">{{ t('settings.port') }}</h3>
          <div class="text-sm text-slate-400">{{ t('settings.currentPort') }}: <span class="font-mono text-white">{{ settings?.port }}</span></div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('settings.newPort') }}</label>
            <input v-model="portValue" type="number" min="1" max="65535" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
          </div>
          <p class="text-xs text-slate-500">{{ t('settings.portHint') }}</p>
          <button @click="changePort" class="px-4 py-2 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('settings.changePort') }}</button>
        </div>

        <!-- 2FA -->
        <div class="xl:col-span-2 space-y-3">
          <h3 class="font-semibold text-white">{{ t('settings.twoFactor') }}</h3>

          <div v-if="settings?.twoFactor" class="space-y-3">
            <div class="text-sm text-ok">✓ {{ t('settings.twoFactorEnabled') }}</div>
            <div class="flex gap-2 items-center">
              <input v-model="disableCode" :placeholder="t('settings.codeFromApp')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono w-48 focus:outline-none focus:border-accent-500" />
              <button @click="disable2fa" class="px-3 py-2 rounded-lg bg-bad/15 text-bad font-semibold text-sm">{{ t('settings.disable2fa') }}</button>
            </div>
          </div>

          <div v-else-if="qrUrl" class="space-y-3">
            <div class="text-sm text-slate-400">{{ t('settings.scanQr') }}</div>
            <img :src="qrUrl" alt="QR" class="w-56 h-56 bg-white rounded-lg p-2" />
            <div class="flex items-center gap-2">
              <code class="font-mono text-sm text-white bg-ink-850 rounded-lg px-3 py-2 break-all">{{ secret2 }}</code>
              <button @click="copySecret" class="px-3 py-2 rounded-lg bg-ink-850 border border-ink-700 text-sm shrink-0">{{ t('settings.copy') }}</button>
            </div>
            <div class="flex gap-2 items-center">
              <input v-model="totpCode" :placeholder="t('settings.confirmCode')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono w-48 focus:outline-none focus:border-accent-500" />
              <button @click="confirm2fa" class="px-3 py-2 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('settings.confirm') }}</button>
            </div>
          </div>

          <div v-else>
            <button @click="setup2fa" class="px-4 py-2 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('settings.enable2fa') }}</button>
          </div>
        </div>

        <!-- ОБНОВЛЕНИЕ ПАНЕЛИ -->
        <div class="xl:col-span-2 space-y-3">
          <h3 class="font-semibold text-white">{{ t('settings.panelUpdate') }}</h3>
          <div class="flex items-center gap-2 text-sm text-slate-400">
            <span>{{ t('settings.currentVersion') }}:</span>
            <span class="font-mono text-white">{{ panelInfo?.version || '…' }}</span>
            <span v-if="panelInfo?.update?.latest" class="text-slate-500">→ {{ panelInfo.update.latest }}</span>
          </div>
          <div class="text-xs text-slate-500 font-mono truncate">{{ panelInfo?.repo || '…' }}</div>
          <div v-if="panelInfo?.update?.available" class="px-4 py-3 rounded-lg bg-warn/10 border border-warn/30 text-warn text-sm">
            {{ t('settings.updateAvailable') }}: {{ panelInfo.update.latest }}
          </div>
          <div v-else-if="panelInfo?.update?.latest" class="px-4 py-3 rounded-lg bg-ok/10 border border-ok/30 text-ok text-sm">
            ✓ {{ t('settings.upToDate') }}
          </div>
          <div v-if="panelInfo?.update?.error" class="text-xs text-slate-500">{{ panelInfo.update.error }}</div>
          <div class="flex gap-2">
            <button @click="checkUpdates" class="px-4 py-2 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('settings.checkUpdates') }}</button>
            <button v-if="panelInfo?.update?.available" @click="updatePanel" :disabled="updatingPanel" class="px-4 py-2 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm disabled:opacity-50">{{ updatingPanel ? t('settings.updating') : t('settings.updateNow') }}</button>
          </div>
          <div v-if="updatingPanel" class="mt-3">
            <div class="h-2 rounded-full bg-ink-700 overflow-hidden mb-2">
              <div class="h-full bg-accent-500 animate-pulse w-full"></div>
            </div>
            <pre class="bg-black/60 rounded-lg p-3 font-mono text-[11px] leading-5 text-slate-300 h-32 overflow-y-auto">{{ panelLog }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
