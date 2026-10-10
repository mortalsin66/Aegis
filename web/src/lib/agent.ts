import { reactive } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { token } from './auth'

export interface Metrics {
  cpu: number
  cpuCores: number
  loadAvg: number
  mem: { total: number; used: number; free: number; usedPct: number }
  disk: { fs: string; mount: string; size: number; used: number; use: number }[]
  net: { iface: string; rx: number; tx: number }
  timestamp: number
}

export interface SystemInfo {
  hostname: string
  distro: string
  release: string
  kernel: string
  arch: string
  platform: string
  uptime: number
  cpuModel?: string
  cpuCores?: number
  cpuPhysicalCores?: number
}

const state = reactive({
  connected: false,
  metrics: null as Metrics | null,
  system: null as SystemInfo | null,
})

let socket: Socket | null = null

export function agentUrl(): string {
  const fromEnv = import.meta.env.VITE_AGENT_URL as string | undefined
  if (fromEnv) return fromEnv
  // В production агент сам раздаёт фронтенд — обращаемся к тому же origin.
  // В dev (Vite dev-server) агент работает на localhost:9000.
  return import.meta.env.DEV ? 'http://localhost:9000' : window.location.origin
}

export function connectAgent(url = agentUrl()): void {
  disconnectAgent()
  const t = token.value
  if (!t) return
  try {
    socket = io(url, { transports: ['websocket', 'polling'], auth: { token: t } })
    socket.on('connect', () => {
      state.connected = true
    })
    socket.on('disconnect', () => {
      state.connected = false
    })
    socket.on('metrics', (m: Metrics) => {
      state.metrics = m
    })
  } catch (e) {
    state.connected = false
    console.warn('Не удалось подключиться к агенту Aegis:', e)
  }

  fetch(`${url}/api/system`, { headers: { Authorization: `Bearer ${t}` } })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    })
    .then((s: SystemInfo) => {
      state.system = s
    })
    .catch(() => {})
}

export function disconnectAgent(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  state.connected = false
  state.metrics = null
  state.system = null
}

export function getSocket(): Socket | null {
  return socket
}

export function useAgent() {
  return { state, connect: connectAgent }
}
