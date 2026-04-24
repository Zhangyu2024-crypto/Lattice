// Top-of-card block that surfaces the tool's input args. Split out of
// GenericToolCard.tsx so the main file focuses on composition.
//
// Tries the structured `step.input` first; falls back to the legacy
// `step.inputSummary` string, and finally a muted "no input captured"
// placeholder when neither is available.

import type { ReactNode } from 'react'

import { INPUT_VALUE_TRUNCATE } from './constants'
import {
  isPlainObject,
  renderValueInline,
  truncateInline,
  type StepWithInput,
} from './helpers'
import { S } from './styles'

export default function InputBlock({ step }: { step: StepWithInput }) {
  const raw = step.input
  if (isPlainObject(raw) && Object.keys(raw).length > 0) {
    const entries = Object.entries(raw)
    // Flatten key / value cells into a single array so the grid's
    // `max-content 1fr` template lays them out row-by-row. Using a
    // fragment inside .map() would force per-row keys onto non-
    // enumerable slots and confuse React's reconciler.
    const cells: ReactNode[] = []
    for (const [k, v] of entries) {
      const full = renderValueInline(v)
      const shown = truncateInline(full, INPUT_VALUE_TRUNCATE)
      cells.push(
        <div key={`k-${k}`} style={S.inputKey}>
          {k}
        </div>,
      )
      cells.push(
        <div key={`v-${k}`} style={S.inputValue} title={full}>
          {shown}
        </div>,
      )
    }
    return (
      <div style={S.section}>
        <div style={S.sectionLabel}>Input</div>
        <div style={S.inputGrid}>{cells}</div>
      </div>
    )
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return (
      <div style={S.section}>
        <div style={S.sectionLabel}>Input</div>
        <div style={S.inputValue} title={raw}>
          {truncateInline(raw, INPUT_VALUE_TRUNCATE * 2)}
        </div>
      </div>
    )
  }
  if (step.inputSummary) {
    return (
      <div style={S.section}>
        <div style={S.sectionLabel}>Input</div>
        <div style={S.inputValue} title={step.inputSummary}>
          {truncateInline(step.inputSummary, INPUT_VALUE_TRUNCATE * 2)}
        </div>
      </div>
    )
  }
  return (
    <div style={S.section}>
      <div style={S.sectionLabel}>Input</div>
      <div style={S.inputEmpty}>No input captured.</div>
    </div>
  )
}
