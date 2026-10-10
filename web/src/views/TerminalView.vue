<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { getSocket, agentUrl } from '../lib/agent'
import { token } from '../lib/auth'
import { apiGet } from '../lib/api'
import type { Socket } from 'socket.io-client'
import { useRoute } from 'vue-router'
import SelectDropdown from '../components/SelectDropdown.vue'
import { t } from '../lib/i18n'

const route = useRoute()

interface Session {
  id: string
  label: string
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  el: HTMLDivElement
}

// ---- настройки ----
const fontSize = ref(13)
const fontFamily = ref("'JetBrains Mono', monospace")
const cursorStyle = ref<'block' | 'underline' | 'bar'>('block')
const themeName = ref('default')
const customFg = ref('')
const fontWeight = ref('400')
const italic = ref(false)
const user = ref('root')
const userOptions = [
  { value: 'root', label: 'root' },
  { value: 'user', label: 'user' },
  { value: 'www-data', label: 'www-data' },
]

const themes: Record<string, Record<string, string>> = {
  default: {
    background: '#0a0e14',
    foreground: '#e2e8f0',
    cursor: '#22d3ee',
    cursorAccent: '#0a0e14',
    selectionBackground: 'rgba(34,211,238,0.25)',
  },
  'one-dark': {
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    cursorAccent: '#282c34',
    selectionBackground: 'rgba(82,139,255,0.3)',
  },
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    cursorAccent: '#282a36',
    selectionBackground: 'rgba(189,147,249,0.3)',
  },
  nord: {
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#88c0d0',
    cursorAccent: '#2e3440',
    selectionBackground: 'rgba(136,192,208,0.3)',
  },
  'solarized-dark': {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    cursorAccent: '#002b36',
    selectionBackground: 'rgba(131,148,150,0.3)',
  },
}
const currentTheme = computed(() => themes[themeName.value] || themes.default)

const themeOptions = [
  { value: 'default', label: 'Default' },
  { value: 'one-dark', label: 'One Dark' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'nord', label: 'Nord' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
]
const cursorOptions = [
  { value: 'block', label: t('terminal.cursorBlock') },
  { value: 'underline', label: t('terminal.cursorUnderline') },
  { value: 'bar', label: t('terminal.cursorBar') },
]
const fontOptions = [
  { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
  { value: "'Fira Code', monospace", label: 'Fira Code' },
  { value: "'Cascadia Code', monospace", label: 'Cascadia Code' },
  { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono' },
  { value: "'Ubuntu Mono', monospace", label: 'Ubuntu Mono' },
  { value: "'Source Code Pro', monospace", label: 'Source Code Pro' },
  { value: "'Roboto Mono', monospace", label: 'Roboto Mono' },
  { value: "'Monocraft', monospace", label: 'Monocraft (Minecraft)' },
  { value: 'monospace', label: 'Monospace' },
]
const weightOptions = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Normal' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'SemiBold' },
  { value: '700', label: 'Bold' },
]

// ---- поиск ----
const searchOpen = ref(false)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const leftHost = ref<HTMLElement | null>(null)
const rightHost = ref<HTMLElement | null>(null)
const sessions = ref<Session[]>([])
const activeIdx = ref(-1)
const splitMode = ref(false)
const splitSession = ref<Session | null>(null)
const error = ref('')
const openMenu = ref<'snippets' | 'settings' | 'audit' | null>(null)
const auditItems = ref<{ ts: number; user: string; command: string }[]>([])

let socket: Socket | null = null
let seq = 0
const snippets = ['ls -la', 'systemctl status nginx', 'docker ps -a', 'journalctl -f', 'df -h', 'tail -f /var/log/nginx/error.log']
let pendingCwd: string | undefined = typeof route.query.cwd === 'string' ? route.query.cwd : undefined
let pendingContainer: string | undefined = typeof route.query.container === 'string' ? route.query.container : undefined
let ro: ResizeObserver | null = null

const SETTINGS_KEY = 'aegis_terminal_settings'
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    if (typeof s.fontSize === 'number') fontSize.value = s.fontSize
    if (typeof s.fontFamily === 'string') fontFamily.value = s.fontFamily
    if (s.cursorStyle) cursorStyle.value = s.cursorStyle
    if (s.themeName) themeName.value = s.themeName
    if (s.customFg) customFg.value = s.customFg
    if (s.fontWeight) fontWeight.value = String(s.fontWeight)
    if (typeof s.italic === 'boolean') italic.value = s.italic
    if (typeof s.user === 'string') user.value = s.user
  } catch {
    /* ignore */
  }
}
function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        fontSize: fontSize.value,
        fontFamily: fontFamily.value,
        cursorStyle: cursorStyle.value,
        themeName: themeName.value,
        customFg: customFg.value,
        fontWeight: Number(fontWeight.value),
        italic: italic.value,
        user: user.value,
      }),
    )
  } catch {
    /* ignore */
  }
}
function toggleMenu(m: 'snippets' | 'settings' | 'audit') {
  if (openMenu.value === m) {
    openMenu.value = null
    return
  }
  if (m === 'audit') loadAudit()
  openMenu.value = m
}
async function loadAudit() {
  try {
    const r = await apiGet<{ commands: { ts: number; user: string; command: string }[] }>('/api/audit')
    auditItems.value = r.commands || []
  } catch {
    /* ignore */
  }
}
function onDocClick() {
  openMenu.value = null
}
loadSettings()

