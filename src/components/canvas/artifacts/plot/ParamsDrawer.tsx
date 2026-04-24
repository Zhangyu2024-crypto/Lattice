// Right-side parameters drawer for PlotArtifactCard. Every control is
// a controlled input that routes its change through the parent's
// `onPatchPayload` — same pattern as StructureArtifactCard's "Edit
// CIF" dialog, but inline / always-visible so expert users can tweak
// without opening a modal.
//
// Contract: the drawer never mutates state locally; changes fire
// immediately via `onPatchPayload({ ...payload, params: nextParams })`.
// React batches renders so typing in the title input doesn't thrash
// ECharts — `buildPlotOption` is memoised on `payload` identity in the
// parent.

import { useCallback } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type {
  PlotMode,
  PlotParams,
  PlotPayload,
  PlotPeak,
} from '../../../../types/artifact'

interface Props {
  payload: PlotPayload
  onPatchPayload: (next: PlotPayload) => void
}

const MODE_OPTIONS: ReadonlyArray<{ value: PlotMode; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'offset', label: 'Offset' },
  { value: 'stacked', label: 'Stacked' },
  { value: 'difference', label: 'Difference' },
]

export default function ParamsDrawer({ payload, onPatchPayload }: Props) {
  const { params, peaks, series, mode } = payload

  const patchParams = useCallback(
    (partial: Partial<PlotParams>) => {
      onPatchPayload({
        ...payload,
        params: { ...params, ...partial },
      })
    },
    [onPatchPayload, payload, params],
  )

  const setMode = useCallback(
    (nextMode: PlotMode) => {
      // Changing mode when there's only one series has limited value —
      // the user gets the same chart. We still allow it so the dropdown
      // isn't mysteriously disabled; the downstream chart builder
      // handles single-series gracefully in every mode.
      onPatchPayload({ ...payload, mode: nextMode })
    },
    [onPatchPayload, payload],
  )

  const addPeak = useCallback(() => {
    const nextPeak: PlotPeak = { x: 0, label: '' }
    onPatchPayload({ ...payload, peaks: [...peaks, nextPeak] })
  }, [onPatchPayload, payload, peaks])

  const updatePeak = useCallback(
    (idx: number, partial: Partial<PlotPeak>) => {
      const next = peaks.map((p, i) => (i === idx ? { ...p, ...partial } : p))
      onPatchPayload({ ...payload, peaks: next })
    },
    [onPatchPayload, payload, peaks],
  )

  const removePeak = useCallback(
    (idx: number) => {
      const next = peaks.filter((_, i) => i !== idx)
      onPatchPayload({ ...payload, peaks: next })
    },
    [onPatchPayload, payload, peaks],
  )

  return (
    <div className="plot-drawer">
      <Section title="Display">
        <Field label="Title">
          <input
            type="text"
            className="plot-drawer-input"
            value={params.title ?? ''}
            onChange={(e) =>
              patchParams({ title: e.target.value || undefined })
            }
            placeholder="(no title)"
          />
        </Field>
        <Field label="X label">
          <input
            type="text"
            className="plot-drawer-input"
            value={params.xLabel ?? ''}
            onChange={(e) =>
              patchParams({ xLabel: e.target.value || undefined })
            }
            placeholder="(x)"
          />
        </Field>
        <Field label="Y label">
          <input
            type="text"
            className="plot-drawer-input"
            value={params.yLabel ?? ''}
            onChange={(e) =>
              patchParams({ yLabel: e.target.value || undefined })
            }
            placeholder="(y)"
          />
        </Field>
        <ToggleRow
          label="Log Y"
          checked={params.logY}
          onChange={(v) => patchParams({ logY: v })}
        />
        <ToggleRow
          label="Legend"
          checked={params.showLegend}
          onChange={(v) => patchParams({ showLegend: v })}
        />
        <ToggleRow
          label="Grid"
          checked={params.grid}
          onChange={(v) => patchParams({ grid: v })}
        />
      </Section>

      {series.length > 1 && (
        <Section title="Layout">
          <Field label="Mode">
            <select
              className="plot-drawer-input"
              value={mode}
              onChange={(e) => setMode(e.target.value as PlotMode)}
            >
              {MODE_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          {mode === 'offset' && (
            <Field label="Offset">
              <input
                type="number"
                className="plot-drawer-input"
                step={0.05}
                min={0}
                max={2}
                value={params.offsetFraction ?? 0.2}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) {
                    patchParams({ offsetFraction: v })
                  }
                }}
              />
            </Field>
          )}
        </Section>
      )}

      <Section title={`Peaks (${peaks.length})`}>
        <div className="plot-drawer-list">
          {peaks.map((p, i) => (
            <div key={i} className="plot-drawer-list-row">
              <input
                type="number"
                className="plot-drawer-input plot-drawer-input-sm"
                step={0.01}
                value={p.x}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) updatePeak(i, { x: v })
                }}
              />
              <input
                type="text"
                className="plot-drawer-input plot-drawer-input-flex"
                value={p.label ?? ''}
                onChange={(e) => updatePeak(i, { label: e.target.value })}
                placeholder="label"
              />
              <button
                type="button"
                className="plot-drawer-icon-btn"
                onClick={() => removePeak(i)}
                aria-label="Remove peak"
                title="Remove"
              >
                <Trash2 size={10} aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="plot-drawer-add-btn"
            onClick={addPeak}
          >
            <Plus size={11} aria-hidden /> Add peak
          </button>
        </div>
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="plot-drawer-section">
      <div className="plot-drawer-section-title">{title}</div>
      {children}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="plot-drawer-field">
      <span className="plot-drawer-field-label">{label}</span>
      {children}
    </label>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="plot-drawer-toggle-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}
