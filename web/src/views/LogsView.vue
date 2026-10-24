<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { apiGet } from '../lib/api'
import { t } from '../lib/i18n'
import { useRoute } from 'vue-router'
import SelectDropdown from '../components/SelectDropdown.vue'

interface LogEntry {
  ts: number | null
  unit: string
  level: string
  message: string
}

const logs = ref<LogEntry[]>([])
const loading = ref(true)
const error = ref('')
const note = ref('')
const route = useRoute()
const unit = ref(typeof route.query.unit === 'string' ? route.query.unit : '')
const level = ref('all')
const lines = ref('200')
const follow = ref(false)
const search = ref('')

const levelOptions = [
  { value: 'all', label: t('logs.allLevels') },
  { value: 'error', label: 'error' },
  { value: 'warn', label: 'warn' },
  { value: 'info', label: 'info' },
  { value: 'debug', label: 'debug' },
]
const linesOptions = [
  { value: '50', label: t('logs.lines50') },
  { value: '200', label: t('logs.lines200') },
  { value: '500', label: t('logs.lines500') },
]

watch([level, lines], () => load())

const levelColor = (l: string) =>
  l === 'error' ? 'text-bad' : l === 'warn' ? 'text-warn' : l === 'debug' ? 'text-slate-500' : 'text-slate-400'

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = level.value === 'all' ? logs.value : logs.value.filter((l) => l.level === level.value)
  if (!q) return list
  return list.filter(
    (l) => l.message.toLowerCase().includes(q) || l.unit.toLowerCase().includes(q),
  )
})

function fmtTs(ts: number | null) {
  if (!ts) return ''
  return new Date(ts).toISOString().slice(11, 19)
}

let timer: ReturnType<typeof setInterval> | undefined

let requestRunning = false
async function load() {
  if (document.hidden || requestRunning) return
  requestRunning = true
  try {
    const res = await apiGet<{ logs: LogEntry[]; note?: string; error?: string }>(
      `/api/logs?lines=${lines.value}&unit=${encodeURIComponent(unit.value)}`,
    )
    note.value = res.note || ''
    error.value = res.error || ''
    logs.value = res.logs || []
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    requestRunning = false
    loading.value = false
  }
}

function toggleFollow() {
  follow.value = !follow.value
  if (follow.value) {
    load()
    timer = setInterval(load, 3000)
  } else if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

onMounted(load)
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold text-white">
        {{ t('logs.title') }} <span class="text-slate-500 font-normal text-sm">(systemd journald)</span>
      </h2>
      <div class="flex gap-2 flex-wrap">
        <input
          v-model="unit"
          @keyup.enter="load"
          :placeholder="t('logs.unitPlaceholder')"
          class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent-500"
        />
        <SelectDropdown v-model="level" :options="levelOptions" />
        <SelectDropdown v-model="lines" :options="linesOptions" />
        <button
          @click="toggleFollow"
          class="px-3 py-1.5 rounded-lg text-sm font-medium"
          :class="follow ? 'bg-accent-500 text-ink-950' : 'bg-ink-850 border border-ink-700'"
        >
          {{ follow ? t('logs.pause') : t('logs.follow') }}
        </button>
      </div>
    </div>

    <input
      v-model="search"
      :placeholder="t('logs.searchPlaceholder')"
      class="mb-3 bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent-500"
    />

    <div v-if="note" class="mb-4 px-4 py-3 rounded-lg bg-warn/10 border border-warn/30 text-warn text-sm">{{ note }}</div>
    <div v-if="error" class="mb-4 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm">{{ error }}</div>

    <div class="card flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-6 bg-black/60">
      <div v-if="loading" class="text-slate-500">{{ t('logs.loading') }}</div>
      <div v-else-if="!filtered.length" class="text-slate-500">{{ t('logs.empty') }}</div>
      <div v-for="(l, i) in filtered" :key="i" class="whitespace-pre-wrap">
        <span class="text-slate-600">{{ fmtTs(l.ts) }}</span>
        <span class="text-accent-400 ml-2">{{ l.unit || 'kernel' }}</span>
        <span :class="levelColor(l.level)" class="uppercase text-xs ml-2">{{ l.level }}</span>
        <span class="text-slate-300 ml-2">{{ l.message }}</span>
      </div>
    </div>
  </div>
</template>
