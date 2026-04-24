// Right-panel parameter sections for XpsProWorkbench. Extracted from the
// monolithic workbench file (Phase 1 refactor). Pure rendering — state +
// actions remain in XpsProWorkbench.tsx and arrive as props.
//
// Sub-components and constants live under `./xps-panel/` and are
// imported from here so this file stays focused on composition. The
// XRD counterpart (`XrdProWorkbench.panel.tsx`) uses the same layout.

import { Plus, Sigma } from 'lucide-react'
import type {
  XpsProPayload,
  XpsProPeakDef,
} from '../../../types/artifact'
import PatternOverlaySection from './pro/PatternOverlaySection'
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
import {
  PEAK_SENSITIVITY_OPTIONS,
  PEAK_SENSITIVITY_PRESETS,
  prominenceToSensitivity,
  type PeakSensitivity,
} from '../../../lib/peak-detection-preset'
import { S } from './XpsProWorkbench.styles'
import ConfidenceDot from './xps-panel/ConfidenceDot'
import FitQualitySection from './xps-panel/FitQualitySection'
import PeakDefRow from './xps-panel/PeakDefRow'
import {
  BG_OPTIONS,
  CHARGE_MODE_OPTIONS,
  METHOD_OPTIONS,
  RSF_OPTIONS,
} from './xps-panel/constants'

const Y_SCALE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'log', label: 'Log Y' },
] as const

export interface XpsParameterPanelProps {
  payload: XpsProPayload
  params: XpsProPayload['params']
  busy: string | null
  setParams: (
    update: (p: XpsProPayload['params']) => XpsProPayload['params'],
  ) => void
  onAssessQuality: () => void
  onChargeCorrect: () => void
  onDetectPeaks: () => void
  onAddPeakDef: (type: 'single' | 'doublet') => void
  onRemovePeakDef: (id: string) => void
  onUpdatePeakDef: (id: string, patch: Partial<XpsProPeakDef>) => void
  onFit: () => void
  onQuantify: () => void
  onLookup: () => void
  onAddPatternOverlay: (file: File) => void | Promise<void>
  onToggleOverlayVisibility: (id: string) => void
  onRemovePatternOverlay: (id: string) => void
}

