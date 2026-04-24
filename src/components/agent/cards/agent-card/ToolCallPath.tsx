// Tool-call path for AgentCard — renders a TaskStep as an inline card
// inside an assistant bubble. Extracted from AgentCard.tsx; behaviour is
// identical. DetailBlock lives alongside because it's a private rendering
// helper used only by this path.

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Info,
  Loader2,
  Wrench,
  X,
} from 'lucide-react'
import type { TaskId, TaskStep } from '../../../../types/session'
import type { MentionRef } from '../../../../types/mention'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../../../stores/runtime-store'
import ArtifactBadge from '../../ArtifactBadge'
import { LOCAL_TOOL_CATALOG } from '../../../../lib/agent-tools'
import { getToolCardEditor } from '../editor-registry'
import CardFooterActions from '../CardFooterActions'
import {
  WORKBENCH_ARTIFACT_KINDS,
  resolveStepPreview,
  type PreviewBlocks,
} from '../preview-registry'
import { pendingHeadline, pendingSubject } from '../pending-headline'
import {
  formatDuration,
  looksLikeJsonBlob,
  mentionArtifactId as resolveMentionArtifactId,
  resolveStepCardMode,
  statusTone,
} from './helpers'
import PendingActions from './PendingActions'

export default function ToolCallPath({
  step,
  onDismiss,
  onOpenWorkbench,
  forceShow,
}: {
  step: TaskStep
  onDismiss?: () => void
  onOpenWorkbench?: (sessionId: string, artifactId: string) => void
  forceShow?: boolean
}) {
  const tool = useMemo(
    () => LOCAL_TOOL_CATALOG.find((t) => t.name === step.toolName),
    [step.toolName],
  )
  const mode = resolveStepCardMode(step, tool)
  const session = useRuntimeStore(selectActiveSession)

  const isRunning = step.status === 'running'
  const isFailed = step.status === 'failed'
  const isPending = step.approvalState === 'pending'
  const tone = statusTone(step.status)
  // Pending overrides tone visuals — a ✓ next to "Awaiting approval" reads
  // as "already done", which is exactly the confusion this redesign is
  // trying to eliminate. Use a neutral question-gate icon instead.
  const StatusIcon = isPending
    ? CircleHelp
    : isRunning
      ? Loader2
      : isFailed
        ? AlertTriangle
        : CheckCircle2

  // Derive the parent taskId lazily — TaskStep doesn't carry it, but we
  // need it to route approval decisions through setStepApproval.
  const taskId = useMemo<TaskId | null>(() => {
    if (!session) return null
    for (const tid of session.taskOrder) {
      const task = session.tasks[tid]
      if (!task) continue
      if (task.steps.some((s) => s.id === step.id)) return tid
    }
    return null
  }, [session, step.id])

  // Artifact ids the step touched — drives the ArtifactBadge row and
  // the Open-Workbench action target.
  const outputArtifactIds = useMemo(
    () =>
      (step.outputMentions ?? [])
        .map((m: MentionRef) => resolveMentionArtifactId(m))
        .filter((id): id is string => Boolean(id)),
    [step.outputMentions],
  )
  const primaryArtifactId = outputArtifactIds[0]
  const primaryArtifact = primaryArtifactId
    ? session?.artifacts[primaryArtifactId]
    : undefined

  // Preview: three-tier fallback — tool-specific resolver → artifact
  // kind preview → plain `outputSummary` one-liner. See
  // `resolveStepPreview` for the contract.
  const preview: PreviewBlocks = useMemo(
    () => resolveStepPreview(step, primaryArtifact),
    [step, primaryArtifact],
  )

  // Pending steps lead with an action verb + subject ("Write file · foo.md")
  // instead of the raw tool name. Non-pending cards keep the original
  // tool-name headline so completed steps read as a stable log entry.
  const headline = isPending
    ? pendingHeadline(step.toolName)
    : step.toolName ?? step.label ?? 'tool'
  const subject = isPending ? pendingSubject(step) : undefined
  const hasEditor = isPending
    ? getToolCardEditor(step.toolName) !== null
    : false
  const duration = formatDuration(step)
  const [userExpanded, setUserExpanded] = useState(false)
  const expanded = isPending || userExpanded

  const isProArtifact = Boolean(
    primaryArtifact && WORKBENCH_ARTIFACT_KINDS.has(primaryArtifact.kind),
  )
  const showOpenWorkbench =
    isProArtifact && Boolean(onOpenWorkbench) && Boolean(primaryArtifactId)

  // Silent steps never render a card inline — they're surfaced through
  // the per-assistant-message audit chip. Callers that DO want to
  // render a silent card (the expanded-chip view) pass `forceShow` to
  // bypass this suppression.
  if (mode === 'silent' && !forceShow) return null

  return (
    <div
      className={
        `agent-card agent-card-tool tone-${tone}` +
        ` is-${mode}` +
        (isPending ? ' is-pending' : ' is-ready') +
        (isRunning ? ' is-running' : '') +
        (isFailed ? ' is-failed' : '')
      }
      data-tool={step.toolName ?? ''}
      data-mode={mode}
    >
      <button
        type="button"
        onClick={() => setUserExpanded((v) => !v)}
        className="agent-card-header"
        // Pending approval pins the card open — disable the toggle so a
        // misleading chevron click doesn't do nothing visible.
        disabled={isPending}
      >
        <ChevronRight
          size={11}
          className={`agent-card-chevron${expanded ? ' is-open' : ''}`}
          aria-hidden
        />
        <StatusIcon
          size={12}
          className={`agent-card-status-icon tone-${tone}${isRunning ? ' is-spinning' : ''}${isPending ? ' is-pending' : ''}`}
          aria-hidden
        />
        <Wrench size={11} className="agent-card-wrench" aria-hidden />
        <span className="agent-card-headline">{headline}</span>
        {isPending ? (
          // Pending lane: lead with the action subject (file path / command
          // / artifact) and the "Pending approval" chip. Skip
          // preview.oneLiner / outputSummary — those describe the
          // *result* of execute(), which for proposal-first tools is the
          // proposal, not something the user has agreed to yet.
          <>
            {subject ? (
              <span className="agent-card-summary" title={subject}>
                · {subject}
              </span>
            ) : null}
            <span className="agent-card-approval-chip">Pending approval</span>
          </>
        ) : preview.oneLiner && !looksLikeJsonBlob(preview.oneLiner) ? (
          <span className="agent-card-summary" title={preview.oneLiner}>
            · {preview.oneLiner}
          </span>
        ) : step.outputSummary && !looksLikeJsonBlob(step.outputSummary) ? (
          <span className="agent-card-summary" title={step.outputSummary}>
            · {step.outputSummary}
          </span>
        ) : isRunning ? (
          <span className="agent-card-summary">· Running…</span>
        ) : null}
        {duration && !isPending ? (
          <span className="agent-card-duration">{duration}</span>
        ) : null}
      </button>

      {isPending ? (
        // Pre-commit banner — clarifies that execute() returning a proposal
        // is NOT the same as the change landing. Without this users read
        // the card as "succeeded, approve after the fact" and either
        // rubber-stamp destructive edits or (rightly) complain.
        <div className="agent-card-pending-banner" role="status">
          <Info size={11} aria-hidden />
          <span>Nothing is applied yet. Approve to commit.</span>
        </div>
      ) : null}
      {expanded ? (
        <div className="agent-card-body">
          {isPending ? (
            // Pending lane: proposal preview + approval actions only.
            // PendingActions internally renders the tool-specific editor
            // (WorkspaceWriteFileEditor, WorkspaceEditFileEditor,
            // DetectPeaksCardEditor, …) when one is registered — in that
            // case the editor IS the proposal view, so we skip
            // preview.compact to avoid stacking a GenericToolCard JSON
            // shape on top of the actual editor. For review-only tools
            // without a custom editor (xps_charge_correct etc.), we fall
            // back to preview.compact so the user still sees *something*
            // about the proposal.
            <>
              {!hasEditor && preview.compact ? (
                <div className="agent-card-preview-compact">
                  {preview.compact}
                </div>
              ) : null}
              <PendingActions
                step={step}
                mode={mode}
                taskId={taskId}
                primaryArtifactId={primaryArtifactId}
                isProArtifact={isProArtifact}
                onOpenWorkbench={onOpenWorkbench}
              />
            </>
          ) : (
            <>
              {/*
                A tool-specific preview (compact / expanded slot) subsumes
                the raw input/output dump — e.g. WorkspaceReadFilePreview
                already shows the file path + contents + size chip, so we
                don't also paste the `{"content":"<N B elided>",…}` JSON
                summary next to it. Only when preview has no body do we
                fall back to the raw DetailBlocks, and even then we skip
                bodies that look like raw JSON blobs so the card can't leak
                tool-wire noise.
              */}
              {!preview.compact && !preview.expanded ? (
                <>
                  {step.inputSummary && !looksLikeJsonBlob(step.inputSummary) ? (
                    <DetailBlock label="Input" body={step.inputSummary} />
                  ) : null}
                  {step.outputSummary &&
                  !looksLikeJsonBlob(step.outputSummary) ? (
                    <DetailBlock label="Output" body={step.outputSummary} />
                  ) : null}
                </>
              ) : null}
              {preview.compact ? (
                <div className="agent-card-preview-compact">
                  {preview.compact}
                </div>
              ) : null}
              {preview.expanded ? (
                <div className="agent-card-preview-expanded">
                  {preview.expanded}
                </div>
              ) : null}
              {outputArtifactIds.length > 0 ? (
                <div className="agent-card-artifacts">
                  {outputArtifactIds.map((id) => (
                    <ArtifactBadge key={id} artifactId={id} />
                  ))}
                </div>
              ) : null}
              {showOpenWorkbench && primaryArtifactId && session ? (
                <div className="agent-card-actions">
                  <button
                    type="button"
                    className="agent-card-btn is-primary"
                    onClick={() =>
                      onOpenWorkbench?.(session.id, primaryArtifactId)
                    }
                  >
                    Open workbench ↗
                  </button>
                  {onDismiss ? (
                    <button
                      type="button"
                      className="agent-card-btn"
                      onClick={onDismiss}
                      aria-label="Dismiss card"
                    >
                      <X size={11} aria-hidden /> Dismiss
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {expanded && session ? (
        <CardFooterActions step={step} sessionId={session.id} artifact={primaryArtifact} />
      ) : null}
    </div>
  )
}

function DetailBlock({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="agent-card-detail-label">{label}</div>
      <pre className="agent-card-detail-body">{body}</pre>
    </div>
  )
}
