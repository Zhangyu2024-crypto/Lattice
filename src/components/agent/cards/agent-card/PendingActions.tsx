// Pending-approval action bar extracted from AgentCard.tsx. Renders the
// editor (edit mode only) plus the Approve / Reject buttons. In review
// mode the editor is suppressed and the raw output passes through
// unchanged on approve.

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import type { TaskId, TaskStep } from '../../../../types/session'
import type { CardMode } from '../../../../types/agent-tool'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../../../stores/runtime-store'
import { toast } from '../../../../stores/toast-store'
import Button from '../../../ui/Button'
import { getToolCardEditor } from '../editor-registry'
import { getToolApplier } from '../../tool-cards/applier-registry'

export default function PendingActions({
  step,
  mode,
  taskId,
  primaryArtifactId,
  isProArtifact,
  onOpenWorkbench,
}: {
  step: TaskStep
  mode: CardMode
  taskId: TaskId | null
  primaryArtifactId: string | undefined
  isProArtifact: boolean
  onOpenWorkbench?: (sessionId: string, artifactId: string) => void
}) {
  const session = useRuntimeStore(selectActiveSession)
  const setStepApproval = useRuntimeStore((s) => s.setStepApproval)
  const focusArtifact = useRuntimeStore((s) => s.focusArtifact)
  const Editor = mode === 'edit' ? getToolCardEditor(step.toolName) : null

  const [editedOutput, setEditedOutput] = useState<unknown>(undefined)

  const onApprove = () => {
    if (!session || !taskId) {
      toast.error('Could not find session context for this approval.')
      return
    }
    // Review mode intentionally ignores any edits — the orchestrator
    // passes the raw output through. For parity we still send `undefined`
    // so setStepApproval's "approve as-is" branch kicks in.
    const payload =
      mode === 'edit' && editedOutput !== undefined ? editedOutput : undefined
    // Some tools represent an artifact mutation (LaTeX selection edits,
    // compile-error fixes, figure inserts, citation ops). The orchestrator
    // feeds the approved output back to the LLM but does NOT touch the
    // artifact — applier-registry fills that gap so the mutation lands
    // on the actual artifact before the next agent turn observes it.
    const applier = getToolApplier(step.toolName)
    if (applier) {
      try {
        applier(session.id, payload ?? step.output)
      } catch (err) {
        // Don't block approval on applier failure — orchestrator still
        // advances, and the user sees a toast.
        toast.error(
          `Apply failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    setStepApproval(session.id, taskId, step.id, 'approved', payload)
  }

  const onReject = () => {
    if (!session || !taskId) {
      toast.error('Could not find session context for this approval.')
      return
    }
    setStepApproval(session.id, taskId, step.id, 'rejected')
  }

  const onOpenArtifact = () => {
    if (!primaryArtifactId || !session) {
      toast.info('No artifact attached to this step to open.')
      return
    }
    focusArtifact(session.id, primaryArtifactId)
  }

  return (
    <div className="agent-card-pending">
      {Editor ? (
        <Editor step={step} onChange={(edited) => setEditedOutput(edited)} />
      ) : null}
      <div className="agent-card-actions">
        <Button
          variant="primary"
          size="sm"
          leading={<Check size={12} />}
          onClick={onApprove}
          className="agent-card-btn agent-card-btn-approve"
        >
          Approve
        </Button>
        <Button
          variant="danger"
          size="sm"
          leading={<X size={12} />}
          onClick={onReject}
          className="agent-card-btn agent-card-btn-reject"
        >
          Reject
        </Button>
        {isProArtifact && onOpenWorkbench && primaryArtifactId && session ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenWorkbench(session.id, primaryArtifactId)}
            className="agent-card-btn"
          >
            Open workbench ↗
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenArtifact}
            disabled={!primaryArtifactId}
            className="agent-card-btn"
          >
            Focus artifact
          </Button>
        )}
      </div>
    </div>
  )
}
