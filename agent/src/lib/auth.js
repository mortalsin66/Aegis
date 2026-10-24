import crypto from 'node:crypto'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import otplib from 'otplib'

const scrypt = promisify(crypto.scrypt)
const { authenticator } = otplib
async function read(file) { try { return (await fs.readFile(file, 'utf8')).trim() } catch (e) { if (e.code === 'ENOENT') return ''; throw e } }
async function save(file, value) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  try { await fs.writeFile(tmp, value, { mode: 0o600 }); await fs.rename(tmp, file); await fs.chmod(file, 0o600) }
  finally { await fs.rm(tmp, { force: true }).catch(() => {}) }
}
export async function registerAuth(app, dir, { onRevoke = () => {} } = {}) {
  const user = process.env.AEGIS_USER || 'admin'
  const pwFile = path.join(dir, '.aegis-password')
  const totpFile = path.join(dir, '.aegis-totp')
  const epochFile = path.join(dir, '.aegis-session-epoch')
  let stored = await read(pwFile)
  if (!stored) {
    const salt = crypto.randomBytes(16).toString('hex')
    stored = salt + ':' + (await scrypt(process.env.AEGIS_PASSWORD || 'admin', salt, 64)).toString('hex')
    await save(pwFile, stored)
  }
  let [salt, hash] = stored.split(':')
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) throw new Error('Invalid password file')
  await fs.chmod(pwFile, 0o600)
  const disabledFile = path.join(dir, '.aegis-totp-disabled')
  let secret = (await read(disabledFile)) ? null : (await read(totpFile)) || process.env.AEGIS_TOTP_SECRET || null
  if (await read(totpFile)) await fs.chmod(totpFile, 0o600)
  let pending = null
  let epoch = (await read(epochFile)) || crypto.randomUUID()
  await save(epochFile, epoch)
  const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')
  const revokedFile = path.join(dir, '.aegis-revoked.json')
  const revoked = new Map(JSON.parse((await read(revokedFile)) || '[]'))
  for (const [id, expiry] of revoked) if (expiry <= Date.now() / 1000) revoked.delete(id)
  let revocationWrite = Promise.resolve()
  function persistRevocations() {
    revocationWrite = revocationWrite.catch(() => {}).then(() => save(revokedFile, JSON.stringify([...revoked])))
    return revocationWrite
  }
  async function check(input) {
    if (typeof input !== 'string' || input.length > 1024) return false
    const derived = await scrypt(input, salt, 64)
    return crypto.timingSafeEqual(derived, Buffer.from(hash, 'hex'))
  }
  let mustChange = await check('admin')
  const viewerUser = process.env.AEGIS_VIEWER_USER
  const viewerPassword = process.env.AEGIS_VIEWER_PASSWORD
  const viewerSalt = crypto.randomBytes(16)
  const viewerHash = viewerPassword ? await scrypt(viewerPassword, viewerSalt, 64) : null
  const attempts = new Map()
  let activeLogins = 0
  function issue(role, setup = false) { return jwt.sign({ user: role === 'viewer' ? viewerUser : user, role, setup, epoch }, jwtSecret, { expiresIn: setup ? '10m' : '12h', algorithm: 'HS256', jwtid: crypto.randomUUID() }) }
  function verify(token, { allowSetup = false } = {}) {
    const claims = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] })
    if (claims.epoch !== epoch || !claims.jti || revoked.has(claims.jti) || !['admin', 'viewer'].includes(claims.role) || (claims.setup && !allowSetup)) throw new Error('Session revoked or restricted')
    return claims
  }
  async function revoke() { const next = crypto.randomUUID(); await save(epochFile, next); epoch = next; revoked.clear(); await persistRevocations(); onRevoke() }
  app.decorateRequest('auth', null)
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]
    if (!url.startsWith('/api/')) return
    if (['/api/auth/login', '/api/auth/2fa/status', '/api/health'].includes(url)) return
    try {
      req.auth = verify((req.headers.authorization || '').replace(/^Bearer /, ''), { allowSetup: url === '/api/auth/password' })
      if (req.auth.role === 'viewer' && url !== '/api/auth/logout' && (!['GET', 'HEAD'].includes(req.method) || /^\/api\/(fs|audit|stacks|containers\/[^/]+\/inspect|settings)/.test(url))) return reply.code(403).send({ error: 'Read-only account: operation unavailable' })
    } catch { return reply.code(401).send({ error: 'Требуется авторизация' }) }
  })
  app.post('/api/auth/login', { schema: { body: { type: 'object', required: ['username', 'password'], additionalProperties: false, properties: { username: { type: 'string', maxLength: 128 }, password: { type: 'string', maxLength: 1024 }, totp: { type: 'string', maxLength: 16 } } } } }, async (req, reply) => {
    const now = Date.now()
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key)
    if (!attempts.has(req.ip) && attempts.size >= 10_000) return reply.code(429).send({ error: 'Попробуйте позже' })
    const entry = attempts.get(req.ip) || { count: 0, until: now + 15 * 60_000 }
    if (entry.count >= 10 || activeLogins >= 4) return reply.header('Retry-After', '900').code(429).send({ error: 'Слишком много попыток входа' })
    entry.count++; attempts.set(req.ip, entry); activeLogins++
    try {
      const { username, password, totp } = req.body
      if (viewerHash && username === viewerUser && crypto.timingSafeEqual(await scrypt(password, viewerSalt, 64), viewerHash)) {
        attempts.delete(req.ip); return { token: issue('viewer'), role: 'viewer', mustChangePassword: false }
      }
      if (username !== user || !(await check(password))) return reply.code(401).send({ error: 'Неверные учётные данные' })
      if (secret && (!totp || !authenticator.check(totp, secret))) return reply.code(401).send({ error: 'Неверный код 2FA', totpRequired: true })
      attempts.delete(req.ip)
      return { token: issue('admin', mustChange), role: 'admin', mustChangePassword: mustChange }
    } finally { activeLogins-- }
  })
  app.get('/api/auth/2fa/status', async () => ({ enabled: !!secret }))
  app.get('/api/auth/me', async req => ({ user: req.auth.user, role: req.auth.role }))
  app.post('/api/auth/password', async (req, reply) => {
    const { current, next } = req.body || {}
    if (!(await check(current))) return reply.code(401).send({ error: 'Неверный текущий пароль' })
    if (typeof next !== 'string' || next.length < 12 || next.length > 1024 || next === current) return reply.code(400).send({ error: 'Новый пароль: от 12 до 1024 символов, должен отличаться от текущего' })
    const nextSalt = crypto.randomBytes(16).toString('hex')
    const nextHash = (await scrypt(next, nextSalt, 64)).toString('hex')
    await save(pwFile, nextSalt + ':' + nextHash)
    salt = nextSalt; hash = nextHash; mustChange = false
    await revoke()
    return { ok: true, token: issue('admin') }
  })
  app.post('/api/auth/logout', async req => {
    for (const [id, expiry] of revoked) if (expiry <= Date.now() / 1000) revoked.delete(id)
    if (revoked.size >= 10_000) { await revoke(); revoked.clear() }
    else { revoked.set(req.auth.jti, req.auth.exp); await persistRevocations(); onRevoke(req.auth.jti) }
    return { ok: true }
  })
  app.post('/api/auth/2fa/setup', async (req, reply) => {
    if (secret) return reply.code(409).send({ error: '2FA уже включена' })
    pending = { value: authenticator.generateSecret(), until: Date.now() + 10 * 60_000 }
    return { secret: pending.value, otpauthUrl: authenticator.keyuri(user, 'Aegis', pending.value) }
  })
  app.post('/api/auth/2fa/confirm', async (req, reply) => {
    if (!pending || pending.until < Date.now() || !authenticator.check(String(req.body?.totp || ''), pending.value)) return reply.code(400).send({ error: 'Неверный или просроченный код' })
    await save(totpFile, pending.value); await fs.rm(disabledFile, { force: true }); secret = pending.value; pending = null; await revoke()
    return { ok: true, token: issue('admin') }
  })
  app.post('/api/auth/2fa/disable', async (req, reply) => {
    if (secret && !authenticator.check(String(req.body?.totp || ''), secret)) return reply.code(400).send({ error: 'Неверный код' })
    await save(disabledFile, 'disabled'); await fs.rm(totpFile, { force: true }); secret = null; pending = null; await revoke()
    return { ok: true, token: issue('admin') }
  })
  return { verify, settings: () => ({ port: Number(process.env.PORT || 9000), user, twoFactor: !!secret, twoFactorPending: !!pending }) }
}
