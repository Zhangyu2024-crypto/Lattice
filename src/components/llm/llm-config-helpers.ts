// Shared formatters used by LLM config sub-tabs. Extracted out of
// `LLMConfigModal.tsx` so the modal file can be Fast-Refresh-clean — a
// component file with non-component named exports forces Vite into
// full-page reload on every HMR tick.

export const maskKey = (key: string | undefined): string => {
  if (!key) return 'Not configured'
  const trimmed = key.trim()
  if (trimmed.length <= 10) return `${'*'.repeat(Math.max(0, trimmed.length - 2))}${trimmed.slice(-2)}`
  const prefix = trimmed.slice(0, 7)
  const suffix = trimmed.slice(-4)
  return `${prefix}****${suffix}`
}

export const fmtInt = (n: number): string =>
  new Intl.NumberFormat('en-US').format(Math.round(n))

export const fmtCompact = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return fmtInt(n)
}

export const fmtUSD = (n: number): string => {
  if (!Number.isFinite(n)) return '$0.00'
  if (Math.abs(n) < 0.01 && n !== 0) return `<$0.01`
  return `$${n.toFixed(2)}`
}
