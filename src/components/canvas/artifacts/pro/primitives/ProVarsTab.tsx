// Shared "Vars" DataTab for Pro Workbenches.
//
// Every technique's Vars tab used to be a `toast.warn`-adjacent
// "pin payload fields here in a later phase" placeholder. This primitive
// consumes a declarative schema per module (sections → rows) and renders
// a dense key/value grid with ALL CAPS section headings, mono-font
// numerics, and optional per-row copy-to-clipboard. The schema stays
// close to the module it belongs to so adding a new readout is a one-
// liner in the module file.
//
// Pinning to the status bar (originally sketched in
// PRO_WORKBENCH_V2_POWER_USER_REPORT §7.2) is deferred — the schema
// already has `pinnable` hooks so later UI can opt in without refactor.

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Copy, Pin, PinOff } from 'lucide-react'
import type { ModuleCtx } from '../modules/types'
import { TYPO } from '@/lib/typography-inline'
import { useProPinsStore } from '@/stores/pro-pins-store'

export interface VarsRowDef<Sub> {
  /** Stable id (used as React key + the future pinning key). */
  key: string
  label: string
  value: (ctx: ModuleCtx<Sub>) => ReactNode | string | number | null | undefined
  /** Render the value cell in mono font + tabular numerals. Default true
   *  for numerics; callers can force off for plain strings. */
  mono?: boolean
  /** When true, show a copy-to-clipboard affordance on hover. */
  copyable?: boolean
  /** Unit (appended to the value in muted text). */
  unit?: string
}

export interface VarsSectionDef<Sub> {
  title: string
  rows: ReadonlyArray<VarsRowDef<Sub>>
}

export interface VarsSchema<Sub> {
  sections: ReadonlyArray<VarsSectionDef<Sub>>
}

export interface ProVarsTabProps<Sub> {
  schema: VarsSchema<Sub>
  ctx: ModuleCtx<Sub>
}

