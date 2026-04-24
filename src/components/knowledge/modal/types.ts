// Shared types, constants and pure helpers used by the split-out
// KnowledgeBrowserModal sub-panes. Extracted verbatim from
// ../KnowledgeBrowserModal.tsx to keep pane files self-contained.

import type { CSSProperties } from 'react'

export const MAX_COMPARE_MATERIALS = 5
export const MAX_COMPARE_METRICS = 5

export type Mode = 'browse' | 'fts' | 'material' | 'metric' | 'technique' | 'tag'

export interface FilterState {
  q: string
  material: string
  metric: string
  technique: string
  min_confidence: number
  tag: string
}

export const INITIAL_FILTERS: FilterState = {
  q: '',
  material: '',
  metric: '',
  technique: '',
  min_confidence: 0,
  tag: '',
}

export function roleBadge(role: string): CSSProperties {
  const map: Record<string, CSSProperties> = {
    system: {
      color: 'var(--color-type-xrd)',
      background: 'color-mix(in srgb, var(--color-type-xrd) 10%, transparent)',
      borderColor: 'color-mix(in srgb, var(--color-type-xrd) 45%, transparent)',
    },
    process: {
      color: 'var(--color-type-xps)',
      background: 'color-mix(in srgb, var(--color-type-xps) 10%, transparent)',
      borderColor: 'color-mix(in srgb, var(--color-type-xps) 45%, transparent)',
    },
    state: {
      color: 'var(--color-type-raman)',
      background: 'color-mix(in srgb, var(--color-type-raman) 10%, transparent)',
      borderColor: 'color-mix(in srgb, var(--color-type-raman) 45%, transparent)',
    },
    measurement: {
      color: 'var(--color-green)',
      background: 'color-mix(in srgb, var(--color-green) 10%, transparent)',
      borderColor:
        'color-mix(in srgb, var(--color-green) 45%, transparent)',
    },
  }
  return (
    map[role.toLowerCase()] ?? {
      color: 'var(--color-text-muted)',
      background: 'var(--color-bg-input)',
      borderColor: 'var(--color-border)',
    }
  )
}

export function truncate(s: string | undefined, n: number): string {
  if (!s) return ''
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}
