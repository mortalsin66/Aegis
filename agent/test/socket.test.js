import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { io as connect } from 'socket.io-client'
test('terminal packets require authentication, valid dimensions, and owning socket', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-socket-'))
  process.env.AEGIS_STATE_DIR = dir; process.env.AEGIS_TEST = '1'; process.env.AEGIS_PASSWORD = 'socket-password-123'
  const { app, termSessions } = await import('../src/app.js')
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  const login = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: process.env.AEGIS_PASSWORD } })).json()
  const clients = []
  async function client(token) {
    const socket = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false, autoConnect: false })
    clients.push(socket)
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect() })
    return socket
  }
  try {
    await assert.rejects(client('invalid'))
    const alice = await client(login.token), bob = await client(login.token)
    let writes = 0, kills = 0
    termSessions.set('fixture', { socketId: alice.id, write: () => writes++, kill: () => kills++, detach: () => {}, resize: () => {} })
    bob.emit('term:input', { id: 'fixture', data: 'echo forbidden\r' })
    bob.emit('term:kill', { id: 'fixture' })
    bob.emit('term:detach', { id: 'fixture' })
    const denied = await bob.timeout(2000).emitWithAck('term:create', { reconnect: 'fixture', cols: 80, rows: 24 })
    assert.match(denied.error, /already attached/)
    assert.equal(writes, 0); assert.equal(kills, 0); assert.equal(termSessions.has('fixture'), true)
    const invalid = await alice.timeout(2000).emitWithAck('term:create', { cols: '80;id', rows: 24 })
    assert.match(invalid.error, /dimensions/)
    alice.emit('term:input', { id: 'fixture', data: 'ok' })
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(writes, 1)
    const disconnected = new Promise(resolve => alice.once('disconnect', resolve))
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: 'Bearer ' + login.token } })
    await disconnected
    assert.equal(alice.connected, false)
  } finally { for (const socket of clients) socket.disconnect(); await app.close(); await fs.rm(dir, { recursive: true, force: true }) }
})
