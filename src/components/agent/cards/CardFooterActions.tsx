import { useMemo, useState } from 'react'
import { Ban, Bookmark, Copy } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Artifact } from '../../../types/artifact'
import type { TaskId, TaskStep } from '../../../types/session'
import { selectActiveSession, useRuntimeStore } from '../../../stores/runtime-store'
import { useArtifactDbStore } from '../../../stores/artifact-db-store'
import { toast } from '../../../stores/toast-store'
import { copyText } from '../../../lib/clipboard-helper'

interface Props {
  step: TaskStep
  sessionId: string
  artifact?: Artifact | null
}

const rootStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  borderTop:
    '1px solid color-mix(in srgb, var(--color-border) 70%, transparent)',
  fontSize: 'var(--font-size-xs, 11px)',
}

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 4,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  fontSize: 'inherit',
  lineHeight: 1.4,
  cursor: 'pointer',
}

const rejectedChipStyle: CSSProperties = {
  ...buttonStyle,
  cursor: 'default',
  color: 'var(--color-text-muted)',
  background:
    'color-mix(in srgb, var(--color-red, #dc2626) 10%, transparent)',
  border:
    '1px solid color-mix(in srgb, var(--color-red, #dc2626) 30%, transparent)',
}

export default function CardFooterActions({ step, sessionId, artifact }: Props) {
  const session = useRuntimeStore(selectActiveSession)
  const setStepApproval = useRuntimeStore((s) => s.setStepApproval)
  const rejectCompletedStep = useRuntimeStore(
    (s) =>
      (s as unknown as {
        rejectCompletedStep?: (
          sessionId: string,
          stepId: string,
          reason?: string,
        ) => void
      }).rejectCompletedStep,
  )

  const [locallyRejected, setLocallyRejected] = useState(false)

  const taskId = useMemo<TaskId | null>(() => {
    if (!session) return null
    for (const tid of session.taskOrder) {
      const task = session.tasks[tid]
      if (!task) continue
      if (task.steps.some((s) => s.id === step.id)) return tid
    }
    return null
  }, [session, step.id])

  const isPending = step.approvalState === 'pending'
  const alreadyRejected =
    locallyRejected || step.approvalState === 'rejected'
  const alreadyApproved = step.approvalState === 'approved'

  const onCopyOutput = () =>
    copyText(JSON.stringify(step.output ?? null, null, 2), 'Copied output JSON')

  const onReject = () => {
    if (alreadyRejected) return
    if (isPending) {
      if (!session || !taskId) {
        toast.error('Could not find session context for this step.')
        return
      }
      setStepApproval(session.id, taskId, step.id, 'rejected', undefined)
      setLocallyRejected(true)
      toast.info(
        'Rejected — agent will be asked to reconsider on next turn.',
      )
      return
    }
    if (!rejectCompletedStep) {
      setLocallyRejected(true)
      toast.warn(
        'Reject is not wired yet for completed steps — tracked as Phase 1.',
      )
      return
    }
    rejectCompletedStep(sessionId, step.id)
    setLocallyRejected(true)
    toast.info('Rejected — agent will be asked to reconsider on next turn.')
  }

  return (
    <div
      className="agent-card-footer-actions"
      style={rootStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        style={buttonStyle}
        onClick={onCopyOutput}
        title="Copy raw output JSON to clipboard"
      >
        <Copy size={11} aria-hidden />
        Copy output
      </button>
      {artifact && session ? (
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            void useArtifactDbStore
              .getState()
              .bookmarkArtifact(artifact, session.id, session.title)
              .then(() => toast.success('Bookmarked to database'))
              .catch(() => toast.error('Failed to bookmark'))
          }}
          title="Save to artifact database"
        >
          <Bookmark size={11} aria-hidden />
          Bookmark
        </button>
      ) : null}
      {alreadyRejected ? (
        <span style={rejectedChipStyle} aria-disabled title="Already rejected">
          <Ban size={11} aria-hidden />
          Rejected
        </span>
      ) : isPending && !alreadyApproved ? (
        <button
          type="button"
          style={buttonStyle}
          onClick={onReject}
          title="Reject this pending step"
        >
          <Ban size={11} aria-hidden />
          Reject
        </button>
      ) : null}
    </div>
  )
}
