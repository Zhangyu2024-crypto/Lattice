// Right-panel parameter sections for CurveProWorkbench. Extracted from the
// previously-monolithic workbench file so the logic lives in the module's
// index.tsx while this file stays pure rendering — mirrors the shape of
// XrdProWorkbench.panel.tsx.

import type { ReactNode } from 'react'
import type {
  CurveBaselineMethod,
  CurveProPayload,
  CurveSmoothMethod,
} from '@/types/artifact'
import { ProButton, ProSelect } from '@/components/common/pro'
import { S } from '@/components/canvas/artifacts/CurveProWorkbench.styles'

const Y_SCALE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'log', label: 'Log Y' },
] as const

export interface CurveParameterPanelProps {
  payload: CurveProPayload
  params: CurveProPayload['params']
  busy: string | null
  setParams: (
    update: (p: CurveProPayload['params']) => CurveProPayload['params'],
  ) => void
  onAssessQuality: () => void
  onSmooth: () => void
  onBaseline: () => void
  onDetectPeaks: () => void
}

export default function CurveParameterPanel({
  payload,
  params,
  busy,
  setParams,
  onAssessQuality,
  onSmooth,
  onBaseline,
  onDetectPeaks,
}: CurveParameterPanelProps) {
  return (
    <>
      <Section title="Smoothing">
        <Field label="Method">
          <select
            value={params.smooth.method}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                smooth: {
                  ...p.smooth,
                  method: e.target.value as CurveSmoothMethod,
                },
              }))
            }
            style={S.inputCompact}
          >
            <option value="savgol">Savitzky-Golay</option>
            <option value="moving_average">Moving avg</option>
            <option value="gaussian">Gaussian</option>
            <option value="none">None</option>
          </select>
        </Field>
        <Field label="Window">
          <input
            type="number"
            value={params.smooth.window}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                smooth: { ...p.smooth, window: Number(e.target.value) || 0 },
              }))
            }
            style={S.inputCompact}
          />
        </Field>
        <Field label="Order">
          <input
            type="number"
            value={params.smooth.order}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                smooth: { ...p.smooth, order: Number(e.target.value) || 0 },
              }))
            }
            style={S.inputCompact}
          />
        </Field>
        <ProButton fullWidth onClick={onSmooth} loading={busy === 'smooth'}>
          Apply Smoothing
        </ProButton>
      </Section>

      <Section title="Baseline">
        <Field label="Method">
          <select
            value={params.baseline.method}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                baseline: {
                  ...p.baseline,
                  method: e.target.value as CurveBaselineMethod,
                },
              }))
            }
            style={S.inputCompact}
          >
            <option value="none">None</option>
            <option value="linear">Linear</option>
            <option value="polynomial">Polynomial</option>
            <option value="shirley">Shirley</option>
            <option value="snip">SNIP</option>
          </select>
        </Field>
        <Field label="Order">
          <input
            type="number"
            value={params.baseline.order}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                baseline: {
                  ...p.baseline,
                  order: Number(e.target.value) || 0,
                },
              }))
            }
            style={S.inputCompact}
          />
        </Field>
        <ProButton
          fullWidth
          onClick={onBaseline}
          loading={busy === 'baseline'}
        >
          Apply Baseline
        </ProButton>
      </Section>

      <Section title="Peak detection">
        <Field label="Top K">
          <input
            type="number"
            value={params.peakDetect.topK}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                peakDetect: {
                  ...p.peakDetect,
                  topK: Number(e.target.value) || 0,
                },
              }))
            }
            style={S.inputCompact}
          />
        </Field>
        <Field label="Prom×">
          <input
            type="number"
            step={0.01}
            value={params.peakDetect.prominenceMult}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                peakDetect: {
                  ...p.peakDetect,
                  prominenceMult: Number(e.target.value) || 0,
                },
              }))
            }
            style={S.inputCompact}
          />
        </Field>
        <ProButton
          variant="primary"
          fullWidth
          onClick={onDetectPeaks}
          loading={busy === 'detect-peaks'}
        >
          Detect Peaks
        </ProButton>
      </Section>

      <Section title="Quality">
        <Field label="Y scale">
          <ProSelect
            value={params.yScale ?? 'linear'}
            options={[...Y_SCALE_OPTIONS]}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                yScale: v === 'log' ? 'log' : 'linear',
              }))
            }
            style={S.inputCompact}
          />
        </Field>
        <ProButton
          fullWidth
          onClick={onAssessQuality}
          loading={busy === 'assess-quality'}
        >
          Assess Quality
        </ProButton>
        {payload.quality && (
          <div className="workbench-curve-quality-line">
            grade: <strong>{payload.quality.grade}</strong>
            {payload.quality.snr != null &&
              ` · SNR ${payload.quality.snr.toFixed(1)}`}
          </div>
        )}
      </Section>
    </>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div style={S.inspectorBlock}>
      <div style={S.inspectorTitle}>{title}</div>
      {children}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div style={S.field}>
      <span className="workbench-curve-field-label">{label}</span>
      {children}
    </div>
  )
}
