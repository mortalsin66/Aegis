<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, apiPost, apiDelete } from '../lib/api'
import { t } from '../lib/i18n'

const router = useRouter()

interface Container {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
}
interface Image {
  id: string
  repo: string
  tag: string
  size: string
  created: string
}
interface Volume {
  name: string
  driver: string
  mountpoint: string
}
interface Net {
  name: string
  driver: string
  scope: string
}
interface Stack {
  name: string
  status: string
  containers: number
}
interface InspectData {
  image?: string
  state?: string
  restartPolicy?: string
  network?: string
  ports?: string[]
  env?: string[]
  mounts?: string[]
  stats?: { cpu: string; mem: string; netIO: string; blockIO: string }
  error?: string
}

const tab = ref('containers')
const containers = ref<Container[]>([])
const images = ref<Image[]>([])
const volumes = ref<Volume[]>([])
const networks = ref<Net[]>([])
const stacks = ref<Stack[]>([])
const installed = ref(true)
const note = ref('')
const error = ref('')
const busy = ref(false)
const working = ref('')

const logsOpen = ref(false)
const logsText = ref('')
const logsName = ref('')

const inspectOpen = ref(false)
const inspectData = ref<InspectData | null>(null)
const inspectName = ref('')

const createOpen = ref(false)
const cImage = ref('')
const cName = ref('')
const cPorts = ref('')
const cEnv = ref('')
const cRestart = ref('no')
const cVolumes = ref('')
const cNetwork = ref('')
const vName = ref('')
const nName = ref('')

const pullOpen = ref(false)
const pImage = ref('')
const pullStatus = ref('')
const pullLog = ref('')

const stackOpen = ref(false)
const sName = ref('')
const sContent = ref('')
const sEditing = ref(false)

let pullTimer: ReturnType<typeof setInterval> | undefined
let installTimer: ReturnType<typeof setInterval> | undefined

const restartOptions = [
  { value: 'no', label: t('containers.restart.no') },
  { value: 'always', label: 'Always' },
  { value: 'unless-stopped', label: 'Unless-stopped' },
  { value: 'on-failure', label: 'On-failure' },
]

