import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { Server } from 'socket.io'
import si from 'systeminformation'
import { exec, spawn, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import fsSync from 'node:fs'
import otplib from 'otplib'

const { authenticator } = otplib

const execAsync = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT || 9000)
const HOST = process.env.HOST || '0.0.0.0'
const WEB_DIST = process.env.WEB_DIST || path.resolve(__dirname, '../../web/dist')
const METRICS_INTERVAL = Number(process.env.METRICS_INTERVAL || 2000)

// версия панели и GitHub-репозиторий для обновлений
const PANEL_VERSION = (() => {
  try {
    const v = fsSync.readFileSync('/opt/aegis/.aegis-version', 'utf8').trim()
    return v || '1.0.0'
  } catch {
    return '1.0.0'
  }
})()
const GITHUB_REPO = 'mortalsin66/Aegis'

const app = Fastify({ logger: { level: 'info' } })

await app.register(cors, { origin: true })
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } })
await app.register(fastifyStatic, { root: WEB_DIST })

// SPA fallback: любые не-API маршруты отдают index.html (для клиентского роутера)
app.setNotFoundHandler((req, reply) => {
  const url = req.raw.url || ''
  if (url.startsWith('/api/') || url.startsWith('/socket.io/')) {
    return reply.code(404).send({ error: 'Not found' })
  }
  return reply.sendFile('index.html')
})

// ===================== АУТЕНТИФИКАЦИЯ =====================
const AEGIS_USER = process.env.AEGIS_USER || 'admin'
const AEGIS_PASSWORD = process.env.AEGIS_PASSWORD || 'admin'
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')

if (!process.env.AEGIS_PASSWORD) {
  app.log.warn('ВНИМАНИЕ: AEGIS_PASSWORD не задан — используются учётные данные admin/admin')
}

const PW_FILE = path.resolve(__dirname, '../.aegis-password')
let pwSalt
let pwHash
try {
  const data = fsSync.readFileSync(PW_FILE, 'utf8').trim()
  const [salt, hash] = data.split(':')
  if (salt && hash) {
    pwSalt = salt
    pwHash = hash
  } else {
    throw new Error('bad format')
  }
} catch {
  pwSalt = crypto.randomBytes(16).toString('hex')
  pwHash = crypto.scryptSync(AEGIS_PASSWORD, pwSalt, 64).toString('hex')
}

function checkPassword(input) {
  const h = crypto.scryptSync(input, pwSalt, 64).toString('hex')
  const a = Buffer.from(h)
  const b = Buffer.from(pwHash)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ---- 2FA (TOTP) ----
const TOTP_FILE = path.resolve(__dirname, '../.aegis-totp')
let totpSecret = null // включённый секрет
let pendingSecret = null // сгенерирован, но ещё не подтверждён
try {
  const fromFile = fsSync.readFileSync(TOTP_FILE, 'utf8').trim()
  if (fromFile) totpSecret = fromFile
} catch {
  totpSecret = process.env.AEGIS_TOTP_SECRET || null
}

app.post('/api/auth/login', async (req, reply) => {
  const { username, password, totp } = req.body || {}
  if (username !== AEGIS_USER || !checkPassword(password || '')) {
    return reply.code(401).send({ error: 'Неверные учётные данные' })
  }
  if (totpSecret) {
    if (!totp || !authenticator.check(String(totp), totpSecret)) {
      return reply.code(401).send({ error: 'Неверный код 2FA', totpRequired: true })
    }
  }
  const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '12h' })
  return { token, mustChangePassword: checkPassword('admin') }
})

app.get('/api/auth/2fa/status', async () => ({ enabled: !!totpSecret, pending: !!pendingSecret }))

app.post('/api/auth/2fa/setup', async () => {
  const secret = authenticator.generateSecret()
  pendingSecret = secret // пока НЕ включаем — ждём подтверждения кодом
  const otpauthUrl = authenticator.keyuri(AEGIS_USER, 'Aegis', secret)
  return { secret, otpauthUrl }
})

app.post('/api/auth/2fa/confirm', async (req, reply) => {
  if (!pendingSecret) return reply.code(400).send({ error: 'Сначала сгенерируйте секрет' })
  const { totp } = req.body || {}
  if (!totp || !authenticator.check(String(totp), pendingSecret)) {
    return reply.code(401).send({ error: 'Неверный код — секрет не был включён' })
  }
  totpSecret = pendingSecret
  fsSync.writeFileSync(TOTP_FILE, pendingSecret, 'utf8')
  pendingSecret = null
  return { ok: true }
})

app.post('/api/auth/2fa/disable', async (req, reply) => {
  if (!totpSecret) return { ok: true }
  const { totp } = req.body || {}
  if (!totp || !authenticator.check(String(totp), totpSecret)) {
    return reply.code(401).send({ error: 'Неверный код 2FA' })
  }
  totpSecret = null
  try {
    fsSync.unlinkSync(TOTP_FILE)
  } catch {
    /* ignore */
  }
  return { ok: true }
})

app.get('/api/settings', async () => ({
  port: PORT,
  user: AEGIS_USER,
  twoFactor: !!totpSecret,
  twoFactorPending: !!pendingSecret,
}))

app.post('/api/auth/password', async (req, reply) => {
  const { current, next } = req.body || {}
  if (!checkPassword(current || '')) return reply.code(401).send({ error: 'Неверный текущий пароль' })
  if (!next || String(next).length < 4) return reply.code(400).send({ error: 'Новый пароль слишком короткий (мин. 4 символа)' })
  pwSalt = crypto.randomBytes(16).toString('hex')
  pwHash = crypto.scryptSync(String(next), pwSalt, 64).toString('hex')
  try {
    fsSync.writeFileSync(PW_FILE, `${pwSalt}:${pwHash}`, 'utf8')
  } catch (e) {
    return reply.code(500).send({ error: 'Не удалось сохранить пароль: ' + e.message })
  }
  return { ok: true }
})

app.post('/api/settings/port', async (req, reply) => {
  const port = Number(req.body?.port)
  if (!port || port < 1 || port > 65535) return reply.code(400).send({ error: 'Некорректный порт' })
  if (port === PORT) return { ok: true, port }
  const candidates = ['/etc/systemd/system/aegis-agent.service', '/opt/aegis/agent/aegis-agent.service']
  let unitFile = null
  for (const c of candidates) {
    try {
      await fs.access(c)
      unitFile = c
      break
    } catch {
      /* ignore */
    }
  }
  if (!unitFile) return reply.code(500).send({ error: 'Не найден systemd-юнит aegis-agent' })
  let content = await fs.readFile(unitFile, 'utf8')
  if (/Environment=PORT=\d+/.test(content)) {
    content = content.replace(/Environment=PORT=\d+/, `Environment=PORT=${port}`)
  } else {
    content = content.replace('[Service]', `[Service]\nEnvironment=PORT=${port}`)
  }
  await fs.writeFile(unitFile, content, 'utf8')
  try {
    await execAsync('ufw allow 22/tcp')
    await execAsync(`ufw allow ${port}/tcp`)
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    exec('systemctl daemon-reload && systemctl restart aegis-agent', () => {})
  }, 1500)
  return { ok: true, port }
})

app.addHook('onRequest', async (req, reply) => {
  const url = req.raw.url || ''
  if (!url.startsWith('/api/') || url === '/api/auth/login' || url === '/api/auth/2fa/status' || url === '/api/health') {
    return
  }
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return reply.code(401).send({ error: 'Требуется авторизация' })
  try {
    jwt.verify(token, JWT_SECRET)
  } catch {
    return reply.code(401).send({ error: 'Сессия истекла или недействительна' })
  }
})

// ===================== МЕТРИКИ =====================
async function getMetrics() {
  const [load, mem, disk, net] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
  ])
  const iface = net[0] || {}
  return {
    cpu: Math.round((load.currentLoad || 0) * 10) / 10,
    cpuCores: (load.cpus || []).length,
    loadAvg: load.avgLoad || 0,
    mem: {
      total: mem.total,
      used: mem.active,
      free: mem.available,
      usedPct: mem.total ? Math.round((mem.active / mem.total) * 1000) / 10 : 0,
    },
    disk: (disk || []).map((d) => ({ fs: d.fs, mount: d.mount, size: d.size, used: d.used, use: d.use })),
    net: { iface: iface.iface || '—', rx: iface.rx_sec || 0, tx: iface.tx_sec || 0 },
    timestamp: Date.now(),
  }
}

// ===================== REST API =====================
app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }))

app.get('/api/system', async () => {
  const [os, time, cpu] = await Promise.all([si.osInfo(), si.time(), si.cpu()])
  return {
    hostname: os.hostname,
    distro: os.distro,
    release: os.release,
    kernel: os.kernel,
    arch: os.arch,
    platform: os.platform,
    uptime: time.uptime,
    cpuModel: (cpu.brand || cpu.model || '').trim(),
    cpuCores: cpu.cores || 0,
    cpuPhysicalCores: cpu.physicalCores || cpu.cores || 0,
  }
})

app.get('/api/metrics', async () => getMetrics())