const SESSIONS_KEY = 'aegis_term_sessions'
function persistSessions() {
  try {
    const ids = sessions.value.map((s) => s.id).filter(Boolean)
    if (splitSession.value?.id) ids.push(splitSession.value.id)
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

function copySelection(term: Terminal) {
  const sel = term.getSelection()
  if (sel) navigator.clipboard.writeText(sel).catch(() => {})
}
async function pasteClipboard(term: Terminal) {
  try {
    const text = await navigator.clipboard.readText()
    if (text) term.paste(text)
  } catch {
    /* нет доступа к буферу */
  }
}

function changeFontSize(delta: number) {
  fontSize.value = Math.min(24, Math.max(8, fontSize.value + delta))
}

function makeSession(): Session {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: fontSize.value,
    fontFamily: fontFamily.value,
    fontWeight: Number(fontWeight.value),
    fontWeightBold: 700,
    cursorStyle: cursorStyle.value,
    theme: { ...currentTheme.value, foreground: customFg.value || currentTheme.value.foreground },
    scrollback: 5000,
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon())
  const el = document.createElement('div')
  el.className = 'h-full w-full'
  if (italic.value) el.classList.add('term-italic')
  term.open(el)

  // копипаст / шрифт / поиск
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const ev = e as KeyboardEvent
    if (ev.ctrlKey && ev.shiftKey && (ev.key === 'C' || ev.key === 'c')) {
      copySelection(term)
      return false
    }
    if (ev.ctrlKey && ev.shiftKey && (ev.key === 'V' || ev.key === 'v')) {
      pasteClipboard(term)
      return false
    }
    if (ev.ctrlKey && (ev.key === '+' || ev.key === '=')) {
      changeFontSize(1)
      return false
    }
    if (ev.ctrlKey && ev.key === '-') {
      changeFontSize(-1)
      return false
    }
    if (ev.ctrlKey && (ev.key === 'f' || ev.key === 'F')) {
      openSearch()
      return false
    }
    return true
  })

  // ПКМ: есть выделение — копировать, иначе — вставить
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const sel = term.getSelection()
    if (sel) copySelection(term)
    else pasteClipboard(term)
  })

  seq++
  return { id: '', label: t('terminal.session') + ' ' + seq, term, fit, search, el }
}

function fitAll() {
  sessions.value.forEach((s) => s.fit.fit())
  if (splitMode.value && splitSession.value) splitSession.value.fit.fit()
}

function layout() {
  if (!leftHost.value) return
  const active = sessions.value[activeIdx.value]
  sessions.value.forEach((s, i) => {
    s.el.style.display = i === activeIdx.value ? '' : 'none'
  })
  if (active && active.el.parentElement !== leftHost.value) leftHost.value.appendChild(active.el)

  if (splitMode.value && splitSession.value && rightHost.value) {
    splitSession.value.el.style.display = ''
    if (splitSession.value.el.parentElement !== rightHost.value) rightHost.value.appendChild(splitSession.value.el)
  }

  nextTick(fitAll)
}

function applySettings() {
  const all = [...sessions.value]
  if (splitSession.value) all.push(splitSession.value)
  all.forEach((s) => {
    s.term.options.fontSize = fontSize.value
    s.term.options.fontFamily = fontFamily.value
    s.term.options.fontWeight = Number(fontWeight.value)
    s.term.options.fontWeightBold = 700
    s.term.options.cursorStyle = cursorStyle.value
    s.term.options.theme = { ...currentTheme.value, foreground: customFg.value || currentTheme.value.foreground }
    s.el.classList.toggle('term-italic', italic.value)
  })
  nextTick(fitAll)
}

