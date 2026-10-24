import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import otplib from 'otplib'
import { registerAuth } from '../src/lib/auth.js'

test('setup token is restricted, password rotation revokes sessions and survives restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-auth-'))
  process.env.AEGIS_PASSWORD = 'admin'
  const app = Fastify()
  const auth = await registerAuth(app, dir)
  app.get('/api/settings', async () => auth.settings())
  try {
    assert.equal((await app.inject('/api/settings')).statusCode, 401)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin' } })
    assert.equal(login.statusCode, 200)
    assert.equal(login.json().mustChangePassword, true)
    const headers = { authorization: 'Bearer ' + login.json().token }
    assert.equal((await app.inject({ url: '/api/settings', headers })).statusCode, 401)
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers })).statusCode, 401)
    const change = await app.inject({ method: 'POST', url: '/api/auth/password', headers, payload: { current: 'admin', next: 'new-strong-password-123' } })
    assert.equal(change.statusCode, 200)
    assert.throws(() => auth.verify(login.json().token, { allowSetup: true }))
    const updated = { authorization: 'Bearer ' + change.json().token }
    assert.equal((await app.inject({ url: '/api/settings', headers: updated })).statusCode, 200)
    const setup = (await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: updated })).json()
    const confirm = await app.inject({ method: 'POST', url: '/api/auth/2fa/confirm', headers: updated, payload: { totp: otplib.authenticator.generate(setup.secret) } })
    assert.equal(confirm.statusCode, 200)
    assert.throws(() => auth.verify(change.json().token))
    assert.equal(auth.settings().twoFactor, true)
    await app.close()
    const restarted = Fastify(); const again = await registerAuth(restarted, dir)
    assert.equal(again.settings().twoFactor, true)
    const denied = await restarted.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'new-strong-password-123' } })
    assert.equal(denied.statusCode, 401)
    const allowed = await restarted.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'new-strong-password-123', totp: otplib.authenticator.generate(setup.secret) } })
    assert.equal(allowed.statusCode, 200)
    await restarted.close()
  } finally { await app.close(); await fs.rm(dir, { recursive: true, force: true }); delete process.env.AEGIS_PASSWORD }
})

test('login validation and rate limiting', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-limit-')), app = Fastify()
  await registerAuth(app, dir)
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: {}, password: [] } })).statusCode, 400)
    for (let i = 0; i < 10; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'wrong', password: 'wrong' } })).statusCode, 401)
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin' } })).statusCode, 429)
  } finally { await app.close(); await fs.rm(dir, { recursive: true, force: true }) }
})

test('viewer may read metrics but cannot mutate or read privileged files', async () => {
  process.env.AEGIS_VIEWER_USER = 'observer'; process.env.AEGIS_VIEWER_PASSWORD = 'observer-password-123'
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-viewer-')), app = Fastify()
  await registerAuth(app, dir)
  app.get('/api/metrics', async () => ({ cpu: 1 }))
  app.post('/api/services/demo/restart', async () => ({ ok: true }))
  app.get('/api/fs/read', async () => ({ secret: 'must not leak' }))
  try {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'observer', password: 'observer-password-123' } })
    assert.equal(login.statusCode, 200)
    const headers = { authorization: 'Bearer ' + login.json().token }
    assert.equal((await app.inject({ url: '/api/metrics', headers })).statusCode, 200)
    assert.equal((await app.inject({ method: 'POST', url: '/api/services/demo/restart', headers })).statusCode, 403)
    assert.equal((await app.inject({ url: '/api/fs/read', headers })).statusCode, 403)
  } finally { delete process.env.AEGIS_VIEWER_USER; delete process.env.AEGIS_VIEWER_PASSWORD; await app.close(); await fs.rm(dir, { recursive: true, force: true }) }
})

test('logout revokes its own token, survives restart, and preserves another session', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-logout-'))
  process.env.JWT_SECRET = 'stable-test-signing-key-for-restart'
  process.env.AEGIS_PASSWORD = 'strong-test-password-123'
  const app = Fastify(); const auth = await registerAuth(app, dir)
  try {
    const login = async () => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: process.env.AEGIS_PASSWORD } })).json().token
    const first = await login(), second = await login()
    assert.notEqual(first, second)
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: 'Bearer ' + first } })).statusCode, 200)
    assert.throws(() => auth.verify(first)); assert.equal(auth.verify(second).role, 'admin')
    await app.close()
    const other = Fastify(); const restored = await registerAuth(other, dir)
    assert.throws(() => restored.verify(first)); assert.equal(restored.verify(second).role, 'admin')
    await other.close()
  } finally { delete process.env.JWT_SECRET; delete process.env.AEGIS_PASSWORD; await app.close(); await fs.rm(dir, { recursive: true, force: true }) }
})
