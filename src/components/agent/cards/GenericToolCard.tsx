// Phase 2 — Tool-Card Coverage · GenericToolCard
//
// The universal fallback preview. When a TaskStep has no tool-specific
// resolver registered in the preview-registry, AgentCard still gets a
// structurally useful rendering instead of dropping to a one-line
// `outputSummary`. We inspect `step.output` with a pure shape detector
// and render the matching variant (table / chips / list / string blob /
// JSON tree / KV object), plus the step's `input` KV block at the top.
//
// Density tiers mirror the `PreviewBlocks` contract the AgentCard shell
// consumes:
//   - `oneLiner`  A brief string that sits next to the tool name in the
//                 header row. Falls through to `outputSummary` if no
//                 structural summary is available.
//   - `compact`   Always-visible body: input KV summary + a very short
//                 output preview (first few rows / 3 lines / chips).
//   - `expanded`  Full structural rendering: the full table / full list /
//                 full string blob (with copy + download) / full JSON.
//
// Styling is inline. No new CSS is required — we reuse existing
// `agent-card-*` hooks where helpful and use inline styles for the new
// surfaces (table / chip row / JSON tree) so this file ships without
// coordinating a stylesheet change.
//
// Implementation is split across `./generic-tool-card/` for readability:
//   - `constants.ts` — numeric limits shared across renderers.
//   - `helpers.ts`   — pure shape detection + formatting (no React).
//   - `styles.ts`    — the inline `S` CSSProperties map.
//   - `InputBlock.tsx`    — top-of-card input KV summary.
//   - `renderers.tsx`     — per-shape expanded renderers + dispatcher.
//   - `CompactOutput.tsx` — trimmed preview for the `compact` density.

import CompactOutput from './generic-tool-card/CompactOutput'
import InputBlock from './generic-tool-card/InputBlock'
import {
  buildOneLiner,
  detectShape,
  type Detected,
  type StepWithInput,
} from './generic-tool-card/helpers'
import { ShapeRenderer } from './generic-tool-card/renderers'
import { S } from './generic-tool-card/styles'

// ─── Public re-exports ───────────────────────────────────────────────
//
// Type re-exports only — value re-exports (`buildOneLiner`, `detectShape`)
// break Fast Refresh (non-component named exports alongside a React
// component default export force Vite into full-page reload on every
// HMR tick). Callers import values directly from `./generic-tool-card/
// helpers`.

export type { Detected }

export type Density = 'oneLiner' | 'compact' | 'expanded'

// ─── Component ───────────────────────────────────────────────────────

export interface GenericToolCardProps {
  step: StepWithInput
  density: Density
}

export default function GenericToolCard({
  step,
  density,
}: GenericToolCardProps) {
  const hasOutput = step.output !== undefined && step.output !== null
  const detected: Detected = hasOutput
    ? detectShape(step.output)
    : step.outputSummary
      ? { kind: 'string-blob', text: step.outputSummary }
      : { kind: 'unknown', json: null }

  if (density === 'oneLiner') {
    // `oneLiner` is rendered as a string by AgentCard's header; we
    // still export a renderable variant for future callers that want a
    // full chip. Returning the same text verbatim keeps the contract
    // stable.
    const label = buildOneLiner(step)
    return <span>{label ?? step.toolName ?? 'tool'}</span>
  }

  if (density === 'compact') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <InputBlock step={step} />
        {hasOutput || step.outputSummary ? (
          <div style={S.section}>
            <div style={S.sectionLabel}>Output</div>
            <CompactOutput detected={detected} />
          </div>
        ) : null}
        <div style={S.expandHint}>Expand for full output</div>
      </div>
    )
  }

  // expanded
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <InputBlock step={step} />
      {hasOutput || step.outputSummary ? (
        <div style={S.section}>
          <div style={S.sectionLabel}>Output</div>
          <ShapeRenderer detected={detected} toolName={step.toolName} />
        </div>
      ) : (
        <div style={S.inputEmpty}>No output captured.</div>
      )}
    </div>
  )
}
