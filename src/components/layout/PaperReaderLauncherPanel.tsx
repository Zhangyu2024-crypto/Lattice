import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useStableCallback } from '../../hooks/useStableCallback'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../stores/runtime-store'
import PaperArtifactCard from '../canvas/artifacts/PaperArtifactCard'
import Button from '../ui/Button'

interface Props {
  open: boolean
  sessionId: string | null
  artifactId: string | null
  onClose: () => void
}

/**
 * Floating paper reader — same shell as SpectrumAnalysisLauncherPanel, but
 * sized for PDF + side panel (Literature sidebar entry opens here instead of
 * docking into the workspace artifact strip).
 */
export default function PaperReaderLauncherPanel({
  open,
  sessionId,
  artifactId,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const handleClose = useStableCallback(onClose)
  const focusArtifact = useRuntimeStore((s) => s.focusArtifact)
  const patchArtifact = useRuntimeStore((s) => s.patchArtifact)
  const session = useRuntimeStore(selectActiveSession)

  const artifact = useRuntimeStore((s) => {
    if (!sessionId || !artifactId) return null
    return s.sessions[sessionId]?.artifacts[artifactId] ?? null
  })

  useOutsideClickDismiss(ref, open, handleClose)
  useEscapeKey(handleClose, open)

  useEffect(() => {
    if (!open || !sessionId || !artifactId) return
    const unsub = useRuntimeStore.subscribe((s) => {
      const a = s.sessions[sessionId]?.artifacts[artifactId]
      if (!a) handleClose()
    })
    return unsub
  }, [open, sessionId, artifactId, handleClose])

  if (!open || !sessionId || !artifactId) return null

  if (!artifact || artifact.kind !== 'paper') return null

  const canDock = session?.id === sessionId

  return (
    <div className="paper-reader-launcher-backdrop" aria-hidden={false}>
      <div
        ref={ref}
        className="paper-reader-launcher-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paper-reader-launcher-title"
      >
        <div className="paper-reader-launcher-head">
          <h2
            id="paper-reader-launcher-title"
            className="paper-reader-launcher-title"
          >
            Paper
          </h2>
          <div className="paper-reader-launcher-head-actions">
            {canDock ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  focusArtifact(sessionId, artifactId)
                  handleClose()
                }}
              >
                Dock in workspace
              </Button>
            ) : null}
            <button
              type="button"
              className="paper-reader-launcher-close"
              onClick={handleClose}
              aria-label="Close"
            >
              <X size={18} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
        <div className="paper-reader-launcher-body">
          <PaperArtifactCard
            artifact={artifact}
            onPatchMetadata={({ title, payload }) => {
              patchArtifact(sessionId, artifactId, { title, payload } as never)
            }}
          />
        </div>
      </div>
    </div>
  )
}
