export function networkMetric(stats, defaultIface) {
  const active = stats.filter(item => item.iface !== 'lo' && item.iface !== 'lo0' && item.operstate !== 'down')
  const iface = stats.find(item => item.iface === defaultIface) || active[0] || stats[0] || {}
  const rate = value => Number.isFinite(value) && value >= 0 ? value : 0
  return { iface: iface.iface || '—', rx: rate(iface.rx_sec), tx: rate(iface.tx_sec) }
}
