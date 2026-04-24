// Right-panel parameter sections for RamanProWorkbench (and its FTIR
// sibling). Extracted from the monolithic workbench file (Phase 1
// refactor). Pure rendering — state + actions stay in the main file.

import { Sparkles } from 'lucide-react'
import type { RamanProPayload } from '../../../types/artifact'
import {
  ProButton,
  ProEmpty,
  ProNumber,
  ProQualityCard,
  ProRow,
  ProSection,
  ProSelect,
  ProSlider,
} from '../../common/pro'
import { S } from './RamanProWorkbench.styles'

const BASELINE_METHOD_OPTIONS = [
  { value: 'polynomial', label: 'polynomial' },
  { value: 'snip', label: 'snip' },
]

const Y_SCALE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'log', label: 'Log Y' },
] as const

export interface RamanParameterPanelProps {
  payload: RamanProPayload
  params: RamanProPayload['params']
  busy: string | null
  isFtir: boolean
  setParams: (
    update: (p: RamanProPayload['params']) => RamanProPayload['params'],
  ) => void
  onAssessQuality: () => void
  onSmooth: () => void
  onBaseline: () => void
  onDetectPeaks: () => void
  onIdentify: () => void
}

export default function RamanParameterPanel({
  payload,
  params,
  busy,
  isFtir,
  setParams,
  onAssessQuality,
  onSmooth,
  onBaseline,
  onDetectPeaks,
  onIdentify,
}: RamanParameterPanelProps) {
  return (
    <>
      <ProSection title="Data Quality">
        <ProQualityCard
          quality={payload.quality}
          busy={busy === 'quality'}
          onAssess={onAssessQuality}
          emptyHint={`Load ${isFtir ? 'an FTIR' : 'a Raman'} file to assess quality`}
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

      <ProSection title="Smoothing">
        <ProRow label="SG window">
          <ProSlider precise
            min={3}
            max={51}
            step={2}
            value={params.smooth.sgWindow}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                smooth: { ...p.smooth, sgWindow: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="SG order">
          <ProSlider precise
            min={1}
            max={7}
            step={1}
            value={params.smooth.sgOrder}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                smooth: { ...p.smooth, sgOrder: v },
              }))
            }
          />
        </ProRow>
        <ProButton fullWidth onClick={onSmooth} loading={busy === 'smooth'}>
          Apply Smoothing
        </ProButton>
      </ProSection>

      <ProSection title="Baseline">
        <ProRow label="Method">
          <ProSelect
            value={params.baseline.method}
            options={BASELINE_METHOD_OPTIONS}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                baseline: {
                  ...p.baseline,
                  method: v as 'polynomial' | 'snip',
                },
              }))
            }
          />
        </ProRow>
        <ProRow label="Order">
          <ProSlider precise
            min={1}
            max={7}
            step={1}
            value={params.baseline.order}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                baseline: { ...p.baseline, order: v },
              }))
            }
          />
        </ProRow>
        <ProButton
          fullWidth
          onClick={onBaseline}
          loading={busy === 'baseline'}
        >
          Apply Baseline
        </ProButton>
      </ProSection>

      <ProSection title="Peak Detection">
        <ProRow label="Prominence">
          <ProSlider precise
            min={0.005}
            max={0.2}
            step={0.005}
            value={params.peakDetect.prominenceMult}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: { ...p.peakDetect, prominenceMult: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="Min spacing" unit="cm⁻¹">
          <ProSlider precise
            min={1}
            max={50}
            step={1}
            value={params.peakDetect.minSpacing}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: { ...p.peakDetect, minSpacing: v },
              }))
            }
          />
        </ProRow>
        <ProRow label="Top K">
          <ProSlider precise
            min={3}
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
        <ProButton
          variant="primary"
          fullWidth
          onClick={onDetectPeaks}
          loading={busy === 'detect-peaks'}
        >
          Re-Detect
        </ProButton>
      </ProSection>

      <ProSection title="Peak Table" defaultOpen={payload.peaks.length > 0}>
        {payload.peaks.length === 0 ? (
          <ProEmpty compact>Detect to populate</ProEmpty>
        ) : (
          <div style={S.peakTable}>
            <div style={S.peakHead}>
              <span>#</span>
              <span>cm⁻¹</span>
              <span>I</span>
              <span>FWHM</span>
            </div>
            {payload.peaks.slice(0, 30).map((p, i) => (
              <div key={`rpk-${i}`} style={S.peakRow}>
                <span>{i + 1}</span>
                <span>{p.position.toFixed(1)}</span>
                <span>{p.intensity.toFixed(0)}</span>
                <span>{p.fwhm?.toFixed(1) ?? '—'}</span>
              </div>
            ))}
          </div>
        )}
      </ProSection>

      <ProSection
        title="Assignment (AI)"
        defaultOpen={payload.matches.length > 0}
      >
        <ProRow label="Tolerance">
          <ProNumber
            value={params.assignment.tolerance}
            step={0.1}
            width={70}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                assignment: {
                  tolerance: typeof v === 'number' ? v : 0.5,
                },
              }))
            }
          />
        </ProRow>
        <ProButton
          variant="primary"
          fullWidth
          onClick={onIdentify}
          loading={busy === 'identify'}
        >
          <Sparkles size={11} /> Assign
        </ProButton>
        {payload.matches.length > 0 && (
          <div style={S.matchList}>
            {payload.matches.slice(0, 10).map((m, i) => (
              <div key={`m-${i}`} style={S.matchRow}>
                <span style={S.matchName}>{m.name}</span>
                {m.formula && (
                  <span style={S.matchFormula}>{m.formula}</span>
                )}
                {m.score != null && (
                  <span style={S.matchScore}>{m.score.toFixed(2)}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {isFtir && (
          <ProEmpty compact>
            FTIR database not wired on backend yet — button disabled.
          </ProEmpty>
        )}
      </ProSection>
    </>
  )
}
