// No third-party imports: legacy updaters copy agent code without installing dependencies.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = await fs.readFile(path.join(dir, 'pnpm-lock.yaml'))
const digest = crypto.createHash('sha256').update(lock).digest('hex')
const marker = path.join(dir, 'node_modules', '.aegis-dependencies')
let installed = ''
try { installed = await fs.readFile(marker, 'utf8') } catch {}
if (installed !== digest) {
  console.log('Aegis: preparing release dependencies…')
  const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['install', '--prod', '--frozen-lockfile'], { cwd: dir, stdio: 'inherit', env: { ...process.env, CI: 'true' }, timeout: 600_000, shell: process.platform === 'win32' })
  if (result.error || result.status !== 0) throw new Error('Dependency migration failed: ' + (result.error?.message || result.status))
  await fs.writeFile(marker, digest)
}
await import('./app.js')
