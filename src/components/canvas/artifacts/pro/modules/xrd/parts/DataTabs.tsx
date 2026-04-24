// Data-tab renderers for the XRD module's bottom panel: peaks table,
// fit summary, and phase candidates. Kept separate from the module's
// main `index.tsx` so table-layout tweaks don't churn the action hook.

import type {
  XrdProCandidate,
  XrdProPayload,
  XrdProPeak,
  XrdProRefineResult,
  ProDataQuality,
} from '@/types/artifact'
import ProPeakTable, {
  type PeakColumnDef,
} from '@/components/canvas/artifacts/pro/primitives/ProPeakTable'
import { ProQualityCard, ProNumber, ProRow } from '@/components/common/pro'
import ScherrerResults from '@/components/canvas/artifacts/xrd-panel/ScherrerResults'
import WilliamsonHallSection from '@/components/canvas/artifacts/xrd-panel/WilliamsonHallSection'
import { S } from '@/components/canvas/artifacts/XrdProWorkbench.styles'

export const XRD_PEAK_COLUMNS = [
  { key: 'position', label: '2θ', unit: '°', numeric: true, precision: 3, editable: true, step: 0.01 },
  { key: 'intensity', label: 'I', numeric: true, precision: 1, editable: true, step: 1 },
  { key: 'fwhm', label: 'FWHM', unit: '°', numeric: true, precision: 3, editable: true, step: 0.01 },
  { key: 'snr', label: 'SNR', numeric: true, precision: 1, editable: false },
] as const satisfies ReadonlyArray<PeakColumnDef<XrdProPeak>>

export function XrdPeaksTab({
  peaks,
  onEdit,
  onRemove,
  onAdd,
  onFocus,
}: {
  peaks: XrdProPeak[]
  onEdit: (idx: number, patch: Partial<XrdProPeak>) => void
  onRemove: (idx: number) => void
  onAdd: () => void
  onFocus: (idx: number | null) => void
}) {
  return (
    <ProPeakTable<XrdProPeak>
      peaks={peaks}
      columns={XRD_PEAK_COLUMNS}
      onEdit={onEdit}
      onDelete={onRemove}
      onAdd={onAdd}
      onFocus={onFocus}
      emptyMessage="No peaks yet — run detect-peaks or add a row."
    />
  )
}

