<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, apiPost } from '../lib/api'
import { agentUrl } from '../lib/agent'
import { token } from '../lib/auth'
import { t } from '../lib/i18n'

const router = useRouter()

interface FsItem {
  name: string
  dir: boolean
  symlink: boolean
  size: number | null
  mtime: number | null
  mode: number | null
}

const cwd = ref('/')
const items = ref<FsItem[]>([])
const loading = ref(true)
const error = ref('')
const showHidden = ref(false)
const selected = ref<string[]>([])
const sortKey = ref<'name' | 'size' | 'mtime'>('name')
const sortDir = ref<'asc' | 'desc'>('asc')

const history = ref<string[]>(['/'])
const historyIdx = ref(0)

// editor
const editorOpen = ref(false)
const editorPath = ref('')
const editorContent = ref('')
const editorError = ref('')

// модалки
const createOpen = ref(false)
const createType = ref<'file' | 'dir'>('dir')
const createName = ref('')
const renameOpen = ref(false)
const renameFrom = ref('')
const renameTo = ref('')
const deleteOpen = ref(false)
const deletePaths = ref<string[]>([])
const deleteIsDir = ref(false)
const deleteConfirmName = ref('')

// контекстное меню
const ctx = ref<{ x: number; y: number; item: FsItem } | null>(null)

// вид и пагинация
const viewMode = ref<'list' | 'grid'>('list')
const page = ref(1)
const pageSize = 100
const pageCount = computed(() => Math.max(1, Math.ceil(visibleItems.value.length / pageSize)))
const pagedItems = computed(() => {
  const start = (page.value - 1) * pageSize
  return visibleItems.value.slice(start, start + pageSize)
})

// свойства (chmod/chown)
const propsOpen = ref(false)
const propsPath = ref('')
const propsMode = ref('')
const propsOwner = ref('')
const propsGroup = ref('')

// размеры папок (по расчёту)
const duResults = ref<Record<string, number>>({})

// прогресс операции
const jobOpen = ref(false)
const jobLabel = ref('')
const jobProgress = ref(0)
let jobTimer: ReturnType<typeof setInterval> | undefined

async function trackJob(id: string, label: string) {
  jobLabel.value = label
  jobProgress.value = 0
  jobOpen.value = true
  if (jobTimer) clearInterval(jobTimer)
  jobTimer = setInterval(async () => {
    try {
      const r = await apiGet<{ status: string; progress: number; error?: string }>(`/api/fs/job/${id}`)
      jobProgress.value = r.progress || 0
      if (r.status === 'done') {
        clearInterval(jobTimer)
        jobTimer = undefined
        setTimeout(() => {
          jobOpen.value = false
          load(cwd.value)
        }, 400)
      } else if (r.status === 'error') {
        clearInterval(jobTimer)
        jobTimer = undefined
        jobOpen.value = false
        error.value = r.error || t('files.errorOperation')
      }
    } catch {
      /* игнорируем ошибки поллинга */
    }
  }, 500)
}

function join(base: string, name: string) {
  return base === '/' ? '/' + name : base + '/' + name
}
const fullPath = (name: string) => join(cwd.value, name)

const segments = computed(() => {
  const parts = cwd.value.split('/').filter(Boolean)
  return parts.map((seg, i) => ({ label: seg, path: '/' + parts.slice(0, i + 1).join('/') }))
})

const visibleItems = computed(() => {
  let list = showHidden.value ? items.value : items.value.filter((it) => !it.name.startsWith('.'))
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    if (sortKey.value === 'name') {
      if (a.dir !== b.dir) return a.dir ? -1 : 1 // папки всегда сверху
      return a.name.localeCompare(b.name, undefined, { numeric: true }) * dir
    }
    if (sortKey.value === 'size') {
      const sa = a.dir ? -1 : (a.size ?? -1)
      const sb = b.dir ? -1 : (b.size ?? -1)
      return (sa - sb) * dir
    }
    return ((a.mtime ?? 0) - (b.mtime ?? 0)) * dir
  })
})

const selectedCount = computed(() => selected.value.length)
const allSelected = computed(
  () => visibleItems.value.length > 0 && visibleItems.value.every((it) => selected.value.includes(it.name)),
)

