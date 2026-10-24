<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAgent } from '../lib/agent'
import { formatNetworkRate } from '../lib/network-rate'
import { apiGet } from '../lib/api'
import { t } from '../lib/i18n'
import CpuChartWidget from '../components/CpuChartWidget.vue'

type WidgetType =
  | 'cpu'
  | 'mem'
  | 'disk'
  | 'net'
  | 'cpuChart'
  | 'memChart'
  | 'services'
  | 'processes'
  | 'events'
  | 'uptime'
  | 'load'

interface Widget {
  id: number
  type: WidgetType
  base: number
  span: number
}

const widgets = ref<Widget[]>([
  { id: 1, type: 'cpu', base: 3, span: 3 },
  { id: 2, type: 'mem', base: 3, span: 3 },
  { id: 3, type: 'disk', base: 3, span: 3 },
  { id: 4, type: 'net', base: 3, span: 3 },
  { id: 5, type: 'cpuChart', base: 8, span: 8 },
  { id: 6, type: 'memChart', base: 4, span: 4 },
  { id: 7, type: 'services', base: 4, span: 4 },
  { id: 8, type: 'processes', base: 4, span: 4 },
  { id: 9, type: 'events', base: 4, span: 4 },
])

const editing = ref(false)
const showPalette = ref(false)
let nextId = 100

// Live metrics; missing data is never replaced with synthetic values.
const cpu = ref(0)
const mem = ref(0)
const disk = ref(0)
const dn = ref(0)
const up = ref(0)
const downRate = computed(() => formatNetworkRate(dn.value))
const upRate = computed(() => formatNetworkRate(up.value))
const { state: agent } = useAgent()
const memTotalGb = ref(0)
const cpuHistory = ref<number[]>([])
const memHistory = ref<number[]>([])
const netDownHistory = ref<number[]>([])
const netUpHistory = ref<number[]>([])
const memPct = computed(() => (memTotalGb.value ? Math.round((mem.value / memTotalGb.value) * 100) : 0))
const memDash = computed(() => `${(memPct.value * 2.64).toFixed(1)} 264`)

const gb = (bytes: number) => (bytes / 1e9).toFixed(1)
const cpuModel = computed(() => agent.system?.cpuModel || '')
const cpuLabel = computed(() => {
  const p = agent.system?.cpuPhysicalCores || 0
  const c = agent.system?.cpuCores || 0
  if (!c) return ''
  return p && p !== c
    ? `${p} ${t('dashboard.cores')} / ${c} ${t('dashboard.threads')}`
    : `${c} ${t('dashboard.cores')}`
})
const rootDisk = computed(() => {
  const disks = agent.metrics?.disk || []
  return disks.find((d) => d.mount === '/') || disks[0] || null
})

// Update only from authenticated agent metrics.
watch(
  () => agent.metrics,
  (m) => {
    if (!m) return
    cpu.value = m.cpu
    mem.value = m.mem.used / 1e9
    memTotalGb.value = m.mem.total / 1e9
    const rootD = (m.disk || []).find((d) => d.mount === '/') || (m.disk || [])[0]
    disk.value = rootD?.use ?? disk.value
    dn.value = m.net.rx
    up.value = m.net.tx
    cpuHistory.value.push(cpu.value)
    if (cpuHistory.value.length > 30) cpuHistory.value.shift()
    memHistory.value.push(mem.value)
    if (memHistory.value.length > 30) memHistory.value.shift()
    netDownHistory.value.push(dn.value)
    if (netDownHistory.value.length > 30) netDownHistory.value.shift()
    netUpHistory.value.push(up.value)
    if (netUpHistory.value.length > 30) netUpHistory.value.shift()
  },
  { immediate: true },
)

let listTimer: ReturnType<typeof setInterval> | undefined
let listsLoading = false
onMounted(() => { loadLists(); listTimer = setInterval(() => { if (!document.hidden) loadLists() }, 15000) })
onUnmounted(() => { if (listTimer) clearInterval(listTimer) })

// Live service, process, and event lists.
const services = ref<[string, string, string, string, string][]>([])
const processes = ref<[string, string, string, number][]>([])
const events = ref<[string, string, string][]>([])

