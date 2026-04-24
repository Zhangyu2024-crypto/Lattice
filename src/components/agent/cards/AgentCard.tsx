// Phase ε — unified agent card.
//
// Single surface for both:
//   (a) tool-call cards (a TaskStep inside an assistant bubble — the
//       Phase-α ToolCallCard with its inline approval editor); and
//   (b) pure artifact cards (a `TranscriptMessage.artifactCardRef` with
//       no associated step — the Phase-δ ChatArtifactCard).
//
// Shape:
//
//   ┌─────────────────────────────────────────────┐
//   │ [status-icon] [kind-icon] Title        [×]  │   <- header
//   │ kind · preview.oneLiner                     │
//   │ ┌ compact preview ─────────────────────────┐│
//   │ │ …                                        ││
//   │ └──────────────────────────────────────────┘│
//   │ ┌ expanded preview (toggle) ───────────────┐│
//   │ │ …                                        ││
//   │ └──────────────────────────────────────────┘│
//   │ ┌ editor (edit mode only) ─────────────────┐│
//   │ │ …                                        ││
//   │ └──────────────────────────────────────────┘│
//   │ [Reject] [Approve] [Expand ↕] [Open WB ↗]   │  <- actions
//   └─────────────────────────────────────────────┘
//
// The action bar shape depends on the resolved `cardMode`:
//   - `info`    no approval buttons; editor slot is suppressed. Dismiss
//               + expand/workbench only.
//   - `review`  Approve/Reject buttons; no editor slot. The raw output
//               passes through unchanged on approve (orchestrator
//               contract).
//   - `edit`    Approve/Reject buttons AND the editor slot is rendered.
//               Approve commits the editor's `onChange` payload.
//
// Mode is resolved in this order:
//   1. Tool-call path: `resolveCardMode(step, tool)` — reads the step's
//      approval state + the tool catalog's `cardMode` / legacy
//      `approvalPolicy`.
//   2. Artifact-only path: always `'info'` — there's no tool loop to
//      gate.
//
// This file is the thin router and the single site that "wires up" the
// tool-preview side-effect registrations. The real rendering lives in
// `./agent-card/` — see ToolCallPath.tsx and ArtifactOnlyPath.tsx.

import type { ArtifactId } from '../../../types/artifact'
import type { TaskStep } from '../../../types/session'
import ToolCallPath from './agent-card/ToolCallPath'
import ArtifactOnlyPath from './agent-card/ArtifactOnlyPath'
// Side-effect imports: each of these files calls `registerToolPreview`
// for its slice of the tool catalog. Keeping them here means AgentCard
// is the single site that "wires up" previews, and code-splitting
// naturally follows the AgentCard bundle.
import './register-spectrum-previews'
import './tool-previews/register-workspace-previews'
import './tool-previews/register-literature-previews'
import './tool-previews/register-artifact-previews'
import './tool-previews/register-compute-previews'
import './tool-previews/register-structure-previews'
import './tool-previews/register-latex-previews'
import './tool-previews/register-library-previews'

// ─── Props ────────────────────────────────────────────────────────────

interface Props {
  /** Tool-call path — render a TaskStep's card. Mutually exclusive with
   *  `artifactCardRef`; callers should pass exactly one. */
  step?: TaskStep
  /** Artifact-only path — render a pure Phase-δ artifact preview. */
  artifactCardRef?: {
    artifactId: ArtifactId
    label?: string
  }
  /** Called when the user dismisses the card. In the artifact-only
   *  path the caller removes the whole transcript message; in the
   *  tool-call path this is a no-op by default (the card stays as a
   *  permanent record of the step). */
  onDismiss?: () => void
  /** Open the Pro-workbench floating window for an artifact. Injected
   *  by the host so this file stays renderer-agnostic (web vs Electron).
   *  When omitted the Open-Workbench button is hidden. */
  onOpenWorkbench?: (sessionId: string, artifactId: string) => void
  /** Override: render the card even when the tool's `cardMode === 'silent'`.
   *  Used by the per-assistant-message audit chip so expanding reveals
   *  the full silent cards inline. */
  forceShow?: boolean
}

// ─── Component ────────────────────────────────────────────────────────

export default function AgentCard({
  step,
  artifactCardRef,
  onDismiss,
  onOpenWorkbench,
  forceShow,
}: Props) {
  // Callers are expected to pass exactly one of these. In dev we log a
  // loud warning; in prod we pick `step` to keep rendering something.
  if (step && artifactCardRef) {
    console.warn('AgentCard: both `step` and `artifactCardRef` supplied — rendering step path.')
  }

  if (step) {
    return (
      <ToolCallPath
        step={step}
        onDismiss={onDismiss}
        onOpenWorkbench={onOpenWorkbench}
        forceShow={forceShow}
      />
    )
  }
  if (artifactCardRef) {
    return (
      <ArtifactOnlyPath
        artifactId={artifactCardRef.artifactId}
        labelOverride={artifactCardRef.label}
        onDismiss={onDismiss}
        onOpenWorkbench={onOpenWorkbench}
      />
    )
  }
  return null
}

// Re-exports for ζ teammates so they have a single entry point.
// Note: `isSilentStep` is imported directly from `./agent-card/helpers` by
// callers — mixing a non-component named export here broke Fast Refresh
// and caused full-page reloads on every HMR tick.
export type { PreviewBlocks } from './preview-registry'
export type AgentCardProps = Props
