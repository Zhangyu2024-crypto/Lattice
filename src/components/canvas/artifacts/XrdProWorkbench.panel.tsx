// Right-panel parameter sections for XrdProWorkbench. Receives all
// handlers as props so the state + action logic stays in the parent
// module (`pro/modules/xrd/index.tsx`) and this file is pure rendering.
//
// Sub-components and constants live under `./xrd-panel/` and are
// re-exported from here so external consumers keep their existing
// `@/components/canvas/artifacts/XrdProWorkbench.panel` imports (see
// pro/modules/xrd/index.tsx for `REFINE_PRESETS`).

import { useState } from 'react'
import {
  Activity,
  Check,
  Crosshair,
  Eye,
  EyeOff,
  Layers,
  Search,
  X,
} from 'lucide-react'
import type {
  XrdProCandidate,
  XrdProPayload,
  XrdProPeak,
} from '../../../types/artifact'
import PatternOverlaySection from './pro/PatternOverlaySection'
import CifSection from './xrd-panel/CifSection'
import {
  DEFAULT_INSTRUMENTAL_FWHM,
  INSTRUMENT_PROFILES,
  WAVELENGTH_TO_ANGSTROM,
} from '../../../lib/xrd-instruments'
import PeakProfileFitModal from './PeakProfileFitModal'
import {
  PEAK_SENSITIVITY_OPTIONS,
  PEAK_SENSITIVITY_PRESETS,
  prominenceToSensitivity,
  type PeakSensitivity,
} from '../../../lib/peak-detection-preset'
import {
  ProButton,
  ProEmpty,
  ProNumber,
  ProQualityCard,
  ProRow,
  ProSection,
  ProSelect,
  ProSlider,
  ProText,
} from '../../common/pro'
import { S } from './XrdProWorkbench.styles'
import DaraStatusBanner from './xrd-panel/DaraStatusBanner'
import ManualAddPeak from './xrd-panel/ManualAddPeak'
import RefineResultView from './xrd-panel/RefineResultView'
import ScherrerResults from './xrd-panel/ScherrerResults'
import WilliamsonHallSection from './xrd-panel/WilliamsonHallSection'
import XrdIdentificationSummary from './xrd-panel/XrdIdentificationSummary'
import {
  BACKGROUND_OPTIONS,
  PEAK_ENGINE_OPTIONS,
  REFINE_PRESETS,
  WAVELENGTH_OPTIONS,
} from './xrd-panel/constants'

// Re-export constants so external modules keep importing from this
// file's module specifier (e.g. pro/modules/xrd/index.tsx pulls
// `REFINE_PRESETS` from here).
export {
  BACKGROUND_OPTIONS,
  PEAK_ENGINE_OPTIONS,
  REFINE_PRESETS,
  WAVELENGTH_OPTIONS,
}

const Y_SCALE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'log', label: 'Log Y' },
] as const

export interface XrdParameterPanelProps {
  payload: XrdProPayload
  params: XrdProPayload['params']
  busy: string | null
  setParams: (
    update: (p: XrdProPayload['params']) => XrdProPayload['params'],
  ) => void
  onAssessQuality: () => void
  onDetectPeaks: () => void
  onClearPeaks: () => void
  onManualAddPeak: (pos: number, intensity: number) => void
  onRemovePeak: (idx: number) => void
  onSearchDb: () => void
  onUpdatePeak: (idx: number, patch: Partial<XrdProPeak>) => void
  onToggleCandidate: (idx: number) => void
  onToggleCandidateOverlay: (idx: number) => void
  onToggleCandidateSimulate: (idx: number) => void
  onAddPatternOverlay: (file: File) => void | Promise<void>
  onToggleOverlayVisibility: (id: string) => void
  onRemovePatternOverlay: (id: string) => void
  onAddCif: (file: File) => void | Promise<void>
  onToggleCifSelection: (id: string) => void
  onRemoveCif: (id: string) => void
  onRefine: () => void
  onApplyPreset: (key: string) => void
}