function openSearch() {
  searchOpen.value = true
  nextTick(() => searchInput.value?.focus())
}
function doSearch() {
  const s = sessions.value[activeIdx.value]
  if (!s || !searchQuery.value) return
  s.search.findNext(searchQuery.value)
}
function doSearchPrev() {
  const s = sessions.value[activeIdx.value]
  if (!s || !searchQuery.value) return
  s.search.findPrevious(searchQuery.value)
}

function create(session: Session, onReady?: () => void, reconnectId?: string) {
  const cwdParam = pendingCwd
  const contParam = pendingContainer
  pendingCwd = undefined
  pendingContainer = undefined
  const payload: Record<string, unknown> = { cols: session.term.cols, rows: session.term.rows }
  if (reconnectId) payload.reconnect = reconnectId
  else {
    if (contParam) payload.container = contParam
    else {
      if (cwdParam) payload.cwd = cwdParam
      if (user.value && user.value !== 'root') payload.user = user.value
    }
  }
  socket!.emit('term:create', payload, (res: { id?: string; error?: string }) => {
    if (res.error) {
      error.value = res.error
      return
    }
    session.id = res.id!
    session.label = contParam ? t('terminal.console') + '-' + contParam.slice(0, 12) : 'srv-' + session.id.slice(-4)
    persistSessions()
    nextTick(() => {
      session.fit.fit()
      if (session.id) socket?.emit('term:resize', { id: session.id, cols: session.term.cols, rows: session.term.rows })
    })
    onReady?.()
  })
  session.term.onData((data) => {
    if (session.id) socket?.emit('term:input', { id: session.id, data })
  })
  session.term.onResize(({ cols, rows }) => {
    if (session.id) socket?.emit('term:resize', { id: session.id, cols, rows })
  })
}

function newSession() {
  if (!socket || !leftHost.value) {
    error.value = t('terminal.noAgent')
    return
  }
  const s = makeSession()
  sessions.value.push(s)
  activeIdx.value = sessions.value.length - 1
  layout()
  create(s)
}

function reconnectSession(rid: string) {
  if (!leftHost.value) return
  const s = makeSession()
  sessions.value.push(s)
  activeIdx.value = sessions.value.length - 1
  layout()
  create(s, undefined, rid)
}

async function onTermDrop(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (!files?.length) return
  const form = new FormData()
  form.append('path', pendingCwd || '/tmp')
  for (const f of Array.from(files)) form.append('files', f)
  try {
    const r = await fetch(`${agentUrl()}/api/fs/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.value}` },
      body: form,
    })
    if (!r.ok) {
      error.value = t('terminal.uploadError') + ': ' + r.status
      return
    }
    const d = await r.json()
    const paths = ((d as { saved?: string[] }).saved || []).join(' ')
    const s = sessions.value[activeIdx.value]
    if (s && s.id && paths) socket?.emit('term:input', { id: s.id, data: paths + ' ' })
  } catch (err) {
    error.value = (err as Error).message
  }
}

function toggleSplit() {
  if (!socket) return
  if (splitMode.value) {
    if (splitSession.value) {
      if (splitSession.value.id) socket.emit('term:kill', { id: splitSession.value.id })
      splitSession.value.term.dispose()
      splitSession.value.el.remove()
    }
    splitSession.value = null
    splitMode.value = false
    layout()
  } else {
    if (!rightHost.value) return
    const s = makeSession()
    splitSession.value = s
    splitMode.value = true
    layout()
    create(s, () => layout())
  }
}

function setActive(i: number) {
  activeIdx.value = i
  layout()
}

function closeSession(i: number) {
  const s = sessions.value[i]
  if (!s) return
  if (s.id) socket?.emit('term:kill', { id: s.id })
  s.term.dispose()
  s.el.remove()
  sessions.value.splice(i, 1)
  if (activeIdx.value >= sessions.value.length) activeIdx.value = sessions.value.length - 1
  persistSessions()
  layout()
}

function closeSplit() {
  if (splitSession.value) {
    if (splitSession.value.id) socket?.emit('term:kill', { id: splitSession.value.id })
    splitSession.value.term.dispose()
    splitSession.value.el.remove()
  }
  splitSession.value = null
  splitMode.value = false
  persistSessions()
}