async function load() {
  error.value = ''
  busy.value = true
  try {
    const c = await apiGet<{ containers: Container[]; installed?: boolean; note?: string }>('/api/containers')
    installed.value = c.installed !== false
    if (!installed.value) {
      containers.value = []
      images.value = []
      volumes.value = []
      networks.value = []
      note.value = ''
      return
    }
    const [i, v, n] = await Promise.all([
      apiGet<{ images: Image[]; note?: string }>('/api/images'),
      apiGet<{ volumes: Volume[]; note?: string }>('/api/volumes'),
      apiGet<{ networks: Net[]; note?: string }>('/api/networks'),
    ])
    containers.value = c.containers || []
    images.value = i.images || []
    volumes.value = v.volumes || []
    networks.value = n.networks || []
    note.value = c.note || i.note || v.note || n.note || ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function loadStacks() {
  try {
    stacks.value = (await apiGet<{ stacks: Stack[] }>('/api/stacks')).stacks
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function installDocker() {
  error.value = ''
  installTimer && clearInterval(installTimer)
  pullOpen.value = true
  pullStatus.value = 'running'
  pullLog.value = t('containers.installStarting') + '\n'
  try {
    const r = await apiPost<{ job: string; already?: boolean }>('/api/containers/install', {})
    if (r.already) {
      pullStatus.value = 'done'
      setTimeout(() => {
        pullOpen.value = false
        load()
      }, 500)
      return
    }
    installTimer = setInterval(async () => {
      try {
        const j = await apiGet<{ status: string; output: string; error?: string }>(`/api/jobs/${r.job}`)
        pullStatus.value = j.status
        if (j.output) pullLog.value = j.output
        if (j.status === 'done') {
          clearInterval(installTimer)
          installTimer = undefined
          setTimeout(() => {
            pullOpen.value = false
            load()
          }, 800)
        } else if (j.status === 'error') {
          clearInterval(installTimer)
          installTimer = undefined
          error.value = j.error || t('containers.installError')
        }
      } catch {
        /* ignore */
      }
    }, 800)
  } catch (e) {
    error.value = (e as Error).message
    pullOpen.value = false
  }
}

function setTab(t: string) {
  tab.value = t
  load()
  if (t === 'stacks') loadStacks()
}

async function action(id: string, act: string) {
  error.value = ''
  try {
    await apiPost(`/api/containers/${id}/${act}`)
    setTimeout(load, 500)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function openLogs(c: Container) {
  logsOpen.value = true
  logsName.value = c.name
  logsText.value = t('containers.loading')
  try {
    const r = await apiGet<{ logs: string }>(`/api/containers/${c.id}/logs`)
    logsText.value = r.logs || t('containers.empty')
  } catch (e) {
    logsText.value = t('containers.errorPrefix') + (e as Error).message
  }
}

async function openInspect(c: Container) {
  inspectOpen.value = true
  inspectName.value = c.name
  inspectData.value = null
  try {
    const d = await apiGet<InspectData>(`/api/containers/${c.id}/inspect`)
    try {
      const s = await apiGet<{ cpu: string; mem: string; netIO: string; blockIO: string }>(`/api/containers/${c.id}/stats`)
      d.stats = s
    } catch {
      /* ignore */
    }
    inspectData.value = d
  } catch (e) {
    inspectData.value = { error: (e as Error).message }
  }
}

async function createContainer() {
  if (!cImage.value) {
    error.value = t('containers.errImageRequired')
    return
  }
  error.value = ''
  const ports = cPorts.value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [host, rest] = s.split(':')
      const [container, proto] = (rest || '').split('/')
      return { host, container, proto: proto || 'tcp' }
    })
  const env: Record<string, string> = {}
  cEnv.value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((l) => {
      const i = l.indexOf('=')
      if (i > 0) env[l.slice(0, i)] = l.slice(i + 1)
    })
  const volumes = cVolumes.value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [host, container] = s.split(':')
      return { host, container }
    })
  working.value = t('containers.creatingContainer')
  try {
    await apiPost('/api/containers/create', {
      image: cImage.value,
      name: cName.value,
      ports,
      env,
      restart: cRestart.value,
      volumes,
      network: cNetwork.value,
    })
    createOpen.value = false
    cImage.value = ''
    cName.value = ''
    cPorts.value = ''
    cEnv.value = ''
    cVolumes.value = ''
    cNetwork.value = ''
    setTimeout(load, 600)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    working.value = ''
  }
}

async function pullImage() {
  if (!pImage.value) return
  error.value = ''
  pullOpen.value = true
  pullStatus.value = 'running'
  pullLog.value = t('containers.pullStarting') + '\n'
  try {
    const r = await apiPost<{ job: string }>('/api/images/pull', { image: pImage.value })
    if (pullTimer) clearInterval(pullTimer)
    pullTimer = setInterval(async () => {
      try {
        const j = await apiGet<{ status: string; output: string; error?: string }>(`/api/jobs/${r.job}`)
        pullStatus.value = j.status
        if (j.output) pullLog.value = j.output
        if (j.status === 'done') {
          clearInterval(pullTimer)
          pullTimer = undefined
          setTimeout(() => {
            pullOpen.value = false
            pImage.value = ''
            load()
          }, 500)
        } else if (j.status === 'error') {
          clearInterval(pullTimer)
          pullTimer = undefined
          error.value = j.error || t('containers.pullError')
        }
      } catch {
        /* ignore */
      }
    }, 800)
  } catch (e) {
    error.value = (e as Error).message
    pullOpen.value = false
  }
}

async function deleteImage(id: string) {
  error.value = ''
  try {
    await apiDelete(`/api/images/${id}`)
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function deleteVolume(name: string) {
  error.value = ''
  try {
    await apiDelete(`/api/volumes/${name}`)
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function deleteNetwork(name: string) {
  error.value = ''
  try {
    await apiDelete(`/api/networks/${name}`)
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function createVolume() {
  if (!vName.value.trim()) return
  error.value = ''
  try {
    await apiPost('/api/volumes', { name: vName.value.trim() })
    vName.value = ''
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function createNetwork() {
  if (!nName.value.trim()) return
  error.value = ''
  try {
    await apiPost('/api/networks', { name: nName.value.trim() })
    nName.value = ''
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function openStackCreate() {
  sEditing.value = false
  sName.value = ''
  sContent.value = 'services:\n  web:\n    image: nginx:latest\n    ports:\n      - "8080:80"\n'
  stackOpen.value = true
}
async function openStackEdit(name: string) {
  try {
    const r = await apiGet<{ content: string }>(`/api/stacks/${name}/file`)
    sEditing.value = true
    sName.value = name
    sContent.value = r.content
    stackOpen.value = true
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function deployStack() {
  if (!sName.value || !sContent.value) {
    error.value = t('containers.errNameContent')
    return
  }
  error.value = ''
  working.value = t('containers.deployingStack')
  try {
    await apiPost('/api/stacks/deploy', { name: sName.value, content: sContent.value })
    stackOpen.value = false
    loadStacks()
    load()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    working.value = ''
  }
}
async function stackAction(name: string, act: string) {
  error.value = ''
  try {
    await apiPost(`/api/stacks/${name}/action`, { action: act })
    loadStacks()
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

const stateDot = (s: string) => (s === 'running' ? 'bg-ok' : s === 'exited' ? 'bg-slate-500' : 'bg-warn')

onMounted(load)
onUnmounted(() => {
  if (pullTimer) clearInterval(pullTimer)
  if (installTimer) clearInterval(installTimer)
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-3 shrink-0">
      <h2 class="text-xl font-bold text-white">
        {{ t('containers.title') }} <span class="text-slate-500 font-normal text-sm">(Docker)</span>
      </h2>
      <button @click="load" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm">↻ {{ t('containers.refresh') }}</button>
    </div>

    <div class="flex gap-2 mb-3 flex-wrap shrink-0" v-if="installed">
      <button
        v-for="tabId in ['containers', 'images', 'volumes', 'networks', 'stacks']"
        :key="tabId"
        class="subtab-btn px-3 py-1.5 rounded-lg text-sm"
        :class="{ active: tab === tabId }"
        @click="setTab(tabId)"
      >
        {{ { containers: t('containers.tabContainers'), images: t('containers.tabImages'), volumes: t('containers.tabVolumes'), networks: t('containers.tabNetworks'), stacks: t('containers.tabStacks') }[tabId] }}
      </button>
    </div>

    <div v-if="note" class="mb-3 px-4 py-3 rounded-lg bg-warn/10 border border-warn/30 text-warn text-sm shrink-0">{{ note }}</div>
    <div v-if="error" class="mb-3 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm shrink-0">{{ error }}</div>

    <!-- Docker не установлен -->
    <div v-if="!installed" class="card p-10 text-center flex-1 flex flex-col items-center justify-center">
      <div class="text-5xl mb-4">🐳</div>
      <h3 class="text-lg font-semibold text-white mb-2">{{ t('containers.dockerNotInstalled') }}</h3>
      <p class="text-sm text-slate-400 mb-5 max-w-md">{{ t('containers.installHint') }}</p>
      <button @click="installDocker" class="px-5 py-2.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm hover:bg-accent-400">{{ t('containers.installDocker') }}</button>
    </div>

    <template v-if="installed">
      <!-- КОНТЕЙНЕРЫ -->
      <div v-if="tab === 'containers'" class="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-ink-700 shrink-0">
          <span class="text-sm text-slate-500">{{ t('containers.tabContainers') }}: {{ containers.length }}</span>
          <button @click="createOpen = true" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">＋ {{ t('containers.createContainer') }}</button>
        </div>
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase border-b border-ink-700">
              <tr><th class="px-4 py-3">{{ t('containers.status') }}</th><th class="px-4 py-3">{{ t('containers.name') }}</th><th class="px-4 py-3 hidden md:table-cell">{{ t('containers.image') }}</th><th class="px-4 py-3 hidden md:table-cell">{{ t('containers.ports') }}</th><th class="px-4 py-3 text-right">{{ t('containers.actions') }}</th></tr>
            </thead>
            <tbody class="divide-y divide-ink-800">
              <tr v-for="c in containers" :key="c.id" class="hover:bg-ink-850">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full inline-block" :class="stateDot(c.state)"></span>
                    <span class="capitalize text-xs">{{ c.state }}</span>
                  </div>
                </td>
                <td class="px-4 py-3 font-mono text-white">{{ c.name }}</td>
                <td class="px-4 py-3 hidden md:table-cell font-mono text-slate-400">{{ c.image }}</td>
                <td class="px-4 py-3 hidden md:table-cell font-mono text-slate-500">{{ c.ports || '—' }}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button @click="openLogs(c)" class="px-2 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs" :title="t('containers.logs')">≡</button>
                  <button @click="openInspect(c)" class="px-2 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs ml-1" :title="t('containers.inspect')">ⓘ</button>
                  <button v-if="c.state === 'running'" @click="router.push('/terminal?container=' + c.id)" class="px-2 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs ml-1" :title="t('containers.console')">❯_</button>
                  <button v-if="c.state === 'running'" @click="action(c.id, 'stop')" class="px-2 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs ml-1" :title="t('containers.stop')">⏹</button>
                  <button v-else @click="action(c.id, 'start')" class="px-2 py-1 rounded bg-ok/15 text-ok hover:bg-ok/25 text-xs ml-1" :title="t('containers.start')">▶</button>
                  <button @click="action(c.id, 'restart')" class="px-2 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs ml-1" :title="t('containers.restart')">↻</button>
                  <button @click="action(c.id, 'remove')" class="px-2 py-1 rounded bg-bad/15 text-bad hover:bg-bad/25 text-xs ml-1" :title="t('containers.delete')">🗑</button>
                </td>
              </tr>
              <tr v-if="!containers.length && !busy"><td colspan="5" class="px-4 py-6 text-center text-slate-500">{{ t('containers.noContainers') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ОБРАЗЫ -->
      <div v-else-if="tab === 'images'" class="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-ink-700 shrink-0">
          <span class="text-sm text-slate-500">{{ t('containers.tabImages') }}: {{ images.length }}</span>
          <button @click="pullOpen = true" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">⬇ Pull</button>
        </div>
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase border-b border-ink-700">
              <tr><th class="px-4 py-3">{{ t('containers.repository') }}</th><th class="px-4 py-3">{{ t('containers.tag') }}</th><th class="px-4 py-3">{{ t('containers.size') }}</th><th class="px-4 py-3">{{ t('containers.created') }}</th><th class="px-4 py-3 text-right"></th></tr>
            </thead>
            <tbody class="divide-y divide-ink-800">
              <tr v-for="i in images" :key="i.id" class="hover:bg-ink-850">
                <td class="px-4 py-3 font-mono text-white">{{ i.repo }}</td>
                <td class="px-4 py-3 font-mono text-accent-400">{{ i.tag }}</td>
                <td class="px-4 py-3 font-mono">{{ i.size }}</td>
                <td class="px-4 py-3 text-slate-500">{{ i.created }}</td>
                <td class="px-4 py-3 text-right"><button @click="deleteImage(i.id)" class="px-2 py-1 rounded bg-bad/15 text-bad hover:bg-bad/25 text-xs">🗑</button></td>
              </tr>
              <tr v-if="!images.length"><td colspan="5" class="px-4 py-6 text-center text-slate-500">{{ t('containers.noImages') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ТОМА -->
      <div v-else-if="tab === 'volumes'" class="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-ink-700 shrink-0">
          <span class="text-sm text-slate-500">{{ t('containers.tabVolumes') }}: {{ volumes.length }}</span>
          <div class="ml-auto flex gap-2">
            <input v-model="vName" @keyup.enter="createVolume" :placeholder="t('containers.volumeNamePlaceholder')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:border-accent-500" />
            <button @click="createVolume" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">＋ {{ t('containers.volume') }}</button>
          </div>
        </div>
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase border-b border-ink-700">
              <tr><th class="px-4 py-3">{{ t('containers.name') }}</th><th class="px-4 py-3">{{ t('containers.driver') }}</th><th class="px-4 py-3">{{ t('containers.mountpoint') }}</th><th class="px-4 py-3 text-right"></th></tr>
            </thead>
            <tbody class="divide-y divide-ink-800">
              <tr v-for="v in volumes" :key="v.name" class="hover:bg-ink-850">
                <td class="px-4 py-3 font-mono text-white">{{ v.name }}</td>
                <td class="px-4 py-3 font-mono text-slate-400">{{ v.driver }}</td>
                <td class="px-4 py-3 font-mono text-slate-500">{{ v.mountpoint }}</td>
                <td class="px-4 py-3 text-right"><button @click="deleteVolume(v.name)" class="px-2 py-1 rounded bg-bad/15 text-bad hover:bg-bad/25 text-xs">🗑</button></td>
              </tr>
              <tr v-if="!volumes.length"><td colspan="4" class="px-4 py-6 text-center text-slate-500">{{ t('containers.noVolumes') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- СЕТИ -->
      <div v-else-if="tab === 'networks'" class="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-ink-700 shrink-0">
          <span class="text-sm text-slate-500">{{ t('containers.tabNetworks') }}: {{ networks.length }}</span>
          <div class="ml-auto flex gap-2">
            <input v-model="nName" @keyup.enter="createNetwork" :placeholder="t('containers.networkNamePlaceholder')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:border-accent-500" />
            <button @click="createNetwork" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">＋ {{ t('containers.network') }}</button>
          </div>
        </div>
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase border-b border-ink-700">
              <tr><th class="px-4 py-3">{{ t('containers.name') }}</th><th class="px-4 py-3">{{ t('containers.driver') }}</th><th class="px-4 py-3">Scope</th><th class="px-4 py-3 text-right"></th></tr>
            </thead>
            <tbody class="divide-y divide-ink-800">
              <tr v-for="n in networks" :key="n.name" class="hover:bg-ink-850">
                <td class="px-4 py-3 font-mono text-white">{{ n.name }}</td>
                <td class="px-4 py-3 font-mono text-slate-400">{{ n.driver }}</td>
                <td class="px-4 py-3 font-mono text-slate-500">{{ n.scope }}</td>
                <td class="px-4 py-3 text-right"><button @click="deleteNetwork(n.name)" class="px-2 py-1 rounded bg-bad/15 text-bad hover:bg-bad/25 text-xs">🗑</button></td>
              </tr>
              <tr v-if="!networks.length"><td colspan="4" class="px-4 py-6 text-center text-slate-500">{{ t('containers.noNetworks') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- СТЭКИ -->
      <div v-else-if="tab === 'stacks'" class="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-ink-700 shrink-0">
          <span class="text-sm text-slate-500">{{ t('containers.tabStacks') }} (Docker Compose): {{ stacks.length }}</span>
          <button @click="openStackCreate" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">＋ {{ t('containers.createStack') }}</button>
        </div>
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase border-b border-ink-700">
              <tr><th class="px-4 py-3">{{ t('containers.name') }}</th><th class="px-4 py-3">{{ t('containers.status') }}</th><th class="px-4 py-3">{{ t('containers.tabContainers') }}</th><th class="px-4 py-3 text-right">{{ t('containers.actions') }}</th></tr>
            </thead>
            <tbody class="divide-y divide-ink-800">
              <tr v-for="s in stacks" :key="s.name" class="hover:bg-ink-850">
                <td class="px-4 py-3 font-mono text-white">{{ s.name }}</td>
                <td class="px-4 py-3">
                  <span class="text-xs px-2 py-0.5 rounded" :class="s.status === 'running' ? 'bg-ok/15 text-ok' : 'bg-slate-600/20 text-slate-500'">{{ s.status }}</span>
                </td>
                <td class="px-4 py-3 font-mono text-slate-400">{{ s.containers }}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button @click="openStackEdit(s.name)" class="px-2 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs" :title="t('containers.edit')">✎</button>
                  <button @click="stackAction(s.name, 'stop')" class="px-2 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs ml-1" :title="t('containers.stop')">⏹</button>
                  <button @click="stackAction(s.name, 'remove')" class="px-2 py-1 rounded bg-bad/15 text-bad hover:bg-bad/25 text-xs ml-1" :title="t('containers.delete')">🗑</button>
                </td>
              </tr>
              <tr v-if="!stacks.length"><td colspan="4" class="px-4 py-6 text-center text-slate-500">{{ t('containers.noStacks') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ЛОГИ -->
    <div v-if="logsOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div class="card w-full max-w-3xl flex flex-col max-h-full">
        <div class="flex items-center justify-between px-4 py-3 border-b border-ink-700">
          <span class="font-mono text-sm text-white">{{ t('containers.logs') }}: {{ logsName }}</span>
          <button @click="logsOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('containers.close') }}</button>
        </div>
        <pre class="flex-1 overflow-y-auto bg-black/60 p-4 font-mono text-[13px] leading-6 text-slate-300">{{ logsText }}</pre>
      </div>
    </div>

    <!-- ИНСПЕКЦИЯ -->
    <div v-if="inspectOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div class="card w-full max-w-2xl flex flex-col max-h-full">
        <div class="flex items-center justify-between px-4 py-3 border-b border-ink-700 shrink-0">
          <span class="font-mono text-sm text-white">{{ t('containers.inspect') }}: {{ inspectName }}</span>
          <button @click="inspectOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('containers.close') }}</button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 text-sm space-y-3">
          <div v-if="!inspectData" class="text-slate-500">{{ t('containers.loading') }}</div>
          <div v-else-if="inspectData.error" class="text-bad">{{ inspectData.error }}</div>
          <template v-else>
            <div class="grid grid-cols-2 gap-2">
              <div><div class="text-slate-500 text-xs">{{ t('containers.image') }}</div><div class="font-mono text-white">{{ inspectData.image }}</div></div>
              <div><div class="text-slate-500 text-xs">{{ t('containers.state') }}</div><div class="font-mono text-white">{{ inspectData.state }}</div></div>
              <div><div class="text-slate-500 text-xs">Restart policy</div><div class="font-mono text-white">{{ inspectData.restartPolicy }}</div></div>
              <div><div class="text-slate-500 text-xs">{{ t('containers.network') }}</div><div class="font-mono text-white">{{ inspectData.network || '—' }}</div></div>
            </div>
            <div>
              <div class="text-slate-500 text-xs mb-1">{{ t('containers.ports') }}</div>
              <div v-for="(p, i) in inspectData.ports || []" :key="i" class="font-mono text-slate-300">{{ p }}</div>
              <div v-if="!inspectData.ports?.length" class="text-slate-600">—</div>
            </div>
            <div>
              <div class="text-slate-500 text-xs mb-1">{{ t('containers.mounts') }}</div>
              <div v-for="(m, i) in inspectData.mounts || []" :key="i" class="font-mono text-slate-300">{{ m }}</div>
              <div v-if="!inspectData.mounts?.length" class="text-slate-600">—</div>
            </div>
            <div>
              <div class="text-slate-500 text-xs mb-1">{{ t('containers.envVars') }}</div>
              <div v-for="(e, i) in inspectData.env || []" :key="i" class="font-mono text-slate-300 break-all">{{ e }}</div>
              <div v-if="!inspectData.env?.length" class="text-slate-600">—</div>
            </div>
            <div v-if="inspectData.stats">
              <div class="text-slate-500 text-xs mb-1">{{ t('containers.stats') }}</div>
              <div class="grid grid-cols-2 gap-2 font-mono">
                <div>CPU: <span class="text-accent-400">{{ inspectData.stats.cpu }}</span></div>
                <div>RAM: <span class="text-accent-400">{{ inspectData.stats.mem }}</span></div>
                <div>Net: {{ inspectData.stats.netIO }}</div>
                <div>Block: {{ inspectData.stats.blockIO }}</div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- СОЗДАНИЕ КОНТЕЙНЕРА -->
    <div v-if="createOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div class="card w-full max-w-lg flex flex-col max-h-full">
        <div class="flex items-center justify-between px-4 py-3 border-b border-ink-700 shrink-0">
          <span class="font-semibold text-white">{{ t('containers.createContainer') }}</span>
          <button @click="createOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('containers.cancel') }}</button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('containers.image') }} *</label>
            <input v-model="cImage" placeholder="nginx:latest" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('containers.containerName') }}</label>
            <input v-model="cName" placeholder="my-container" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('containers.portsHint') }}</label>
            <textarea v-model="cPorts" rows="2" placeholder="8080:80, 443:443/tcp" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500"></textarea>
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('containers.envHint') }}</label>
            <textarea v-model="cEnv" rows="3" placeholder="TZ=Europe/Moscow" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500"></textarea>
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">{{ t('containers.volumesHint') }}</label>
            <textarea v-model="cVolumes" rows="2" placeholder="/data:/var/lib/data" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-slate-500 block mb-1">Restart policy</label>
              <select v-model="cRestart" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option v-for="o in restartOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-slate-500 block mb-1">{{ t('containers.network') }}</label>
              <input v-model="cNetwork" placeholder="bridge" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-4 py-3 border-t border-ink-700 shrink-0">
          <button @click="createContainer" class="px-4 py-2 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('containers.create') }}</button>
        </div>
      </div>
    </div>

    <!-- PULL / УСТАНОВКА -->
    <div v-if="pullOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div class="card w-full max-w-md p-5">
        <h3 class="font-semibold text-white mb-4">{{ pullStatus === 'done' ? t('containers.done') : t('containers.loading') }}</h3>
        <div class="h-2 rounded-full bg-ink-700 overflow-hidden mb-3">
          <div class="h-full bg-accent-500 transition-all" :class="pullStatus === 'running' ? 'animate-pulse w-full' : 'w-full'"></div>
        </div>
        <pre class="bg-black/60 rounded-lg p-3 font-mono text-[11px] leading-5 text-slate-300 h-40 overflow-y-auto">{{ pullLog }}</pre>
        <div v-if="pullStatus === 'done'" class="mt-3 text-ok text-sm">{{ t('containers.completed') }} ✓</div>
        <div v-if="pullStatus === 'error'" class="mt-3 text-bad text-sm">{{ t('containers.error') }}</div>
        <button v-if="pullStatus !== 'running'" @click="pullOpen = false" class="mt-3 px-4 py-2 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('containers.close') }}</button>
      </div>
    </div>

    <!-- ОЖИДАНИЕ (деплой/создание) -->
    <div v-if="working" class="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-6">
      <div class="card p-6 flex items-center gap-3">
        <span class="inline-block w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></span>
        <span class="text-white">{{ working }}</span>
      </div>
    </div>

    <!-- СТЭК РЕДАКТОР -->
    <div v-if="stackOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div class="card w-full max-w-3xl flex flex-col max-h-full">
        <div class="flex items-center justify-between px-4 py-3 border-b border-ink-700 shrink-0">
          <span class="font-semibold text-white">{{ sEditing ? t('containers.editStack') : t('containers.createStack') }}</span>
          <button @click="stackOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('containers.cancel') }}</button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <input v-model="sName" :disabled="sEditing" :placeholder="t('containers.stackNamePlaceholder')" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500 disabled:opacity-50" />
          <textarea v-model="sContent" rows="18" spellcheck="false" class="w-full bg-black/60 border border-ink-700 rounded-lg p-4 font-mono text-[13px] leading-6 text-slate-200 focus:outline-none focus:border-accent-500"></textarea>
        </div>
        <div class="flex justify-end gap-2 px-4 py-3 border-t border-ink-700 shrink-0">
          <button @click="deployStack" class="px-4 py-2 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">Deploy</button>
        </div>
      </div>
    </div>
  </div>
</template>
