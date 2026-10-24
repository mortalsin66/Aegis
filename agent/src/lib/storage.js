import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { command } from './commands.js'

export async function atomicJson(file, value) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  try { await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(tmp, file) }
  finally { await fs.rm(tmp, { force: true }).catch(() => {}) }
}
export async function loadJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e; return fallback }
}
export class MetricHistory {
  constructor(file, points = []) { this.file = file; this.points = points; this.savedAt = 0; this.saving = null }
  add(m) {
    const last = this.points.at(-1)
    if (!last || m.timestamp - last.t >= 10_000) this.points.push({ t: m.timestamp, cpu: m.cpu, mem: m.mem.usedPct, disk: m.disk.find(d => d.mount === '/')?.use ?? m.disk[0]?.use ?? 0, rx: m.net.rx, tx: m.net.tx })
    const since = Date.now() - 86400_000
    while (this.points.length && this.points[0].t < since) this.points.shift()
    if (Date.now() - this.savedAt >= 60_000) this.flush().catch(() => {})
  }
  async flush() {
    if (this.saving) { await this.saving; return this.flush() }
    this.savedAt = Date.now()
    this.saving = atomicJson(this.file, this.points).then(() => { this.savedAt = Date.now() }).finally(() => { this.saving = null })
    return this.saving
  }
  range(seconds, max = 240) {
    const points = this.points.filter(p => p.t >= Date.now() - seconds * 1000)
    const step = Math.max(1, Math.ceil(points.length / max))
    const out = []
    for (let i = 0; i < points.length; i += step) {
      const group = points.slice(i, i + step), result = { t: group.at(-1).t }
      for (const key of ['cpu', 'mem', 'disk', 'rx', 'tx']) result[key] = group.reduce((sum, p) => sum + (p[key] || 0), 0) / group.length
      out.push(result)
    }
    return out
  }
}

export function folderSizes() {
  const cache = new Map(), pending = new Map(), waiting = []
  let active = 0
  async function slot() { if (active >= 2) await new Promise(resolve => waiting.push(resolve)); else active++ }
  function release() { const next = waiting.shift(); if (next) next(); else active-- }
  return async (input, refresh = false) => {
    if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) { const e = new Error('Absolute path required'); e.statusCode = 400; throw e }
    const real = await fs.realpath(input)
    const hit = cache.get(real)
    if (!refresh && hit && hit.expires > Date.now()) return { ...hit.result, cached: true }
    if (pending.has(real)) return pending.get(real)
    if (pending.size >= 100) { const e = new Error('Folder size queue is full'); e.statusCode = 429; throw e }
    const work = (async () => {
      await slot()
      try {
        const { stdout } = await command('du', ['-sb', '--', real], { timeout: 60_000 })
        const size = Number(stdout.split(/\s/)[0])
        if (!Number.isFinite(size)) throw new Error('Could not calculate folder size')
        const result = { size, path: real, calculatedAt: Date.now(), cached: false }
        if (cache.size >= 1000) cache.delete(cache.keys().next().value)
        cache.set(real, { result, expires: Date.now() + 30_000 })
        return result
      } finally { release() }
    })().finally(() => pending.delete(real))
    pending.set(real, work)
    return work
  }
}