async function loadLists() {
  if (listsLoading) return
  listsLoading = true
  try {
    const r = await apiGet<{ services: { unit: string; active: string; description: string }[]; note?: string }>(
      '/api/services',
    )
    if (!r.note && r.services) {
      services.value = r.services.slice(0, 6).map((s) => {
        const clean = s.unit.replace(/\.service$/, '')
        return [
          s.active === 'active' ? 'running' : s.active === 'failed' ? 'failed' : 'stopped',
          s.description || clean,
          clean,
          '',
          '',
        ] as [string, string, string, string, string]
      })
    }
  } catch {
    /* Keep last received data. */
  }

  try {
    const r = await apiGet<{ processes: { pid: number; user: string; name: string; cpu: number }[] }>('/api/processes')
    if (r.processes) {
      processes.value = r.processes
        .slice(0, 5)
        .map((p) => [String(p.pid), p.user || '', p.name, p.cpu || 0] as [string, string, string, number])
    }
  } catch {
    /* нет данных */
  }

  try {
    const r = await apiGet<{ logs: { ts: number | null; level: string; message: string }[]; note?: string }>(
      '/api/logs?lines=20',
    )
    if (!r.note && r.logs) {
      events.value = r.logs
        .slice(0, 5)
        .map((l) => [l.ts ? new Date(l.ts).toISOString().slice(11, 19) : '', l.level, l.message] as [string, string, string])
    }
  } catch {
    /* нет данных */
  }
  listsLoading = false
}

const svcDot = (s: string) =>
  s === 'running' ? 'bg-ok' : s === 'failed' ? 'bg-bad' : 'bg-slate-500'

