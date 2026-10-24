<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { nav } from '../router'
import { useAgent } from '../lib/agent'
import { t, locale, setLocale } from '../lib/i18n'
import { apiGet } from '../lib/api'

const router = useRouter()
const query = ref('')
const { state } = useAgent()
const emit = defineEmits<{ (e: 'menu'): void }>()

interface Notification {
  type: string
  level: string
  name?: string
  count?: number
  use?: number
  link?: string
}
interface ServiceItem {
  unit: string
  description: string
}
interface ContainerItem {
  name: string
  image: string
}
interface SearchResult {
  section: 'nav' | 'services' | 'containers'
  label: string
  sub?: string
  path: string
}

const notifications = ref<Notification[]>([])
const notifOpen = ref(false)
const services = ref<ServiceItem[]>([])
const containers = ref<ContainerItem[]>([])
let notifTimer: ReturnType<typeof setInterval> | undefined

const osLine = computed(() =>
  state.system
    ? `${state.system.distro} ${state.system.release} · ${state.system.kernel}`
    : t('common.loading'),
)

const updateCount = computed(() => {
  const u = notifications.value.find((n) => n.type === 'updates')
  return u?.count || 0
})

const searchResults = computed<SearchResult[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  const out: SearchResult[] = []
  nav.forEach((n) => {
    if (t('nav.' + n.id).toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
      out.push({ section: 'nav', label: t('nav.' + n.id), sub: n.path, path: n.path })
    }
  })
  services.value.forEach((s) => {
    const name = s.unit.replace(/\.service$/, '')
    if (name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)) {
      out.push({ section: 'services', label: name, sub: s.description, path: '/services' })
    }
  })
  containers.value.forEach((c) => {
    if ((c.name || '').toLowerCase().includes(q) || (c.image || '').toLowerCase().includes(q)) {
      out.push({ section: 'containers', label: c.name, sub: c.image, path: '/containers' })
    }
  })
  return out.slice(0, 14)
})

function notifText(n: Notification): string {
  if (n.type === 'service') return `${t('notif.serviceFailed')}: ${n.name}`
  if (n.type === 'updates') return `${t('notif.updatesAvailable')}: ${n.count}`
  if (n.type === 'disk') return `${t('notif.diskLow')}: ${n.use}%`
  if (n.type === 'container') return `${t('notif.containerStopped')}: ${n.name}`
  return ''
}

function notifDot(n: Notification): string {
  return n.level === 'error' ? 'bg-bad' : n.level === 'warn' ? 'bg-warn' : 'bg-ok'
}

function sectionIcon(section: string): string {
  if (section === 'services') return '⚙'
  if (section === 'containers') return '▦'
  return '◈'
}

async function loadNotifications() {
  try {
    const r = await apiGet<{ items: Notification[] }>('/api/notifications')
    notifications.value = r.items || []
  } catch {
    /* ignore */
  }
}

async function fetchSearchData() {
  try {
    const s = await apiGet<{ services: ServiceItem[] }>('/api/services')
    services.value = s.services || []
  } catch {
    /* ignore */
  }
  try {
    const c = await apiGet<{ containers: ContainerItem[] }>('/api/containers')
    containers.value = c.containers || []
  } catch {
    /* ignore */
  }
}

function onNotifClick(n: Notification) {
  notifOpen.value = false
  if (n.link) router.push(n.link)
}

function goResult(r: SearchResult) {
  query.value = ''
  router.push(r.path)
}

function onSearch() {
  const first = searchResults.value[0]
  if (first) goResult(first)
}

function onDocClick() {
  notifOpen.value = false
}

onMounted(() => {
  loadNotifications()
  fetchSearchData()
  notifTimer = setInterval(() => { if (!document.hidden) loadNotifications() }, 60000)
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => {
  if (notifTimer) clearInterval(notifTimer)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <header class="h-16 shrink-0 flex items-center gap-3 px-4 md:px-6 border-b border-ink-700 bg-ink-900">
    <button @click="emit('menu')" class="lg:hidden p-2 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800" title="Меню">
      ☰
    </button>
    <div class="flex items-center gap-2 min-w-0">
      <span class="w-2.5 h-2.5 rounded-full animate-pulse shrink-0" :class="state.connected ? 'bg-ok' : 'bg-slate-600'"></span>
      <span class="text-sm font-semibold text-white truncate">{{ state.system?.hostname || '…' }}</span>
      <span class="text-xs text-slate-500 hidden lg:inline">{{ osLine }}</span>
    </div>

    <div class="ml-auto flex items-center gap-2 md:gap-3">
      <button
        @click="setLocale(locale === 'ru' ? 'en' : 'ru')"
        class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm font-medium"
        title="Language / Язык"
      >
        {{ locale === 'ru' ? 'EN' : 'RU' }}
      </button>

      <!-- поиск -->
      <div class="relative hidden md:block">
        <input
          v-model="query"
          @keyup.enter="onSearch"
          @focus="fetchSearchData"
          :placeholder="t('common.search')"
          class="w-40 xl:w-64 bg-ink-850 border border-ink-700 rounded-lg pl-9 pr-3 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:border-accent-500"
        />
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">⌕</span>
        <div v-if="query.trim()" class="absolute left-0 top-11 w-72 card p-1.5 z-50 max-h-80 overflow-y-auto">
          <div v-if="!searchResults.length" class="px-3 py-2 text-xs text-slate-600">—</div>
          <button
            v-for="(r, i) in searchResults"
            :key="i"
            @click="goResult(r)"
            class="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg hover:bg-ink-850"
          >
            <span class="text-xs text-slate-500 shrink-0">{{ sectionIcon(r.section) }}</span>
            <span class="text-sm text-white truncate">{{ r.label }}</span>
            <span v-if="r.sub" class="text-[11px] text-slate-500 truncate ml-auto max-w-[45%]">{{ r.sub }}</span>
          </button>
        </div>
      </div>

      <!-- обновления -->
      <button
        @click="router.push('/updates')"
        class="relative p-2 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800"
        :title="t('nav.updates')"
      >
        ⬆
        <span v-if="updateCount" class="absolute -top-1 -right-1 px-1 rounded-full bg-warn text-ink-950 text-[10px] font-bold leading-4">{{ updateCount }}</span>
      </button>

      <!-- уведомления -->
      <div class="relative">
        <button
          @click.stop="notifOpen = !notifOpen"
          class="relative p-2 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800"
          :title="t('notif.title')"
        >
          🔔
          <span v-if="notifications.length" class="absolute -top-1 -right-1 px-1 rounded-full bg-bad text-ink-950 text-[10px] font-bold leading-4">{{ notifications.length }}</span>
        </button>
        <div v-if="notifOpen" class="absolute right-0 top-12 w-80 card p-2 z-50 max-h-96 overflow-y-auto" @click.stop>
          <div class="px-2 py-1 text-xs text-slate-500 font-semibold">{{ t('notif.title') }}</div>
          <div v-if="!notifications.length" class="px-3 py-2 text-xs text-slate-600">{{ t('notif.empty') }}</div>
          <button
            v-for="(n, i) in notifications"
            :key="i"
            @click="onNotifClick(n)"
            class="w-full flex items-start gap-2 text-left px-3 py-2 rounded-lg hover:bg-ink-850"
          >
            <span class="w-2 h-2 rounded-full mt-1.5 shrink-0" :class="notifDot(n)"></span>
            <span class="text-[13px] text-slate-300 break-all">{{ notifText(n) }}</span>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
