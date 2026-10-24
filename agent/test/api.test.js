import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('API rejects command injection and unsafe stack names; audit omits secrets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-api-'))
  process.env.AEGIS_STATE_DIR = dir; process.env.AEGIS_TEST = '1'; process.env.AEGIS_PASSWORD = 'integration-password-123'
  const { app } = await import('../src/app.js')
  try {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: process.env.AEGIS_PASSWORD } })
    assert.equal(login.statusCode, 200)
    const headers = { authorization: 'Bearer ' + login.json().token }
    for (const url of ['/api/services/demo%3Bid/restart', '/api/users/root%20--help/sudo']) {
      const r = await app.inject({ method: 'POST', url, headers, payload: {} }); assert.equal(r.statusCode, 400)
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/stacks/deploy', headers, payload: { name: '..', content: 'secret-compose-content' } })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: '/api/users/someuser/password', headers, payload: { password: 'bad\nroot:injected' } })).statusCode, 400)
    assert.equal((await app.inject({ url: '/api/logs?unit=demo%3Bid', headers })).statusCode, 400)
    assert.equal((await app.inject({ url: '/api/fs/du?path=relative', headers })).statusCode, 400)
    assert.equal((await app.inject({ url: '/api/fs/du?path=' + encodeURIComponent(path.join(dir, 'missing')), headers })).statusCode, 404)
    const audit = (await app.inject({ url: '/api/audit', headers })).json()
    assert.ok(audit.commands.length >= 4); assert.ok(!JSON.stringify(audit).includes('secret-compose-content')); assert.ok(!JSON.stringify(audit).includes('root:injected'))
  } finally { await app.close(); await fs.rm(dir, { recursive: true, force: true }) }
})