// история метрик (для графиков с периодами)
const history = []
const HISTORY_MAX = Math.ceil((24 * 3600) / (METRICS_INTERVAL / 1000))

function pushHistory(m) {
  history.push({ t: Date.now(), cpu: m.cpu })
  if (history.length > HISTORY_MAX) history.shift()
}

app.get('/api/metrics/history', async (req) => {
  const ranges = { '1m': 60, '15m': 900, '1h': 3600, '6h': 21600, '12h': 43200, '24h': 86400 }
  const range = (req.query.range || '1h').toString()
  const seconds = ranges[range] || 3600
  const since = Date.now() - seconds * 1000
  const pts = history.filter((p) => p.t >= since)
  const step = Math.max(1, Math.ceil(pts.length / 120))
  const points = pts.filter((_, i) => i % step === 0)
  return { range, points }
})

app.get('/api/services', async () => {
  if (process.platform !== 'linux') {
    return { services: [], note: 'systemd доступен только на Linux' }
  }
  try {
    const { stdout } = await execAsync(
      'systemctl list-units --type=service --all --no-legend --no-pager',
    )
    const services = stdout
      .trim()
      .split('\n')
      .map((line) => {
        // systemctl добавляет маркер "● " перед not-found юнитами — убираем,
        // иначе колонки сдвигаются
        const cleaned = line.trim().replace(/^●\s*/, '')
        const [unit, load, active, sub, ...rest] = cleaned.split(/\s+/)
        return { unit, load, active, sub, description: rest.join(' ') }
      })
      .filter((s) => s.unit && s.unit.endsWith('.service'))
      .sort((a, b) => a.unit.localeCompare(b.unit))
    return { services }
  } catch (e) {
    return { services: [], error: e.message }
  }
})

app.post('/api/services/:name/:action', async (req, reply) => {
  const allowed = ['start', 'stop', 'restart', 'reload', 'enable', 'disable']
  const { name, action } = req.params
  if (!allowed.includes(action)) {
    return reply.code(400).send({ error: 'Недопустимое действие' })
  }
  if (process.platform !== 'linux') {
    return reply.code(400).send({ error: 'systemd доступен только на Linux' })
  }
  try {
    const { stdout, stderr } = await execAsync(`systemctl ${action} ${name}`)
    return { ok: true, stdout, stderr }
  } catch (e) {
    return reply.code(500).send({ ok: false, error: e.message })
  }
})

