import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { cached, ExpiringJobs } from '../src/lib/cache.js'
import { MetricHistory, loadJson, folderSizes } from '../src/lib/storage.js'
import { command, identifier, dimensions } from '../src/lib/commands.js'
import { validVersion } from '../src/lib/updater.js'

test('concurrent metric requests share one collection', async () => {
  let calls = 0
  const collect = cached(async () => { calls++; await new Promise(r => setTimeout(r, 10)); return { cpu: 2 } }, 1000)
  const values = await Promise.all(Array.from({ length: 20 }, () => collect()))
  assert.equal(calls, 1); assert.equal(values.length, 20)
  await collect(); assert.equal(calls, 1)
})
test('history persists all five series and returns bounded aggregated ranges', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-history-'))
  try {
    const file = path.join(dir, 'history.json'), history = new MetricHistory(file)
    const now = Date.now()
    for (let i = 0; i < 1000; i++) history.add({ timestamp: now - (1000 - i) * 10000, cpu: i % 100, mem: { usedPct: 45 }, disk: [{ mount: '/', use: 70 }], net: { rx: 1024, tx: 512 } })
    await history.flush(); await history.flush()
    const loaded = new MetricHistory(file, await loadJson(file, []))
    const points = loaded.range(86400)
    assert.ok(points.length <= 240 && points.length > 0)
    assert.equal(points[0].mem, 45); assert.equal(points[0].disk, 70); assert.equal(points[0].rx, 1024)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
test('job store keeps references, bounds retention, and refuses unbounded active work', () => {
  const store = new ExpiringJobs({ limit: 2, ttl: 1 }), job = { status: 'running' }
  store.set('a', job); job.status = 'done'; assert.equal(store.get('a').status, 'done')
  store.set('b', { status: 'running' }); store.set('c', { status: 'running' })
  assert.equal(store.has('a'), false); assert.throws(() => store.set('d', { status: 'running' }))
})
test('commands use argv without executing metacharacters; command timeout works', async () => {
  const text = 'value; echo injected $(whoami)'
  const r = await command(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', text])
  assert.equal(r.stdout, text)
  await assert.rejects(command(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 30 }))
  for (const value of ['--help', 'a;id', '../root', 'hello world']) assert.throws(() => identifier(value))
  assert.throws(() => dimensions('80', 24)); assert.throws(() => dimensions(99999, 24))
  assert.equal(validVersion('1.1.0'), true); assert.equal(validVersion('1.1.0;id'), false)
})
test('folder sizes handle nested directories, spaces, cache, and missing paths', { skip: process.platform !== 'linux' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-folder-'))
  try {
    await fs.mkdir(path.join(dir, 'nested space')); await fs.writeFile(path.join(dir, 'nested space/file.bin'), Buffer.alloc(8192))
    const measure = folderSizes()
    const results = await Promise.all([measure(dir), measure(dir)])
    assert.equal(results[0].size, results[1].size); assert.ok(results[0].size >= 8192)
    assert.equal((await measure(dir)).cached, true)
    await assert.rejects(measure(path.join(dir, 'missing')))
    await assert.rejects(measure('relative'))
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
