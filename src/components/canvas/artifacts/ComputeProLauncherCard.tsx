// Placeholder card shown when a `compute-pro` artifact is surfaced inside
// the editor area (artifact-body or EnvelopeArtifactEditor). Since the
// compute workbench lives exclusively in the full-screen overlay now,
// this card just invites the user to open it — clicking dispatches
// `openComputeOverlay()` on the window bus; App.tsx's listener flips
// `computeOverlayOpen` true.

import { Sparkles, SquareTerminal } from 'lucide-react'
import type { Artifact, ComputeProPayload } from '../../../types/artifact'
import { openComputeOverlay } from '../../../lib/compute-overlay-bus'

interface Props {
  artifact: Artifact
}

export default function ComputeProLauncherCard({ artifact }: Props) {
  const payload = (artifact.payload as ComputeProPayload | null) ?? null
  const cellCount = payload?.cells?.length ?? 0
  return (
    <div className="compute-pro-launcher-card">
      <SquareTerminal
        size={26}
        strokeWidth={1.3}
        className="compute-pro-launcher-icon"
        aria-hidden
      />
      <div className="compute-pro-launcher-text">
        <div className="compute-pro-launcher-title">{artifact.title}</div>
        <div className="compute-pro-launcher-sub">
          Compute workspace · {cellCount}{' '}
          {cellCount === 1 ? 'cell' : 'cells'}
        </div>
      </div>
      <button
        type="button"
        className="compute-pro-launcher-btn"
        onClick={() => openComputeOverlay()}
      >
        <Sparkles size={12} aria-hidden />
        Open in Compute
      </button>
    </div>
  )
}
