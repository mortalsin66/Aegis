<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { apiGet, apiPost } from '../lib/api'
import SelectDropdown from '../components/SelectDropdown.vue'
import { t } from '../lib/i18n'

interface Service {
  unit: string
  load: string
  active: string
  sub: string
  description: string
}

const services = ref<Service[]>([])
const loading = ref(true)
const error = ref('')
const note = ref('')
const filter = ref('')
const statusFilter = ref('all')
const loadFilter = ref('all')
const subFilter = ref('all')
const spinning = ref(false)

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const filtered = computed(() => {
  let list = services.value
  const q = filter.value.trim().toLowerCase()
  if (q) {
    // юнит — по подстроке; описание — по целому слову (чтобы "apt" не цеплял "capture")
    const re = new RegExp(`\\b${escapeRegExp(q)}\\b`, 'i')
    list = list.filter((s) => s.unit.toLowerCase().includes(q) || re.test(s.description || ''))
  }
  if (statusFilter.value !== 'all') list = list.filter((s) => s.active === statusFilter.value)
  if (loadFilter.value !== 'all') list = list.filter((s) => s.load === loadFilter.value)
  if (subFilter.value !== 'all') list = list.filter((s) => s.sub === subFilter.value)
  return list
})

const counts = computed(() => ({
  running: services.value.filter((s) => s.active === 'active').length,
  failed: services.value.filter((s) => s.active === 'failed').length,
  total: services.value.length,
}))

const isRunning = (s: Service) => s.active === 'active'
const dot = (s: Service) =>
  s.active === 'failed' ? 'bg-bad' : s.active === 'active' ? 'bg-ok' : 'bg-slate-500'
const loadClass = (l: string) =>
  l === 'not-found' ? 'text-slate-600 italic' : l === 'masked' ? 'text-warn' : 'text-slate-400'

const opt = (arr: string[], allLabel = t('services.all')) =>
  arr.map((v) => ({ value: v, label: v === 'all' ? allLabel : v }))
const activeOptions = opt(['all', 'active', 'inactive', 'failed', 'activating', 'deactivating'])
const loadOptions = opt(['all', 'loaded', 'not-found', 'masked', 'error'])
const subOptions = opt(['all', 'running', 'dead', 'exited', 'failed', 'waiting', 'auto-restart'])

let timer: ReturnType<typeof setInterval> | undefined

let requestRunning = false
async function load() {
  if (document.hidden || requestRunning) return
  requestRunning = true
  try {
    const res = await apiGet<{ services: Service[]; note?: string; error?: string }>('/api/services')
    note.value = res.note || ''
    error.value = res.error || ''
    services.value = res.services || []
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    requestRunning = false
    loading.value = false
  }
}

async function refresh() {
  spinning.value = true
  await load()
  setTimeout(() => (spinning.value = false), 500)
}

async function action(unit: string, act: string) {
  error.value = ''
  try {
    await apiPost(`/api/services/${encodeURIComponent(unit)}/${act}`)
    setTimeout(load, 600)
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(() => {
  load()
  timer = setInterval(load, 10000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-xl font-bold text-white">
        {{ t('services.title') }} <span class="text-slate-500 font-normal text-sm">(systemd)</span>
      </h2>
      <div class="flex gap-2">
        <input
          v-model="filter"
          :placeholder="t('services.search')"
          class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent-500"
        />
        <button
          @click="refresh"
          class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm"
          :title="t('services.refresh')"
        >
          <span class="inline-block" :class="spinning ? 'animate-spin' : ''">↻</span>
        </button>
      </div>
    </div>

    <div v-if="note" class="mb-3 px-4 py-3 rounded-lg bg-warn/10 border border-warn/30 text-warn text-sm">{{ note }}</div>
    <div v-if="error" class="mb-3 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm">{{ error }}</div>

    <div class="flex items-center gap-3 mb-3 text-sm flex-wrap">
      <span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-ok"></span> {{ t('services.running') }}: {{ counts.running }}</span>
      <span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-bad"></span> {{ t('services.failed') }}: {{ counts.failed }}</span>
      <span class="text-slate-500">{{ t('services.total') }}: {{ counts.total }}</span>
      <span class="text-slate-500">· {{ t('services.shown') }}: {{ filtered.length }}</span>

      <div class="ml-auto flex gap-2">
        <SelectDropdown v-model="statusFilter" :label="t('services.status')" :options="activeOptions" />
        <SelectDropdown v-model="loadFilter" label="Load" :options="loadOptions" />
        <SelectDropdown v-model="subFilter" label="Sub" :options="subOptions" />
      </div>
    </div>

    <div class="card flex-1 min-h-0 overflow-y-auto">
      <div v-if="loading" class="p-6 text-slate-500">{{ t('services.loading') }}</div>
      <table v-else class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase tracking-wide border-b border-ink-700">
          <tr>
            <th class="px-4 py-3">{{ t('services.status') }}</th>
            <th class="px-4 py-3">{{ t('services.unit') }}</th>
            <th class="px-4 py-3">{{ t('services.description') }}</th>
            <th class="px-4 py-3">Load</th>
            <th class="px-4 py-3">Sub</th>
            <th class="px-4 py-3 text-right">{{ t('services.actions') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-800">
          <tr v-for="s in filtered" :key="s.unit" class="hover:bg-ink-850">
            <td class="px-4 py-2.5">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full inline-block shrink-0" :class="dot(s)"></span>
                <span class="capitalize text-xs whitespace-nowrap">{{ s.active }}</span>
              </div>
            </td>
            <td class="px-4 py-2.5 font-mono text-white whitespace-nowrap">{{ s.unit }}</td>
            <td class="px-4 py-2.5 text-slate-400">{{ s.description }}</td>
            <td class="px-4 py-2.5 font-mono whitespace-nowrap" :class="loadClass(s.load)">{{ s.load }}</td>
            <td class="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">{{ s.sub }}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
              <button v-admin
                v-if="isRunning(s)"
                @click="action(s.unit, 'stop')"
                class="px-2.5 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs"
                :title="t('services.stop')"
              >
                ⏹
              </button>
              <button v-admin
                v-else
                @click="action(s.unit, 'start')"
                class="px-2.5 py-1 rounded bg-ok/15 text-ok hover:bg-ok/25 text-xs"
                :title="t('services.start')"
              >
                ▶
              </button>
              <button v-admin
                @click="action(s.unit, 'restart')"
                class="px-2.5 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs ml-1"
                :title="t('services.restart')"
              >
                ↻
              </button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">{{ t('services.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