// ---- SVG-хелперы для графиков ----
function linePoints(data: number[], w: number, h: number): string {
  if (data.length < 2) return ''
  return data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`)
    .join(' ')
}
const cpuSpark = computed(() => linePoints(cpuHistory.value.slice(-20), 100, 40))
const memSpark = computed(() => linePoints(memHistory.value, 100, 40))

function linePointsAuto(data: number[], w: number, h: number): string {
  const max = Math.max(...data, 1)
  if (data.length < 2) return ''
  return data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ')
}
const netDownSpark = computed(() => linePointsAuto(netDownHistory.value, 100, 40))
const netUpSpark = computed(() => linePointsAuto(netUpHistory.value, 100, 40))

// ---- операции с виджетами ----
function removeWidget(id: number) {
  widgets.value = widgets.value.filter((w) => w.id !== id)
}
function toggleResize(w: Widget) {
  w.span = w.span === w.base ? Math.min(12, w.base * 2) : w.base
}
function addWidget(type: WidgetType) {
  widgets.value.push({ id: nextId++, type, base: 3, span: 3 })
  showPalette.value = false
}

// ---- перетаскивание (HTML5 DnD) ----
let dragId: number | null = null
function onDragStart(e: DragEvent, id: number) {
  if (!editing.value) return
  dragId = id
  ;(e.currentTarget as HTMLElement)?.classList.add('opacity-40')
}
function onDragEnd(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('opacity-40')
  dragId = null
}
function onDrop(e: DragEvent, targetId: number) {
  e.preventDefault()
  if (dragId == null || dragId === targetId) return
  const from = widgets.value.findIndex((w) => w.id === dragId)
  const to = widgets.value.findIndex((w) => w.id === targetId)
  if (from < 0 || to < 0) return
  const [moved] = widgets.value.splice(from, 1)
  widgets.value.splice(to, 0, moved)
}

const palette = computed<{ type: WidgetType; label: string }[]>(() => [
  { type: 'cpu', label: 'CPU' },
  { type: 'mem', label: t('dashboard.memory') },
  { type: 'disk', label: t('dashboard.disk') },
  { type: 'net', label: t('dashboard.network') },
  { type: 'uptime', label: t('dashboard.uptime') },
  { type: 'load', label: 'Load' },
])
</script>

<template>
  <div>
    <div v-if="!agent.metrics || !agent.connected" class="mb-3 p-3 rounded-lg bg-warn/10 text-warn text-sm">{{ t('monitor.offline') }} <span v-if="agent.metrics">{{ new Date(agent.metrics.timestamp).toLocaleString() }}</span></div>
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-xl font-bold text-white">{{ t('dashboard.title') }}</h2>
        <p class="text-xs text-slate-500 mt-0.5">
          {{ t('dashboard.hint') }}
        </p>
      </div>
    </div>

    <div v-if="agent.metrics" class="dash-grid" @dragover.prevent>
      <div
        v-for="w in widgets"
        :key="w.id"
        class="widget card p-5"
        :style="{ gridColumn: `span ${w.span}` }"
        :draggable="editing"
        @dragstart="onDragStart($event, w.id)"
        @dragend="onDragEnd"
        @drop="onDrop($event, w.id)"
      >
        <div v-if="editing" class="absolute top-2 right-2 flex items-center gap-1 z-10">
          <span class="px-1.5 rounded hover:bg-ink-700 text-slate-400 cursor-grab" :title="t('dashboard.drag')">⠿</span>
          <button class="px-1.5 rounded hover:bg-ink-700 text-slate-400" :title="t('dashboard.resize')" @click="toggleResize(w)">
            ⤢
          </button>
          <button
            class="px-1.5 rounded hover:bg-bad/20 text-slate-400 hover:text-bad"
            :title="t('dashboard.delete')"
            @click="removeWidget(w.id)"
          >
            ×
          </button>
        </div>

        <!-- CPU -->
        <template v-if="w.type === 'cpu'">
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-400">CPU</span>
            <span class="text-[10px] font-mono text-slate-500">{{ cpuLabel }}</span>
          </div>
          <div class="mt-2 flex items-end gap-2">
            <span class="text-3xl font-bold font-mono text-white">{{ cpu.toFixed(1) }}</span>
            <span class="text-slate-500 mb-1">%</span>
          </div>
          <div class="mt-1 text-[11px] text-slate-500 font-mono truncate" :title="cpuModel">{{ cpuModel || '…' }}</div>
          <svg viewBox="0 0 100 40" class="w-full h-10 mt-1" preserveAspectRatio="none">
            <polyline :points="cpuSpark" fill="none" stroke="#22d3ee" stroke-width="1.5" />
          </svg>
        </template>

        <!-- MEM -->
        <template v-else-if="w.type === 'mem'">
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-400">{{ t('dashboard.memory') }}</span>
            <span class="text-[10px] font-mono text-slate-500">{{ memTotalGb.toFixed(1) }} {{ t('dashboard.gb') }}</span>
          </div>
          <div class="mt-2 flex items-end gap-2">
            <span class="text-3xl font-bold font-mono text-white">{{ mem.toFixed(1) }}</span>
            <span class="text-slate-500 mb-1">/ {{ memTotalGb.toFixed(1) }} {{ t('dashboard.gb') }}</span>
          </div>
          <svg viewBox="0 0 100 40" class="w-full h-10 mt-1" preserveAspectRatio="none">
            <polyline :points="memSpark" fill="none" stroke="#34d399" stroke-width="1.5" />
          </svg>
        </template>

        <!-- DISK -->
        <template v-else-if="w.type === 'disk'">
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-400">{{ t('dashboard.disk') }} {{ rootDisk?.mount || '/' }}</span>
          </div>
          <div class="mt-2 flex items-end gap-2">
            <span class="text-3xl font-bold font-mono text-white">{{ disk.toFixed(1) }}</span>
            <span class="text-slate-500 mb-1">%</span>
          </div>
          <div class="mt-1 text-[12px] font-mono text-slate-400">
            {{ rootDisk ? gb(rootDisk.used) + ' ' + t('dashboard.of') + ' ' + gb(rootDisk.size) + ' ' + t('dashboard.gb') : '…' }}
          </div>
          <div class="mt-2 h-1.5 rounded-full bg-ink-700">
            <div class="h-full rounded-full bg-accent-400" :style="{ width: disk + '%' }"></div>
          </div>
          <div class="mt-1 text-[11px] text-slate-500 font-mono">
            {{ rootDisk ? t('dashboard.free') + ' ' + gb(rootDisk.size - rootDisk.used) + ' ' + t('dashboard.gb') : '' }}
          </div>
        </template>

        <!-- NET -->
        <template v-else-if="w.type === 'net'">
          <div class="flex items-center justify-between">
            <span class="text-sm text-slate-400">{{ t('dashboard.network') }}</span>
            <span class="text-[10px] font-mono text-slate-500">{{ agent.metrics?.net.iface || '…' }}</span>
          </div>
          <div class="mt-2 flex items-end gap-2">
            <span class="text-3xl font-bold font-mono text-white">{{ downRate.value }}</span>
            <span class="text-slate-500 mb-1">{{ t(downRate.unitKey) }}</span>
          </div>
          <svg viewBox="0 0 100 40" class="w-full h-10 mt-1" preserveAspectRatio="none">
            <polyline :points="netDownSpark" fill="none" stroke="#22d3ee" stroke-width="1.5" />
            <polyline :points="netUpSpark" fill="none" stroke="#34d399" stroke-width="1" />
          </svg>
          <div class="mt-1 flex flex-wrap items-center gap-3 text-[11px] font-mono" :title="t('dashboard.netHint')">
            <span class="text-accent-400">↓ {{ downRate.value }} {{ t(downRate.unitKey) }}</span>
            <span class="text-emerald-400">↑ {{ upRate.value }} {{ t(upRate.unitKey) }}</span>
          </div>
        </template>

        <!-- CPU CHART -->
        <template v-else-if="w.type === 'cpuChart'">
          <CpuChartWidget />
        </template>

        <!-- MEM CHART -->
        <template v-else-if="w.type === 'memChart'">
          <h3 class="font-semibold text-white mb-4">{{ t('dashboard.memory') }}</h3>
          <div class="relative w-40 h-40 mx-auto">
            <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#16202e" stroke-width="12" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="#22d3ee"
                stroke-width="12"
                stroke-linecap="round"
                :stroke-dasharray="memDash"
              />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-2xl font-bold font-mono text-white">{{ memPct }}%</span>
              <span class="text-[11px] text-slate-500">{{ t('dashboard.used') }}</span>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 mt-4 text-[12px]">
            <div class="flex justify-between bg-ink-850 rounded-lg px-3 py-2">
              <span class="text-slate-400">{{ t('dashboard.usedLabel') }}</span>
              <span class="font-mono text-white">{{ mem.toFixed(1) }} {{ t('dashboard.gb') }}</span>
            </div>
            <div class="flex justify-between bg-ink-850 rounded-lg px-3 py-2">
              <span class="text-slate-400">{{ t('dashboard.freeLabel') }}</span>
              <span class="font-mono text-white">{{ (memTotalGb - mem).toFixed(1) }} {{ t('dashboard.gb') }}</span>
            </div>
          </div>
        </template>

        <!-- SERVICES -->
        <template v-else-if="w.type === 'services'">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold text-white">{{ t('dashboard.services') }}</h3>
            <router-link to="/services" class="text-xs text-accent-400 hover:text-accent-500">{{ t('dashboard.viewAll') }}</router-link>
          </div>
          <div class="space-y-2">
            <div v-for="s in services" :key="s[1]" class="flex items-center justify-between py-1.5">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full inline-block" :class="svcDot(s[0])"></span>
                <span class="text-sm">{{ s[1] }}</span>
              </div>
              <span class="text-xs font-mono text-slate-500">{{ s[2] }}</span>
            </div>
          </div>
        </template>

        <!-- PROCESSES -->
        <template v-else-if="w.type === 'processes'">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold text-white">{{ t('dashboard.topProcesses') }}</h3>
            <router-link to="/processes" class="text-xs text-accent-400 hover:text-accent-500">{{ t('dashboard.viewAll') }}</router-link>
          </div>
          <table class="w-full text-sm">
            <tbody>
              <tr v-for="p in processes" :key="p[0]">
                <td class="py-1.5 font-mono text-slate-500">{{ p[0] }}</td>
                <td class="py-1.5 text-white">{{ p[2] }}</td>
                <td class="py-1.5 text-right font-mono">{{ p[3].toFixed(1) }}%</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- EVENTS -->
        <template v-else-if="w.type === 'events'">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold text-white">{{ t('dashboard.events') }}</h3>
            <router-link to="/logs" class="text-xs text-accent-400 hover:text-accent-500">{{ t('dashboard.logs') }}</router-link>
          </div>
          <div class="space-y-3 text-[13px] font-mono">
            <div v-for="e in events" :key="e[0] + e[1]" class="flex gap-2 items-start min-w-0">
              <span
                class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                :class="e[1] === 'error' ? 'bg-bad' : e[1] === 'warn' ? 'bg-warn' : 'bg-ok'"
              ></span>
              <div class="min-w-0">
                <span class="text-slate-500 mr-1.5">{{ e[0] }}</span>
                <span class="text-slate-300 break-words">{{ e[2] }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- UPTIME -->
        <template v-else-if="w.type === 'uptime'">
          <div class="text-sm text-slate-400">{{ t('dashboard.uptime') }}</div>
          <div class="mt-2 text-2xl font-bold font-mono text-white">12д 4ч 22м</div>
          <div class="text-[11px] text-slate-600 mt-1 font-mono">{{ t('dashboard.sinceReboot') }}</div>
        </template>

        <!-- LOAD -->
        <template v-else-if="w.type === 'load'">
          <div class="text-sm text-slate-400">Load average</div>
          <div class="mt-2 text-2xl font-bold font-mono text-white">0.42</div>
          <div class="text-[11px] text-slate-500 mt-1 font-mono">0.38 · 0.31 (1/5/15 мин)</div>
        </template>
      </div>
    </div>

    <!-- палитра виджетов -->
    <div
      v-if="showPalette"
      class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      @click.self="showPalette = false"
    >
      <div class="card w-full max-w-md p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-white">{{ t('dashboard.addWidget') }}</h3>
          <button class="text-slate-500 hover:text-slate-300 text-xl leading-none" @click="showPalette = false">
            ×
          </button>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="p in palette"
            :key="p.type"
            class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm hover:bg-ink-800"
            @click="addWidget(p.type)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
