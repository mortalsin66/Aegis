// Independent systemd unit: restarting aegis-agent must not terminate this worker.
import fs from 'node:fs/promises'
import path from 'node:path'
import { command } from './lib/commands.js'
import { atomicJson, loadJson } from './lib/storage.js'
import { validVersion } from './lib/updater.js'
const [rootArg, version, port] = process.argv.slice(2)
if (!rootArg || !path.isAbsolute(rootArg) || !validVersion(version) || !/^\d+$/.test(port)) throw new Error('Invalid update parameters')
const root = path.resolve(rootArg)
if (root === path.parse(root).root) throw new Error('Invalid installation directory')
const stateFile = path.join(root, '.aegis-update-status.json')
const state = await loadJson(stateFile, {})
const stage = path.join(root, '.aegis-stage-' + version + '-' + Date.now())
const backup = path.join(root, '.aegis-rollback')
let agentSwapped = false, distSwapped = false, stopped = false
let previousVersion = ''
async function log(message) { state.output = (state.output + '\n' + message).slice(-16000); await atomicJson(stateFile, state) }
async function exists(file) { return fs.access(file).then(() => true, () => false) }
try {
  previousVersion = await fs.readFile(path.join(root, '.aegis-version'), 'utf8').catch(() => '1.0.0')
  if (await exists(stage)) throw new Error('Staging directory already exists; inspect previous update')
  await fs.mkdir(stage)
  await log('Downloading release v' + version)
  const archive = path.join(stage, 'release.tar.gz')
  await command('curl', ['-fL', '--retry', '2', '--max-time', '180', `https://github.com/mortalsin66/Aegis/archive/refs/tags/v${version}.tar.gz`, '-o', archive], { timeout: 200_000 })
  await command('tar', ['-xzf', archive, '-C', stage, '--strip-components=1'], { timeout: 60_000 })
  const pkg = JSON.parse(await fs.readFile(path.join(stage, 'agent/package.json'), 'utf8'))
  if (pkg.version !== version) throw new Error('Release package version mismatch')
  await log('Installing locked dependencies and building interface')
  for (const [dir, args] of [['agent', ['install', '--prod', '--frozen-lockfile']], ['web', ['install', '--frozen-lockfile']], ['web', ['build']]]) {
    await command('pnpm', args, { cwd: path.join(stage, dir), timeout: 600_000, env: { ...process.env, CI: 'true' } })
  }
  await command(process.execPath, [path.join(stage, 'agent/scripts/smoke.mjs')], { cwd: stage, timeout: 60_000 })
  await fs.access(path.join(stage, 'web/dist/index.html'))
  await log('Checks passed; switching release')
  if (await exists(backup)) await fs.rm(backup, { recursive: true })
  await fs.mkdir(backup)
  await command('systemctl', ['stop', 'aegis-agent']); stopped = true
  for (const entry of await fs.readdir(path.join(root, 'agent'))) {
    if (entry.startsWith('.aegis-')) await fs.cp(path.join(root, 'agent', entry), path.join(stage, 'agent', entry), { recursive: true })
  }
  await fs.rename(path.join(root, 'agent'), path.join(backup, 'agent'))
  try { await fs.rename(path.join(stage, 'agent'), path.join(root, 'agent')); agentSwapped = true }
  catch (e) { await fs.rename(path.join(backup, 'agent'), path.join(root, 'agent')); throw e }
  await fs.rename(path.join(root, 'web/dist'), path.join(backup, 'dist'))
  try { await fs.rename(path.join(stage, 'web/dist'), path.join(root, 'web/dist')); distSwapped = true }
  catch (e) { await fs.rename(path.join(backup, 'dist'), path.join(root, 'web/dist')); throw e }
  await fs.writeFile(path.join(root, '.aegis-version'), version)
  await command('systemctl', ['start', 'aegis-agent'])
  let healthy = false
  const healthAttempts = Math.max(1, Math.min(120, Number(process.env.AEGIS_UPDATE_HEALTH_ATTEMPTS) || 60))
  for (let i = 0; i < healthAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }); const h = await r.json(); if (r.ok && h.ok && h.version === version) { healthy = true; break } } catch {}
  }
  if (!healthy) throw new Error('New agent failed health check')
  state.status = 'done'; await log('Release ' + version + ' is healthy; rollback copy retained')
  await fs.rm(stage, { recursive: true })
} catch (e) {
  state.status = 'error'; state.error = e.message
  if (stopped) {
    await command('systemctl', ['stop', 'aegis-agent']).catch(() => {})
    if (agentSwapped) { await fs.rename(path.join(root, 'agent'), path.join(stage, 'failed-agent')); await fs.rename(path.join(backup, 'agent'), path.join(root, 'agent')) }
    if (distSwapped) { await fs.rename(path.join(root, 'web/dist'), path.join(stage, 'failed-dist')); await fs.rename(path.join(backup, 'dist'), path.join(root, 'web/dist')) }
    await fs.writeFile(path.join(root, '.aegis-version'), previousVersion)
    await command('systemctl', ['start', 'aegis-agent']).catch(() => {})
  }
  await log('Update failed: ' + e.message + (stopped ? '; previous release restored' : '; installed release unchanged'))
  process.exitCode = 1
}
