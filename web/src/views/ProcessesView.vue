<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { apiGet, apiPost } from '../lib/api'
import { t } from '../lib/i18n'
import SelectDropdown from '../components/SelectDropdown.vue'

interface Process {
  pid: number
  name: string
  user: string
  cpu: number
  mem: number
  state: string
}

const processes = ref<Process[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref('')
const sortKey = ref<'cpu' | 'mem' | 'pid' | 'name'>('cpu')
const sortDir = ref<'asc' | 'desc'>('desc')
const stateFilter = ref('all')
const spinning = ref(false)

function fmtMem(kb: number) {
  if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' ' + t('processes.mem.gb')
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' ' + t('processes.mem.mb')
  return kb.toFixed(0) + ' ' + t('processes.mem.kb')
}

const stateOptions = ['all', 'running', 'sleeping', 'blocked', 'zombie', 'stopped', 'idle', 'dead', 'paging'].map(
  (v) => ({ value: v, label: v === 'all' ? t('processes.state.all') : v }),
)

const stateDot = (s: string) =>
  s === 'running'
    ? 'bg-ok'
    : s === 'sleeping'
      ? 'bg-slate-400'
      : s === 'blocked'
        ? 'bg-warn'
        : s === 'zombie'
          ? 'bg-bad'
          : s === 'stopped'
            ? 'bg-orange-400'
            : s === 'idle'
              ? 'bg-slate-600'
              : 'bg-slate-700'

const counts = computed(() => ({
  running: processes.value.filter((p) => p.state === 'running').length,
  sleeping: processes.value.filter((p) => p.state === 'sleeping').length,
  blocked: processes.value.filter((p) => p.state === 'blocked').length,
  zombie: processes.value.filter((p) => p.state === 'zombie').length,
  idle: processes.value.filter((p) => p.state === 'idle').length,
  total: processes.value.length,
}))

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  let list = processes.value
  if (q) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.pid).includes(q) ||
        (p.user || '').toLowerCase().includes(q),
    )
  }
  if (stateFilter.value !== 'all') list = list.filter((p) => p.state === stateFilter.value)
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    if (sortKey.value === 'cpu') return (a.cpu - b.cpu) * dir
    if (sortKey.value === 'mem') return (a.mem - b.mem) * dir
    if (sortKey.value === 'name') return a.name.localeCompare(b.name) * dir
    return (a.pid - b.pid) * dir
  })
})

function setSort(key: 'cpu' | 'mem' | 'pid' | 'name') {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'name' || key === 'pid' ? 'asc' : 'desc'
  }
}

const arrow = (key: 'cpu' | 'mem' | 'pid' | 'name') =>
  sortKey.value === key ? (sortDir.value === 'asc' ? '↑' : '↓') : ''

let timer: ReturnType<typeof setInterval> | undefined

let requestRunning = false
async function load() {
  if (document.hidden || requestRunning) return
  requestRunning = true
  try {
    const res = await apiGet<{ processes: Process[] }>('/api/processes')
    processes.value = res.processes || []
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

async function kill(pid: number) {
  error.value = ''
  try {
    await apiPost(`/api/processes/${pid}/kill`)
    setTimeout(load, 500)
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(() => {
  load()
  timer = setInterval(load, 3000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-3 shrink-0">
      <h2 class="text-xl font-bold text-white">{{ t('processes.title') }}</h2>
      <div class="flex gap-2">
        <input
          v-model="filter"
          :placeholder="t('processes.filterPlaceholder')"
          class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent-500"
        />
        <button
          @click="refresh"
          class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm"
          :title="t('processes.refresh')"
        >
          <span class="inline-block" :class="spinning ? 'animate-spin' : ''">↻</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="mb-3 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm shrink-0">{{ error }}</div>

    <div class="flex items-center gap-3 mb-3 text-sm flex-wrap shrink-0">
      <span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-ok"></span> running: {{ counts.running }}</span>
      <span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-slate-400"></span> sleeping: {{ counts.sleeping }}</span>
      <span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-slate-600"></span> idle: {{ counts.idle }}</span>
      <span v-if="counts.blocked" class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-warn"></span> blocked: {{ counts.blocked }}</span>
      <span v-if="counts.zombie" class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-bad"></span> zombie: {{ counts.zombie }}</span>
      <span class="text-slate-500">· {{ t('processes.count.total') }}: {{ counts.total }} · {{ t('processes.count.shown') }}: {{ filtered.length }}</span>
      <div class="ml-auto">
        <SelectDropdown v-model="stateFilter" :label="t('processes.state')" :options="stateOptions" />
      </div>
    </div>

    <div class="card flex-1 min-h-0 overflow-y-auto">
      <div v-if="loading" class="p-6 text-slate-500">{{ t('processes.loading') }}</div>
      <table v-else class="w-full text-sm">
        <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase tracking-wide border-b border-ink-700">
          <tr>
            <th class="px-4 py-3 cursor-pointer select-none" @click="setSort('pid')">PID {{ arrow('pid') }}</th>
            <th class="px-4 py-3">{{ t('processes.user') }}</th>
            <th class="px-4 py-3 cursor-pointer select-none" @click="setSort('name')">{{ t('processes.name') }} {{ arrow('name') }}</th>
            <th class="px-4 py-3 cursor-pointer select-none" @click="setSort('cpu')">CPU {{ arrow('cpu') }}</th>
            <th class="px-4 py-3 cursor-pointer select-none" @click="setSort('mem')">{{ t('processes.memory') }} {{ arrow('mem') }}</th>
            <th class="px-4 py-3">{{ t('processes.state') }}</th>
            <th class="px-4 py-3 text-right">{{ t('processes.actions') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-800">
          <tr v-for="p in filtered.slice(0, 100)" :key="p.pid" class="hover:bg-ink-850">
            <td class="px-4 py-2.5 font-mono text-slate-500">{{ p.pid }}</td>
            <td class="px-4 py-2.5">{{ p.user }}</td>
            <td class="px-4 py-2.5 font-mono text-white">{{ p.name }}</td>
            <td class="px-4 py-2.5 font-mono whitespace-nowrap">{{ p.cpu.toFixed(1) }}%</td>
            <td class="px-4 py-2.5 font-mono whitespace-nowrap">{{ fmtMem(p.mem) }}</td>
            <td class="px-4 py-2.5">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full inline-block shrink-0" :class="stateDot(p.state)"></span>
                <span class="text-xs whitespace-nowrap">{{ p.state }}</span>
              </div>
            </td>
            <td class="px-4 py-2.5 text-right">
              <button v-admin @click="kill(p.pid)" class="px-2.5 py-1 rounded bg-ink-700 hover:bg-bad/20 hover:text-bad text-xs">⊘ {{ t('processes.kill') }}</button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">{{ t('processes.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
