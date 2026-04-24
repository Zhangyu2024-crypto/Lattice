export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const diffMs = Math.max(0, now - timestamp)
  const sec = Math.round(diffMs / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  try {
    return new Date(timestamp).toLocaleDateString()
  } catch {
    return ''
  }
}
