/** Format a byte-per-second counter without hiding small but real traffic. */
export function formatNetworkRate(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return { value: '—', unitKey: 'dashboard.bytesPerSec' }
  const units = ['dashboard.bytesPerSec', 'dashboard.kbPerSec', 'dashboard.mbPerSec', 'dashboard.gbPerSec']
  let value = bytes, index = 0
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++ }
  if (index === 0) return { value: value > 0 && value < 1 ? '<1' : String(Math.round(value)), unitKey: units[index] }
  return { value: value.toFixed(value < 10 ? 2 : 1), unitKey: units[index] }
}
