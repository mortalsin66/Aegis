import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-smoke-'))
process.env.AEGIS_STATE_DIR = dir
process.env.AEGIS_TEST = '1'
process.env.AEGIS_PASSWORD = 'smoke-test-strong-password'
try {
  const { app } = await import('../src/app.js')
  assert.equal((await app.inject('/api/health')).statusCode, 200)
  assert.equal((await app.inject('/api/settings')).statusCode, 401)
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: process.env.AEGIS_PASSWORD } })
  assert.equal(login.statusCode, 200)
  const headers = { authorization: 'Bearer ' + login.json().token }
  assert.equal((await app.inject({ url: '/api/settings', headers })).statusCode, 200)
  await app.close()
  console.log('Agent smoke checks passed')
} finally { await fs.rm(dir, { recursive: true, force: true }) }
