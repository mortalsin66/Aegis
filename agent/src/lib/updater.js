import path from 'node:path'
import crypto from 'node:crypto'
import { command } from './commands.js'
import { atomicJson, loadJson } from './storage.js'
export function validVersion(version) { return /^\d+\.\d+\.\d+$/.test(version) }
export async function startUpdate(root, version, port) {
  if (!validVersion(version)) throw new Error('Invalid release version')
  const file = path.join(root, '.aegis-update-status.json')
  const previous = await loadJson(file, null)
  if (previous?.status === 'running') { const e = new Error('Update already running'); e.statusCode = 409; throw e }
  const id = 'update-' + crypto.randomUUID()
  const state = { id, status: 'running', output: 'Preparing update…', version, startedAt: Date.now() }
  await atomicJson(file, state)
  try {
    await command('systemd-run', ['--unit=aegis-update', '--collect', '--property=Type=exec', process.execPath, path.join(root, 'agent/src/update-worker.js'), root, version, String(port)], { timeout: 15_000 })
  } catch (e) { await atomicJson(file, { ...state, status: 'error', error: e.message }); throw e }
  return id
}
