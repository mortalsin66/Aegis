<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
} from 'chart.js'
import { t } from '../lib/i18n'
import { formatNetworkRate } from '../lib/network-rate'
import { apiGet } from '../lib/api'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip)

const canvasEl = ref<HTMLCanvasElement | null>(null)
const range = ref('1h')
const ranges = ['1m', '15m', '1h', '6h', '12h', '24h']
const loading = ref(false)
const metric = ref<'cpu' | 'mem' | 'disk' | 'rx' | 'tx'>('cpu')
const metrics = ['cpu', 'mem', 'disk', 'rx', 'tx'] as const

function formatValue(value: number): string {
  if (metric.value !== 'rx' && metric.value !== 'tx') return value.toFixed(1) + '%'
  const rate = formatNetworkRate(value)
  return rate.value + ' ' + t(rate.unitKey)
}

let chart: Chart | null = null
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  if (!canvasEl.value || loading.value || document.hidden) return
  loading.value = true
  try {
    const r = await apiGet<{ points: { t: number; cpu: number; mem: number; disk: number; rx: number; tx: number }[] }>(
      `/api/metrics/history?range=${range.value}`,
    )
    const points = r.points || []
    const labels = points.map((p) =>
      new Date(p.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    )
    const data = points.map((p) => p[metric.value])

    if (!chart) {
      chart = new Chart(canvasEl.value, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: t('monitor.' + metric.value),
              data,
              borderColor: '#22d3ee',
              backgroundColor: '#22d3ee22',
              fill: true,
              tension: 0.35,
              pointRadius: 0,
              pointHoverRadius: 4,
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          animation: { duration: 250 },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#16202e',
              borderColor: '#1d2a3a',
              borderWidth: 1,
              titleColor: '#94a3b8',
              bodyColor: '#e2e8f0',
              padding: 10,
              callbacks: { label: (ctx) => formatValue(ctx.parsed.y ?? 0) },
            },
          },
          scales: {
            x: {
              ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 0 },
              grid: { color: 'rgba(148,163,184,0.06)' },
            },
            y: {
              min: 0,
              suggestedMax: metric.value === 'rx' || metric.value === 'tx' ? undefined : 100,
              ticks: { color: '#64748b', callback: (v) => formatValue(Number(v)) },
              grid: { color: 'rgba(148,163,184,0.06)' },
            },
          },
        },
      })
    } else {
      chart.data.labels = labels
      chart.data.datasets[0].data = data
      chart.update()
    }
  } catch {
    /* нет данных */
  } finally {
    loading.value = false
  }
}

watch([range, metric], () => { chart?.destroy(); chart = null; load() })

onMounted(() => {
  load()
  timer = setInterval(() => { if (!document.hidden) load() }, 15000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
  chart?.destroy()
  chart = null
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <h3 class="font-semibold text-white">{{ t('monitor.history') }}</h3>
      <div class="flex gap-1 text-[11px] font-mono">
        <button
          v-for="r in ranges"
          :key="r"
          @click="range = r"
          class="px-2 py-1 rounded transition-colors"
          :class="range === r ? 'bg-accent-500/20 text-accent-400' : 'bg-ink-700 text-slate-400 hover:bg-ink-800'"
        >
          {{ r }}
        </button>
      </div>
    </div>
    <div class="flex flex-wrap gap-2 mb-2"><button v-for="m in metrics" :key="m" @click="metric = m" class="text-xs px-2 py-1 rounded" :class="metric === m ? 'bg-accent-500/20 text-accent-400' : 'text-slate-400'">{{ t('monitor.' + m) }}</button></div>
    <div class="relative h-40">
      <canvas ref="canvasEl"></canvas>
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">…</div>
    </div>
  </div>
</template>
