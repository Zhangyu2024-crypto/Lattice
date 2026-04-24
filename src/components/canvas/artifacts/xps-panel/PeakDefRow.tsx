// Peak-definition row for the XPS parameter panel. Extracted from
// `XpsProWorkbench.panel.tsx` (Phase 1 refactor). Pure presentational —
// all state + mutations are routed through `onChange` / `onRemove`.

import { X } from 'lucide-react'
import type { XpsProPeakDef } from '../../../../types/artifact'
import { ProNumber } from '../../../common/pro'
import { S } from '../XpsProWorkbench.styles'

// Clamp `v` to [min, max]. `min`/`max` may be undefined for one-sided bounds.
// A tiny positive FWHM floor (FWHM_MIN) prevents divide-by-zero downstream
// in the fit worker when a user zeros the field out.
const FWHM_MIN = 0.01
const clamp = (v: number, min?: number, max?: number): number => {
  let out = v
  if (typeof min === 'number' && out < min) out = min
  if (typeof max === 'number' && out > max) out = max
  return out
}

export default function PeakDefRow({
  def,
  spectrumXMin,
  spectrumXMax,
  onChange,
  onRemove,
}: {
  def: XpsProPeakDef
  spectrumXMin?: number
  spectrumXMax?: number
  onChange: (patch: Partial<XpsProPeakDef>) => void
  onRemove: () => void
}) {
  return (
    <div style={S.peakDefCard}>
      <div className="workbench-xps-panel-def-head">
        <input
          type="text"
          value={def.label}
          onChange={(e) => onChange({ label: e.target.value })}
          style={S.peakDefLabel}
        />
        <span style={S.peakDefType}>{def.type}</span>
        <button
          type="button"
          onClick={onRemove}
          style={S.peakDefDelBtn}
          title="Remove"
        >
          <X size={11} />
        </button>
      </div>
      <div style={S.peakDefGrid}>
        <ProNumber
          value={def.position}
          step={0.1}
          width="100%"
          min={spectrumXMin}
          max={spectrumXMax}
          onChange={(v) =>
            onChange({
              position:
                typeof v === 'number'
                  ? clamp(v, spectrumXMin, spectrumXMax)
                  : 0,
            })
          }
        />
        <ProNumber
          value={def.intensity}
          step={10}
          width="100%"
          min={0}
          onChange={(v) =>
            onChange({
              intensity: typeof v === 'number' ? clamp(v, 0) : 0,
            })
          }
        />
        <ProNumber
          value={def.fwhm}
          step={0.1}
          width="100%"
          min={FWHM_MIN}
          onChange={(v) =>
            onChange({
              fwhm: typeof v === 'number' ? clamp(v, FWHM_MIN) : FWHM_MIN,
            })
          }
        />
      </div>
      {def.type === 'doublet' && (
        <>
          <div className="workbench-xps-panel-btn-row">
            <ProNumber
              value={def.split ?? 0}
              step={0.1}
              width="100%"
              min={0}
              onChange={(v) =>
                onChange({
                  split: typeof v === 'number' ? clamp(v, 0) : 0,
                })
              }
            />
            <ProNumber
              value={def.branchingRatio ?? 0.5}
              step={0.01}
              width="100%"
              min={0.01}
              max={1}
              onChange={(v) =>
                onChange({
                  branchingRatio:
                    typeof v === 'number' ? clamp(v, 0.01, 1) : 0.5,
                })
              }
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 4,
              fontSize: 'var(--text-xxs)',
              color: 'var(--color-text-muted)',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
              }}
              title="Unlock to let the fitter drift split within ±20% of the seed. Locked = use the quantum-mechanical constant (e.g. Fe 2p ≈ 13.6 eV)."
            >
              <input
                type="checkbox"
                checked={def.fixedSplit !== false}
                onChange={(e) =>
                  onChange({ fixedSplit: e.currentTarget.checked })
                }
              />
              Lock split
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
              }}
              title="Unlock to let the fitter drift area ratio within (0.01, 10). Locked = QM-derived (e.g. 2p: 0.5, 3d: 0.67)."
            >
              <input
                type="checkbox"
                checked={def.fixedBranching !== false}
                onChange={(e) =>
                  onChange({ fixedBranching: e.currentTarget.checked })
                }
              />
              Lock ratio
            </label>
          </div>
        </>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 6,
          fontSize: 'var(--text-xxs)',
          color: 'var(--color-text-muted)',
        }}
        title="Pseudo-Voigt mix: 0 = Gaussian, 1 = Lorentzian. Overrides the workbench default for this peak only."
      >
        <span
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            width: 32,
            flexShrink: 0,
          }}
        >
          η
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={def.voigtEta ?? 0.5}
          onChange={(e) =>
            onChange({ voigtEta: Number(e.currentTarget.value) })
          }
          style={{ flex: 1, accentColor: 'var(--color-accent)' }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-secondary)',
            width: 34,
            textAlign: 'right',
          }}
        >
          {(def.voigtEta ?? 0.5).toFixed(2)}
        </span>
      </div>
    </div>
  )
}
