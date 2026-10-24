<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatNetworkRate } from '../lib/network-rate'
import { apiGet, apiPost } from '../lib/api'
import { t } from '../lib/i18n'
import SelectDropdown from '../components/SelectDropdown.vue'

interface Iface {
  iface: string
  ip4: string
  ip6: string
  mac: string
  type: string
  up: boolean
  rx_sec: number
  tx_sec: number
}
interface Port {
  port: string
  proto: string
  address: string
  process: string
  pid: number | null
}
interface Route {
  dest: string
  gateway: string
  iface: string
  metric: string
}
interface FwInfo {
  pref?: string
  firewalls?: Record<string, {
    installed: boolean
    active: boolean
    rules: string[]
    policy?: { incoming: string; outgoing: string }
    apps?: string[]
  }>
  note?: string
}

const tab = ref('interfaces')
const interfaces = ref<Iface[]>([])
const ports = ref<Port[]>([])
const routes = ref<Route[]>([])
const fw = ref<FwInfo | null>(null)
const dns = ref<{ servers: string[]; content: string; note?: string; error?: string }>({ servers: [], content: '' })
const error = ref('')
const loading = ref('')
const loaded = ref<Record<string, boolean>>({})

// файрвол: форма добавления правила
const fwAction = ref('allow')
const fwPort = ref('')
const fwProto = ref('tcp')
const fwFrom = ref('')
const fwApp = ref('')
const note = ref('')

// роутинг: форма добавления
const rtDest = ref('')
const rtGateway = ref('')
const rtIface = ref('')
const rtMetric = ref('')

// dns: редактируемый список
const dnsList = ref<string[]>([])
const dnsInput = ref('')

const actionOptions = [
  { value: 'allow', label: 'allow' },
  { value: 'deny', label: 'deny' },
  { value: 'reject', label: 'reject' },
  { value: 'limit', label: 'limit' },
]
const protoOptions = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: 'both', label: 'TCP+UDP' },
]
const policyOptions = [
  { value: 'allow', label: 'allow' },
  { value: 'deny', label: 'deny' },
  { value: 'reject', label: 'reject' },
]
const ufwApps = computed(() => {
  const list = fw.value?.firewalls?.ufw?.apps || []
  return [{ value: '', label: t('network.appPlaceholder') }, ...list.map((a) => ({ value: a, label: a }))]
})

const fwNames: Record<string, string> = { ufw: 'ufw', iptables: 'iptables', firewalld: 'firewalld' }
const viewFw = ref('ufw')
const fwOptions = computed(() =>
  Object.entries(fwNames)
    .filter(([k]) => fw.value?.firewalls?.[k]?.installed)
    .map(([value, label]) => ({ value, label })),
)

