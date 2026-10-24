import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { command } from '../src/lib/commands.js'
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const scenario of ['success', 'build failure', 'health failure']) {
  test('transactional updater: ' + scenario, { skip: process.platform !== 'linux' }, async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-update-'))
    const root = path.join(tmp, 'installed'), fixture = path.join(tmp, 'release'), bin = path.join(tmp, 'bin')
    let server
    try {
      await fs.mkdir(path.join(root, 'web/dist'), { recursive: true })
      await fs.cp(path.join(source, 'src'), path.join(root, 'agent/src'), { recursive: true })
      await fs.writeFile(path.join(root, 'agent/old-release'), 'original')
      await fs.writeFile(path.join(root, 'agent/.aegis-password'), 'credential-must-survive')
      await fs.writeFile(path.join(root, 'web/dist/index.html'), 'old interface')
      await fs.writeFile(path.join(root, '.aegis-version'), '1.0.1')
      await fs.writeFile(path.join(root, '.aegis-update-status.json'), JSON.stringify({ id: 'fixture', status: 'running', output: '' }))
      for (const dir of ['agent/scripts', 'web/dist', 'bin']) await fs.mkdir(path.join(dir === 'bin' ? tmp : fixture, dir), { recursive: true })
      await fs.writeFile(path.join(fixture, 'agent/package.json'), JSON.stringify({ version: '1.1.0' }))
      await fs.writeFile(path.join(fixture, 'agent/new-release'), 'candidate')
      await fs.writeFile(path.join(fixture, 'agent/scripts/smoke.mjs'), '')
      await fs.writeFile(path.join(fixture, 'web/dist/index.html'), 'new interface')
      const archive = path.join(tmp, 'candidate.tar.gz')
      await command('tar', ['-czf', archive, '-C', fixture, '.'])
      const scripts = {
        curl: '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\ncp "$AEGIS_FIXTURE_ARCHIVE" "$2"\n',
        systemctl: '#!/bin/sh\nprintf "%s\\n" "$*" >> "$AEGIS_SYSTEMCTL_LOG"\n',
        pnpm: '#!/bin/sh\nexit ' + (scenario === 'build failure' ? '1' : '0') + '\n',
      }
      for (const [name, text] of Object.entries(scripts)) await fs.writeFile(path.join(bin, name), text, { mode: 0o755 })
      server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, version: scenario === 'success' ? '1.1.0' : 'bad' })) })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const result = await command(process.execPath, [path.join(root, 'agent/src/update-worker.js'), root, '1.1.0', String(server.address().port)], {
        timeout: 30_000,
        env: { ...process.env, PATH: bin + ':' + process.env.PATH, AEGIS_FIXTURE_ARCHIVE: archive, AEGIS_SYSTEMCTL_LOG: path.join(tmp, 'systemctl.log'), AEGIS_UPDATE_HEALTH_ATTEMPTS: '2' },
      }).catch(e => ({ failed: true, stderr: e.stderr }))
      const status = JSON.parse(await fs.readFile(path.join(root, '.aegis-update-status.json'), 'utf8'))
      assert.equal(status.status, scenario === 'success' ? 'done' : 'error')
      assert.equal(await fs.readFile(path.join(root, 'agent/.aegis-password'), 'utf8'), 'credential-must-survive')
      assert.equal(await fs.readFile(path.join(root, 'web/dist/index.html'), 'utf8'), scenario === 'success' ? 'new interface' : 'old interface')
      assert.equal((await fs.readFile(path.join(root, '.aegis-version'), 'utf8')).trim(), scenario === 'success' ? '1.1.0' : '1.0.1')
      if (scenario !== 'success') assert.equal(result.failed, true)
      if (scenario === 'build failure') await assert.rejects(fs.access(path.join(tmp, 'systemctl.log')))
    } finally { if (server) await new Promise(resolve => server.close(resolve)); await fs.rm(tmp, { recursive: true, force: true }) }
  })
}
