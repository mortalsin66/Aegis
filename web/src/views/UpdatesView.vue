<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { apiGet, apiPost } from '../lib/api'
import { t } from '../lib/i18n'

interface Update {
  name: string
  available: string
  current: string
}
interface SysInfo {
  os: string
  kernel: string
  uptime: number
  totalPackages: number
}

const updates = ref<Update[]>([])
const system = ref<SysInfo | null>(null)
const lastUpdate = ref('')
const note = ref('')
const error = ref('')
const loading = ref(false)

const updating = ref(false)
const upTitle = ref('')
const upStatus = ref('')
const upLog = ref('')
let upTimer: ReturnType<typeof setInterval> | undefined
let autoTimer: ReturnType<typeof setInterval> | undefined

function fmtUptime(sec: number) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d} ${t('updates.unit.day')} ${h} ${t('updates.unit.hour')}`
  if (h > 0) return `${h} ${t('updates.unit.hour')} ${m} ${t('updates.unit.min')}`
  return `${m} ${t('updates.unit.min')}`
}

async function load() {
  error.value = ''
  loading.value = true
  try {
    const r = await apiGet<{ updates: Update[]; system: SysInfo | null; lastUpdate?: string; note?: string }>('/api/updates')
    updates.value = r.updates || []
    system.value = r.system || null
    lastUpdate.value = r.lastUpdate || ''
    note.value = r.note || ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function runUpdateJob(endpoint: string, title: string, initialLog: string) {
  error.value = ''
  updating.value = true
  upTitle.value = title
  upStatus.value = 'running'
  upLog.value = initialLog
  try {
    const r = await apiPost<{ job: string }>(endpoint)
    if (upTimer) clearInterval(upTimer)
    upTimer = setInterval(async () => {
      try {
        const j = await apiGet<{ status: string; output: string; error?: string }>(`/api/jobs/${r.job}`)
        upStatus.value = j.status
        if (j.output) upLog.value = j.output
        if (j.status === 'done') {
          clearInterval(upTimer)
          upTimer = undefined
          updating.value = false
          load()
        } else if (j.status === 'error') {
          clearInterval(upTimer)
          upTimer = undefined
          updating.value = false
          error.value = j.error || t('updates.error')
        }
      } catch {
        /* ignore */
      }
    }, 1000)
  } catch (e) {
    error.value = (e as Error).message
    updating.value = false
  }
}

function apply() {
  if (!updates.value.length) return
  runUpdateJob('/api/updates/apply', t('updates.applyTitle'), t('updates.applyStart') + '\n')
}

function refreshLists() {
  runUpdateJob('/api/updates/refresh', t('updates.refreshTitle'), t('updates.refreshStart') + '\n')
}

onMounted(() => {
  load()
  autoTimer = setInterval(load, 5 * 60 * 1000)
})
onUnmounted(() => {
  if (upTimer) clearInterval(upTimer)
  if (autoTimer) clearInterval(autoTimer)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-3 shrink-0">
      <h2 class="text-xl font-bold text-white">{{ t('updates.title') }}</h2>
      <div class="flex gap-2">
        <button @click="load" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm">
          <span class="inline-block" :class="loading ? 'animate-spin' : ''">↻</span> {{ t('updates.check') }}
        </button>
        <button @click="refreshLists" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm" :title="t('updates.refreshListsTitle')">
          🔄 {{ t('updates.refreshLists') }}
        </button>
        <button
          @click="apply"
          :disabled="!updates.length || updating"
          class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ t('updates.applyAll') }} ({{ updates.length }})
        </button>
      </div>
    </div>

    <div v-if="note" class="mb-3 px-4 py-3 rounded-lg bg-warn/10 border border-warn/30 text-warn text-sm shrink-0">{{ note }}</div>
    <div v-if="error" class="mb-3 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm shrink-0">{{ error }}</div>

    <!-- статус обновлений -->
    <div class="mb-3 shrink-0">
      <div v-if="updates.length" class="px-4 py-3 rounded-lg bg-warn/10 border border-warn/30 text-warn text-sm font-medium">
        {{ t('updates.available') }}: {{ updates.length }}
      </div>
      <div v-else-if="!loading" class="px-4 py-3 rounded-lg bg-ok/10 border border-ok/30 text-ok text-sm font-medium">
        ✓ {{ t('updates.updated') }}
      </div>
    </div>

    <div class="card flex-1 min-h-0 overflow-y-auto">
      <!-- системная информация -->
      <div v-if="system" class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b border-ink-700">
        <div><div class="text-xs text-slate-500">{{ t('updates.os') }}</div><div class="font-mono text-white text-sm mt-1 truncate" :title="system.os">{{ system.os }}</div></div>
        <div><div class="text-xs text-slate-500">{{ t('updates.kernel') }}</div><div class="font-mono text-white text-sm mt-1">{{ system.kernel }}</div></div>
        <div><div class="text-xs text-slate-500">{{ t('updates.packages') }}</div><div class="font-mono text-white text-sm mt-1">{{ system.totalPackages }}</div></div>
        <div><div class="text-xs text-slate-500">{{ t('updates.uptime') }}</div><div class="font-mono text-white text-sm mt-1">{{ fmtUptime(system.uptime) }}</div></div>
        <div class="col-span-2 md:col-span-4">
          <div class="text-xs text-slate-500">{{ t('updates.lastUpdate') }}</div>
          <div class="font-mono text-slate-300 text-sm mt-1">{{ lastUpdate || t('updates.noData') }}</div>
        </div>
      </div>

      <!-- список пакетов -->
      <table class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase border-b border-ink-700">
          <tr>
            <th class="px-4 py-3">{{ t('updates.package') }}</th>
            <th class="px-4 py-3">{{ t('updates.current') }}</th>
            <th class="px-4 py-3">{{ t('updates.availableVersion') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-800">
          <tr v-for="u in updates" :key="u.name" class="hover:bg-ink-850">
            <td class="px-4 py-2.5 font-mono text-white">{{ u.name }}</td>
            <td class="px-4 py-2.5 font-mono text-slate-500">{{ u.current }}</td>
            <td class="px-4 py-2.5 font-mono text-accent-400">{{ u.available }}</td>
          </tr>
          <tr v-if="!updates.length && !loading"><td colspan="3" class="px-4 py-6 text-center text-slate-500">{{ t('updates.none') }}</td></tr>
          <tr v-if="loading"><td colspan="3" class="px-4 py-6 text-center text-slate-500">{{ t('updates.checking') }}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- прогресс обновления -->
    <div v-if="updating" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div class="card w-full max-w-md p-5">
        <h3 class="font-semibold text-white mb-4">{{ upTitle }}</h3>
        <div class="h-2 rounded-full bg-ink-700 overflow-hidden mb-3">
          <div class="h-full bg-accent-500" :class="upStatus === 'running' ? 'animate-pulse w-full' : 'w-full'"></div>
        </div>
        <pre class="bg-black/60 rounded-lg p-3 font-mono text-[11px] leading-5 text-slate-300 h-40 overflow-y-auto">{{ upLog }}</pre>
        <div v-if="upStatus === 'done'" class="mt-3 text-ok text-sm">{{ t('updates.done') }} ✓</div>
        <div v-if="upStatus === 'error'" class="mt-3 text-bad text-sm">{{ t('updates.updateError') }}</div>
      </div>
    </div>
  </div>
</template>