export default function XrdParameterPanel({
  payload,
  params,
  busy,
  setParams,
  onAssessQuality,
  onDetectPeaks,
  onClearPeaks,
  onManualAddPeak,
  onRemovePeak,
  onUpdatePeak,
  onSearchDb,
  onToggleCandidate,
  onToggleCandidateOverlay,
  onToggleCandidateSimulate,
  onAddPatternOverlay,
  onToggleOverlayVisibility,
  onRemovePatternOverlay,
  onAddCif,
  onToggleCifSelection,
  onRemoveCif,
  onRefine,
  onApplyPreset,
}: XrdParameterPanelProps) {
  // Peak-profile fit modal state. Kept in the panel so the peak table
  // can open it directly without adding yet another action to the XRD
  // module's handler bag — the modal talks back through `onUpdatePeak`.
  const [profileFitIdx, setProfileFitIdx] = useState<number | null>(null)
  const profileFitPeak =
    profileFitIdx != null ? payload.peaks[profileFitIdx] ?? null : null
  return (
    <>
      <ProSection title="Data Quality">
        <ProQualityCard
          quality={payload.quality}
          busy={busy === 'assess-quality'}
          onAssess={onAssessQuality}
          emptyHint="Load a file to assess quality"
        />
        <ProRow label="Y scale">
          <ProSelect
            value={params.yScale ?? 'linear'}
            options={[...Y_SCALE_OPTIONS]}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                yScale: v === 'log' ? 'log' : 'linear',
              }))
            }
          />
        </ProRow>
      </ProSection>

      <ProSection title="Peak Detection">
        <ProRow label="Sensitivity">
          <ProSelect
            value={prominenceToSensitivity(params.peakDetect.prominenceMult)}
            options={PEAK_SENSITIVITY_OPTIONS}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: {
                  ...p.peakDetect,
                  prominenceMult:
                    PEAK_SENSITIVITY_PRESETS[v as PeakSensitivity]
                      .prominenceMult,
                },
              }))
            }
          />
        </ProRow>
        <ProRow label="Min spacing" unit="°">
          <ProSlider precise
            min={0.05}
            max={50}
            step={0.05}
            value={params.peakDetect.minSpacing}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: { ...p.peakDetect, minSpacing: v },
              }))
            }
          />
        </ProRow>
        <ProButton
          variant="primary"
          onClick={onDetectPeaks}
          loading={busy === 'detect-peaks'}
          fullWidth
        >
          Detect Peaks
        </ProButton>

        <div style={S.peakTableWrap}>
          <div style={S.peakTableHdr}>
            <span className="workbench-xrd-panel-flex1">{payload.peaks.length} peaks</span>
            {payload.peaks.length > 0 && (
              <ProButton variant="danger" compact onClick={onClearPeaks}>
                Clear
              </ProButton>
            )}
          </div>
          {payload.peaks.length === 0 ? (
            <ProEmpty compact>No peaks yet</ProEmpty>
          ) : (
            <div style={S.peakScroll}>
              {payload.peaks.slice(0, 40).map((p, i) => (
                <div key={`pk-${i}`} style={S.peakRow}>
                  <span style={S.peakIdx}>#{i + 1}</span>
                  <span style={S.peakCell}>{p.position.toFixed(3)}</span>
                  <span style={S.peakCell}>{p.intensity.toFixed(1)}</span>
                  <span style={S.peakCell}>{p.fwhm?.toFixed(3) ?? '—'}</span>
                  <button
                    type="button"
                    onClick={() => setProfileFitIdx(i)}
                    style={S.peakDelBtn}
                    title="Fit profile (pseudo-Voigt LM) to refine FWHM"
                  >
                    <Crosshair size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemovePeak(i)}
                    style={S.peakDelBtn}
                    title="Remove"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              {payload.peaks.length > 40 && (
                <div style={S.peakMore}>
                  +{payload.peaks.length - 40} more…
                </div>
              )}
            </div>
          )}
          <ManualAddPeak onAdd={onManualAddPeak} />
        </div>
      </ProSection>

      <ProSection title="Peak Detection — Advanced" defaultOpen={false}>
        <ProRow label="Engine">
          <ProSelect
            value={params.peakDetect.engine}
            options={PEAK_ENGINE_OPTIONS}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: {
                  ...p.peakDetect,
                  engine: v as 'scipy' | 'dara',
                },
              }))
            }
          />
        </ProRow>
        <ProRow label="Prominence" unit="×">
          <ProSlider precise
            min={0.1}
            max={10}
            step={0.1}
            value={params.peakDetect.prominenceMult}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: { ...p.peakDetect, prominenceMult: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="Top K">
          <ProSlider precise
            min={1}
            max={100}
            step={1}
            value={params.peakDetect.topK}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: { ...p.peakDetect, topK: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="SNR thr">
          <ProSlider precise
            min={0.5}
            max={20}
            step={0.5}
            value={params.peakDetect.snr}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: { ...p.peakDetect, snr: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="Background">
          <ProSelect
            value={params.peakDetect.background}
            options={BACKGROUND_OPTIONS}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: {
                  ...p.peakDetect,
                  background: v as 'snip' | 'polynomial' | 'none',
                },
              }))
            }
          />
        </ProRow>
      </ProSection>

      <PatternOverlaySection
        overlays={payload.patternOverlays ?? []}
        helpText="Load secondary XRD files to compare against the primary pattern — in-situ, operando, or temperature-series studies."
        accept=".csv,.tsv,.xy,.dat,.txt,.chi,.uxd,.xrdml,.gsa,.fxye,.cpi,.udf"
        inputId="xrd-overlay-file-input"
        onAdd={onAddPatternOverlay}
        onToggle={onToggleOverlayVisibility}
        onRemove={onRemovePatternOverlay}
      />

      <ProSection title="Phase Search">
        <ProRow label="Elements">
          <ProText
            value={params.phaseSearch.elements}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                phaseSearch: { ...p.phaseSearch, elements: v },
              }))
            }
            placeholder="Fe, O, Si"
          />
        </ProRow>
        <ProRow label="Tolerance" unit="°">
          <ProSlider precise
            min={0.05}
            max={2}
            step={0.05}
            value={params.phaseSearch.tolerance}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                phaseSearch: { ...p.phaseSearch, tolerance: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="Top K">
          <ProSlider precise
            min={3}
            max={100}
            step={1}
            value={params.phaseSearch.topK}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                phaseSearch: { ...p.phaseSearch, topK: v },
              }))
            }
          />
        </ProRow>
        <ProButton
          variant="primary"
          fullWidth
          onClick={onSearchDb}
          loading={busy === 'xrd-search'}
          disabled={
            params.phaseSearch.elements.trim().length === 0 ||
            payload.peaks.length === 0
          }
          title={
            params.phaseSearch.elements.trim().length === 0
              ? 'Add element symbols (e.g. "Fe, O") to enable retrieval'
              : payload.peaks.length === 0
                ? 'Detect or add peaks first'
                : 'Element-subset retrieval + LLM phase identification'
          }
        >
          <Search size={11} />
          Identify Phases
        </ProButton>
        {params.phaseSearch.elements.trim().length === 0 ? (
          <div
            style={{
              fontSize: 'var(--text-xxs)',
              color: 'var(--color-text-muted)',
              marginTop: 4,
              lineHeight: 1.4,
            }}
          >
            Elements are required — the retriever uses them to narrow a 155k-row
            Materials Project DB before the LLM adjudicates.
          </div>
        ) : null}
        {payload.identification ? (
          <XrdIdentificationSummary identification={payload.identification} />
        ) : null}
        <div className="workbench-xrd-panel-candidates-wrap">
          <div style={S.subHeader}>
            Candidates{' '}
            <span className="workbench-xrd-panel-muted-count">
              ({payload.candidates.length})
            </span>
          </div>
          {payload.candidates.length === 0 ? (
            <ProEmpty compact>
              Search database or upload CIF files to add candidates
            </ProEmpty>
          ) : (
            <div style={S.candidateList}>
              {payload.candidates.map((c: XrdProCandidate, i: number) => (
                <div
                  key={`c-${i}`}
                  style={
                    c.selected
                      ? { ...S.candidateRow, ...S.candidateRowActive }
                      : S.candidateRow
                  }
                >
                  <button
                    type="button"
                    onClick={() => onToggleCandidate(i)}
                    title={
                      c.selected
                        ? 'Deselect (remove from refinement)'
                        : 'Select for refinement'
                    }
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: 'inherit',
                      font: 'inherit',
                      textAlign: 'left',
                    }}
                  >
                    <span style={S.candidateIcon}>
                      {c.selected ? <Check size={11} /> : null}
                    </span>
                    <span style={S.candidateName}>
                      {c.name ?? c.formula ?? c.material_id ?? 'Candidate'}
                    </span>
                    {c.space_group && (
                      <span style={S.candidateSg}>{c.space_group}</span>
                    )}
                    {c.score != null && (
                      <span style={S.candidateScore}>
                        {c.score.toFixed(2)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleCandidateOverlay(i)}
                    disabled={!c.refPeaks || c.refPeaks.length === 0}
                    title={
                      !c.refPeaks || c.refPeaks.length === 0
                        ? 'No reference peaks available'
                        : c.showOverlay
                          ? 'Hide reference peak ticks'
                          : 'Overlay reference peak ticks on chart'
                    }
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      borderRadius: 3,
                      padding: '2px 5px',
                      marginLeft: 6,
                      cursor:
                        !c.refPeaks || c.refPeaks.length === 0
                          ? 'not-allowed'
                          : 'pointer',
                      color: c.showOverlay
                        ? 'var(--color-text-primary)'
                        : 'var(--color-text-muted)',
                      fontSize: 'var(--text-xxs)',
                      lineHeight: 1,
                      opacity:
                        !c.refPeaks || c.refPeaks.length === 0 ? 0.4 : 1,
                    }}
                  >
                    {c.showOverlay ? <Eye size={11} /> : <EyeOff size={11} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleCandidateSimulate(i)}
                    disabled={!c.refPeaks || c.refPeaks.length === 0}
                    title={
                      !c.refPeaks || c.refPeaks.length === 0
                        ? 'No reference peaks available'
                        : c.showSimulate
                          ? 'Hide simulated continuous pattern'
                          : 'Simulate pseudo-Voigt-broadened pattern from this phase'
                    }
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      borderRadius: 3,
                      padding: '2px 5px',
                      marginLeft: 4,
                      cursor:
                        !c.refPeaks || c.refPeaks.length === 0
                          ? 'not-allowed'
                          : 'pointer',
                      color: c.showSimulate
                        ? 'var(--color-text-primary)'
                        : 'var(--color-text-muted)',
                      fontSize: 'var(--text-xxs)',
                      lineHeight: 1,
                      opacity:
                        !c.refPeaks || c.refPeaks.length === 0 ? 0.4 : 1,
                    }}
                  >
                    <Activity size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </ProSection>

      <ProSection title="Whole-pattern Fit">
        <DaraStatusBanner />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 2px',
            fontSize: 'var(--text-xxs)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
          title="Route the fit through BGMN for a real Rietveld refinement. Requires DARA_SERVICE_URL set pre-launch + at least one loaded CIF."
        >
          <input
            type="checkbox"
            checked={params.refinement.useDara === true}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                refinement: { ...p.refinement, useDara: e.currentTarget.checked },
              }))
            }
          />
          Use BGMN (true Rietveld)
        </label>
        {params.refinement.useDara && (
          <CifSection
            cifs={payload.uploadedCifs ?? []}
            onAdd={onAddCif}
            onToggle={onToggleCifSelection}
            onRemove={onRemoveCif}
          />
        )}
        <div style={S.presetBar}>
          {Object.entries(REFINE_PRESETS).map(([k, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => onApplyPreset(k)}
              style={S.presetChip}
            >
              {v.label}
            </button>
          ))}
        </div>
        <ProRow label="Wavelength">
          <ProSelect
            value={params.refinement.wavelength}
            options={WAVELENGTH_OPTIONS}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                refinement: {
                  ...p.refinement,
                  wavelength:
                    v as XrdProPayload['params']['refinement']['wavelength'],
                },
              }))
            }
          />
        </ProRow>
        <ProRow label="2θ min" unit="°">
          <ProNumber
            value={params.refinement.twoThetaMin}
            step={1}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                refinement: {
                  ...p.refinement,
                  twoThetaMin: typeof v === 'number' ? v : 10,
                },
              }))
            }
          />
        </ProRow>
        <ProRow label="2θ max" unit="°">
          <ProNumber
            value={params.refinement.twoThetaMax}
            step={1}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                refinement: {
                  ...p.refinement,
                  twoThetaMax: typeof v === 'number' ? v : 80,
                },
              }))
            }
          />
        </ProRow>
        <ProRow label="Max phases">
          <ProSlider precise
            min={1}
            max={6}
            step={1}
            value={params.refinement.maxPhases}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                refinement: { ...p.refinement, maxPhases: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="Instrument">
          <ProSelect
            value={params.refinement.instrumentProfile ?? ''}
            options={INSTRUMENT_PROFILES}
            onChange={(v) =>
              setParams((p) => {
                // When a known profile is picked, also pre-seed Scherrer's
                // instrumental FWHM from the LUT — saves the user a round
                // trip to the Scherrer section for a sensible default.
                const lut = DEFAULT_INSTRUMENTAL_FWHM[v]
                return {
                  ...p,
                  refinement: { ...p.refinement, instrumentProfile: v },
                  scherrer:
                    lut != null
                      ? { ...p.scherrer, instrumentalFwhm: lut }
                      : p.scherrer,
                }
              })
            }
          />
        </ProRow>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 2px',
            fontSize: 'var(--text-xxs)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
          title="Overlay y_obs − y_calc on the main chart after refinement"
        >
          <input
            type="checkbox"
            checked={payload.params.showResiduals !== false}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                // `showResiduals` lives on the params blob; default true so
                // persisted artifacts that never set it still plot Δ.
                showResiduals: e.currentTarget.checked,
              }))
            }
          />
          Show residuals (Δ = y_obs − y_calc)
        </label>
        <ProButton
          variant="primary"
          fullWidth
          onClick={onRefine}
          loading={busy === 'xrd-refine'}
        >
          <Layers size={11} />
          Run Fit
        </ProButton>
      </ProSection>

      <ProSection title="Crystallite Size (Scherrer)" defaultOpen={false}>
        <ProRow
          label="K factor"
          unit={`λ = ${WAVELENGTH_TO_ANGSTROM[
            params.refinement.wavelength
          ].toFixed(4)} Å`}
        >
          <ProNumber
            value={params.scherrer.kFactor}
            min={0.5}
            max={1.5}
            step={0.01}
            width={60}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                scherrer: {
                  ...p.scherrer,
                  kFactor: typeof v === 'number' ? v : 0.9,
                },
              }))
            }
          />
        </ProRow>
        <ProRow label="Inst. FWHM" unit="°">
          <ProNumber
            value={params.scherrer.instrumentalFwhm ?? 0.1}
            min={0}
            max={1}
            step={0.01}
            width={60}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                scherrer: {
                  ...p.scherrer,
                  instrumentalFwhm: typeof v === 'number' ? v : 0.1,
                },
              }))
            }
          />
        </ProRow>
        <ScherrerResults
          peaks={payload.peaks}
          kFactor={params.scherrer.kFactor}
          instrumentalFwhm={params.scherrer.instrumentalFwhm ?? 0.1}
          wavelength={params.refinement.wavelength}
        />
      </ProSection>

      <WilliamsonHallSection
        peaks={payload.peaks}
        instrumentalFwhm={params.scherrer.instrumentalFwhm ?? 0.1}
        kFactor={params.scherrer.kFactor}
        wavelength={params.refinement.wavelength}
      />

      <ProSection
        title="Results"
        defaultOpen={payload.refineResult != null}
      >
        {payload.refineResult ? (
          <RefineResultView
            result={payload.refineResult}
            qpaRir={params.qpaRir === true}
            onToggleQpaRir={(v) =>
              setParams((p) => ({ ...p, qpaRir: v }))
            }
          />
        ) : (
          <ProEmpty compact>
            Search phases or upload CIF, select candidates, then run refinement
          </ProEmpty>
        )}
      </ProSection>
      <PeakProfileFitModal
        open={profileFitIdx != null}
        peak={profileFitPeak}
        peakIndex={profileFitIdx}
        spectrum={
          payload.spectrum
            ? { x: payload.spectrum.x, y: payload.spectrum.y }
            : null
        }
        onClose={() => setProfileFitIdx(null)}
        onApply={(idx, patch) => onUpdatePeak(idx, patch)}
      />
    </>
  )
}