export function XrdFitTab({
  result,
}: {
  result: XrdProRefineResult | null | undefined
}) {
  if (!result) {
    return (
      <div style={S.tabPlaceholder}>
        Run <code>refine</code> to populate fit statistics.
      </div>
    )
  }

  const fmt = (v: number | undefined, dp = 3) =>
    v != null ? v.toFixed(dp) : '—'

  return (
    <div style={S.tabTable}>
      {/* ── Global R-factors ── */}
      <div style={S.tabKvRow}>
        <span style={S.tabKvKey}>R_wp</span>
        <span style={S.tabKvVal}>
          {result.rwp != null ? `${result.rwp.toFixed(3)}%` : '—'}
        </span>
      </div>
      {result.rexp != null && (
        <div style={S.tabKvRow}>
          <span style={S.tabKvKey}>R_exp</span>
          <span style={S.tabKvVal}>{result.rexp.toFixed(3)}%</span>
        </div>
      )}
      <div style={S.tabKvRow}>
        <span style={S.tabKvKey}>GoF</span>
        <span style={S.tabKvVal}>{result.gof?.toFixed(3) ?? '—'}</span>
      </div>
      <div style={S.tabKvRow}>
        <span style={S.tabKvKey}>Converged</span>
        <span style={S.tabKvVal}>{result.converged == null ? '—' : result.converged ? 'yes' : 'no'}</span>
      </div>
      {result.quality_flags && result.quality_flags.length > 0 && (
        <div style={S.tabKvRow}>
          <span style={S.tabKvKey}>Flags</span>
          <span style={S.tabKvVal}>{result.quality_flags.join(', ')}</span>
        </div>
      )}

      {/* ── Per-phase details ── */}
      {result.phases.map((ph, i) => (
        <div key={`ph-${i}`} style={{ borderTop: '1px solid var(--color-border)', padding: '6px 0 2px' }}>
          <div style={S.tabKvRow}>
            <span style={{ ...S.tabKvKey, fontWeight: 600 }}>
              {ph.phase_name ?? ph.formula ?? `Phase ${i + 1}`}
            </span>
            <span style={S.tabKvVal}>
              {ph.weight_pct != null ? `${ph.weight_pct.toFixed(1)} wt%` : ''}
            </span>
          </div>
          {ph.hermann_mauguin && (
            <div style={S.tabKvRow}>
              <span style={S.tabKvKey}>Space group</span>
              <span style={S.tabKvVal}>{ph.hermann_mauguin}</span>
            </div>
          )}
          {(ph.a != null || ph.b != null || ph.c != null) && (
            <div style={S.tabKvRow}>
              <span style={S.tabKvKey}>Lattice</span>
              <span style={S.tabKvVal}>
                a={fmt(ph.a, 4)} b={fmt(ph.b, 4)} c={fmt(ph.c, 4)} Å
              </span>
            </div>
          )}
          {(ph.alpha != null || ph.beta != null || ph.gamma != null) && (
            <div style={S.tabKvRow}>
              <span style={S.tabKvKey}>Angles</span>
              <span style={S.tabKvVal}>
                α={fmt(ph.alpha, 2)} β={fmt(ph.beta, 2)} γ={fmt(ph.gamma, 2)}°
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const phasesHeadStyle: import('react').CSSProperties = {
  ...S.tabTableHead,
  gridTemplateColumns: '28px 1fr 80px 60px',
}
const phasesRowStyle: import('react').CSSProperties = {
  ...S.tabTableRow,
  gridTemplateColumns: '28px 1fr 80px 60px',
}
const phasesRowSelectedStyle: import('react').CSSProperties = {
  ...phasesRowStyle,
  color: 'var(--color-accent-text)',
}

const phasesRowBtnStyle: import('react').CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
}

export function XrdPhasesTab({
  candidates,
  onToggle,
}: {
  candidates: XrdProCandidate[]
  onToggle?: (idx: number) => void
}) {
  if (candidates.length === 0) {
    return (
      <div style={S.tabPlaceholder}>
        Run <code>search-phases</code> to get candidate phases.
      </div>
    )
  }
  return (
    <div style={S.tabTable}>
      <div style={phasesHeadStyle}>
        <span>✓</span>
        <span>Name / formula</span>
        <span>SG</span>
        <span>Score</span>
      </div>
      {candidates.map((c, i) => (
        <button
          key={`cand-${i}`}
          type="button"
          onClick={() => onToggle?.(i)}
          style={{
            ...phasesRowBtnStyle,
            ...(c.selected ? phasesRowSelectedStyle : phasesRowStyle),
            ...(onToggle ? null : { cursor: 'default' }),
          }}
          title={
            c.selected
              ? 'Deselect candidate for refinement'
              : 'Select candidate for refinement'
          }
          disabled={!onToggle}
        >
          <span>{c.selected ? '✓' : ''}</span>
          <span className="workbench-xrd-mono">
            {c.name ?? c.formula ?? c.material_id ?? 'Candidate'}
          </span>
          <span>{c.space_group ?? '—'}</span>
          <span>{c.score?.toFixed(3) ?? '—'}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Crystallite tab (Scherrer + Williamson-Hall) ──────────��──────

function numVal(v: number | '', fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

export function XrdCrystalliteTab({
  peaks,
  params,
  setParams,
}: {
  peaks: XrdProPeak[]
  params: XrdProPayload['params']
  setParams: (fn: (p: XrdProPayload['params']) => XrdProPayload['params']) => void
}) {
  const scherrer = params.scherrer ?? { kFactor: 0.9, instrumentalFwhm: 0.1 }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 8px', overflow: 'auto', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <ProRow label="K factor">
          <ProNumber
            value={scherrer.kFactor}
            min={0.5}
            max={1.5}
            step={0.01}
            width={52}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                scherrer: { ...scherrer, kFactor: numVal(v, scherrer.kFactor) },
              }))
            }
          />
        </ProRow>
        <ProRow label="Inst. FWHM (°)">
          <ProNumber
            value={scherrer.instrumentalFwhm ?? 0.1}
            min={0}
            max={1}
            step={0.01}
            width={52}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                scherrer: { ...scherrer, instrumentalFwhm: numVal(v, scherrer.instrumentalFwhm ?? 0.1) },
              }))
            }
          />
        </ProRow>
      </div>
      <ScherrerResults
        peaks={peaks}
        kFactor={scherrer.kFactor}
        instrumentalFwhm={scherrer.instrumentalFwhm ?? 0.1}
        wavelength={params.refinement.wavelength}
      />
      <WilliamsonHallSection
        peaks={peaks}
        kFactor={scherrer.kFactor}
        instrumentalFwhm={scherrer.instrumentalFwhm ?? 0.1}
        wavelength={params.refinement.wavelength}
      />
    </div>
  )
}

// ─── Quality tab ─────────────────────────────────────────��────────

export function XrdQualityTab({
  quality,
  busy,
  onAssess,
}: {
  quality: ProDataQuality | null | undefined
  busy: boolean
  onAssess: () => void
}) {
  return (
    <div style={{ padding: '6px 8px', overflow: 'auto', flex: 1, minHeight: 0 }}>
      <ProQualityCard
        quality={quality ?? null}
        busy={busy}
        onAssess={onAssess}
        emptyHint="Load a spectrum, then assess quality."
      />
    </div>
  )
}
