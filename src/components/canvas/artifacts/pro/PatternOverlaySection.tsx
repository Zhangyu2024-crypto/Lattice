// Shared "Pattern Overlays" inspector section used by both the XRD and
// XPS Pro workbenches. The two workbenches used to ship near-identical
// ~150-line copies that differed only in help text, file accept list,
// and input id — consolidating avoids palette/styling drift and keeps
// future UX tweaks (bulk remove, reorder, hover preview) in one place.
//
// The `overlay` prop is structurally typed so both `XrdPatternOverlay`
// and `XpsPatternOverlay` satisfy it without a shared interface in the
// domain-types file.

import { Eye, EyeOff, X } from 'lucide-react'
import { ProEmpty, ProSection } from '../../../common/pro'

export interface PatternOverlayRow {
  id: string
  name: string
  x: number[]
  color: string
  visible: boolean
}

export interface PatternOverlaySectionProps {
  overlays: readonly PatternOverlayRow[]
  /** Plain description shown below the section title. Technique-specific
   *  so the XRD copy can say "in-situ / operando / T-series" while the
   *  XPS copy talks about depth / angle / before-after. */
  helpText: string
  /** File-input `accept` attribute. Format selection is technique-aware
   *  because XRD ships e.g. `.xrdml` / `.chi` parsers that XPS doesn't. */
  accept: string
  /** Stable input id so two PatternOverlaySections on the same page
   *  (e.g. a multi-pane workbench) don't collide. */
  inputId: string
  onAdd: (file: File) => void | Promise<void>
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}

export default function PatternOverlaySection({
  overlays,
  helpText,
  accept,
  inputId,
  onAdd,
  onToggle,
  onRemove,
}: PatternOverlaySectionProps) {
  return (
    <ProSection title="Pattern Overlays" defaultOpen={false}>
      <div
        style={{
          fontSize: 'var(--text-xxs)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.4,
          padding: '0 2px 6px',
        }}
      >
        {helpText}
      </div>
      <label
        htmlFor={inputId}
        style={{
          display: 'inline-block',
          padding: '4px 10px',
          border: '1px solid var(--color-border)',
          borderRadius: 3,
          background: 'var(--color-bg-active)',
          color: 'var(--color-text-primary)',
          fontSize: 'var(--text-xxs)',
          cursor: 'pointer',
          marginBottom: 6,
        }}
      >
        + Add pattern
      </label>
      <input
        id={inputId}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          if (file) {
            void onAdd(file)
            // Reset so the same file can be re-selected after removal.
            e.currentTarget.value = ''
          }
        }}
      />
      {overlays.length === 0 ? (
        <ProEmpty compact>No overlays loaded</ProEmpty>
      ) : (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
        >
          {overlays.map((o) => (
            <div
              key={o.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 6px',
                border: '1px solid var(--color-border)',
                borderRadius: 3,
                background: 'var(--color-bg-base)',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: o.color,
                  flexShrink: 0,
                  opacity: o.visible ? 1 : 0.3,
                }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: 'var(--text-xxs)',
                  color: o.visible
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${o.name} — ${o.x.length} points`}
              >
                {o.name}
              </span>
              <button
                type="button"
                onClick={() => onToggle(o.id)}
                title={o.visible ? 'Hide' : 'Show'}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 3,
                  padding: '1px 5px',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                }}
              >
                {o.visible ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
              <button
                type="button"
                onClick={() => onRemove(o.id)}
                title="Remove"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 3,
                  padding: '1px 5px',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ProSection>
  )
}