function fmtSize(bytes: number | null, dir: boolean) {
  if (dir) return '—'
  if (bytes == null) return '—'
  if (bytes < 1024) return bytes + t('files.bytes')
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + t('files.kb')
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + t('files.mb')
  return (bytes / 1024 ** 3).toFixed(2) + t('files.gb')
}
function fmtMode(mode: number | null, dir: boolean) {
  if (mode == null) return '—'
  const rwx = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  return (dir ? 'd' : '-') + rwx[(mode >> 6) & 7] + rwx[(mode >> 3) & 7] + rwx[mode & 7]
}
const fmtModeNum = (mode: number | null) => (mode == null ? '' : (mode & 0o777).toString(8).padStart(3, '0'))
const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—')

function fileIcon(name: string, dir: boolean) {
  if (dir) return '📁'
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'bz2', 'xz'].includes(ext)) return '📦'
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) return '🖼'
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'php', 'sh', 'bash', 'css', 'html', 'vue', 'sql'].includes(ext)) return '📜'
  if (['conf', 'cfg', 'ini', 'yaml', 'yml', 'json', 'toml', 'env', 'service', 'xml'].includes(ext)) return '⚙️'
  if (['exe', 'dll', 'so', 'bin', 'o', 'a', 'run', 'appimage'].includes(ext)) return '⚡'
  return '📄'
}

async function load(p: string) {
  loading.value = true
  error.value = ''
  try {
    const res = await apiGet<{ path: string; items: FsItem[] }>(`/api/fs?path=${encodeURIComponent(p)}`)
    cwd.value = res.path || p
    items.value = res.items || []
    selected.value = []
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function navigate(p: string) {
  if (p === cwd.value) return
  history.value = history.value.slice(0, historyIdx.value + 1)
  history.value.push(p)
  historyIdx.value = history.value.length - 1
  load(p)
}
function goBack() {
  if (historyIdx.value > 0) {
    historyIdx.value--
    load(history.value[historyIdx.value])
  }
}
function goForward() {
  if (historyIdx.value < history.value.length - 1) {
    historyIdx.value++
    load(history.value[historyIdx.value])
  }
}
function goHome() {
  navigate('/')
}
function goUp() {
  if (cwd.value === '/') return
  const parts = cwd.value.split('/').filter(Boolean)
  parts.pop()
  navigate('/' + parts.join('/'))
}

function toggleSelect(name: string) {
  const i = selected.value.indexOf(name)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(name)
}
function toggleSelectAll() {
  selected.value = allSelected.value ? [] : visibleItems.value.map((it) => it.name)
}

function setSort(key: 'name' | 'size' | 'mtime') {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}
const arrow = (key: 'name' | 'size' | 'mtime') =>
  sortKey.value === key ? (sortDir.value === 'asc' ? '↑' : '↓') : ''

async function openFile(item: FsItem) {
  if (item.dir) {
    navigate(fullPath(item.name))
    return
  }
  if ((item.size || 0) > 2 * 1024 * 1024) {
    error.value = t('files.fileTooLarge')
    return
  }
  editorPath.value = fullPath(item.name)
  editorOpen.value = true
  editorError.value = ''
  editorContent.value = ''
  try {
    const res = await apiGet<{ content: string }>(`/api/fs/read?path=${encodeURIComponent(editorPath.value)}`)
    editorContent.value = res.content.includes('\u0000') ? '' : res.content
    if (res.content.includes('\u0000')) editorError.value = t('files.binaryFile')
  } catch (e) {
    editorError.value = (e as Error).message
  }
}

async function saveFile() {
  editorError.value = ''
  try {
    await apiPost('/api/fs/write', { path: editorPath.value, content: editorContent.value })
    editorOpen.value = false
    load(cwd.value)
  } catch (e) {
    editorError.value = (e as Error).message
  }
}

async function downloadFile(name: string) {
  try {
    const r = await fetch(`${agentUrl()}/api/fs/download?path=${encodeURIComponent(fullPath(name))}`, {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    if (!r.ok) {
      error.value = t('files.downloadError') + r.status
      return
    }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = (e as Error).message
  }
}

const fileInput = ref<HTMLInputElement | null>(null)

async function uploadFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList)
  if (!files.length) return
  const form = new FormData()
  form.append('path', cwd.value)
  for (const f of files) form.append('files', f)
  error.value = ''
  try {
    const r = await fetch(`${agentUrl()}/api/fs/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.value}` },
      body: form,
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      error.value = (d && (d as { error?: string }).error) || t('files.uploadError') + r.status
      return
    }
    load(cwd.value)
  } catch (e) {
    error.value = (e as Error).message
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) uploadFiles(input.files)
  input.value = ''
}
function onDrop(e: DragEvent) {
  if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files)
}

