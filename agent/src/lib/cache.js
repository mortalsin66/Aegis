export function cached(loader, ttl = 2000) {
  let value, expires = 0, pending
  return async (...args) => {
    if (Date.now() < expires) return value
    if (pending) return pending
    pending = Promise.resolve().then(() => loader(...args)).then(result => {
      value = result
      expires = Date.now() + ttl
      return result
    }).finally(() => { pending = undefined })
    return pending
  }
}

export class ExpiringJobs extends Map {
  constructor({ limit = 200, ttl = 3600_000 } = {}) { super(); this.limit = limit; this.ttl = ttl }
  prune() {
    const now = Date.now()
    for (const [id, job] of this) if (job.status !== 'running' && now - job.createdAt > this.ttl) this.delete(id)
  }
  set(id, job) {
    this.prune()
    if (this.size >= this.limit) {
      for (const [key, value] of this) { if (value.status !== 'running') { this.delete(key); break } }
      if (this.size >= this.limit) { const e = new Error('Too many active jobs'); e.statusCode = 429; throw e }
    }
    job.createdAt ??= Date.now()
    return super.set(id, job)
  }
}
