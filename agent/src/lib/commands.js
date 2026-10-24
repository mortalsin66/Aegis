import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export function command(file, args = [], options = {}) {
  return execFileAsync(file, args.map(String), { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, ...options })
}
export function identifier(value, kind = 'identifier') {
  const text = String(value ?? '')
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.:@+-]{0,255}$/.test(text)) {
    const error = new Error(`Invalid ${kind}`)
    error.statusCode = 400
    throw error
  }
  return text
}
export function dimensions(cols, rows) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 1 || rows > 300) throw new Error('Invalid terminal dimensions')
  return { cols, rows }
}
export function startProcess(file, args, options = {}) {
  return spawn(file, args, { ...options, shell: false })
}