function isArchive(name: string) {
  return name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.zip')
}

function openTerminalHere() {
  router.push({ path: '/terminal', query: { cwd: cwd.value } })
}

function openProps(item: FsItem) {
  propsPath.value = fullPath(item.name)
  propsMode.value = fmtModeNum(item.mode)
  propsOwner.value = ''
  propsGroup.value = ''
  propsOpen.value = true
}
async function confirmProps() {
  error.value = ''
  try {
    if (propsMode.value) await apiPost('/api/fs/chmod', { path: propsPath.value, mode: propsMode.value })
    if (propsOwner.value) {
      await apiPost('/api/fs/chown', { path: propsPath.value, owner: propsOwner.value, group: propsGroup.value })
    }
    propsOpen.value = false
    load(cwd.value)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function archiveItem(item: FsItem, format: 'tar.gz' | 'zip') {
  closeCtx()
  error.value = ''
  try {
    const r = await apiPost<{ job: string }>('/api/fs/archive', { path: fullPath(item.name), format })
    trackJob(r.job, t('files.archiving'))
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function extractItem(item: FsItem) {
  closeCtx()
  error.value = ''
  try {
    const r = await apiPost<{ job: string }>('/api/fs/extract', { path: fullPath(item.name) })
    trackJob(r.job, t('files.extracting'))
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function duItem(item: FsItem) {
  closeCtx()
  error.value = ''
  try {
    const r = await apiGet<{ size: number }>(`/api/fs/du?path=${encodeURIComponent(fullPath(item.name))}`)
    duResults.value[item.name] = r.size
  } catch (e) {
    error.value = (e as Error).message
  }
}

function openRename(item: FsItem) {
  renameFrom.value = fullPath(item.name)
  renameTo.value = item.name
  renameOpen.value = true
}
async function confirmRename() {
  error.value = ''
  try {
    await apiPost('/api/fs/rename', { from: renameFrom.value, to: join(cwd.value, renameTo.value) })
    renameOpen.value = false
    load(cwd.value)
  } catch (e) {
    error.value = (e as Error).message
  }
}

function openDelete(paths: string[], isDir: boolean) {
  deletePaths.value = paths
  deleteIsDir.value = isDir
  deleteConfirmName.value = ''
  deleteOpen.value = true
}
async function confirmDelete() {
  error.value = ''
  try {
    for (const p of deletePaths.value) {
      await apiPost('/api/fs/delete', { path: p })
    }
    deleteOpen.value = false
    load(cwd.value)
  } catch (e) {
    error.value = (e as Error).message
  }
}

function openCreate(type: 'file' | 'dir') {
  createType.value = type
  createName.value = ''
  createOpen.value = true
}
async function confirmCreate() {
  if (!createName.value.trim()) return
  error.value = ''
  const p = fullPath(createName.value.trim())
  try {
    if (createType.value === 'dir') await apiPost('/api/fs/mkdir', { path: p })
    else await apiPost('/api/fs/write', { path: p, content: '' })
    createOpen.value = false
    load(cwd.value)
  } catch (e) {
    error.value = (e as Error).message
  }
}

function onCtx(e: MouseEvent, item: FsItem) {
  e.preventDefault()
  ctx.value = { x: e.clientX, y: e.clientY, item }
}
function closeCtx() {
  ctx.value = null
}

const ctxStyle = computed(() => {
  if (!ctx.value) return {}
  return {
    left: Math.min(ctx.value.x, window.innerWidth - 180) + 'px',
    top: Math.min(ctx.value.y, window.innerHeight - 200) + 'px',
  }
})

function itemAction(item: FsItem, act: string) {
  closeCtx()
  if (act === 'open') openFile(item)
  else if (act === 'rename') openRename(item)
  else if (act === 'download') downloadFile(item.name)
  else if (act === 'delete') openDelete([fullPath(item.name)], item.dir)
  else if (act === 'props') openProps(item)
  else if (act === 'du') duItem(item)
  else if (act === 'extract') extractItem(item)
}

onMounted(() => {
  load('/')
  document.addEventListener('click', closeCtx)
})
onUnmounted(() => {
  document.removeEventListener('click', closeCtx)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- шапка + навигация -->
    <div class="flex items-center gap-2 mb-3 shrink-0">
      <h2 class="text-xl font-bold text-white mr-2">{{ t('files.title') }}</h2>
      <div class="flex gap-1">
        <button @click="goBack" :disabled="historyIdx === 0" class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 disabled:opacity-40 text-sm" :title="t('files.back')">←</button>
        <button @click="goForward" :disabled="historyIdx >= history.length - 1" class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 disabled:opacity-40 text-sm" :title="t('files.forward')">→</button>
        <button @click="goUp" class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm" :title="t('files.up')">↑</button>
        <button @click="goHome" class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm" :title="t('files.home')">⌂</button>
      </div>
      <div class="flex items-center gap-1 px-2 py-1.5 bg-ink-850 border border-ink-700 rounded-lg text-sm font-mono flex-1 min-w-0 overflow-x-auto">
        <button class="text-accent-400 hover:text-accent-500 shrink-0" @click="navigate('/')">/</button>
        <template v-for="(s, i) in segments" :key="s.path">
          <span class="text-slate-600">/</span>
          <button class="text-accent-400 hover:text-accent-500 whitespace-nowrap" @click="navigate(s.path)">{{ s.label }}</button>
        </template>
      </div>
      <button
        @click="showHidden = !showHidden"
        class="px-2 py-1.5 rounded-lg text-sm"
        :class="showHidden ? 'bg-accent-500/20 text-accent-400' : 'bg-ink-850 border border-ink-700'"
        :title="t('files.hiddenFiles')"
      >
        👁
      </button>
      <button @click="load(cwd)" class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm" :title="t('files.refresh')">↻</button>
    </div>

    <div v-if="error" class="mb-3 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm shrink-0">{{ error }}</div>

    <!-- тулбар -->
    <div class="flex items-center gap-2 mb-3 shrink-0">
      <button @click="fileInput?.click()" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm">⇧ {{ t('files.upload') }}</button>
      <input ref="fileInput" type="file" multiple class="hidden" @change="onFileChange" />
      <button @click="openCreate('dir')" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm hover:bg-accent-400">＋ {{ t('files.folder') }}</button>
      <button @click="openCreate('file')" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm">＋ {{ t('files.file') }}</button>
      <button
        @click="openDelete(selected.map(fullPath), selected.some((n) => items.find((i) => i.name === n)?.dir))"
        :disabled="!selectedCount"
        class="px-3 py-1.5 rounded-lg bg-bad/15 text-bad font-semibold text-sm hover:bg-bad/25 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        🗑 {{ t('files.delete') }}{{ selectedCount ? ' (' + selectedCount + ')' : '' }}
      </button>
      <button @click="openTerminalHere" class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm" :title="t('files.openTerminal')">❯_</button>
      <button
        @click="viewMode = viewMode === 'list' ? 'grid' : 'list'"
        class="px-2 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm"
        :title="viewMode === 'list' ? t('files.grid') : t('files.list')"
      >
        {{ viewMode === 'list' ? '⊞' : '☰' }}
      </button>
      <span class="text-xs text-slate-500 ml-auto">{{ t('files.selected') }} {{ selectedCount }}</span>
    </div>

    <!-- таблица -->
    <div class="card flex-1 min-h-0 flex flex-col overflow-hidden" @dragover.prevent @drop.prevent="onDrop">
      <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="p-6 text-slate-500">{{ t('files.loading') }}</div>
        <table v-else-if="viewMode === 'list'" class="w-full text-sm">
          <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase tracking-wide border-b border-ink-700">
            <tr>
              <th class="px-3 py-2 w-8">
                <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" class="accent-cyan-400 w-4 h-4" />
              </th>
              <th class="px-4 py-2 cursor-pointer select-none" @click="setSort('name')">{{ t('files.name') }} {{ arrow('name') }}</th>
              <th class="px-4 py-2 cursor-pointer select-none" @click="setSort('size')">{{ t('files.size') }} {{ arrow('size') }}</th>
              <th class="px-4 py-2">{{ t('files.permissions') }}</th>
              <th class="px-4 py-2 cursor-pointer select-none" @click="setSort('mtime')">{{ t('files.modified') }} {{ arrow('mtime') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-800">
            <tr
              v-for="it in pagedItems"
              :key="it.name"
              class="hover:bg-ink-850 cursor-default"
              @click="openFile(it)"
              @contextmenu="onCtx($event, it)"
            >
              <td class="px-3 py-2" @click.stop>
                <input type="checkbox" :checked="selected.includes(it.name)" @change="toggleSelect(it.name)" class="accent-cyan-400 w-4 h-4" />
              </td>
              <td class="px-4 py-2 font-mono text-white whitespace-nowrap">
                <span :class="it.dir ? 'text-accent-400' : ''">{{ fileIcon(it.name, it.dir) }}</span> {{ it.name }}{{ it.symlink ? ' ↪' : '' }}
              </td>
              <td class="px-4 py-2 font-mono text-slate-400 whitespace-nowrap">{{ duResults[it.name] !== undefined ? fmtSize(duResults[it.name], false) : fmtSize(it.size, it.dir) }}</td>
              <td class="px-4 py-2 font-mono text-slate-500 whitespace-nowrap" :title="fmtModeNum(it.mode)">{{ fmtMode(it.mode, it.dir) }}</td>
              <td class="px-4 py-2 text-slate-500 whitespace-nowrap">{{ fmtDate(it.mtime) }}</td>
            </tr>
            <tr v-if="!pagedItems.length">
              <td colspan="5" class="px-4 py-6 text-center text-slate-500">{{ t('files.empty') }}</td>
            </tr>
          </tbody>
        </table>
        <!-- сетка -->
        <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 p-4">
          <div
            v-for="it in pagedItems"
            :key="it.name"
            class="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-ink-850 cursor-default"
            @click="openFile(it)"
            @contextmenu="onCtx($event, it)"
          >
            <span class="text-3xl">{{ fileIcon(it.name, it.dir) }}</span>
            <span class="text-xs text-slate-300 text-center break-all line-clamp-2">{{ it.name }}</span>
          </div>
          <div v-if="!pagedItems.length" class="col-span-full text-center text-slate-500 py-6">{{ t('files.empty') }}</div>
        </div>
      </div>
      <!-- пагинация -->
      <div v-if="pageCount > 1" class="flex items-center justify-center gap-3 px-4 py-2 border-t border-ink-700 text-sm shrink-0">
        <button @click="page = Math.max(1, page - 1)" :disabled="page === 1" class="px-2 py-1 rounded bg-ink-850 border border-ink-700 disabled:opacity-40">←</button>
        <span class="text-slate-500">{{ page }} / {{ pageCount }}</span>
        <button @click="page = Math.min(pageCount, page + 1)" :disabled="page === pageCount" class="px-2 py-1 rounded bg-ink-850 border border-ink-700 disabled:opacity-40">→</button>
      </div>
    </div>

    <!-- контекстное меню -->
    <div
      v-if="ctx"
      class="fixed z-50 card p-1.5 w-48 text-sm"
      :style="ctxStyle"
    >
      <button class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-ink-850" @click="itemAction(ctx.item, 'open')">{{ t('files.open') }}</button>
      <button class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-ink-850" @click="itemAction(ctx.item, 'rename')">{{ t('files.rename') }}</button>
      <button v-if="!ctx.item.dir" class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-ink-850" @click="itemAction(ctx.item, 'download')">{{ t('files.download') }}</button>
      <button v-if="ctx.item.dir" class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-ink-850" @click="itemAction(ctx.item, 'du')">{{ t('files.folderSize') }}</button>
      <button class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-ink-850" @click="itemAction(ctx.item, 'props')">{{ t('files.properties') }}</button>
      <template v-if="!isArchive(ctx.item.name)">
        <button class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-ink-850" @click="archiveItem(ctx.item, 'tar.gz')">{{ t('files.archiveTarGz') }}</button>
        <button class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-ink-850" @click="archiveItem(ctx.item, 'zip')">{{ t('files.archiveZip') }}</button>
      </template>
      <button v-if="isArchive(ctx.item.name)" class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-ink-850" @click="itemAction(ctx.item, 'extract')">{{ t('files.extract') }}</button>
      <button class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-bad/20 text-bad" @click="itemAction(ctx.item, 'delete')">{{ t('files.delete') }}</button>
    </div>

    <!-- модалка: создать -->
    <div v-if="createOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" @click.self="createOpen = false">
      <div class="card w-full max-w-sm p-5">
        <h3 class="font-semibold text-white mb-4">{{ createType === 'dir' ? t('files.newFolder') : t('files.newFile') }}</h3>
        <input v-model="createName" @keyup.enter="confirmCreate" :placeholder="createType === 'dir' ? t('files.folderNamePlaceholder') : t('files.fileNamePlaceholder')" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-accent-500" />
        <div class="flex gap-2 justify-end">
          <button @click="createOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('files.cancel') }}</button>
          <button @click="confirmCreate" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('files.create') }}</button>
        </div>
      </div>
    </div>

    <!-- модалка: переименовать -->
    <div v-if="renameOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" @click.self="renameOpen = false">
      <div class="card w-full max-w-sm p-5">
        <h3 class="font-semibold text-white mb-4">{{ t('files.rename') }}</h3>
        <input v-model="renameTo" @keyup.enter="confirmRename" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-accent-500" />
        <div class="flex gap-2 justify-end">
          <button @click="renameOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('files.cancel') }}</button>
          <button @click="confirmRename" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('files.rename') }}</button>
        </div>
      </div>
    </div>

    <!-- модалка: удалить -->
    <div v-if="deleteOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" @click.self="deleteOpen = false">
      <div class="card w-full max-w-md p-5">
        <h3 class="font-semibold text-white mb-3">{{ t('files.delete') }}</h3>
        <div class="text-sm text-slate-400 mb-3 break-all">
          {{ deletePaths.length === 1 ? deletePaths[0] : deletePaths.length + t('files.elements') }}
        </div>
        <div v-if="deleteIsDir" class="mb-4">
          <div class="text-xs text-slate-400 mb-1">{{ t('files.deleteDirConfirm') }}</div>
          <input v-model="deleteConfirmName" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-bad" />
        </div>
        <div class="flex gap-2 justify-end">
          <button @click="deleteOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('files.cancel') }}</button>
          <button
            @click="confirmDelete"
            :disabled="deleteIsDir && deleteConfirmName !== deletePaths[0].split('/').pop()"
            class="px-3 py-1.5 rounded-lg bg-bad text-ink-950 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {{ t('files.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- модалка: свойства -->
    <div v-if="propsOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" @click.self="propsOpen = false">
      <div class="card w-full max-w-sm p-5">
        <h3 class="font-semibold text-white mb-4">{{ t('files.properties') }}</h3>
        <div class="text-xs text-slate-500 mb-3 break-all font-mono">{{ propsPath }}</div>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('files.chmodLabel') }}</label>
            <input v-model="propsMode" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-xs text-slate-500 block mb-1">{{ t('files.owner') }}</label>
              <input v-model="propsOwner" :placeholder="t('files.ownerPlaceholder')" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-500" />
            </div>
            <div>
              <label class="text-xs text-slate-500 block mb-1">{{ t('files.group') }}</label>
              <input v-model="propsGroup" :placeholder="t('files.groupPlaceholder')" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-500" />
            </div>
          </div>
        </div>
        <div class="flex gap-2 justify-end mt-4">
          <button @click="propsOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('files.cancel') }}</button>
          <button @click="confirmProps" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('files.apply') }}</button>
        </div>
      </div>
    </div>

    <!-- прогресс операции -->
    <div v-if="jobOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div class="card w-full max-w-sm p-5">
        <h3 class="font-semibold text-white mb-4">{{ jobLabel }}…</h3>
        <div class="h-2 rounded-full bg-ink-700 overflow-hidden">
          <div class="h-full bg-accent-500 transition-all duration-300" :style="{ width: jobProgress + '%' }"></div>
        </div>
        <div class="mt-2 text-right text-xs font-mono text-slate-500">{{ jobProgress }}%</div>
      </div>
    </div>

    <!-- редактор -->
    <div v-if="editorOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div class="card w-full max-w-3xl flex flex-col max-h-full">
        <div class="flex items-center justify-between px-4 py-3 border-b border-ink-700">
          <span class="font-mono text-sm text-white truncate">{{ editorPath }}</span>
          <div class="flex gap-2 shrink-0">
            <button @click="saveFile" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('files.save') }}</button>
            <button @click="editorOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('files.cancel') }}</button>
          </div>
        </div>
        <div v-if="editorError" class="px-4 py-2 text-bad text-sm border-b border-ink-700">{{ editorError }}</div>
        <textarea v-model="editorContent" class="flex-1 bg-black/60 p-4 font-mono text-[13px] leading-6 outline-none resize-none text-slate-200" rows="18" spellcheck="false"></textarea>
        <div class="px-4 py-2 text-[11px] text-slate-500 border-t border-ink-700 font-mono">UTF-8 · Text</div>
      </div>
    </div>
  </div>
</template>
