// Phase ζ.1 — inline approval editor for the `xps_fit_peaks` tool.
//
// Mirrors the DetectPeaks editor shape: a table of fit components with
// editable BE (center_eV) / FWHM / area numeric inputs and a delete-row
// button. The user's edited list goes back to the agent via `onChange`
// as a contract-compatible tool_result (same keys the tool emitted).
//
// Follows the registry-wide props contract: `step` is read-only; every
// mutation publishes the new array through `onChange`.

import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { TaskStep } from '../../../../types/session'
import type { XpsFitComponent } from '../../../../types/pro-api'

interface XpsFitPeaksOutput {
  artifactId: string
  components: number
  componentDetails?: XpsFitComponent[]
  rSquared?: number
  reducedChiSquared?: number
  summary?: string
}

function parseOutput(output: unknown): XpsFitPeaksOutput | null {
  if (!output || typeof output !== 'object') return null
  const candidate = output as Partial<XpsFitPeaksOutput>
  if (typeof candidate.artifactId !== 'string') return null
  return {
    artifactId: candidate.artifactId,
    components: Number(candidate.components ?? 0),
    componentDetails: Array.isArray(candidate.componentDetails)
      ? candidate.componentDetails.map((c) => ({
          name: String(c.name ?? ''),
          center_eV: Number(c.center_eV ?? 0),
          center_err: c.center_err != null ? Number(c.center_err) : undefined,
          fwhm_eV: Number(c.fwhm_eV ?? 0),
          fwhm_err: c.fwhm_err != null ? Number(c.fwhm_err) : undefined,
          fraction: c.fraction != null ? Number(c.fraction) : undefined,
          area: Number(c.area ?? 0),
          area_err: c.area_err != null ? Number(c.area_err) : undefined,
        }))
      : undefined,
    rSquared: candidate.rSquared != null ? Number(candidate.rSquared) : undefined,
    reducedChiSquared:
      candidate.reducedChiSquared != null
        ? Number(candidate.reducedChiSquared)
        : undefined,
    summary: candidate.summary,
  }
}

interface Props {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export default function XpsFitPeaksEditor({ step, onChange }: Props) {
  const parsed = useMemo(() => parseOutput(step.output), [step.output])
  const [components, setComponents] = useState<XpsFitComponent[]>(
    () => parsed?.componentDetails ?? [],
  )
  useEffect(() => {
    if (!parsed) return
    setComponents(parsed.componentDetails ?? [])
  }, [parsed])

  const publish = (next: XpsFitComponent[]) => {
    setComponents(next)
    if (!parsed) {
      onChange({ componentDetails: next })
      return
    }
    onChange({
      artifactId: parsed.artifactId,
      components: next.length,
      componentDetails: next,
      rSquared: parsed.rSquared,
      reducedChiSquared: parsed.reducedChiSquared,
      summary: `${next.length} components (edited)`,
    })
  }

  const removeRow = (index: number) => {
    publish(components.filter((_, i) => i !== index))
  }

  const patchRow = (
    index: number,
    field: 'center_eV' | 'fwhm_eV' | 'area',
    value: string,
  ) => {
    const num = value.trim() === '' ? NaN : Number(value)
    if (!Number.isFinite(num)) return
    const next = components.map((c, i) =>
      i === index ? { ...c, [field]: num } : c,
    )
    publish(next)
  }

  if (!parsed) {
    return (
      <div className="tool-approval-editor-empty">
        Output not in the expected shape; approve to use as-is or reject.
      </div>
    )
  }

  if (components.length === 0) {
    return (
      <div className="tool-approval-editor-empty">
        No components remaining. Approve to send an empty list back to the agent.
      </div>
    )
  }

  return (
    <div className="tool-approval-editor tool-approval-editor-xps-fit-peaks">
      <table className="tool-approval-editor-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>BE (eV)</th>
            <th>FWHM</th>
            <th>Area</th>
            <th aria-label="Delete" />
          </tr>
        </thead>
        <tbody>
          {components.map((c, i) => (
            <tr key={`${i}-${c.name}`}>
              <td>{c.name || `#${i + 1}`}</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  defaultValue={c.center_eV}
                  onBlur={(e) => patchRow(i, 'center_eV', e.target.value)}
                  className="tool-approval-editor-num"
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  defaultValue={c.fwhm_eV}
                  onBlur={(e) => patchRow(i, 'fwhm_eV', e.target.value)}
                  className="tool-approval-editor-num"
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  defaultValue={c.area}
                  onBlur={(e) => patchRow(i, 'area', e.target.value)}
                  className="tool-approval-editor-num"
                />
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="tool-approval-editor-delete"
                  title="Remove component"
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
