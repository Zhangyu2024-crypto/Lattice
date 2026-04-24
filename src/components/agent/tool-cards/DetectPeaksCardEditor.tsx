// Phase α pilot — inline approval editor for the `detect_peaks` tool.
//
// When the orchestrator pauses after `detect_peaks`, this component
// renders between the ToolCallCard body and the Approve / Reject row.
// The user can trim spurious detections from the table or nudge a
// position / intensity / FWHM value before the peaks are shipped back
// to the LLM as the tool result. The compact mini-plot previews the
// spectrum with the (edited) peaks marked so corrections are easy to
// eyeball without opening the full workbench.
//
// Props contract is the registry-wide one: `step` is read-only; the
// edited `Peak[]` array goes out through `onChange` on every mutation,
// and the card forwards the latest value to `setStepApproval` on
// Approve.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Trash2 } from 'lucide-react'
import type { TaskStep } from '../../../types/session'
import type {
  Artifact,
  ProWorkbenchSpectrum,
  XrdProPeak,
} from '../../../types/artifact'
import {
  isCurveProArtifact,
  isRamanProArtifact,
  isXpsProArtifact,
  isXrdProArtifact,
} from '../../../types/artifact'
import { selectActiveSession, useRuntimeStore } from '../../../stores/runtime-store'
import { CHART_PRIMARY } from '../../../lib/chart-colors'
import { CHART_FONT_MONO, CHART_FONT_SANS } from '../../../lib/chart-font-stacks'
import { CHART_TEXT_PX } from '../../../lib/chart-text-px'

const PEAK_COLOR = '#FF5A5A'
const PEAK_FOCUSED_COLOR = '#FFFFFF'

interface DetectPeaksOutput {
  artifactId: string
  peaks: XrdProPeak[]
  summary?: string
}

/** Narrow the tool's raw output into the detect_peaks shape. Returns
 *  null for anything else so the card can fall back to the legacy
 *  JSON blob viewer. */
function parseDetectPeaksOutput(output: unknown): DetectPeaksOutput | null {
  if (!output || typeof output !== 'object') return null
  const candidate = output as Partial<DetectPeaksOutput>
  if (typeof candidate.artifactId !== 'string') return null
  if (!Array.isArray(candidate.peaks)) return null
  return {
    artifactId: candidate.artifactId,
    peaks: candidate.peaks.map((p) => ({
      position: Number(p.position ?? 0),
      intensity: Number(p.intensity ?? 0),
      fwhm: p.fwhm != null ? Number(p.fwhm) : undefined,
      snr: p.snr != null ? Number(p.snr) : undefined,
      label: p.label,
    })),
    summary: candidate.summary,
  }
}

function extractSpectrum(artifact: Artifact | undefined): ProWorkbenchSpectrum | null {
  if (!artifact) return null
  if (isXrdProArtifact(artifact)) return artifact.payload.spectrum
  if (isXpsProArtifact(artifact)) return artifact.payload.spectrum
  if (isRamanProArtifact(artifact)) return artifact.payload.spectrum
  if (isCurveProArtifact(artifact)) return artifact.payload.spectrum
  return null
}

interface Props {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export default function DetectPeaksCardEditor({ step, onChange }: Props) {
  const parsed = useMemo(() => parseDetectPeaksOutput(step.output), [step.output])
  const session = useRuntimeStore(selectActiveSession)
  const artifact = parsed
    ? session?.artifacts[parsed.artifactId]
    : undefined
  const spectrum = extractSpectrum(artifact)

  // Local copy of the peaks array — the single source of truth while
  // the card is live. Re-initialised whenever the raw output identity
  // changes (e.g. the LLM re-ran the tool after a rejection) but never
  // from upstream edits, so a stale re-render of the parent doesn't
  // clobber an in-flight user edit.
  const [peaks, setPeaks] = useState<XrdProPeak[]>(() => parsed?.peaks ?? [])
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const chartRef = useRef<ReactECharts | null>(null)

  const tableRef = useRef<HTMLTableSectionElement | null>(null)
  const handleRowEnter = useCallback((i: number) => setFocusedIdx(i), [])
  const handleRowLeave = useCallback(() => setFocusedIdx(null), [])

  const onChartClick = useCallback((params: { seriesName?: string; dataIndex?: number }) => {
    if (params.seriesName !== 'peaks' || params.dataIndex == null) return
    setFocusedIdx(params.dataIndex)
    const row = tableRef.current?.children[params.dataIndex] as HTMLElement | undefined
    row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])
  useEffect(() => {
    if (!parsed) return
    setPeaks(parsed.peaks)
  }, [parsed])

  // Notify parent on every mutation. We thread the updated array through
  // `onChange` as the same `{ artifactId, peaks, summary }` shape the
  // tool originally produced so the LLM sees a contract-compatible
  // tool_result.
  const publish = (next: XrdProPeak[]) => {
    setPeaks(next)
    if (!parsed) {
      onChange({ peaks: next })
      return
    }
    onChange({
      artifactId: parsed.artifactId,
      peaks: next,
      summary: `${next.length} peaks (edited)`,
    })
  }

  const removePeak = (index: number) => {
    publish(peaks.filter((_, i) => i !== index))
  }

