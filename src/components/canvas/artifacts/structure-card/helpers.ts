// Pure formatters for the structure artifact card. Kept separate so the
// card file stays focused on state + composition.

/** Render a unix-ms timestamp as local HH:MM:SS for the transform pill
 *  row. No date part — the pill is only useful for "just happened" vs
 *  "earlier in this session", and the full timestamp lives elsewhere. */
export function formatClock(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