export default function XpsParameterPanel({
  payload,
  params,
  busy,
  setParams,
  onAssessQuality,
  onChargeCorrect,
  onDetectPeaks,
  onAddPeakDef,
  onRemovePeakDef,
  onUpdatePeakDef,
  onFit,
  onQuantify,
  onLookup,
  onAddPatternOverlay,
  onToggleOverlayVisibility,
  onRemovePatternOverlay,
}: XpsParameterPanelProps) {
  return (
    <>
      <ProSection title="Data Quality">
        <ProQualityCard
          quality={payload.quality}
          busy={busy === 'quality'}
          onAssess={onAssessQuality}
          emptyHint="Load an XPS file to assess quality"
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

      <ProSection title="Charge Correction">
        <ProRow label="Mode">
          <ProSelect
            value={params.chargeCorrect.mode}
            options={CHARGE_MODE_OPTIONS}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                chargeCorrect: {
                  ...p.chargeCorrect,
                  mode: v as 'auto' | 'manual',
                },
              }))
            }
          />
        </ProRow>
        {params.chargeCorrect.mode === 'auto' ? (
          <ProRow label="C 1s Ref" unit="eV">
            <ProNumber
              value={params.chargeCorrect.referenceEV}
              step={0.1}
              width={70}
              onChange={(v) =>
                setParams((p) => ({
                  ...p,
                  chargeCorrect: {
                    ...p.chargeCorrect,
                    referenceEV: typeof v === 'number' ? v : 284.8,
                  },
                }))
              }
            />
          </ProRow>
        ) : (
          <ProRow label="Shift" unit="eV">
            <ProNumber
              value={params.chargeCorrect.manualShift}
              step={0.1}
              width={70}
              onChange={(v) =>
                setParams((p) => ({
                  ...p,
                  chargeCorrect: {
                    ...p.chargeCorrect,
                    manualShift: typeof v === 'number' ? v : 0,
                  },
                }))
              }
            />
          </ProRow>
        )}
        <ProButton
          variant="primary"
          fullWidth
          onClick={onChargeCorrect}
          loading={busy === 'charge-correct'}
        >
          Auto Correct
        </ProButton>
        {payload.chargeCorrection && (
          <div style={S.shiftLine}>
            Applied shift:{' '}
            <strong>{payload.chargeCorrection.shiftEV.toFixed(2)}</strong> eV
            {payload.chargeCorrection.c1sFoundEV != null &&
              ` (C 1s @ ${payload.chargeCorrection.c1sFoundEV.toFixed(2)})`}
          </div>
        )}
      </ProSection>

      <PatternOverlaySection
        overlays={payload.patternOverlays ?? []}
        helpText="Load secondary XPS files to compare against the primary spectrum — depth-profile, angle-resolved, or before/after studies."
        accept=".csv,.tsv,.xy,.dat,.txt,.vms,.vamas"
        inputId="xps-overlay-file-input"
        onAdd={onAddPatternOverlay}
        onToggle={onToggleOverlayVisibility}
        onRemove={onRemovePatternOverlay}
      />

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
        <ProRow label="Min spacing" unit="eV">
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
          fullWidth
          onClick={onDetectPeaks}
          loading={busy === 'detect-peaks'}
        >
          Detect Peaks
        </ProButton>
        <div style={S.xpsPeakTable}>
          <div style={S.xpsPeakHead}>
            <span>#</span>
            <span>BE (eV)</span>
            <span>I</span>
            <span>FWHM</span>
          </div>
          {payload.detectedPeaks.slice(0, 20).map((p, i) => (
            <div key={`xpk-${i}`} style={S.xpsPeakRow}>
              <span>{i + 1}</span>
              <span>{p.position.toFixed(2)}</span>
              <span>{p.intensity.toFixed(0)}</span>
              <span>{p.fwhm?.toFixed(2) ?? '—'}</span>
            </div>
          ))}
        </div>
      </ProSection>

      <ProSection title="Peak Detection — Advanced" defaultOpen={false}>
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
      </ProSection>

      <ProSection title="Peak Definitions">
        {payload.peakDefinitions.length === 0 ? (
          <ProEmpty compact>No peak definitions</ProEmpty>
        ) : (
          payload.peakDefinitions.map((p) => (
            <PeakDefRow
              key={p.id}
              def={p}
              spectrumXMin={
                payload.spectrum ? Math.min(...payload.spectrum.x) : undefined
              }
              spectrumXMax={
                payload.spectrum ? Math.max(...payload.spectrum.x) : undefined
              }
              onChange={(patchDef) => onUpdatePeakDef(p.id, patchDef)}
              onRemove={() => onRemovePeakDef(p.id)}
            />
          ))
        )}
        <div className="workbench-xps-panel-btn-row">
          <ProButton compact onClick={() => onAddPeakDef('single')}>
            <Plus size={10} /> Peak
          </ProButton>
          <ProButton compact onClick={() => onAddPeakDef('doublet')}>
            <Plus size={10} /> Doublet
          </ProButton>
        </div>
      </ProSection>

      <ProSection title="Fit Parameters">
        <ProRow label="Background">
          <ProSelect
            value={params.fit.background}
            options={BG_OPTIONS}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                fit: {
                  ...p.fit,
                  background: v as 'shirley' | 'linear' | 'tougaard',
                },
              }))
            }
          />
        </ProRow>
        <ProRow label="Method">
          <ProSelect
            value={params.fit.method}
            options={METHOD_OPTIONS}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                fit: {
                  ...p.fit,
                  method: v as XpsProPayload['params']['fit']['method'],
                },
              }))
            }
          />
        </ProRow>
        <ProRow label="Default η" unit="0=G, 1=L">
          <ProSlider precise
            min={0}
            max={1}
            step={0.05}
            value={params.fit.voigtEta}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                fit: { ...p.fit, voigtEta: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="FWHM min" unit="eV">
          <ProNumber
            value={params.fit.fwhmMin}
            step={0.1}
            width={70}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                fit: { ...p.fit, fwhmMin: typeof v === 'number' ? v : 0.3 },
              }))
            }
          />
        </ProRow>
        <ProRow label="FWHM max" unit="eV">
          <ProNumber
            value={params.fit.fwhmMax}
            step={0.5}
            width={70}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                fit: { ...p.fit, fwhmMax: typeof v === 'number' ? v : 4.0 },
              }))
            }
          />
        </ProRow>
        <ProRow label="Max iter">
          <ProNumber
            value={params.fit.maxIter}
            step={1000}
            width={80}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                fit: { ...p.fit, maxIter: typeof v === 'number' ? v : 5000 },
              }))
            }
          />
        </ProRow>
        <ProButton
          variant="primary"
          fullWidth
          onClick={onFit}
          loading={busy === 'fit'}
        >
          <Sigma size={11} /> Fit Peaks
        </ProButton>
      </ProSection>

      <FitQualitySection fitResult={payload.fitResult} />

      <ProSection title="Quantification">
        <ProRow label="RSF set">
          <ProSelect
            value={params.quantify.rsfSet}
            options={RSF_OPTIONS}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                quantify: { ...p.quantify, rsfSet: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="Elements">
          <ProText
            value={params.quantify.elements}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                quantify: { ...p.quantify, elements: v },
              }))
            }
            placeholder="Fe, O, C"
          />
        </ProRow>
        <ProButton
          fullWidth
          onClick={onQuantify}
          loading={busy === 'quantify'}
        >
          Quantify
        </ProButton>
        {payload.fitResult?.quantification &&
          payload.fitResult.quantification.length > 0 && (
            <div style={S.quantTable}>
              <div style={S.quantHead}>
                <span>Element</span>
                <span className="workbench-xps-panel-text-right">at%</span>
              </div>
              {payload.fitResult.quantification.map((q, i) => (
                <div key={`q-${i}`} style={S.quantRow}>
                  <span>{q.element}</span>
                  <span className="workbench-xps-panel-text-right">
                    {q.atomic_percent.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
      </ProSection>

      <ProSection title="BE Database Lookup">
        <ProRow label="Element">
          <ProText
            value={params.lookup.element}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                lookup: { ...p.lookup, element: v },
              }))
            }
            placeholder="Fe"
            width={60}
          />
        </ProRow>
        <ProRow label="BE" unit="eV">
          <ProNumber
            value={params.lookup.be ?? ''}
            step={0.1}
            width={80}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                lookup: { ...p.lookup, be: v === '' ? null : v },
              }))
            }
          />
        </ProRow>
        <ProRow label="Tolerance" unit="eV">
          <ProNumber
            value={params.lookup.tolerance}
            step={0.1}
            width={60}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                lookup: {
                  ...p.lookup,
                  tolerance: typeof v === 'number' ? v : 1.0,
                },
              }))
            }
          />
        </ProRow>
        <ProButton
          variant="primary"
          fullWidth
          onClick={onLookup}
          loading={busy === 'lookup'}
        >
          Lookup
        </ProButton>
        {payload.fitResult?.lookupAssignments &&
          payload.fitResult.lookupAssignments.length > 0 && (
            <div style={S.lookupList}>
              {payload.fitResult.lookupAssignments
                .slice(0, 6)
                .map((a, i) => (
                  <div key={`la-${i}`} style={S.lookupRow}>
                    <ConfidenceDot confidence={a.confidence} />
                    <span>
                      {a.element} {a.line}
                    </span>
                    <span className="workbench-xps-panel-muted-cell">
                      {a.chemical_state ?? ''}
                    </span>
                    {a.binding_energy != null && (
                      <span className="workbench-xps-panel-be-cell">
                        {a.binding_energy.toFixed(2)}
                      </span>
                    )}
                    {a.wagner_parameter != null && (
                      <span
                        title="Modified Auger parameter α' = BE_XPS + KE_Auger (Al Kα, 1486.7 eV). Diagnostic for chemical-state ambiguities that BE alone can't resolve."
                        style={{
                          marginLeft: 6,
                          padding: '1px 5px',
                          border: '1px solid var(--color-border)',
                          borderRadius: 3,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-2xs)',
                          color: 'var(--color-text-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        α' {a.wagner_parameter.toFixed(1)}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          )}
      </ProSection>

      <ProSection title="Fit Results" defaultOpen={false}>
        {payload.fitResult?.curves ? (
          <ProEmpty compact>
            Envelope, components and residual are overlaid on the chart.
          </ProEmpty>
        ) : (
          <ProEmpty compact>Define peaks and run fit</ProEmpty>
        )}
      </ProSection>
    </>
  )
}