function findSession(id: string): Session | null {
  const t = sessions.value.find((x) => x.id === id)
  if (t) return t
  if (splitSession.value && splitSession.value.id === id) return splitSession.value
  return null
}

function onOutput(res: { id: string; data: string }) {
  const s = findSession(res.id)
  if (s) s.term.write(res.data)
}

function onExit(res: { id: string }) {
  if (splitSession.value && splitSession.value.id === res.id) {
    closeSplit()
    return
  }
  const i = sessions.value.findIndex((x) => x.id === res.id)
  if (i >= 0) closeSession(i)
}

function insertSnippet(text: string) {
  const s = sessions.value[activeIdx.value]
  if (s && s.id && socket) socket.emit('term:input', { id: s.id, data: text })
  openMenu.value = null
}

watch([themeName, cursorStyle, fontFamily, fontSize, customFg, fontWeight, italic, user], () => {
  try {
    applySettings()
  } catch {
    /* ignore */
  }
  saveSettings()
})

onMounted(() => {
  socket = getSocket()
  if (!socket) {
    error.value = t('terminal.noAgent')
    return
  }
  socket.on('term:output', onOutput)
  socket.on('term:exit', onExit)
  document.addEventListener('click', onDocClick)

  ro = new ResizeObserver(() => fitAll())
  if (leftHost.value) ro.observe(leftHost.value)
  if (rightHost.value) ro.observe(rightHost.value)

  const start = () => {
    if (pendingContainer) {
      newSession()
      return
    }
    let stored: string[] = []
    try {
      const v = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
      if (Array.isArray(v)) stored = v.filter((x) => typeof x === 'string')
    } catch {
      /* ignore */
    }
    if (stored.length) {
      stored.forEach((rid) => reconnectSession(rid))
      if (!sessions.value.length) newSession()
    } else {
      newSession()
    }
  }
  if (socket.connected) start()
  else socket.once('connect', start)
})