async function loadTab(name: string) {
  if (loaded.value[name]) return
  loaded.value[name] = true
  error.value = ''
  loading.value = name
  try {
    if (name === 'interfaces') {
      interfaces.value = (await apiGet<{ interfaces: Iface[] }>('/api/network/interfaces')).interfaces
    } else if (name === 'ports') {
      ports.value = (await apiGet<{ ports: Port[] }>('/api/network/ports')).ports
    } else if (name === 'firewall') {
      fw.value = await apiGet<FwInfo>('/api/network/firewall')
      const active = Object.keys(fwNames).find((k) => fw.value?.firewalls?.[k]?.active)
      if (active) viewFw.value = active
    } else if (name === 'routes') {
      routes.value = (await apiGet<{ routes: Route[] }>('/api/network/routes')).routes
    } else if (name === 'dns') {
      dns.value = await apiGet('/api/network/dns')
      dnsList.value = [...(dns.value.servers || [])]
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = ''
  }
}
loadTab('interfaces')

function setTab(t: string) {
  tab.value = t
  loadTab(t)
}

async function reload(name: string) {
  loaded.value[name] = false
  loadTab(name)
}

async function installFw(name: string) {
  error.value = ''
  try {
    await apiPost(`/api/network/firewall/install/${name}`)
    reload('firewall')
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function addFwRule() {
  if (!fwPort.value) {
    error.value = t('network.errorPortRequired')
    return
  }
  error.value = ''
  try {
    await apiPost('/api/network/firewall/rule', {
      fw: viewFw.value,
      action: fwAction.value,
      port: fwPort.value,
      proto: fwProto.value,
      from: fwFrom.value,
      app: fwApp.value,
    })
    fwPort.value = ''
    fwFrom.value = ''
    fwApp.value = ''
    reload('firewall')
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deleteFwRule(rule: string) {
  error.value = ''
  try {
    await apiPost('/api/network/firewall/rule/delete', { fw: viewFw.value, rule })
    reload('firewall')
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function setPolicy(direction: string, policy: string) {
  error.value = ''
  try {
    await apiPost('/api/network/firewall/policy', { fw: 'ufw', direction, policy })
    reload('firewall')
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function saveIptables() {
  error.value = ''
  note.value = ''
  try {
    await apiPost('/api/network/firewall/iptables-save', {})
    note.value = t('network.iptablesSaved')
    setTimeout(() => (note.value = ''), 4000)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function toggleFw(fwName: string, enable: boolean) {
  if (enable && fwName === 'ufw') {
    const ok = window.confirm(
      t('network.fwEnableConfirm'),
    )
    if (!ok) return
  }
  error.value = ''
  try {
    await apiPost('/api/network/firewall/toggle', { fw: fwName, enable })
    reload('firewall')
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function addRoute() {
  if (!rtDest.value) {
    error.value = t('network.errorRouteDestRequired')
    return
  }
  error.value = ''
  try {
    await apiPost('/api/network/routes/add', {
      dest: rtDest.value,
      gateway: rtGateway.value,
      iface: rtIface.value,
      metric: rtMetric.value,
    })
    rtDest.value = ''
    rtGateway.value = ''
    rtIface.value = ''
    rtMetric.value = ''
    reload('routes')
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deleteRoute(r: Route) {
  error.value = ''
  try {
    await apiPost('/api/network/routes/delete', { dest: r.dest, gateway: r.gateway, iface: r.iface })
    reload('routes')
  } catch (e) {
    error.value = (e as Error).message
  }
}

function addDnsServer() {
  const v = dnsInput.value.trim()
  if (v && !dnsList.value.includes(v)) dnsList.value.push(v)
  dnsInput.value = ''
}
function removeDnsServer(i: number) {
  dnsList.value.splice(i, 1)
}
async function saveDns() {
  error.value = ''
  try {
    const r = await apiPost<{ servers?: string[] }>('/api/network/dns', { servers: dnsList.value })
    dnsList.value = r.servers || []
    reload('dns')
  } catch (e) {
    error.value = (e as Error).message
  }
}

const fmtRate = (b: number) => { const rate = formatNetworkRate(b); return rate.value + ' ' + t(rate.unitKey) }
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-3 shrink-0">
      <h2 class="text-xl font-bold text-white">{{ t('network.title') }}</h2>
    </div>

    <div class="flex gap-2 mb-3 flex-wrap shrink-0">
      <button
        v-for="tabKey in ['interfaces', 'ports', 'firewall', 'routes', 'dns']"
        :key="tabKey"
        class="subtab-btn px-3 py-1.5 rounded-lg text-sm"
        :class="{ active: tab === tabKey }"
        @click="setTab(tabKey)"
      >
        {{ { interfaces: t('network.tabInterfaces'), ports: t('network.tabPorts'), firewall: t('network.tabFirewall'), routes: t('network.tabRoutes'), dns: t('network.tabDns') }[tabKey] }}
      </button>
    </div>

    <div v-if="error" class="mb-3 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm shrink-0">{{ error }}</div>
    <div v-if="note" class="mb-3 px-4 py-3 rounded-lg bg-ok/10 border border-ok/30 text-ok text-sm shrink-0">{{ note }}</div>

    <div class="card flex-1 min-h-0 overflow-y-auto">
      <!-- ИНТЕРФЕЙСЫ -->
      <div v-if="tab === 'interfaces'" class="grid grid-cols-1 xl:grid-cols-3 gap-4 p-4">
        <div v-for="i in interfaces" :key="i.iface" class="card p-5">
          <div class="flex items-center justify-between mb-3">
            <span class="font-mono text-white font-semibold">{{ i.iface }}</span>
            <span class="text-xs px-2 py-0.5 rounded" :class="i.up ? 'bg-ok/15 text-ok' : 'bg-slate-600/20 text-slate-500'">{{ i.up ? 'up' : 'down' }}</span>
          </div>
          <div class="space-y-1 text-sm font-mono">
            <div class="flex justify-between"><span class="text-slate-500">IPv4</span><span class="text-white">{{ i.ip4 || '—' }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">MAC</span><span class="text-slate-400">{{ i.mac || '—' }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">↓</span><span class="text-accent-400">{{ fmtRate(i.rx_sec) }}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">↑</span><span class="text-ok">{{ fmtRate(i.tx_sec) }}</span></div>
          </div>
        </div>
        <div v-if="!interfaces.length" class="card p-6 text-slate-500 col-span-full">{{ t('network.loading') }}</div>
      </div>

      <!-- ПОРТЫ -->
      <div v-else-if="tab === 'ports'" class="p-4">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm text-slate-500">{{ t('network.openPorts') }} · <span class="font-mono">{{ t('network.portProcessPid') }}</span></span>
          <button @click="reload('ports')" class="px-2 py-1 rounded bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm" :title="t('network.refresh')">↻</button>
        </div>
        <table class="w-full text-sm">
          <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase border-b border-ink-700">
            <tr><th class="px-4 py-3">{{ t('network.port') }}</th><th class="px-4 py-3">{{ t('network.protocol') }}</th><th class="px-4 py-3">{{ t('network.address') }}</th><th class="px-4 py-3">{{ t('network.process') }}</th><th class="px-4 py-3">PID</th></tr>
          </thead>
          <tbody class="divide-y divide-ink-800">
            <tr v-for="(p, idx) in ports" :key="idx" class="hover:bg-ink-850">
              <td class="px-4 py-2.5 font-mono text-white">{{ p.port }}</td>
              <td class="px-4 py-2.5 font-mono text-slate-400">{{ p.proto }}</td>
              <td class="px-4 py-2.5 font-mono text-slate-500">{{ p.address }}</td>
              <td class="px-4 py-2.5 font-mono text-white">{{ p.process || '—' }}</td>
              <td class="px-4 py-2.5 font-mono text-slate-500">{{ p.pid ?? '—' }}</td>
            </tr>
            <tr v-if="!ports.length"><td colspan="5" class="px-4 py-6 text-center text-slate-500">{{ t('network.loading') }}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- ФАЙРВОЛ -->
      <div v-else-if="tab === 'firewall'" class="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
        <div class="card p-5">
          <h3 class="font-semibold text-white mb-4">{{ t('network.firewalls') }}</h3>
          <div v-if="fw?.note" class="text-sm text-warn">{{ fw.note }}</div>
          <div v-else class="space-y-2 text-sm">
            <div v-for="(name, key) in fwNames" :key="key" class="flex items-center justify-between bg-ink-850 rounded-lg px-3 py-2.5">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full" :class="fw?.firewalls?.[key]?.installed ? 'bg-ok' : 'bg-slate-600'"></span>
                <span class="font-mono">{{ name }}</span>
              </div>
              <div class="flex items-center gap-2">
                <button v-admin
                  v-if="fw?.firewalls?.[key]?.installed"
                  @click="toggleFw(key, !fw.firewalls[key].active)"
                  class="relative w-10 h-6 rounded-full transition-colors shrink-0"
                  :class="fw.firewalls[key].active ? 'bg-accent-500' : 'bg-ink-700'"
                  :title="fw.firewalls[key].active ? t('network.disable') : t('network.enable')"
                >
                  <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform" :class="fw.firewalls[key].active ? 'translate-x-4' : ''"></span>
                </button>
                <span v-if="fw?.firewalls?.[key]?.active" class="text-xs text-ok">{{ t('network.on') }}</span>
                <span v-else-if="fw?.firewalls?.[key]?.installed" class="text-xs text-slate-500">{{ t('network.off') }}</span>
                <button v-admin v-if="!fw?.firewalls?.[key]?.installed && (key === 'ufw' || key === 'firewalld')" class="text-xs px-2 py-1 rounded bg-accent-500 text-ink-950 font-semibold" @click="installFw(key)">{{ t('network.install') }}</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold text-white">{{ t('network.rules') }}</h3>
              <SelectDropdown v-model="viewFw" :options="fwOptions" />
            </div>
            <span class="text-xs px-2 py-0.5 rounded" :class="fw?.firewalls?.[viewFw]?.active ? 'bg-ok/15 text-ok' : 'bg-slate-600/20 text-slate-500'">{{ fw?.firewalls?.[viewFw]?.active ? t('network.active') : t('network.inactive') }}</span>
          </div>

          <div v-if="viewFw === 'ufw' || viewFw === 'iptables'" class="flex gap-2 flex-wrap items-center mb-4">
            <SelectDropdown v-model="fwAction" :options="actionOptions" />
            <SelectDropdown v-if="viewFw === 'ufw'" v-model="fwApp" :options="ufwApps" />
            <input v-model="fwPort" :placeholder="viewFw === 'ufw' ? t('network.portPlaceholderUfw') : t('network.portPlaceholder')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:border-accent-500" />
            <SelectDropdown v-if="viewFw === 'ufw'" v-model="fwProto" :options="protoOptions" />
            <input v-if="viewFw === 'ufw'" v-model="fwFrom" :placeholder="t('network.fromPlaceholder')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-accent-500" />
            <button v-admin @click="addFwRule" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('network.add') }}</button>
          </div>

          <div v-if="viewFw === 'ufw' && fw?.firewalls?.ufw?.policy" class="flex items-center gap-3 mb-4 text-sm flex-wrap">
            <span class="text-slate-500">{{ t('network.defaultPolicy') }}</span>
            <div class="flex items-center gap-1">
              <span class="text-slate-500">{{ t('network.incoming') }}</span>
              <SelectDropdown :model-value="fw.firewalls.ufw.policy.incoming" :options="policyOptions" @update:model-value="setPolicy('incoming', $event)" />
            </div>
            <div class="flex items-center gap-1">
              <span class="text-slate-500">{{ t('network.outgoing') }}</span>
              <SelectDropdown :model-value="fw.firewalls.ufw.policy.outgoing" :options="policyOptions" @update:model-value="setPolicy('outgoing', $event)" />
            </div>
          </div>

          <div v-if="viewFw === 'iptables'" class="flex items-center justify-between mb-3 text-xs">
            <span class="text-warn">{{ t('network.iptablesResetWarning') }}</span>
            <button v-admin @click="saveIptables" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('network.save') }}</button>
          </div>

          <div class="space-y-1.5 font-mono text-sm max-h-96 overflow-y-auto">
            <div v-for="(r, i) in fw?.firewalls?.[viewFw]?.rules || []" :key="i" class="flex items-center justify-between bg-ink-850 rounded-lg px-3 py-2">
              <span class="break-all">{{ r }}</span>
              <button v-admin v-if="viewFw === 'ufw' || viewFw === 'iptables'" @click="deleteFwRule(r)" class="ml-2 shrink-0 text-xs px-2 py-1 rounded bg-bad/15 text-bad hover:bg-bad/25">{{ t('network.delete') }}</button>
            </div>
            <div v-if="!fw?.firewalls?.[viewFw]?.rules?.length" class="text-slate-500">{{ t('network.noRules') }}</div>
          </div>
        </div>
      </div>

      <!-- РОУТИНГ -->
      <div v-else-if="tab === 'routes'" class="p-4">
        <div class="card p-4 mb-4">
          <h3 class="font-semibold text-white mb-3">{{ t('network.addRoute') }}</h3>
          <div class="flex gap-2 flex-wrap">
            <input v-model="rtDest" :placeholder="t('network.routeDestPlaceholder')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:border-accent-500" />
            <input v-model="rtGateway" :placeholder="t('network.gateway')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:border-accent-500" />
            <input v-model="rtIface" :placeholder="t('network.interface')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:border-accent-500" />
            <input v-model="rtMetric" :placeholder="t('network.metric')" class="bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:border-accent-500" />
            <button v-admin @click="addRoute" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('network.add') }}</button>
          </div>
        </div>
        <table class="w-full text-sm">
          <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase border-b border-ink-700">
            <tr><th class="px-4 py-3">{{ t('network.destination') }}</th><th class="px-4 py-3">{{ t('network.gateway') }}</th><th class="px-4 py-3">{{ t('network.interface') }}</th><th class="px-4 py-3">{{ t('network.metric') }}</th><th class="px-4 py-3 text-right"></th></tr>
          </thead>
          <tbody class="divide-y divide-ink-800">
            <tr v-for="(r, i) in routes" :key="i" class="hover:bg-ink-850">
              <td class="px-4 py-2.5 font-mono text-white">{{ r.dest }}</td>
              <td class="px-4 py-2.5 font-mono">{{ r.gateway || '—' }}</td>
              <td class="px-4 py-2.5 font-mono">{{ r.iface || '—' }}</td>
              <td class="px-4 py-2.5 font-mono text-slate-500">{{ r.metric || '—' }}</td>
              <td class="px-4 py-2.5 text-right"><button v-admin @click="deleteRoute(r)" class="text-xs px-2 py-1 rounded bg-bad/15 text-bad hover:bg-bad/25">{{ t('network.delete') }}</button></td>
            </tr>
            <tr v-if="!routes.length"><td colspan="5" class="px-4 py-6 text-center text-slate-500">{{ t('network.loading') }}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- DNS -->
      <div v-else-if="tab === 'dns'" class="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
        <div class="card p-5">
          <h3 class="font-semibold text-white mb-4">{{ t('network.dnsServers') }}</h3>
          <div v-if="dns.note" class="text-sm text-warn mb-3">{{ dns.note }}</div>
          <div class="space-y-2 font-mono text-sm mb-4">
            <div v-for="(s, i) in dnsList" :key="i" class="flex items-center justify-between bg-ink-850 rounded-lg px-3 py-2">
              <span>{{ s }}</span>
              <button v-admin @click="removeDnsServer(i)" class="text-xs px-2 py-1 rounded bg-bad/15 text-bad hover:bg-bad/25">×</button>
            </div>
            <div v-if="!dnsList.length" class="text-slate-500">{{ t('network.noDnsServers') }}</div>
          </div>
          <div class="flex gap-2">
            <input v-model="dnsInput" @keyup.enter="addDnsServer" placeholder="1.1.1.1" class="flex-1 bg-ink-850 border border-ink-700 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent-500" />
            <button v-admin @click="addDnsServer" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:bg-ink-800 text-sm">＋</button>
            <button v-admin @click="saveDns" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('network.save') }}</button>
          </div>
        </div>
        <div class="card p-5">
          <h3 class="font-semibold text-white mb-4">/etc/resolv.conf</h3>
          <pre class="bg-black/60 rounded-lg p-4 font-mono text-[13px] leading-6 text-slate-300 overflow-x-auto">{{ dns.content || '—' }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