  const patchPeak = (index: number, field: keyof XrdProPeak, value: string) => {
    const num = value.trim() === '' ? NaN : Number(value)
    // Ignore non-numeric intermediate states — the input's own string
    // value holds the user's typing, so we only commit when they've
    // entered a valid number. fwhm is allowed to go back to undefined
    // via an empty field.
    if (field === 'fwhm') {
      const next = peaks.map((p, i) =>
        i === index ? { ...p, fwhm: Number.isFinite(num) ? num : undefined } : p,
      )
      publish(next)
      return
    }
    if (!Number.isFinite(num)) return
    const next = peaks.map((p, i) =>
      i === index ? { ...p, [field]: num } : p,
    )
    publish(next)
  }

  const seriesData = useMemo(() => {
    if (!spectrum) return [] as Array<[number, number]>
    return spectrum.x.map((x, i) => [x, spectrum.y[i]] as [number, number])
  }, [spectrum])

  const peakScatterData = useMemo(
    () =>
      peaks.map((p, i) => ({
        value: [p.position, p.intensity],
        symbolSize: i === focusedIdx ? 14 : 8,
        itemStyle: {
          color: i === focusedIdx ? PEAK_FOCUSED_COLOR : PEAK_COLOR,
          shadowBlur: i === focusedIdx ? 8 : 0,
          shadowColor: i === focusedIdx ? 'rgba(255,255,255,0.5)' : 'transparent',
        },
        label: {
          show: i === focusedIdx,
          formatter: `{b|${p.position.toFixed(2)}}`,
          position: 'top' as const,
          distance: 10,
          rich: {
            b: {
              fontSize: CHART_TEXT_PX.xxs,
              fontFamily: CHART_FONT_MONO,
              color: '#fff',
              backgroundColor: 'rgba(30,30,30,0.88)',
              borderRadius: 3,
              padding: [2, 5],
            },
          },
        },
      })),
    [peaks, focusedIdx],
  )

  const option = useMemo(
    () => ({
      backgroundColor: 'transparent',
      animation: false,
      grid: { top: 24, right: 14, bottom: 26, left: 48 },
      xAxis: {
        type: 'value' as const,
        axisLabel: {
          color: '#888',
          fontSize: CHART_TEXT_PX.xs,
          fontFamily: CHART_FONT_MONO,
        },
        axisLine: { lineStyle: { color: '#2A2A2A' } },
        axisTick: { lineStyle: { color: '#2A2A2A' } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: {
          color: '#888',
          fontSize: CHART_TEXT_PX.xs,
          fontFamily: CHART_FONT_MONO,
        },
        axisLine: { lineStyle: { color: '#2A2A2A' } },
        axisTick: { lineStyle: { color: '#2A2A2A' } },
        splitLine: { show: false },
      },
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: 'rgba(20,20,20,0.96)',
        borderColor: '#2A2A2A',
        borderWidth: 1,
        extraCssText: 'z-index: 10 !important; pointer-events: none;',
        textStyle: {
          color: '#E8E8E8',
          fontSize: CHART_TEXT_PX.xs,
          fontFamily: CHART_FONT_SANS,
        },
      },
      series: [
        {
          type: 'line',
          name: 'spectrum',
          data: seriesData,
          showSymbol: false,
          lineStyle: { color: CHART_PRIMARY, width: 1.5 },
        },
        {
          type: 'scatter',
          name: 'peaks',
          data: peakScatterData,
          z: 3,
        },
      ],
    }),
    [seriesData, peakScatterData],
  )

  if (!parsed) {
    return (
      <div className="tool-approval-editor-empty">
        Output not in the expected shape; approve to use as-is or reject.
      </div>
    )
  }

  return (
    <div className="tool-approval-editor tool-approval-editor-detect-peaks">
      {spectrum && seriesData.length > 0 ? (
        <ReactECharts
          ref={chartRef}
          option={option}
          notMerge={false}
          lazyUpdate
          opts={{ renderer: 'canvas' }}
          style={{ height: 200, width: '100%' }}
          onEvents={{ click: onChartClick }}
        />
      ) : (
        <div className="tool-approval-editor-empty">
          Artifact spectrum unavailable — table edits still propagate.
        </div>
      )}
      {peaks.length === 0 ? (
        <div className="tool-approval-editor-empty">
          No peaks remaining. Approve to send an empty list back to the agent.
        </div>
      ) : (
        <table className="tool-approval-editor-table">
          <thead>
            <tr>
              <th>#</th>
              <th>2θ / x</th>
              <th>Intensity</th>
              <th>FWHM</th>
              <th aria-label="Delete" />
            </tr>
          </thead>
          <tbody ref={tableRef}>
            {peaks.map((peak, i) => (
              <tr
                key={`${i}-${peak.position}`}
                className={i === focusedIdx ? 'is-focused' : undefined}
                onPointerEnter={() => handleRowEnter(i)}
                onPointerLeave={handleRowLeave}
              >
                <td>{i + 1}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={peak.position}
                    onBlur={(e) => patchPeak(i, 'position', e.target.value)}
                    className="tool-approval-editor-num"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={peak.intensity}
                    onBlur={(e) => patchPeak(i, 'intensity', e.target.value)}
                    className="tool-approval-editor-num"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={peak.fwhm ?? ''}
                    onBlur={(e) => patchPeak(i, 'fwhm', e.target.value)}
                    className="tool-approval-editor-num"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => removePeak(i)}
                    className="tool-approval-editor-delete"
                    title="Remove peak"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