onUnmounted(() => {
  saveSettings()
  sessions.value.forEach((s) => {
    if (s.id) socket?.emit('term:detach', { id: s.id })
    s.term.dispose()
  })
  if (splitSession.value) {
    if (splitSession.value.id) socket?.emit('term:detach', { id: splitSession.value.id })
    splitSession.value.term.dispose()
  }
  socket?.off('term:output', onOutput)
  socket?.off('term:exit', onExit)
  document.removeEventListener('click', onDocClick)
  ro?.disconnect()
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center gap-2 mb-3 shrink-0">
      <h2 class="text-xl font-bold text-white">{{ t('terminal.title') }}</h2>
      <div class="flex gap-1 ml-4 overflow-x-auto">
        <button
          v-for="(s, i) in sessions"
          :key="s.id || i"
          @click="setActive(i)"
          class="px-3 py-1.5 rounded-t-lg text-xs font-mono border-b-2 whitespace-nowrap"
          :class="i === activeIdx ? 'text-accent-400 border-accent-400' : 'text-slate-500 border-transparent hover:text-slate-300'"
        >
          {{ s.label }}
          <span class="ml-1 text-slate-600 hover:text-bad" @click.stop="closeSession(i)">×</span>
        </button>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <button
          @click="searchOpen ? (searchOpen = false) : openSearch()"
          class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm"
          :title="t('terminal.search')"
        >
          🔍
        </button>
        <div class="relative">
          <button
            @click.stop="toggleMenu('snippets')"
            class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm"
            :title="t('terminal.snippets')"
          >
            📋
          </button>
          <div v-if="openMenu === 'snippets'" class="absolute right-0 top-10 w-72 card p-2 z-40" @click.stop>
            <div class="px-2 py-1 text-xs text-slate-500 font-semibold">{{ t('terminal.snippets') }}</div>
            <button
              v-for="s in snippets"
              :key="s"
              @click="insertSnippet(s)"
              class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-ink-850 font-mono text-[13px]"
            >
              {{ s }}
            </button>
          </div>
        </div>
        <button
          @click="toggleSplit"
          class="px-2 py-1.5 rounded-lg text-sm"
          :class="splitMode ? 'bg-accent-500 text-ink-950 font-semibold' : 'bg-ink-850 border border-ink-700'"
          :title="t('terminal.splitPanel')"
        >
          ⊞
        </button>
        <div class="relative">
          <button
            @click.stop="toggleMenu('audit')"
            class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm"
            :title="t('terminal.audit')"
          >
            📜
          </button>
          <div v-if="openMenu === 'audit'" class="absolute right-0 top-10 w-80 card p-2 z-40 max-h-80 overflow-y-auto" @click.stop>
            <div class="px-2 py-1 text-xs text-slate-500 font-semibold">{{ t('terminal.audit') }}</div>
            <div v-if="!auditItems.length" class="px-3 py-2 text-xs text-slate-600">{{ t('terminal.noRecords') }}</div>
            <div v-for="(c, i) in auditItems" :key="i" class="px-3 py-1.5 border-b border-ink-800 last:border-0">
              <div class="text-[13px] font-mono text-slate-300 break-all">{{ c.command }}</div>
              <div class="text-[11px] text-slate-600">{{ c.user }} · {{ new Date(c.ts).toLocaleTimeString() }}</div>
            </div>
          </div>
        </div>
        <div class="relative">
          <button
            @click.stop="toggleMenu('settings')"
            class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm"
            :title="t('terminal.settings')"
          >
            ⚙
          </button>
          <div v-if="openMenu === 'settings'" class="absolute right-0 top-10 w-72 card p-3 z-50 space-y-3" @click.stop>
            <div>
              <div class="text-xs text-slate-500 mb-1">{{ t('terminal.theme') }}</div>
              <SelectDropdown v-model="themeName" :options="themeOptions" />
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">{{ t('terminal.font') }}</div>
              <SelectDropdown v-model="fontFamily" :options="fontOptions" />
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">{{ t('terminal.weight') }}</div>
              <SelectDropdown v-model="fontWeight" :options="weightOptions" />
            </div>
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" v-model="italic" />
              <span class="text-slate-300">{{ t('terminal.italic') }}</span>
            </label>
            <div>
              <div class="text-xs text-slate-500 mb-1">{{ t('terminal.fontSize') }}</div>
              <div class="flex items-center gap-2">
                <button @click="changeFontSize(-1)" class="px-2 py-1 rounded bg-ink-850 border border-ink-700 text-sm">−</button>
                <span class="font-mono text-sm w-8 text-center">{{ fontSize }}</span>
                <button @click="changeFontSize(1)" class="px-2 py-1 rounded bg-ink-850 border border-ink-700 text-sm">＋</button>
                <span class="text-[11px] text-slate-600">Ctrl +/-</span>
              </div>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">{{ t('terminal.cursor') }}</div>
              <SelectDropdown v-model="cursorStyle" :options="cursorOptions" />
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">{{ t('terminal.textColor') }}</div>
              <div class="flex items-center gap-2">
                <input type="color" v-model="customFg" class="w-8 h-8 rounded cursor-pointer border border-ink-700 bg-transparent" />
                <button v-if="customFg" @click="customFg = ''" class="text-xs text-slate-500 hover:text-slate-300">{{ t('terminal.reset') }}</button>
                <span v-else class="text-[11px] text-slate-600">{{ t('terminal.fromTheme') }}</span>
              </div>
            </div>
          </div>
        </div>
        <SelectDropdown v-model="user" :options="userOptions" />
        <button
          @click="newSession"
          class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm hover:bg-accent-400"
        >
          ＋ {{ t('terminal.newSession') }}
        </button>
      </div>
    </div>

    <div v-if="error" class="mb-3 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm shrink-0">{{ error }}</div>

    <div v-if="searchOpen" class="mb-2 flex items-center gap-2 shrink-0">
      <input
        ref="searchInput"
        v-model="searchQuery"
        @keyup.enter="doSearch"
        @keydown.esc="searchOpen = false"
        :placeholder="t('terminal.searchPlaceholder')"
        class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-accent-500"
      />
      <button @click="doSearch" class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm">↓</button>
      <button @click="doSearchPrev" class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm">↑</button>
      <button @click="searchOpen = false" class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">×</button>
    </div>

    <div class="card flex-1 min-h-0 relative overflow-hidden" :style="{ background: currentTheme.background }" @dragover.prevent @drop.prevent="onTermDrop">
      <div class="absolute inset-0 flex p-2">
        <div ref="leftHost" class="flex-1 min-w-0 h-full"></div>
        <div ref="rightHost" class="h-full min-w-0" :class="splitMode ? 'flex-1 border-l border-ink-800' : 'hidden'"></div>
      </div>
    </div>
  </div>
</template>
