// CIF management for DARA Rietveld refinement. Renders under the
// "Whole-pattern Fit" section and only when the user has opted into
// DARA — the UI branch + `XrdProParams.refinement.useDara` flag in the
// parent panel drive visibility.
//
// CIFs are loaded entirely client-side (no lattice-cli round-trip): we
// read the File contents, stash the text under `XrdProCif.content`, and
// forward the array as `cif_texts` to `xrd.refine_dara`. This sidesteps
// the cross-backend filesystem-mount problem and works offline.

import { Check, Trash2 } from 'lucide-react'
import type { XrdProCif } from '../../../../types/artifact'

export interface CifSectionProps {
  cifs: readonly XrdProCif[]
  onAdd: (file: File) => void | Promise<void>
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}

export default function CifSection({
  cifs,
  onAdd,
  onToggle,
  onRemove,
}: CifSectionProps) {
  const inputId = 'xrd-dara-cif-input'
  const selectedCount = cifs.filter((c) => c.selected).length
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        marginTop: 6,
        padding: '6px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 3,
        background: 'var(--color-bg-base)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 'var(--text-xxs)',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        <span>CIFs for BGMN ({selectedCount}/{cifs.length} selected)</span>
        <label
          htmlFor={inputId}
          style={{
            padding: '1px 8px',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            background: 'var(--color-bg-active)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
            textTransform: 'none',
            letterSpacing: 'normal',
          }}
        >
          + Load CIF
        </label>
        <input
          id={inputId}
          type="file"
          accept=".cif"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            if (file) {
              void onAdd(file)
              e.currentTarget.value = ''
            }
          }}
        />
      </div>
      {cifs.length === 0 ? (
        <div
          style={{
            fontSize: 'var(--text-xxs)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.4,
            padding: '2px 0',
          }}
        >
          Load at least one CIF to enable BGMN refinement.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {cifs.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 4px',
                border: '1px solid var(--color-border)',
                borderRadius: 3,
                background: c.selected
                  ? 'var(--color-bg-active)'
                  : 'transparent',
              }}
            >
              <button
                type="button"
                onClick={() => onToggle(c.id)}
                title={c.selected ? 'Remove from fit' : 'Include in fit'}
                style={{
                  width: 14,
                  height: 14,
                  border: '1px solid var(--color-border)',
                  borderRadius: 2,
                  background: 'transparent',
                  color: c.selected
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {c.selected ? <Check size={10} /> : null}
              </button>
              <span
                style={{
                  flex: 1,
                  fontSize: 'var(--text-xxs)',
                  color: c.selected
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${c.filename} — ${Math.round(c.size / 1024)} KB`}
              >
                {c.filename}
              </span>
              {c.formula && (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-2xs)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {c.formula}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                title="Remove CIF"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 3,
                  padding: '1px 4px',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                }}
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