export default function ProVarsTab<Sub>({
  schema,
  ctx,
}: ProVarsTabProps<Sub>) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const artifactId = ctx.artifact.id
  const pinList = useProPinsStore((s) => s.pins[artifactId] ?? [])
  const togglePin = useProPinsStore((s) => s.togglePin)

  const handleCopy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => {
        setCopiedKey((k) => (k === key ? null : k))
      }, 1200)
    } catch {
      // clipboard unavailable — silent; no toast on a non-action.
    }
  }, [])

  const anyRows = schema.sections.some((s) => s.rows.length > 0)
  if (!anyRows) {
    return <div style={styles.empty}>No readouts yet.</div>
  }

  // Resolve pinned rows against the current schema + ctx. Orphaned pins
  // (schema row removed) are silently filtered so the strip never goes
  // stale — they stay in the store but render nothing.
  const pinnedChips = pinList
    .map((pin) => {
      const section = schema.sections.find((s) => s.title === pin.section)
      const row = section?.rows.find((r) => r.key === pin.row)
      if (!section || !row) return null
      return { section, row, pin }
    })
    .filter(
      (x): x is { section: VarsSectionDef<Sub>; row: VarsRowDef<Sub>; pin: typeof pinList[number] } =>
        x !== null,
    )

  return (
    <div style={styles.wrap}>
      {pinnedChips.length > 0 ? (
        <div style={styles.pinnedStrip}>
          <span style={styles.pinnedStripHeading}>Pinned</span>
          {pinnedChips.map(({ section, row, pin }) => {
            const value = row.value(ctx)
            return (
              <span key={`${pin.section}:${pin.row}`} style={styles.pinnedChip}>
                <span style={styles.pinnedChipLabel}>{row.label}</span>
                <span style={styles.pinnedChipValue}>
                  {formatValue(value)}
                  {row.unit ? (
                    <span style={styles.unit}> {row.unit}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => togglePin(artifactId, pin)}
                  style={styles.pinnedChipUnpin}
                  title={`Unpin ${row.label}`}
                  aria-label={`Unpin ${row.label}`}
                >
                  <PinOff size={10} aria-hidden />
                </button>
                <span style={styles.pinnedChipSection}>{section.title}</span>
              </span>
            )
          })}
        </div>
      ) : null}
      {schema.sections.map((section) => (
        <div key={section.title} style={styles.section}>
          <div style={styles.sectionTitle}>{section.title}</div>
          <div style={styles.rows}>
            {section.rows.map((row) => {
              const resolved = row.value(ctx)
              const display = formatValue(resolved)
              const copyText = stringifyCopy(resolved)
              const pinKey = { section: section.title, row: row.key }
              const pinned = pinList.some(
                (p) => p.section === pinKey.section && p.row === pinKey.row,
              )
              return (
                <div key={row.key} style={styles.row}>
                  <span style={styles.rowLabel}>{row.label}</span>
                  <span
                    style={{
                      ...styles.rowValue,
                      ...(row.mono === false ? null : styles.mono),
                    }}
                    title={typeof display === 'string' ? display : undefined}
                  >
                    {display}
                    {row.unit ? (
                      <span style={styles.unit}> {row.unit}</span>
                    ) : null}
                  </span>
                  <div style={styles.rowActions}>
                    {row.copyable && copyText ? (
                      <button
                        type="button"
                        onClick={() => void handleCopy(row.key, copyText)}
                        style={styles.copyBtn}
                        title="Copy value"
                        aria-label="Copy value"
                      >
                        {copiedKey === row.key ? (
                          <Check size={10} aria-hidden />
                        ) : (
                          <Copy size={10} aria-hidden />
                        )}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => togglePin(artifactId, pinKey)}
                      style={{
                        ...styles.copyBtn,
                        ...(pinned ? styles.pinBtnActive : null),
                      }}
                      title={pinned ? 'Unpin from strip' : 'Pin to strip'}
                      aria-label={pinned ? 'Unpin row' : 'Pin row'}
                    >
                      <Pin size={10} aria-hidden />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatValue(value: ReactNode | string | number | null | undefined): ReactNode {
  if (value == null || value === '') {
    return <span style={styles.dim}>—</span>
  }
  if (typeof value === 'number') {
    // Let callers format floats if they want to; raw numbers get a sane
    // fallback of up to 6 significant digits so `0.0000001234` doesn't
    // render as 3 decimal places and look like 0.000.
    return Number.isFinite(value) ? formatNumber(value) : String(value)
  }
  return value
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString()
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 0.001 || abs >= 1e7)) {
    return value.toExponential(3)
  }
  return value
    .toPrecision(6)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
}

function stringifyCopy(value: ReactNode | string | number | null | undefined): string {
  if (value == null) return ''
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'string') return value
  return ''
}

// ─── Inline styles (grayscale / hairline per design system) ──────────

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 10,
    minHeight: 0,
    overflow: 'auto',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  sectionTitle: {
    fontSize: TYPO.xxs,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    paddingLeft: 2,
    paddingBottom: 2,
    borderBottom: '1px solid var(--color-border)',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '110px 1fr auto',
    alignItems: 'center',
    gap: 8,
    padding: '3px 2px',
    fontSize: TYPO.xs,
    color: 'var(--color-text-primary)',
    borderBottom: '1px solid color-mix(in srgb, var(--color-border) 35%, transparent)',
  },
  rowActions: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
  },
  pinBtnActive: {
    color: 'var(--color-accent)',
  },
  pinnedStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    padding: '6px 2px 10px',
    borderBottom: '1px dashed var(--color-border)',
    marginBottom: 4,
  },
  pinnedStripHeading: {
    fontSize: TYPO.xxs,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    marginRight: 4,
  },
  pinnedChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 6px',
    background: 'var(--color-bg-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: TYPO.xxs,
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-primary)',
  },
  pinnedChipLabel: {
    color: 'var(--color-text-muted)',
  },
  pinnedChipValue: {
    color: 'var(--color-text-primary)',
    fontVariantNumeric: 'tabular-nums slashed-zero',
  },
  pinnedChipUnpin: {
    width: 14,
    height: 14,
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinnedChipSection: {
    fontSize: TYPO.micro,
    color: 'var(--color-text-muted)',
    marginLeft: 2,
    opacity: 0.6,
  },
  rowLabel: {
    color: 'var(--color-text-muted)',
    fontSize: TYPO.xxs,
    letterSpacing: '0.02em',
  },
  rowValue: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    color: 'var(--color-text-primary)',
  },
  mono: {
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums slashed-zero',
  },
  unit: {
    color: 'var(--color-text-muted)',
    fontSize: TYPO.xxs,
    marginLeft: 2,
  },
  dim: {
    color: 'var(--color-text-muted)',
    opacity: 0.5,
  },
  copyBtn: {
    width: 18,
    height: 18,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    borderRadius: 3,
  },
  empty: {
    padding: 16,
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
    textAlign: 'center',
  },
}
