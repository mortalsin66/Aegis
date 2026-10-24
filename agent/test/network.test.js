import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatNetworkRate } from '../../web/src/lib/network-rate.js'
import { networkMetric } from '../src/lib/network.js'
import si from 'systeminformation'
import http from 'node:http'

test('small panel traffic remains visible instead of rounding to zero MB/s', () => {
  assert.deepEqual(formatNetworkRate(0), { value: '0', unitKey: 'dashboard.bytesPerSec' })
  assert.deepEqual(formatNetworkRate(512), { value: '512', unitKey: 'dashboard.bytesPerSec' })
  assert.deepEqual(formatNetworkRate(2048), { value: '2.00', unitKey: 'dashboard.kbPerSec' })
  assert.deepEqual(formatNetworkRate(40 * 1024), { value: '40.0', unitKey: 'dashboard.kbPerSec' })
  assert.deepEqual(formatNetworkRate(1.5 * 1024 ** 2), { value: '1.50', unitKey: 'dashboard.mbPerSec' })
  assert.deepEqual(formatNetworkRate(1024 ** 3), { value: '1.00', unitKey: 'dashboard.gbPerSec' })
  assert.equal(formatNetworkRate(0.1).value, '<1')
  for (const invalid of [NaN, Infinity, -1]) assert.equal(formatNetworkRate(invalid).value, '—')
})

test('default route interface wins over loopback and virtual adapters', () => {
  const stats = [
    { iface: 'lo', rx_sec: 100000, tx_sec: 100000 },
    { iface: 'docker0', rx_sec: 0, tx_sec: 0 },
    { iface: 'ens3', rx_sec: 2048, tx_sec: 4096 },
  ]
  assert.deepEqual(networkMetric(stats, 'ens3'), { iface: 'ens3', rx: 2048, tx: 4096 })
  assert.deepEqual(networkMetric([{ iface: 'ens3', rx_sec: null, tx_sec: -1 }], 'ens3'), { iface: 'ens3', rx: 0, tx: 0 })
  assert.equal(networkMetric([{ iface: 'lo' }, { iface: 'ens3', operstate: 'up' }], 'missing').iface, 'ens3')
})

test('real HTTP traffic produces nonzero Linux interface rates', { skip: process.platform !== 'linux' }, async () => {
  const server = http.createServer((req, res) => res.end(Buffer.alloc(256 * 1024)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await si.networkStats('lo')
    const response = await fetch(`http://127.0.0.1:${server.address().port}`)
    assert.equal((await response.arrayBuffer()).byteLength, 256 * 1024)
    await new Promise(resolve => setTimeout(resolve, 600))
    const stats = await si.networkStats('lo')
    assert.ok(stats[0].rx_sec > 0 && stats[0].tx_sec > 0)
    assert.notEqual(formatNetworkRate(stats[0].rx_sec).value, '0')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
