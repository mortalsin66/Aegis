import { agentUrl } from './agent'
import { token, setToken } from './auth'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string> | undefined) || {}),
  }
  const sentToken = token.value
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`

  const r = await fetch(`${agentUrl()}${path}`, { ...init, headers, signal: init?.signal || AbortSignal.timeout(path.startsWith('/api/fs/du') ? 90000 : 30000) })
  if (r.status === 401) {
    if (token.value === sentToken) setToken(null)
    throw new Error('Требуется авторизация')
  }
  if (!r.ok) {
    let msg = `API ${path} → ${r.status}`
    try {
      const data = await r.json()
      if (data && typeof data.error === 'string') msg = data.error
    } catch {
      /* тело ошибки не JSON */
    }
    throw new Error(msg)
  }
  return (await r.json()) as T
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}