// возвращает { ticks, state } из /proc/<pid>/stat
function readProcStat(pid) {
  try {
    const stat = fsSync.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const close = stat.lastIndexOf(')')
    const rest = stat.slice(close + 2).split(' ')
    const c = rest[0]
    const state =
      c === 'R'
        ? 'running'
        : c === 'S'
          ? 'sleeping'
          : c === 'D' || c === 'U'
            ? 'blocked'
            : c === 'Z'
              ? 'zombie'
              : c === 'T' || c === 't'
                ? 'stopped'
                : c === 'I'
                  ? 'idle'
                  : c === 'X' || c === 'x'
                    ? 'dead'
                    : c === 'W'
                      ? 'paging'
                      : 'unknown'
    const ticks = Number(rest[11]) + Number(rest[12])
    return { ticks, state }
  } catch {
    return null
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.get('/api/processes', async () => {
  // два замера с интервалом, чтобы получить мгновенный %CPU (systeminformation даёт средний за жизнь)
  const t0 = Date.now()
  const pids = fsSync
    .readdirSync('/proc')
    .filter((d) => /^\d+$/.test(d))
    .map(Number)
  const sample1 = new Map()
  for (const pid of pids) {
    const s = readProcStat(pid)
    if (s) sample1.set(pid, s.ticks)
  }
  await sleep(400)
  const data = await si.processes()
  const deltaSec = (Date.now() - t0) / 1000
  const processes = data.list
    .slice(0, 200)
    .map((p) => {
      const s2 = readProcStat(p.pid)
      const t1 = sample1.get(p.pid)
      const cpu = s2 && t1 != null && deltaSec > 0 ? Math.max(0, (s2.ticks - t1) / deltaSec) : 0
      return {
        pid: p.pid,
        name: p.name,
        user: p.user,
        cpu: Math.round(cpu * 10) / 10,
        mem: p.memRss, // в КБ
        state: s2 ? s2.state : p.state,
      }
    })
    .sort((a, b) => b.cpu - a.cpu)
  return { processes }
})

app.post('/api/processes/:pid/kill', async (req, reply) => {
  const pid = Number(req.params.pid)
  if (!pid || pid <= 1) return reply.code(400).send({ error: 'Некорректный PID' })
  if (process.platform !== 'linux') return reply.code(400).send({ error: 'kill доступен только на Linux' })
  try {
    await execAsync(`kill ${pid}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ ok: false, error: e.message })
  }
})

// ===================== ФАЙЛЫ =====================
app.get('/api/fs', async (req, reply) => {
  const p = (req.query.path || '/').toString()
  try {
    const entries = await fs.readdir(p, { withFileTypes: true })
    const items = await Promise.all(
      entries.map(async (e) => {
        const full = path.join(p, e.name)
        let size = null
        let mtime = null
        let mode = null
        let isDir = e.isDirectory()
        try {
          const st = await fs.stat(full)
          size = st.size
          mtime = st.mtimeMs
          mode = st.mode
          if (st.isDirectory()) isDir = true
        } catch {
          /* битые симлинки и т.п. — игнорируем stat */
        }
        return { name: e.name, dir: isDir, symlink: e.isSymbolicLink(), size, mtime, mode }
      }),
    )
    items.sort((a, b) => (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || a.name.localeCompare(b.name))
    return { path: p, items }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.get('/api/fs/read', async (req, reply) => {
  const p = (req.query.path || '').toString()
  if (!p) return reply.code(400).send({ error: 'path required' })
  try {
    const st = await fs.stat(p)
    if (st.isDirectory()) return reply.code(400).send({ error: 'Это папка' })
    if (st.size > 2 * 1024 * 1024) {
      return reply.code(413).send({ error: 'Файл слишком большой (более 2 МБ)' })
    }
    const content = await fs.readFile(p, 'utf8')
    return { path: p, content }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/fs/write', async (req, reply) => {
  const body = req.body || {}
  const p = (body.path || '').toString()
  if (!p) return reply.code(400).send({ error: 'path required' })
  try {
    await fs.writeFile(p, body.content || '', 'utf8')
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/fs/mkdir', async (req, reply) => {
  const p = (req.body?.path || '').toString()
  if (!p) return reply.code(400).send({ error: 'path required' })
  try {
    await fs.mkdir(p)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/fs/rename', async (req, reply) => {
  const from = (req.body?.from || '').toString()
  const to = (req.body?.to || '').toString()
  if (!from || !to) return reply.code(400).send({ error: 'from/to required' })
  try {
    await fs.rename(from, to)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/fs/delete', async (req, reply) => {
  const p = (req.body?.path || '').toString()
  if (!p) return reply.code(400).send({ error: 'path required' })
  try {
    await fs.rm(p, { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.get('/api/fs/download', async (req, reply) => {
  const p = (req.query.path || '').toString()
  if (!p) return reply.code(400).send({ error: 'path required' })
  try {
    const st = await fs.stat(p)
    if (st.isDirectory()) return reply.code(400).send({ error: 'Это папка' })
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(p))}"`)
    return reply.send(fsSync.createReadStream(p))
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/fs/upload', async (req, reply) => {
  let dir = '/'
  const saved = []
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const dest = path.join(dir, path.basename(part.filename))
        await pipeline(part.file, fsSync.createWriteStream(dest))
        saved.push(dest)
      } else if (part.fieldname === 'path') {
        dir = (part.value || '/').toString()
      }
    }
    return { ok: true, saved }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

app.post('/api/fs/chmod', async (req, reply) => {
  const p = (req.body?.path || '').toString()
  const mode = (req.body?.mode || '').toString().replace(/[^0-7]/g, '')
  if (!p || !mode) return reply.code(400).send({ error: 'path/mode required' })
  try {
    await execAsync(`chmod ${mode} ${shellQuote(p)}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/fs/chown', async (req, reply) => {
  const p = (req.body?.path || '').toString()
  const owner = (req.body?.owner || '').toString().replace(/[^a-zA-Z0-9_.-]/g, '')
  const group = (req.body?.group || '').toString().replace(/[^a-zA-Z0-9_.-]/g, '')
  if (!p || !owner) return reply.code(400).send({ error: 'path/owner required' })
  const target = group ? `${owner}:${group}` : owner
  try {
    await execAsync(`chown ${target} ${shellQuote(p)}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

// ---- задачи архивации/распаковки с прогрессом ----
const fsJobs = new Map()

function newFsJob(type, target) {
  const id = Math.random().toString(36).slice(2, 8)
  const job = { id, type, target, status: 'running', progress: 0, error: '' }
  fsJobs.set(id, job)
  return job
}

function runArchiveJob(p, format) {
  const dir = path.dirname(p)
  const base = path.basename(p)
  const archivePath = format === 'tar.gz' ? `${p}.tar.gz` : `${p}.zip`
  const job = newFsJob('archive', archivePath)
  execAsync(`du -sb ${shellQuote(p)}`)
    .then(({ stdout }) => {
      job.total = Number(stdout.trim().split('\t')[0]) || 0
    })
    .catch(() => {
      job.total = 0
    })
  const cmd =
    format === 'tar.gz'
      ? `tar -czf ${shellQuote(archivePath)} -C ${shellQuote(dir)} ${shellQuote(base)}`
      : `cd ${shellQuote(dir)} && zip -r ${shellQuote(`${base}.zip`)} ${shellQuote(base)}`
  const proc = exec(cmd, (err) => {
    if (err) {
      job.status = 'error'
      job.error = err.message
    }
  })
  const poll = setInterval(() => {
    if (job.status !== 'running') {
      clearInterval(poll)
      return
    }
    try {
      const st = fsSync.statSync(archivePath)
      if (job.total > 0) job.progress = Math.min(99, Math.round((st.size / job.total) * 100))
    } catch {
      /* архив ещё не создан */
    }
  }, 400)
  proc.on('close', () => {
    clearInterval(poll)
    if (job.status === 'running') {
      job.status = 'done'
      job.progress = 100
    }
  })
  return job.id
}

async function runExtractJob(p) {
  const dir = path.dirname(p)
  const job = newFsJob('extract', dir)
  let baseline = 0
  try {
    const b = await execAsync(`du -sb ${shellQuote(dir)} 2>/dev/null || echo 0`)
    baseline = Number(b.stdout.trim().split('\t')[0]) || 0
    const t = await execAsync(
      p.endsWith('.zip')
        ? `unzip -l ${shellQuote(p)} | tail -1 | awk '{print $1}'`
        : `tar -tzvf ${shellQuote(p)} | awk '{s += $3} END {print s}'`,
    )
    job.total = Number(t.stdout.trim()) || 0
  } catch {
    job.total = 0
  }
  const cmd =
    p.endsWith('.tar.gz') || p.endsWith('.tgz')
      ? `tar -xzf ${shellQuote(p)} -C ${shellQuote(dir)}`
      : `unzip -o ${shellQuote(p)} -d ${shellQuote(dir)}`
  const proc = exec(cmd, (err) => {
    if (err) {
      job.status = 'error'
      job.error = err.message
    }
  })
  const poll = setInterval(() => {
    if (job.status !== 'running') {
      clearInterval(poll)
      return
    }
    execAsync(`du -sb ${shellQuote(dir)} 2>/dev/null || echo 0`)
      .then(({ stdout }) => {
        const cur = Number(stdout.trim().split('\t')[0]) || 0
        const delta = Math.max(0, cur - baseline)
        if (job.total > 0) job.progress = Math.min(99, Math.round((delta / job.total) * 100))
      })
      .catch(() => {})
  }, 600)
  proc.on('close', () => {
    clearInterval(poll)
    if (job.status === 'running') {
      job.status = 'done'
      job.progress = 100
    }
  })
  return job.id
}

app.post('/api/fs/archive', async (req, reply) => {
  const p = (req.body?.path || '').toString()
  const format = (req.body?.format || 'tar.gz').toString()
  if (!p) return reply.code(400).send({ error: 'path required' })
  if (format !== 'tar.gz' && format !== 'zip') return reply.code(400).send({ error: 'Неподдерживаемый формат' })
  const job = runArchiveJob(p, format)
  return { ok: true, job }
})

app.post('/api/fs/extract', async (req, reply) => {
  const p = (req.body?.path || '').toString()
  if (!p) return reply.code(400).send({ error: 'path required' })
  if (!(p.endsWith('.tar.gz') || p.endsWith('.tgz') || p.endsWith('.zip'))) {
    return reply.code(400).send({ error: 'Неподдерживаемый формат архива' })
  }
  const job = await runExtractJob(p)
  return { ok: true, job }
})

app.get('/api/fs/job/:id', async (req, reply) => {
  const job = fsJobs.get(req.params.id)
  if (!job) return reply.code(404).send({ error: 'job not found' })
  return { status: job.status, progress: job.progress, error: job.error, target: job.target }
})

app.get('/api/fs/du', async (req, reply) => {
  const p = (req.query.path || '').toString()
  if (!p) return reply.code(400).send({ error: 'path required' })
  try {
    const { stdout } = await execAsync(`du -sb ${shellQuote(p)} 2>/dev/null || echo 0`)
    const size = Number(stdout.trim().split('\t')[0]) || 0
    return { size }
  } catch (e) {
    return { size: 0, error: e.message }
  }
})

// ===================== ЖУРНАЛ =====================
function priorityToLevel(p) {
  const n = Number(p)
  if (n <= 3) return 'error'
  if (n === 4) return 'warn'
  if (n <= 6) return 'info'
  return 'debug'
}

app.get('/api/logs', async (req) => {
  if (process.platform !== 'linux') {
    return { logs: [], note: 'journald доступен только на Linux' }
  }
  const unit = (req.query.unit || '').toString()
  const lines = Math.min(Number(req.query.lines || 200) || 200, 1000)
  const cmd = ['journalctl', '--no-pager', '-o', 'json', '-n', String(lines), '-r']
  if (unit) cmd.push('-u', unit)
  try {
    const { stdout } = await execAsync(cmd.join(' '))
    const logs = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          const j = JSON.parse(line)
          return {
            ts: j.__REALTIME_TIMESTAMP ? Number(j.__REALTIME_TIMESTAMP) / 1000 : null,
            unit: j._SYSTEMD_UNIT || '',
            level: priorityToLevel(j.PRIORITY),
            message: j.MESSAGE || '',
          }
        } catch {
          return null
        }
      })
      .filter(Boolean)
    return { logs }
  } catch (e) {
    return { logs: [], error: e.message }
  }
})

// ===================== СЕТЬ =====================
app.get('/api/network/interfaces', async () => {
  const [ifs, stats] = await Promise.all([si.networkInterfaces(), si.networkStats()])
  const statMap = {}
  ;(stats || []).forEach((s) => {
    statMap[s.iface] = s
  })
  const interfaces = (ifs || [])
    .filter((i) => i.iface)
    .map((i) => {
      const s = statMap[i.iface] || {}
      return {
        iface: i.iface,
        ip4: i.ip4,
        ip6: i.ip6,
        mac: i.mac,
        type: i.type,
        up: i.operstate === 'up',
        rx_sec: s.rx_sec || 0,
        tx_sec: s.tx_sec || 0,
      }
    })
  return { interfaces }
})

app.get('/api/network/ports', async () => {
  const ports = []
  if (process.platform === 'linux') {
    try {
      const { stdout } = await execAsync('ss -tulpn')
      for (const line of stdout.trim().split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/)
        const local = parts[4] || ''
        if (!local.includes(':')) continue
        const proc = line.match(/users:\(\("([^"]+)"/)
        const pid = line.match(/pid=(\d+)/)
        ports.push({
          port: local.slice(local.lastIndexOf(':') + 1),
          proto: (parts[0] || '').toLowerCase(),
          address: local.slice(0, local.lastIndexOf(':')),
          process: proc ? proc[1] : '',
          pid: pid ? Number(pid[1]) : null,
        })
      }
    } catch (e) {
      return { ports, error: e.message }
    }
  } else if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync('netstat -ano')
      const pidName = {}
      try {
        const { stdout: tl } = await execAsync('tasklist /FO CSV /NH')
        for (const l of tl.trim().split('\n')) {
          const m = l.match(/^"([^"]+)","([^"]+)"/)
          if (m) pidName[m[2]] = m[1]
        }
      } catch {
        /* ignore */
      }
      for (const line of stdout.split('\n')) {
        const m = line.trim().match(/^(TCP|UDP)\s+(\S+)\s+\S+\s+(\S+)\s+(\d+)$/)
        if (!m) continue
        if (m[1] === 'TCP' && m[3] !== 'LISTENING') continue
        const local = m[2]
        if (!local.includes(':')) continue
        const pid = Number(m[4])
        ports.push({
          port: local.slice(local.lastIndexOf(':') + 1),
          proto: m[1].toLowerCase(),
          address: local.slice(0, local.lastIndexOf(':')),
          process: pidName[String(pid)] || '',
          pid,
        })
      }
    } catch (e) {
      return { ports, error: e.message }
    }
  } else {
    return { ports, note: 'Не поддерживается на этой ОС' }
  }
  return { ports }
})

const FW_PREF_FILE = '/opt/aegis/.fw-pref'

async function getFwInfo() {
  const has = async (c) => {
    try {
      await execAsync(`command -v ${c}`)
      return true
    } catch {
      return false
    }
  }
  const [ufw, iptables, firewalld, nft] = await Promise.all([
    has('ufw'),
    has('iptables'),
    has('firewall-cmd'),
    has('nft'),
  ])
  let pref = 'ufw'
  try {
    const p = await fs.readFile(FW_PREF_FILE, 'utf8')
    if (p.trim()) pref = p.trim()
  } catch {
    /* ignore */
  }
  const firewalls = {
    ufw: { installed: ufw, active: false, rules: [] },
    iptables: { installed: iptables, active: false, rules: [] },
    firewalld: { installed: firewalld, active: false, rules: [] },
    nft: { installed: nft, active: false, rules: [] },
  }
  if (ufw) {
    try {
      const { stdout } = await execAsync('ufw status')
      firewalls.ufw.active = stdout.includes('Status: active')
      if (firewalls.ufw.active) {
        firewalls.ufw.rules = stdout.split('\n').filter((l) => /ALLOW|DENY|REJECT/.test(l)).map((l) => l.trim())
      } else {
        const { stdout: added } = await execAsync('ufw show added')
        firewalls.ufw.rules = added.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Added user rules') && l !== '(None)')
      }
    } catch {
      /* ignore */
    }
    // политика по умолчанию (ACCEPT->allow, DROP->deny, REJECT->reject)
    try {
      const cfg = await fs.readFile('/etc/default/ufw', 'utf8')
      const inM = cfg.match(/^DEFAULT_INPUT_POLICY="(\w+)"/m)
      const outM = cfg.match(/^DEFAULT_OUTPUT_POLICY="(\w+)"/m)
      const norm = (v) => {
        const l = (v || '').toLowerCase()
        return l === 'accept' ? 'allow' : l === 'drop' ? 'deny' : l === 'reject' ? 'reject' : 'deny'
      }
      firewalls.ufw.policy = {
        incoming: inM ? norm(inM[1]) : 'deny',
        outgoing: outM ? norm(outM[1]) : 'allow',
      }
    } catch {
      /* ignore */
    }
    // профили приложений
    try {
      const { stdout: apps } = await execAsync('ufw app list')
      firewalls.ufw.apps = apps
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.toLowerCase().includes('application') && !l.toLowerCase().includes('available'))
    } catch {
      /* ignore */
    }
  }
  if (iptables) {
    try {
      const { stdout } = await execAsync('iptables -S')
      firewalls.iptables.rules = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    } catch {
      /* ignore */
    }
  }
  if (firewalld) {
    try {
      const { stdout } = await execAsync('firewall-cmd --state 2>/dev/null || echo notrunning')
      firewalls.firewalld.active = stdout.trim() === 'running'
      const { stdout: list } = await execAsync('firewall-cmd --list-all 2>/dev/null || echo ""')
      firewalls.firewalld.rules = list.split('\n').map((l) => l.trim()).filter(Boolean)
    } catch {
      /* ignore */
    }
  }
  if (nft) {
    try {
      const { stdout } = await execAsync('nft list ruleset 2>/dev/null || echo ""')
      firewalls.nft.rules = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
      firewalls.nft.active = firewalls.nft.rules.length > 0
    } catch {
      /* ignore */
    }
  }
  // iptables «активен» только если это сырой файрвол с правилами, поверх которого нет ufw/firewalld
  const iptRules = firewalls.iptables.rules || []
  const iptHasRules = iptRules.some((l) => /^-A/.test(l) || /^-P .* (DROP|REJECT)/.test(l))
  firewalls.iptables.active = iptHasRules && !firewalls.ufw.active && !firewalls.firewalld.active
  return { pref, firewalls }
}

app.get('/api/network/firewall', async () => {
  if (process.platform !== 'linux') {
    return { note: 'Управление файрволом доступно только на Linux' }
  }
  return await getFwInfo()
})

app.post('/api/network/firewall/pref', async (req, reply) => {
  const name = (req.body?.name || 'ufw').toString()
  if (!['ufw', 'iptables', 'firewalld', 'nft'].includes(name)) {
    return reply.code(400).send({ error: 'Неизвестный файрвол' })
  }
  try {
    await fs.writeFile(FW_PREF_FILE, name, 'utf8')
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/network/firewall/rule', async (req, reply) => {
  const fw = (req.body?.fw || 'ufw').toString()
  const action = (req.body?.action || 'allow').toString()
  const port = (req.body?.port || '').toString().replace(/[^0-9a-zA-Z,\-:]/g, '')
  const proto = (req.body?.proto || 'tcp').toString()
  const from = (req.body?.from || '').toString().trim()
  const app = (req.body?.app || '').toString().trim().replace(/'/g, '')
  try {
    if (fw === 'ufw') {
      if (!['allow', 'deny', 'reject', 'limit'].includes(action)) return reply.code(400).send({ error: 'Некорректное действие' })
      if (!port && !from && !app) return reply.code(400).send({ error: 'Укажите порт, from или приложение' })
      let cmd
      if (app) {
        cmd = `ufw ${action} '${app}'`
      } else {
        const protoPart = proto === 'tcp' ? '/tcp' : proto === 'udp' ? '/udp' : ''
        cmd = `ufw ${action}`
        if (port) cmd += ` ${port}${protoPart}`
        if (from) cmd += ` from ${from}`
      }
      const { stdout, stderr } = await execAsync(cmd)
      return { ok: true, output: (stdout + stderr).trim().slice(-300) }
    }
    if (fw === 'iptables') {
      if (!port) return reply.code(400).send({ error: 'Порт обязателен' })
      const target = action === 'deny' ? 'DROP' : action === 'reject' ? 'REJECT' : 'ACCEPT'
      const p = proto === 'udp' ? 'udp' : 'tcp'
      const { stdout, stderr } = await execAsync(`iptables -A INPUT -p ${p} --dport ${port} -j ${target}`)
      return { ok: true, output: (stdout + stderr).trim().slice(-300) }
    }
    return reply.code(400).send({ error: 'Управление правилами реализовано для ufw и iptables' })
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/network/firewall/rule/delete', async (req, reply) => {
  const fw = (req.body?.fw || 'ufw').toString()
  let rule = (req.body?.rule || '').toString()
  if (!rule) return reply.code(400).send({ error: 'Правило обязательно' })
  try {
    if (fw === 'ufw') {
      rule = rule.replace(/^ufw\s+/, '').trim()
      let cmd
      if (/^(allow|deny|reject|limit)\s+\S+/.test(rule)) {
        cmd = `ufw --force delete ${rule}`
      } else {
        const m = rule.match(/^(\S+)\s+\((?:v6)\)\s+(ALLOW|DENY|REJECT)/) || rule.match(/^(\S+)\s+(ALLOW|DENY|REJECT)/)
        if (!m) return reply.code(400).send({ error: 'Не удалось разобрать правило' })
        cmd = `ufw --force delete ${m[2].toLowerCase()} ${m[1]}`
      }
      const { stdout, stderr } = await execAsync(cmd)
      return { ok: true, output: (stdout + stderr).trim().slice(-300) }
    }
    if (fw === 'iptables') {
      const del = rule.replace(/^-A\s+/, '-D ')
      const { stdout, stderr } = await execAsync(`iptables ${del}`)
      return { ok: true, output: (stdout + stderr).trim().slice(-300) }
    }
    return reply.code(400).send({ error: 'Управление правилами реализовано для ufw и iptables' })
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/network/firewall/toggle', async (req, reply) => {
  const fw = (req.body?.fw || 'ufw').toString()
  const enable = !!req.body?.enable
  try {
    if (enable) {
      // взаимное исключение: отключаем конкурирующие файрволы
      try {
        const fwState = await execAsync('firewall-cmd --state 2>/dev/null || echo notrunning')
        if (fw !== 'firewalld' && fwState.stdout.trim() === 'running') {
          await execAsync('systemctl disable --now firewalld')
        }
      } catch {
        /* ignore */
      }
      try {
        const ufws = await execAsync('ufw status')
        if (fw !== 'ufw' && ufws.stdout.includes('Status: active')) {
          await execAsync('ufw --force disable')
        }
      } catch {
        /* ignore */
      }
    }
    if (fw === 'ufw') {
      if (enable) {
        // защита от самоблокировки: всегда разрешаем SSH и порт панели
        await execAsync('ufw allow 22/tcp')
        await execAsync(`ufw allow ${PORT}/tcp`)
      }
      await execAsync(`ufw --force ${enable ? 'enable' : 'disable'}`)
      return { ok: true }
    }
    if (fw === 'firewalld') {
      await execAsync(enable ? 'systemctl enable --now firewalld' : 'systemctl disable --now firewalld')
      return { ok: true }
    }
    if (fw === 'iptables') {
      if (!enable) {
        await execAsync('iptables -F; iptables -X; iptables -P INPUT ACCEPT; iptables -P FORWARD ACCEPT; iptables -P OUTPUT ACCEPT')
      }
      return { ok: true }
    }
    return reply.code(400).send({ error: 'Для этого файрвола включение/выключение не применимо' })
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/network/firewall/policy', async (req, reply) => {
  const fw = (req.body?.fw || 'ufw').toString()
  const direction = (req.body?.direction || 'incoming').toString()
  const policy = (req.body?.policy || 'deny').toString()
  if (fw !== 'ufw') return reply.code(400).send({ error: 'Политика реализована для ufw' })
  if (!['incoming', 'outgoing'].includes(direction)) return reply.code(400).send({ error: 'Некорректное направление' })
  if (!['allow', 'deny', 'reject'].includes(policy)) return reply.code(400).send({ error: 'Некорректная политика' })
  try {
    const { stdout, stderr } = await execAsync(`ufw default ${policy} ${direction}`)
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/network/firewall/iptables-save', async (req, reply) => {
  try {
    await execAsync('mkdir -p /etc/iptables')
    await execAsync('iptables-save > /etc/iptables/rules.v4')
    await execAsync('ip6tables-save > /etc/iptables/rules.v6 2>/dev/null || true')
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/network/firewall/install/:name', async (req, reply) => {
  const name = req.params.name
  if (!['ufw', 'firewalld'].includes(name)) return reply.code(400).send({ error: 'Неизвестный файрвол' })
  if (process.platform !== 'linux') return reply.code(400).send({ error: 'Установка доступна только на Linux' })
  try {
    const { stdout, stderr } = await execAsync(`DEBIAN_FRONTEND=noninteractive apt-get install -y ${name}`)
    return { ok: true, stdout: (stdout + stderr).slice(-500) }
  } catch (e) {
    return reply.code(500).send({ ok: false, error: e.message })
  }
})

app.get('/api/network/routes', async () => {
  const routes = []
  if (process.platform === 'linux') {
    try {
      const { stdout } = await execAsync('ip route')
      for (const line of stdout.trim().split('\n')) {
        const parts = line.split(' ')
        let gateway = ''
        let iface = ''
        let metric = ''
        for (let i = 1; i < parts.length; i++) {
          if (parts[i] === 'via') gateway = parts[i + 1] || ''
          if (parts[i] === 'dev') iface = parts[i + 1] || ''
          if (parts[i] === 'metric') metric = parts[i + 1] || ''
        }
        routes.push({ dest: parts[0], gateway, iface, metric })
      }
    } catch (e) {
      return { routes, error: e.message }
    }
  } else if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync('route print -4')
      let inActive = false
      for (const line of stdout.split('\n')) {
        if (line.includes('Active Routes:')) {
          inActive = true
          continue
        }
        if (!inActive || !line.trim() || line.includes('===')) continue
        const cols = line.trim().split(/\s{2,}/)
        if (cols.length >= 5 && cols[0].includes('.')) {
          routes.push({ dest: cols[0], gateway: cols[2], iface: cols[3], metric: cols[4] })
        }
      }
    } catch (e) {
      return { routes, error: e.message }
    }
  }
  return { routes }
})

app.post('/api/network/routes/add', async (req, reply) => {
  const dest = (req.body?.dest || '').toString().trim()
  if (!dest) return reply.code(400).send({ error: 'Назначение обязательно' })
  let cmd = `ip route add ${dest}`
  if (req.body?.gateway) cmd += ` via ${req.body.gateway}`
  if (req.body?.iface) cmd += ` dev ${req.body.iface}`
  if (req.body?.metric) cmd += ` metric ${req.body.metric}`
  try {
    const { stdout, stderr } = await execAsync(cmd)
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/network/routes/delete', async (req, reply) => {
  const dest = (req.body?.dest || '').toString().trim()
  if (!dest) return reply.code(400).send({ error: 'Назначение обязательно' })
  let cmd = `ip route del ${dest}`
  if (req.body?.gateway) cmd += ` via ${req.body.gateway}`
  if (req.body?.iface) cmd += ` dev ${req.body.iface}`
  try {
    await execAsync(cmd)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.get('/api/network/dns', async () => {
  const servers = []
  if (process.platform !== 'linux') {
    return { servers, content: '', note: 'Чтение DNS доступно только на Linux' }
  }
  try {
    const content = await fs.readFile('/etc/resolv.conf', 'utf8')
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*nameserver\s+(\S+)/)
      if (m) servers.push(m[1])
    }
    return { servers, content }
  } catch (e) {
    return { servers, content: '', error: e.message }
  }
})

app.post('/api/network/dns', async (req, reply) => {
  const servers = req.body?.servers
  if (!Array.isArray(servers)) return reply.code(400).send({ error: 'servers required' })
  const valid = servers
    .map((s) => String(s).trim().replace(/[^0-9a-fA-F.:]/g, ''))
    .filter(Boolean)
  try {
    const content = valid.map((s) => `nameserver ${s}`).join('\n') + (valid.length ? '\n' : '')
    await fs.writeFile('/etc/resolv.conf', content, 'utf8')
    return { ok: true, servers: valid }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

// ===================== КОНТЕЙНЕРЫ (Docker) =====================
async function docker(args) {
  return execAsync(`docker ${args}`)
}

function dockerParse(out) {
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

async function dockerInstalled() {
  try {
    await execAsync('command -v docker')
    return true
  } catch {
    return false
  }
}

const dockerJobs = new Map()

function startDockerInstall() {
  const id = Math.random().toString(36).slice(2, 8)
  const job = { id, status: 'running', output: '' }
  dockerJobs.set(id, job)
  const cmd = 'DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2'
  const proc = spawn('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', (d) => {
    job.output = (job.output + d.toString()).slice(-3000)
  })
  proc.stderr.on('data', (d) => {
    job.output = (job.output + d.toString()).slice(-3000)
  })
  proc.on('close', (code) => {
    if (code === 0) {
      job.status = 'done'
      exec('systemctl enable --now docker', () => {})
    } else {
      job.status = 'error'
      job.error = 'Установка завершилась с ошибкой (код ' + code + ')'
    }
  })
  return id
}

app.get('/api/containers', async () => {
  if (!(await dockerInstalled())) {
    return { installed: false, containers: [] }
  }
  try {
    const { stdout } = await docker(`ps -a --format '{{json .}}'`)
    const containers = dockerParse(stdout).map((c) => ({
      id: c.ID,
      name: c.Names,
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: c.Ports || '',
    }))
    return { installed: true, containers }
  } catch (e) {
    return { installed: true, containers: [], note: 'Docker недоступен: ' + e.message }
  }
})

app.post('/api/containers/install', async (req, reply) => {
  if (await dockerInstalled()) {
    return { ok: true, already: true }
  }
  const id = startDockerInstall()
  return { ok: true, job: id }
})

app.get('/api/containers/install/job/:id', async (req, reply) => {
  const job = dockerJobs.get(req.params.id)
  if (!job) return reply.code(404).send({ error: 'job not found' })
  return { status: job.status, output: job.output, error: job.error }
})

app.get('/api/images', async () => {
  try {
    const { stdout } = await docker(`images --format '{{json .}}'`)
    const images = dockerParse(stdout).map((i) => ({
      id: i.ID,
      repo: i.Repository,
      tag: i.Tag,
      size: i.Size,
      created: i.CreatedSince,
    }))
    return { images }
  } catch (e) {
    return { images: [], note: 'Docker недоступен: ' + e.message }
  }
})

app.get('/api/volumes', async () => {
  try {
    const { stdout } = await docker(`volume ls --format '{{json .}}'`)
    const volumes = dockerParse(stdout).map((v) => ({ name: v.Name, driver: v.Driver, mountpoint: v.Mountpoint }))
    return { volumes }
  } catch (e) {
    return { volumes: [], note: 'Docker недоступен: ' + e.message }
  }
})

app.get('/api/networks', async () => {
  try {
    const { stdout } = await docker(`network ls --format '{{json .}}'`)
    const networks = dockerParse(stdout).map((n) => ({ name: n.Name, driver: n.Driver, scope: n.Scope }))
    return { networks }
  } catch (e) {
    return { networks: [], note: 'Docker недоступен: ' + e.message }
  }
})

app.post('/api/containers/:id/:action', async (req, reply) => {
  const allowed = ['start', 'stop', 'restart', 'kill', 'pause', 'unpause', 'remove']
  const { id, action } = req.params
  if (!allowed.includes(action)) return reply.code(400).send({ error: 'Недопустимое действие' })
  try {
    const cmd = action === 'remove' ? `rm --force ${id}` : `${action} ${id}`
    await docker(cmd)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ ok: false, error: e.message })
  }
})

app.get('/api/containers/:id/logs', async (req, reply) => {
  try {
    const { stdout } = await docker(`logs --tail 100 ${req.params.id}`)
    return { logs: stdout }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

// ---- создание / инспекция / статистика контейнеров ----
function dockerRun(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err += d))
    proc.on('close', (code) => (code === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error(err || out || 'docker exited ' + code))))
  })
}

app.post('/api/containers/create', async (req, reply) => {
  const { image, name, ports, env, restart, volumes, network } = req.body || {}
  if (!image) return reply.code(400).send({ error: 'Образ обязателен' })
  try {
    await execAsync(`docker image inspect ${shellQuote(image)}`)
  } catch {
    await execAsync(`docker pull ${image}`)
  }
  const args = ['run', '-d']
  if (name) args.push('--name', String(name))
  if (restart && restart !== 'no') args.push('--restart', restart)
  if (network) args.push('--network', String(network))
  for (const p of ports || []) {
    if (p.host && p.container) args.push('-p', `${p.host}:${p.container}${p.proto && p.proto !== 'tcp' ? '/' + p.proto : ''}`)
  }
  for (const [k, v] of Object.entries(env || {})) {
    if (k) args.push('-e', `${k}=${v}`)
  }
  for (const v of volumes || []) {
    if (v.host && v.container) args.push('-v', `${v.host}:${v.container}`)
  }
  args.push(image)
  try {
    const { stdout, stderr } = await dockerRun(args)
    return { ok: true, id: stdout.trim().slice(0, 12), output: stderr.trim().slice(-300) }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.get('/api/containers/:id/inspect', async (req, reply) => {
  try {
    const { stdout } = await execAsync(`docker inspect ${req.params.id}`)
    const data = JSON.parse(stdout)[0]
    return {
      id: data.Id,
      name: data.Name?.replace(/^\//, ''),
      image: data.Config?.Image,
      created: data.Created,
      state: data.State?.Status,
      restartPolicy: data.HostConfig?.RestartPolicy?.Name,
      ports: data.HostConfig?.PortBindings
        ? Object.entries(data.HostConfig.PortBindings).map(([k, v]) => `${k} → ${v?.[0]?.HostPort || ''}`)
        : [],
      env: data.Config?.Env || [],
      mounts: (data.Mounts || []).map((m) => `${m.Source || m.Name} → ${m.Destination}`),
      network: Object.keys(data.NetworkSettings?.Networks || {})[0] || '',
    }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.get('/api/containers/:id/stats', async (req, reply) => {
  try {
    const { stdout } = await execAsync(`docker stats --no-stream --format '{{json .}}' ${req.params.id}`)
    const s = JSON.parse(stdout.trim().split('\n')[0])
    return { cpu: s.CPUPerc, mem: s.MemUsage, memPerc: s.MemPerc, netIO: s.NetIO, blockIO: s.BlockIO }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

// ---- образы / тома / сети ----
app.post('/api/images/pull', async (req, reply) => {
  const image = (req.body?.image || '').toString().trim()
  if (!image) return reply.code(400).send({ error: 'Образ обязателен' })
  const id = 'img-' + Math.random().toString(36).slice(2, 8)
  const job = { id, status: 'running', output: '' }
  dockerJobs.set(id, job)
  const proc = spawn('docker', ['pull', image], { stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', (d) => {
    job.output = (job.output + d.toString()).slice(-3000)
  })
  proc.stderr.on('data', (d) => {
    job.output = (job.output + d.toString()).slice(-3000)
  })
  proc.on('close', (code) => {
    job.status = code === 0 ? 'done' : 'error'
    if (code !== 0) job.error = 'Ошибка pull: ' + job.output.slice(-200)
  })
  return { ok: true, job: id }
})

app.delete('/api/images/:id', async (req, reply) => {
  try {
    await execAsync(`docker rmi -f ${req.params.id}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/volumes', async (req, reply) => {
  const name = (req.body?.name || '').toString().replace(/[^a-zA-Z0-9_.-]/g, '')
  if (!name) return reply.code(400).send({ error: 'Имя обязательно' })
  try {
    await execAsync(`docker volume create ${name}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.delete('/api/volumes/:name', async (req, reply) => {
  try {
    await execAsync(`docker volume rm ${req.params.name}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/networks', async (req, reply) => {
  const name = (req.body?.name || '').toString().replace(/[^a-zA-Z0-9_.-]/g, '')
  if (!name) return reply.code(400).send({ error: 'Имя обязательно' })
  try {
    await execAsync(`docker network create ${name}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.delete('/api/networks/:name', async (req, reply) => {
  try {
    await execAsync(`docker network rm ${req.params.name}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.get('/api/jobs/:id', async (req, reply) => {
  const job = dockerJobs.get(req.params.id) || fsJobs.get(req.params.id)
  if (!job) return reply.code(404).send({ error: 'job not found' })
  return { status: job.status, output: job.output || '', error: job.error || '' }
})

// ---- стэки (Docker Compose) ----
const STACKS_DIR = '/opt/aegis/stacks'

app.get('/api/stacks', async () => {
  const stacks = []
  try {
    const entries = await fs.readdir(STACKS_DIR)
    for (const name of entries) {
      const dir = path.join(STACKS_DIR, name)
      const st = await fs.stat(dir).catch(() => null)
      if (!st || !st.isDirectory()) continue
      let status = 'unknown'
      let containers = 0
      try {
        const { stdout } = await execAsync(`docker compose -f ${shellQuote(path.join(dir, 'docker-compose.yml'))} ps --format '{{.Name}} {{.State}}'`)
        const lines = stdout.trim().split('\n').filter(Boolean)
        containers = lines.length
        status = lines.some((l) => /running/i.test(l)) ? 'running' : 'stopped'
      } catch {
        status = 'error'
      }
      stacks.push({ name, status, containers })
    }
  } catch {
    /* каталога стэков нет */
  }
  return { stacks }
})

app.post('/api/stacks/deploy', async (req, reply) => {
  const name = (req.body?.name || '').toString().replace(/[^a-zA-Z0-9_.-]/g, '')
  const content = (req.body?.content || '').toString()
  if (!name || !content) return reply.code(400).send({ error: 'Имя и содержимое обязательны' })
  const dir = path.join(STACKS_DIR, name)
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'docker-compose.yml'), content, 'utf8')
    const { stdout, stderr } = await execAsync(`docker compose -f ${shellQuote(path.join(dir, 'docker-compose.yml'))} up -d`)
    return { ok: true, output: (stdout + stderr).slice(-500) }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.get('/api/stacks/:name/file', async (req, reply) => {
  const name = req.params.name
  try {
    const content = await fs.readFile(path.join(STACKS_DIR, name, 'docker-compose.yml'), 'utf8')
    return { content }
  } catch (e) {
    return reply.code(404).send({ error: 'Стэк не найден' })
  }
})

app.post('/api/stacks/:name/action', async (req, reply) => {
  const { name } = req.params
  const action = (req.body?.action || '').toString()
  const dir = path.join(STACKS_DIR, name)
  const file = path.join(dir, 'docker-compose.yml')
  try {
    if (action === 'stop') {
      await execAsync(`docker compose -f ${shellQuote(file)} down`)
      return { ok: true }
    }
    if (action === 'remove') {
      await execAsync(`docker compose -f ${shellQuote(file)} down -v`)
      await fs.rm(dir, { recursive: true, force: true })
      return { ok: true }
    }
    return reply.code(400).send({ error: 'Неизвестное действие' })
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

// ===================== ПОЛЬЗОВАТЕЛИ =====================
app.get('/api/users', async () => {
  if (process.platform !== 'linux') {
    return { users: [], note: 'Список пользователей доступен только на Linux' }
  }
  try {
    const [passwd, group] = await Promise.all([
      fs.readFile('/etc/passwd', 'utf8'),
      fs.readFile('/etc/group', 'utf8'),
    ])
    const groupName = {}
    group.split('\n').forEach((l) => {
      const parts = l.split(':')
      if (parts[2]) groupName[parts[2]] = parts[0]
    })
    const memberships = {}
    group.split('\n').forEach((l) => {
      const parts = l.split(':')
      if (parts[0] && parts[3]) {
        parts[3].split(',').filter(Boolean).forEach((u) => {
          if (!memberships[u]) memberships[u] = new Set()
          memberships[u].add(parts[0])
        })
      }
    })
    const users = passwd
      .split('\n')
      .filter((l) => l.includes(':'))
      .map((l) => {
        const [name, , uid, gid, , home, shell] = l.split(':')
        const uidNum = Number(uid)
        const primary = groupName[gid] || gid
        const groups = Array.from(new Set([primary, ...(memberships[name] || [])]))
        return {
          name,
          uid,
          gid,
          group: primary,
          home,
          shell,
          system: (uidNum < 1000 && uidNum !== 0) || /nologin|false$/.test(shell),
          sudo: groups.includes('sudo'),
          groups,
        }
      })
    return { users }
  } catch (e) {
    return { users: [], error: e.message }
  }
})

function chpasswdUser(name, password) {
  return new Promise((resolve, reject) => {
    const proc = spawn('chpasswd', [], { stdio: ['pipe', 'pipe', 'pipe'] })
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('chpasswd exited ' + code))))
    proc.stdin.write(`${name}:${password}\n`)
    proc.stdin.end()
  })
}

app.post('/api/users', async (req, reply) => {
  const name = (req.body?.name || '').toString().replace(/[^a-zA-Z0-9_.-]/g, '')
  const password = (req.body?.password || '').toString()
  const shell = (req.body?.shell || '/bin/bash').toString().replace(/[^a-zA-Z0-9/_.-]/g, '')
  const sudo = !!req.body?.sudo
  if (!name) return reply.code(400).send({ error: 'Имя обязательно' })
  if (name === 'root') return reply.code(400).send({ error: 'root уже существует' })
  try {
    await execAsync(`useradd -m -s ${shell} ${name}`)
    if (password) await chpasswdUser(name, password)
    if (sudo) await execAsync(`usermod -aG sudo ${name}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.delete('/api/users/:name', async (req, reply) => {
  const name = req.params.name
  if (name === 'root') return reply.code(400).send({ error: 'Нельзя удалить root' })
  try {
    await execAsync(`userdel -r ${name}`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/users/:name/password', async (req, reply) => {
  const name = req.params.name
  const password = (req.body?.password || '').toString()
  if (!password) return reply.code(400).send({ error: 'Пароль обязателен' })
  try {
    await chpasswdUser(name, password)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

app.post('/api/users/:name/sudo', async (req, reply) => {
  const name = req.params.name
  const enable = !!req.body?.enable
  try {
    if (enable) await execAsync(`usermod -aG sudo ${name}`)
    else await execAsync(`gpasswd -d ${name} sudo`)
    return { ok: true }
  } catch (e) {
    return reply.code(500).send({ error: e.message })
  }
})

// ===================== ОБНОВЛЕНИЯ =====================
app.get('/api/updates', async () => {
  if (process.platform !== 'linux') {
    return { updates: [], system: null, note: 'Обновления (apt) доступны только на Linux' }
  }
  try {
    let os = 'Linux'
    let kernel = ''
    let uptime = 0
    let totalPackages = 0
    try {
      const release = await fs.readFile('/etc/os-release', 'utf8')
      const osM = release.match(/PRETTY_NAME="([^"]+)"/)
      if (osM) os = osM[1]
      kernel = (await execAsync('uname -r')).stdout.trim()
      uptime = (await si.time()).uptime || 0
      totalPackages = Number((await execAsync(`dpkg -l | grep -c '^ii'`)).stdout.trim()) || 0
    } catch {
      /* ignore */
    }
    const { stdout } = await execAsync('apt list --upgradable 2>/dev/null')
    const updates = stdout
      .split('\n')
      .filter((l) => l.includes('[upgradable from:'))
      .map((l) => {
        const name = l.split('/')[0].trim()
        const parts = l.split(' ')
        const from = l.match(/\[upgradable from: ([^\]]+)\]/)
        return { name, available: parts[1] || '', current: from ? from[1] : '' }
      })
    let lastUpdate = null
    try {
      const hist = await fs.readFile('/var/log/apt/history.log', 'utf8')
      const starts = hist.match(/Start-Date:\s*([0-9-]+\s+[0-9:]+)/g)
      if (starts && starts.length) lastUpdate = starts[starts.length - 1].replace('Start-Date:', '').trim()
    } catch {
      /* ignore */
    }
    return { updates, system: { os, kernel, uptime, totalPackages }, lastUpdate }
  } catch (e) {
    return { updates: [], system: null, error: e.message }
  }
})

app.post('/api/updates/apply', async (req, reply) => {
  if (process.platform !== 'linux') return reply.code(400).send({ error: 'Обновления доступны только на Linux' })
  const id = 'apt-' + Math.random().toString(36).slice(2, 8)
  const job = { id, status: 'running', output: '' }
  dockerJobs.set(id, job)
  const proc = spawn('bash', ['-c', 'DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --with-new-pkgs -o APT::Get::Always-Include-Phased-Updates=true'], { stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', (d) => {
    job.output = (job.output + d.toString()).slice(-3000)
  })
  proc.stderr.on('data', (d) => {
    job.output = (job.output + d.toString()).slice(-3000)
  })
  proc.on('close', (code) => {
    job.status = code === 0 ? 'done' : 'error'
    if (code !== 0) job.error = 'Ошибка обновления'
  })
  return { ok: true, job: id }
})

app.post('/api/updates/refresh', async (req, reply) => {
  if (process.platform !== 'linux') return reply.code(400).send({ error: 'Обновления доступны только на Linux' })
  const id = 'aptupd-' + Math.random().toString(36).slice(2, 8)
  const job = { id, status: 'running', output: '' }
  dockerJobs.set(id, job)
  const proc = spawn('bash', ['-c', 'DEBIAN_FRONTEND=noninteractive apt-get update'], { stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', (d) => {
    job.output = (job.output + d.toString()).slice(-3000)
  })
  proc.stderr.on('data', (d) => {
    job.output = (job.output + d.toString()).slice(-3000)
  })
  proc.on('close', (code) => {
    job.status = code === 0 ? 'done' : 'error'
    if (code !== 0) job.error = 'Ошибка обновления списков'
  })
  return { ok: true, job: id }
})

// ===================== УВЕДОМЛЕНИЯ =====================
app.get('/api/notifications', async () => {
  if (process.platform !== 'linux') return { items: [] }
  const items = []
  try {
    const { stdout } = await execAsync('systemctl --failed --no-legend --no-pager 2>/dev/null')
    const failed = stdout.trim().split('\n').filter(Boolean).map((l) => l.split(/\s+/)[0])
    failed.slice(0, 10).forEach((name) => items.push({ type: 'service', level: 'error', name, link: '/services' }))
  } catch {
    /* ignore */
  }
  try {
    const { stdout } = await execAsync('apt list --upgradable 2>/dev/null | grep -c upgradable')
    const count = Number(stdout.trim()) || 0
    if (count > 0) items.push({ type: 'updates', level: 'warn', count, link: '/updates' })
  } catch {
    /* ignore */
  }
  try {
    const disk = await si.fsSize()
    const root = disk.find((d) => d.mount === '/') || disk[0]
    if (root && root.use > 90) items.push({ type: 'disk', level: 'warn', use: Math.round(root.use), link: '/' })
  } catch {
    /* ignore */
  }
  try {
    const { stdout } = await execAsync(`docker ps -a --filter "status=exited" --format '{{.Names}}' 2>/dev/null`)
    const stopped = stdout.trim().split('\n').filter(Boolean)
    stopped.slice(0, 5).forEach((name) => items.push({ type: 'container', level: 'info', name, link: '/containers' }))
  } catch {
    /* ignore */
  }
  return { items }
})

// ===================== ОБНОВЛЕНИЕ ПАНЕЛИ (GitHub) =====================
let panelUpdateStatus = null

function isNewerVersion(latest, current) {
  const a = (latest || '').replace(/^v/, '').split('.').map(Number)
  const b = (current || '').replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

async function checkPanelUpdate() {
  if (!GITHUB_REPO || !GITHUB_REPO.includes('/')) {
    panelUpdateStatus = {
      current: PANEL_VERSION,
      latest: null,
      available: false,
      checkedAt: Date.now(),
      error: 'GitHub-репозиторий не настроен',
    }
    return panelUpdateStatus
  }
  const [owner, repo] = GITHUB_REPO.split('/')
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'aegis-panel', Accept: 'application/vnd.github+json' },
    })
    if (!r.ok) throw new Error('GitHub API: HTTP ' + r.status)
    const data = await r.json()
    const latest = (data.tag_name || '').replace(/^v/, '')
    panelUpdateStatus = {
      current: PANEL_VERSION,
      latest,
      available: latest ? isNewerVersion(latest, PANEL_VERSION) : false,
      notes: data.body || '',
      checkedAt: Date.now(),
    }
  } catch (e) {
    panelUpdateStatus = {
      current: PANEL_VERSION,
      latest: null,
      available: false,
      checkedAt: Date.now(),
      error: e.message,
    }
  }
  return panelUpdateStatus
}

// периодическая проверка обновлений раз в 6 часов
checkPanelUpdate()
setInterval(checkPanelUpdate, 6 * 60 * 60 * 1000).unref()

app.get('/api/panel/info', async () => {
  if (!panelUpdateStatus) await checkPanelUpdate()
  return { version: PANEL_VERSION, repo: GITHUB_REPO, update: panelUpdateStatus }
})

app.post('/api/panel/update/check', async () => {
  return await checkPanelUpdate()
})

app.post('/api/panel/update', async (req, reply) => {
  if (!GITHUB_REPO || !GITHUB_REPO.includes('/')) {
    return reply.code(400).send({ error: 'GitHub-репозиторий не настроен' })
  }
  const status = panelUpdateStatus || (await checkPanelUpdate())
  if (!status.latest || !status.available) {
    return reply.code(400).send({ error: 'Нет доступных обновлений' })
  }
  const [owner, repo] = GITHUB_REPO.split('/')
  const tag = 'v' + status.latest.replace(/^v/, '')
  const id = 'update-' + Math.random().toString(36).slice(2, 8)
  const job = { id, status: 'running', output: '' }
  dockerJobs.set(id, job)
  const log = (s) => {
    job.output = (job.output + s + '\n').slice(-4000)
  }
  const run = async () => {
    try {
      log(`Загрузка ${GITHUB_REPO} @ ${tag}...`)
      await execAsync(`curl -fsSL https://github.com/${owner}/${repo}/archive/refs/tags/${tag}.tar.gz -o /opt/aegis/.update.tar.gz`)
      log('Распаковка архива...')
      await execAsync('rm -rf /opt/aegis/.update-tmp && mkdir -p /opt/aegis/.update-tmp && tar -xzf /opt/aegis/.update.tar.gz -C /opt/aegis/.update-tmp --strip-components=1')
      log('Копирование агента...')
      await execAsync('cp -r /opt/aegis/.update-tmp/agent/. /opt/aegis/agent/')
      log('Установка зависимостей и сборка фронтенда...')
      await execAsync('cd /opt/aegis/.update-tmp/web && pnpm install --no-frozen-lockfile && pnpm build')
      log('Обновление dist...')
      await execAsync('rm -rf /opt/aegis/web/dist/* && cp -r /opt/aegis/.update-tmp/web/dist/. /opt/aegis/web/dist/')
      await execAsync(`printf '%s' '${status.latest}' > /opt/aegis/.aegis-version`)
      log('Готово. Перезапуск панели...')
      job.status = 'done'
      setTimeout(() => {
        exec('systemctl restart aegis-agent', () => {})
      }, 1500)
    } catch (e) {
      job.status = 'error'
      job.error = e.message
      log('Ошибка: ' + e.message)
    }
  }
  run()
  return { ok: true, job: id }
})

// ===================== ТЕРМИНАЛ (PTY) =====================
let pty = null
try {
  pty = (await import('node-pty')).default
} catch {
  app.log.warn('node-pty не установлен — терминал работает без полноценного TTY (fallback)')
}

const termSessions = new Map()
function newTermId() {
  return 't' + Math.random().toString(36).slice(2, 8)
}

const auditLog = []
function cleanCommand(raw) {
  let s = String(raw).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  s = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  return s.trim()
}
function pushAudit(sessionId, user, rawLine) {
  const cmd = cleanCommand(rawLine)
  if (!cmd) return
  auditLog.push({ ts: Date.now(), user, session: sessionId, command: cmd })
  if (auditLog.length > 1000) auditLog.shift()
}

app.get('/api/audit', async () => {
  return { commands: auditLog.slice(-200).reverse() }
})

// ===================== WEBSOCKET =====================
const io = new Server(app.server, { cors: { origin: '*' } })

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token
  if (!token) return next(new Error('unauthorized'))
  try {
    jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    next(new Error('unauthorized'))
  }
})

io.on('connection', (socket) => {
  // ---- терминал (tmux-сессии переживают перезагрузку) ----
  socket.on('term:create', ({ cols = 80, rows = 24, cwd, user, reconnect, container } = {}, ack) => {
    try {
      const shell = process.env.SHELL || '/bin/bash'
      const cwdPath = typeof cwd === 'string' && cwd ? cwd : process.env.HOME || '/'
      const safeUser =
        typeof user === 'string' && user && user !== 'root' ? user.replace(/[^a-zA-Z0-9_.-]/g, '') : null

      let id = newTermId()
      let reconnected = false
      if (typeof reconnect === 'string' && reconnect) {
        try {
          execSync(`tmux has-session -t aegis-${reconnect}`, { stdio: 'ignore' })
          id = reconnect
          reconnected = true
        } catch {
          /* сессии больше нет — создаём новую */
        }
      }
      const tmuxName = `aegis-${id}`

      const s = {
        socketId: socket.id,
        id,
        tmuxName,
        user: safeUser || 'root',
        inputBuffer: '',
        write: () => {},
        kill: () => {},
        detach: () => {},
        resize: () => {},
      }
      let spawned = false

      if (pty) {
        try {
          if (!reconnected) {
            if (container) {
              const cid = container.replace(/[^a-zA-Z0-9_.:-]/g, '')
              execSync(`tmux new-session -d -s ${tmuxName} -x ${cols} -y ${rows} "docker exec -it ${cid} /bin/sh"`)
            } else if (safeUser) {
              execSync(`tmux new-session -d -s ${tmuxName} -x ${cols} -y ${rows} -c ${shellQuote(cwdPath)} "exec su -s /bin/bash ${safeUser}"`)
            } else {
              execSync(`tmux new-session -d -s ${tmuxName} -x ${cols} -y ${rows} -c ${shellQuote(cwdPath)}`)
            }
            try {
              execSync(`tmux set-option -t ${tmuxName} status off`)
            } catch {
              /* ignore */
            }
          }
          if (reconnected) {
            try {
              const hist = execSync(`tmux capture-pane -t ${tmuxName} -p -S -5000 -E -1`, { encoding: 'utf8' })
              if (hist) socket.emit('term:output', { id, data: hist.replace(/\n/g, '\r\n') })
            } catch {
              /* ignore */
            }
          }
          const term = pty.spawn('tmux', ['attach', '-d', '-t', tmuxName], {
            name: 'xterm-256color',
            cols,
            rows,
            env: process.env,
          })
          s.write = (d) => term.write(d)
          s.kill = () => {
            exec(`tmux kill-session -t ${tmuxName}`, () => {})
            term.kill()
          }
          s.detach = () => term.kill()
          s.resize = (c, r) => {
            term.resize(c, r)
            exec(`tmux resize-window -t ${tmuxName} -x ${c} -y ${r}`, () => {})
          }
          term.onData((d) => socket.emit('term:output', { id, data: d }))
          term.onExit(() => {
            socket.emit('term:exit', { id })
            termSessions.delete(id)
          })
          spawned = true
        } catch (e) {
          app.log.warn('tmux spawn не удался, fallback: ' + e.message)
        }
      }
      if (!spawned && pty) {
        try {
          const args = container
            ? ['-c', `docker exec -it ${container.replace(/[^a-zA-Z0-9_.:-]/g, '')} /bin/sh`]
            : safeUser
              ? ['-c', `cd ${shellQuote(cwdPath)} && exec su -s /bin/bash ${safeUser}`]
              : []
          const term = pty.spawn(shell, args, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: safeUser ? process.env.HOME || '/' : cwdPath,
            env: process.env,
          })
          s.write = (d) => term.write(d)
          s.kill = () => term.kill()
          s.resize = (c, r) => term.resize(c, r)
          term.onData((d) => socket.emit('term:output', { id, data: d }))
          term.onExit(() => {
            socket.emit('term:exit', { id })
            termSessions.delete(id)
          })
          spawned = true
        } catch (e) {
          app.log.warn('node-pty fallback не удался: ' + e.message)
        }
      }
      if (!spawned) {
        const proc = spawn(shell, [], { cwd: cwdPath, stdio: ['pipe', 'pipe', 'pipe'] })
        s.write = (d) => proc.stdin.write(d.replace(/\r\n?/g, '\n'))
        s.kill = () => proc.kill()
        proc.stdout.on('data', (d) => socket.emit('term:output', { id, data: d.toString('utf8') }))
        proc.stderr.on('data', (d) => socket.emit('term:output', { id, data: d.toString('utf8') }))
        proc.on('exit', () => {
          socket.emit('term:exit', { id })
          termSessions.delete(id)
        })
      }

      termSessions.set(id, s)
      if (ack) ack({ id, reconnected })
    } catch (e) {
      if (ack) ack({ error: e.message })
    }
  })

  socket.on('term:input', ({ id, data }) => {
    const s = termSessions.get(id)
    if (s && data) {
      s.write(data)
      // аудит команд
      s.inputBuffer += data
      while (true) {
        const r = s.inputBuffer.indexOf('\r')
        const n = s.inputBuffer.indexOf('\n')
        const cut = r === -1 ? n : n === -1 ? r : Math.min(r, n)
        if (cut === -1) break
        const line = s.inputBuffer.slice(0, cut)
        s.inputBuffer = s.inputBuffer.slice(cut + 1)
        pushAudit(id, s.user, line)
      }
      if (s.inputBuffer.length > 10000) s.inputBuffer = s.inputBuffer.slice(-1000)
    }
  })

  socket.on('term:resize', ({ id, cols, rows }) => {
    const s = termSessions.get(id)
    if (s) s.resize(cols, rows)
  })

  socket.on('term:kill', ({ id }) => {
    const s = termSessions.get(id)
    if (s) {
      try {
        s.kill()
      } catch {
        /* ignore */
      }
      termSessions.delete(id)
    }
  })

  socket.on('term:detach', ({ id }) => {
    const s = termSessions.get(id)
    if (s) {
      try {
        s.detach()
      } catch {
        /* ignore */
      }
      termSessions.delete(id)
    }
  })

  socket.on('disconnect', () => {
    const mine = []
    for (const [id, s] of termSessions) if (s.socketId === socket.id) mine.push(id)
    for (const id of mine) {
      const s = termSessions.get(id)
      if (s) {
        // tmux-сессия живёт дальше — просто отсоединяемся
        try {
          s.detach()
        } catch {
          /* ignore */
        }
        termSessions.delete(id)
      }
    }
  })

  // метрики шлём асинхронно, не блокируя регистрацию обработчиков
  getMetrics()
    .then((m) => socket.emit('metrics', m))
    .catch((e) => app.log.error(e))
})

setInterval(async () => {
  try {
    const m = await getMetrics()
    pushHistory(m)
    io.emit('metrics', m)
  } catch (e) {
    app.log.error(e)
  }
}, METRICS_INTERVAL)

// ===================== СТАРТ =====================
try {
  await app.listen({ port: PORT, host: HOST })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
