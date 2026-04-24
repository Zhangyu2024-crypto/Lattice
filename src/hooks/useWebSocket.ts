import { useEffect, useRef } from 'react'
import { wsClient } from '../stores/ws-client'
import { useAppStore } from '../stores/app-store'
import { useRuntimeStore } from '../stores/runtime-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useEditorStore } from '../stores/editor-store'
import {
  persistChatMessage,
  persistChatMessageUpdate,
  persistPeaksUpdate,
  persistSpectrumUpdate,
} from '../lib/workspace/persist-ws-events'
import type {
  Artifact,
  PeakFitPayload,
  SpectrumPayload,
} from '../types/artifact'
import type {
  TaskStatus,
  TaskStepKind,
  TaskStepStatus,
  TranscriptMessage,
  TranscriptRole,
} from '../types/session'

// Phase 6: once-per-session warn when a WS push lands but no workspace is
// selected. In the new workspace-first model every persistent write needs a
// root folder; the legacy session-store fallback is gone.
const warnedEvents = new Set<string>()
const warnNoWorkspaceOnce = (event: string): void => {
  if (warnedEvents.has(event)) return
  warnedEvents.add(event)
  console.warn(
    `[ws] ${event}: no workspace selected, dropping push. ` +
      'Pick a workspace folder via the Explorer to persist backend events.',
  )
}

/**
 * True when the string opens with a JSON literal character. We use this
 * to detect the orchestrator's `summarizeToolOutput` wire fallback so we
 * can drop the blob instead of rendering it as if it were a human-written
 * summary. Duplicated in `AgentCard.looksLikeJsonBlob` — kept local to
 * avoid a cross-layer import.
 */
const looksLikeJsonLiteral = (value: string): boolean => {
  const trimmed = value.trimStart()
  if (trimmed.length === 0) return false
  const first = trimmed[0]
  return first === '{' || first === '[' || first === '"'
}

const mapBackendStatus = (backendStatus?: string): TaskStepStatus => {
  switch (backendStatus) {
    case 'planned':
      return 'planned'
    case 'done':
    case 'success':
    case 'succeeded':
      return 'succeeded'
    case 'error':
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'skipped'
    default:
      return 'running'
  }
}

const mapTaskStatus = (backendStatus?: string): TaskStatus => {
  switch (backendStatus) {
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    case 'error':
    case 'failed':
      return 'failed'
    case 'done':
    case 'success':
    case 'succeeded':
      return 'succeeded'
    default:
      return 'running'
  }
}

const mapPlanKind = (rawKind: unknown, toolName?: string | null): TaskStepKind => {
  if (rawKind === 'reasoning') return 'reasoning'
  if (rawKind === 'summary') return 'summary'
  if (
    rawKind === 'tool' ||
    rawKind === 'tool_call' ||
    rawKind === 'action' ||
    typeof toolName === 'string'
  ) {
    return 'tool_call'
  }
  return 'plan'
}

// Defensive shape guards — a misbehaving backend should never crash the
// renderer. Non-object event payloads degrade to `{}` and non-array lists
// degrade to `[]`.
const asObject = (v: unknown): Record<string, any> => {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {}
}

const asArray = <T = unknown,>(v: unknown): T[] => {
  return Array.isArray(v) ? (v as T[]) : []
}

const eventData = (event: unknown): unknown => {
  const obj = asObject(event)
  return Object.prototype.hasOwnProperty.call(obj, 'data') ? obj.data : event
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const toTimestampMs = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Date.now()
  // Backend timestamps are historically seconds; tolerate either unit.
  return value > 1_000_000_000_000 ? value : value * 1000
}

const truncateLabel = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed
}

const ensureActiveSession = (): string => {
  const store = useRuntimeStore.getState()
  if (store.activeSessionId) return store.activeSessionId
  return store.createSession({ title: 'Session 1' })
}

const resolveLocalSessionId = (preferred?: unknown): string => {
  const store = useRuntimeStore.getState()
  if (typeof preferred === 'string' && store.sessions[preferred]) return preferred
  return ensureActiveSession()
}

const makeBackendStepKey = (backendTaskId: string, backendStepId: string): string =>
  `${backendTaskId}::${backendStepId}`

const normalizeArtifact = (raw: unknown): Artifact | null => {
  const obj = asObject(raw)
  const id = stringOrNull(obj.id)
  const kind = stringOrNull(obj.kind)
  const title = stringOrNull(obj.title)
  if (!id || !kind || !title || !Object.prototype.hasOwnProperty.call(obj, 'payload')) {
    return null
  }
  const now = Date.now()
  return {
    ...obj,
    id,
    kind,
    title,
    createdAt:
      typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt)
        ? obj.createdAt
        : now,
    updatedAt:
      typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
        ? obj.updatedAt
        : now,
    payload: obj.payload,
  } as Artifact
}

export function useWebSocket() {
  const backendReady = useAppStore((s) => s.backend.ready)
  const backendPort = useAppStore((s) => s.backend.port)
  const backendToken = useAppStore((s) => s.backend.token)
  const setConnected = useAppStore((s) => s.setConnected)
  const updateStatus = useAppStore((s) => s.updateStatus)

  const stepByMessageId = useRef(
    new Map<string, { sessionId: string; taskId: string; stepId: string }>(),
  )
  const taskByBackendId = useRef(
    new Map<string, { sessionId: string; taskId: string }>(),
  )
  const stepByBackendId = useRef(
    new Map<string, { sessionId: string; taskId: string; stepId: string }>(),
  )
  const summaryMessageByBackendStep = useRef(
    new Map<string, { sessionId: string; messageId: string }>(),
  )
  // Per-task record of which artifact ids have already produced a
  // "Generated N artifact(s)" transcript bubble. Research-style flows
  // (plan_outline → draft_section × N → finalize) re-emit tool_result
  // frames that all point at the *same* artifact; without this gate the
  // chat shows "Generated 1 artifact" + the same Report card N times.
  const announcedArtifactsByTask = useRef(new Map<string, Set<string>>())
  const sawStructuredProtocol = useRef(false)

  useEffect(() => {
    const bindTranscriptTask = (
      sessionId: string,
      messageId: string | null,
      taskId: string,
    ) => {
      if (!messageId) return
      const session = useRuntimeStore.getState().sessions[sessionId]
      if (!session?.transcript.some((msg) => msg.id === messageId)) return
      useRuntimeStore.getState().updateTranscriptMessage(sessionId, messageId, {
        taskId,
      })
    }

    const ensureTask = (opts: {
      backendTaskId?: string | null
      sessionHint?: unknown
      title?: string | null
      rootMessageId?: string | null
    }): { sessionId: string; taskId: string } => {
      const { backendTaskId, sessionHint, title, rootMessageId } = opts
      if (backendTaskId) {
        const existing = taskByBackendId.current.get(backendTaskId)
        if (existing) {
          bindTranscriptTask(existing.sessionId, rootMessageId ?? null, existing.taskId)
          return existing
        }
      }
      const sessionId = resolveLocalSessionId(sessionHint)
      const taskId = useRuntimeStore.getState().startTask(sessionId, {
        title: title ?? 'Agent Task',
        rootMessageId: rootMessageId ?? undefined,
      })
      if (backendTaskId) {
        taskByBackendId.current.set(backendTaskId, { sessionId, taskId })
      }
      bindTranscriptTask(sessionId, rootMessageId ?? null, taskId)
      return { sessionId, taskId }
    }

    const ensureStep = (opts: {
      sessionId: string
      taskId: string
      backendTaskId?: string | null
      backendStepId?: string | null
      kind: TaskStepKind
      label: string
      toolName?: string | null
      inputSummary?: string | null
      /** Phase 1 · raw tool input args, threaded from the WS event so
       *  tool cards can render the structured parameters the LLM
       *  invoked the tool with. */
      input?: unknown
      status?: TaskStepStatus
    }): { sessionId: string; taskId: string; stepId: string } => {
      const {
        sessionId,
        taskId,
        backendTaskId,
        backendStepId,
        kind,
        label,
        toolName,
        inputSummary,
        input,
        status,
      } = opts
      const key =
        backendTaskId && backendStepId
          ? makeBackendStepKey(backendTaskId, backendStepId)
          : null
      if (key) {
        const existing = stepByBackendId.current.get(key)
        if (existing) return existing
      }
      const stepId = useRuntimeStore.getState().appendStep(sessionId, taskId, {
        kind,
        label,
        toolName: toolName ?? undefined,
        inputSummary: inputSummary ?? undefined,
        input,
        status,
        // Persist the backend id on the step so the Phase α approval
        // bridge (session-store → agent-orchestrator-approvals) can find
        // the orchestrator-side pending promise when the user clicks
        // approve / reject on the ToolCallCard.
        backendStepId: backendStepId ?? undefined,
      })
      const created = { sessionId, taskId, stepId }
      if (key) stepByBackendId.current.set(key, created)
      return created
    }

    const upsertToolResultMessage = (opts: {
      sessionId: string
      taskId: string
      backendTaskId?: string | null
      backendStepId?: string | null
      content?: string | null
      artifactIds: string[]
    }) => {
      const { sessionId, taskId, backendTaskId, backendStepId, content, artifactIds } = opts
      // The caller passes through `output_summary`, which for structured
      // tool outputs is a truncated `JSON.stringify(...)` blob. Quoting
      // that verbatim into the transcript reads as `Art 1 / {"outputRelPath":
      // "...","format":"png",…}` — wire noise masquerading as an assistant
      // reply. Treat JSON-shaped summaries as "no human content" so the
      // artifact-count fallback fires instead.
      const trimmedContent = content?.trim() ?? ''
      const humanContent =
        trimmedContent.length > 0 && !looksLikeJsonLiteral(trimmedContent)
          ? trimmedContent
          : null

      // De-dupe artifact-only bubbles. A research flow patches the same
      // research-report artifact across 6–7 tool calls; each tool_result
      // would otherwise spawn a fresh "Generated 1 artifact" row pointing
      // at the same card. Filter out any artifact id we've already
      // announced in this task so follow-up patches stay quiet.
      let announced = announcedArtifactsByTask.current.get(taskId)
      if (!announced) {
        announced = new Set<string>()
        announcedArtifactsByTask.current.set(taskId, announced)
      }
      const freshArtifactIds = artifactIds.filter((id) => !announced!.has(id))
      if (!humanContent && freshArtifactIds.length === 0) return

      const key =
        backendTaskId && backendStepId
          ? makeBackendStepKey(backendTaskId, backendStepId)
          : `task_${taskId}_${Date.now()}`
      const existing = summaryMessageByBackendStep.current.get(key)
      const bubbleArtifactIds = freshArtifactIds.length > 0 ? freshArtifactIds : []
      const nextContent =
        humanContent ??
        (bubbleArtifactIds.length === 1
          ? 'Generated 1 artifact.'
          : `Generated ${bubbleArtifactIds.length} artifacts.`)
      if (existing) {
        useRuntimeStore.getState().updateTranscriptMessage(sessionId, existing.messageId, {
          content: nextContent,
          timestamp: Date.now(),
          taskId,
          artifactRefs:
            bubbleArtifactIds.length > 0 ? bubbleArtifactIds : undefined,
        })
        for (const id of bubbleArtifactIds) announced.add(id)
        return
      }
      const messageId = `toolmsg_${key.replace(/[^a-zA-Z0-9_:-]/g, '_')}`
      useRuntimeStore.getState().appendTranscript(sessionId, {
        id: messageId,
        role: 'assistant',
        content: nextContent,
        timestamp: Date.now(),
        taskId,
        artifactRefs:
          bubbleArtifactIds.length > 0 ? bubbleArtifactIds : undefined,
      })
      summaryMessageByBackendStep.current.set(key, { sessionId, messageId })
      for (const id of bubbleArtifactIds) announced.add(id)
    }

    const finalizeTask = (backendTaskId: string | null, backendStatus?: string) => {
      if (!backendTaskId) return
      const mapping = taskByBackendId.current.get(backendTaskId)
      if (!mapping) return
      const store = useRuntimeStore.getState()
      const task = store.sessions[mapping.sessionId]?.tasks[mapping.taskId]
      if (!task) return
      const taskStatus = mapTaskStatus(backendStatus)
      const terminalStepStatus: TaskStepStatus =
        taskStatus === 'failed'
          ? 'failed'
          : taskStatus === 'cancelled'
            ? 'skipped'
            : 'succeeded'
      for (const step of task.steps) {
        if (step.status !== 'running' && step.status !== 'planned') continue
        store.updateStep(mapping.sessionId, mapping.taskId, step.id, {
          status: step.status === 'planned' ? 'skipped' : terminalStepStatus,
          endedAt: Date.now(),
        })
      }
      store.endTask(mapping.sessionId, mapping.taskId, taskStatus)
    }

    const onStructuredEvent = () => {
      sawStructuredProtocol.current = true
    }

    const unsubs: Array<() => void> = []
    const bind = (event: string, handler: (payload: any) => void) => {
      unsubs.push(wsClient.on(event, handler))
    }

    bind('connection', (e) => {
      setConnected(Boolean(asObject(e).connected))
    })

    bind('status_update', (e) => {
      updateStatus(asObject(eventData(e)))
    })

    bind('task_start', (e) => {
      onStructuredEvent()
      const raw = asObject(eventData(e))
      ensureTask({
        backendTaskId: stringOrNull(raw.task_id),
        sessionHint: raw.session_id,
        title: stringOrNull(raw.title) ?? 'Agent Task',
        rootMessageId: stringOrNull(raw.root_message_id),
      })
    })

    bind('agent_plan', (e) => {
      onStructuredEvent()
      const raw = asObject(eventData(e))
      const backendTaskId = stringOrNull(raw.task_id)
      const { sessionId, taskId } = ensureTask({
        backendTaskId,
        sessionHint: raw.session_id,
        title: stringOrNull(raw.title) ?? 'Agent Task',
        rootMessageId: stringOrNull(raw.root_message_id),
      })
      const steps = asArray<Record<string, any>>(raw.steps)
      for (const step of steps) {
        const toolName = stringOrNull(step.tool) ?? stringOrNull(step.tool_name)
        ensureStep({
          sessionId,
          taskId,
          backendTaskId,
          backendStepId: stringOrNull(step.step_id) ?? stringOrNull(step.id),
          kind: mapPlanKind(step.kind, toolName),
          label:
            stringOrNull(step.label) ??
            toolName ??
            'Planned step',
          toolName,
          inputSummary: stringOrNull(step.input) ?? stringOrNull(step.input_summary),
          status: 'planned',
        })
      }
    })

    bind('agent_reasoning', (e) => {
      onStructuredEvent()
      const raw = asObject(eventData(e))
      const content = stringOrNull(raw.content)
      if (!content) return
      const backendTaskId = stringOrNull(raw.task_id)
      const backendStepId = stringOrNull(raw.step_id) ?? stringOrNull(raw.id)
      const { sessionId, taskId } = ensureTask({
        backendTaskId,
        sessionHint: raw.session_id,
        title: 'Agent Task',
      })
      const resolved = ensureStep({
        sessionId,
        taskId,
        backendTaskId,
        backendStepId,
        kind: 'reasoning',
        label: truncateLabel(content, 'Reasoning'),
        inputSummary: content,
        status: mapBackendStatus(raw.status),
      })
      const nextStatus =
        raw.done === true || raw.final === true
          ? 'succeeded'
          : mapBackendStatus(raw.status)
      useRuntimeStore.getState().updateStep(sessionId, taskId, resolved.stepId, {
        label: truncateLabel(content, 'Reasoning'),
        outputSummary: content,
        status: nextStatus,
        endedAt: nextStatus !== 'running' ? Date.now() : undefined,
      })
    })

    bind('tool_invocation', (e) => {
      onStructuredEvent()
      const raw = asObject(eventData(e))
      const backendTaskId = stringOrNull(raw.task_id)
      const backendStepId = stringOrNull(raw.step_id) ?? stringOrNull(raw.id)
      const toolName = stringOrNull(raw.tool_name) ?? stringOrNull(raw.tool)
      const inputSummary =
        stringOrNull(raw.input_summary) ??
        (typeof raw.input === 'string' ? raw.input : null) ??
        (raw.input ? JSON.stringify(raw.input) : null)
      // Phase 1 · prefer the structured `input` payload when present so
      // cards can render actual arg values; fall back to `undefined` so
      // callers (e.g. legacy mock streams that only ship `input_summary`)
      // don't overwrite an earlier richer record with noise.
      const rawInput: unknown =
        raw.input !== undefined && typeof raw.input !== 'string'
          ? raw.input
          : undefined
      const { sessionId, taskId } = ensureTask({
        backendTaskId,
        sessionHint: raw.session_id,
        title: 'Agent Task',
      })
      const resolved = ensureStep({
        sessionId,
        taskId,
        backendTaskId,
        backendStepId,
        kind: 'tool_call',
        label: toolName ?? 'tool',
        toolName,
        inputSummary,
        input: rawInput,
        status: 'running',
      })
      useRuntimeStore.getState().updateStep(sessionId, taskId, resolved.stepId, {
        label: toolName ?? 'tool',
        toolName: toolName ?? undefined,
        inputSummary: inputSummary ?? undefined,
        // Only patch `input` when we actually received a structured
        // payload — a subsequent `tool_invocation` without one (e.g.
        // re-emitted by a helper) must not clobber a previously set
        // record.
        ...(rawInput !== undefined ? { input: rawInput } : {}),
        status: 'running',
      })
    })

    bind('tool_result', (e) => {
      onStructuredEvent()
      const raw = asObject(eventData(e))
      const backendTaskId = stringOrNull(raw.task_id)
      const backendStepId = stringOrNull(raw.step_id) ?? stringOrNull(raw.id)
      const toolName = stringOrNull(raw.tool_name) ?? stringOrNull(raw.tool)
      const outputSummary =
        stringOrNull(raw.output_summary) ??
        (typeof raw.output === 'string' ? raw.output : null)
      // Mirror the `tool_invocation` handler: capture the structured
      // payload so tool-specific card previews can read `step.output`.
      // Skip strings (they're already in `outputSummary`).
      const rawOutput: unknown =
        raw.output !== undefined && typeof raw.output !== 'string'
          ? raw.output
          : undefined
      const artifactIds = asArray<string>(raw.artifact_ids).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
      const { sessionId, taskId } = ensureTask({
        backendTaskId,
        sessionHint: raw.session_id,
        title: 'Agent Task',
      })
      const resolved = ensureStep({
        sessionId,
        taskId,
        backendTaskId,
        backendStepId,
        kind: 'tool_call',
        label: toolName ?? 'tool',
        toolName,
        status: mapBackendStatus(raw.status),
      })
      const nextStatus = mapBackendStatus(raw.status)
      useRuntimeStore.getState().updateStep(sessionId, taskId, resolved.stepId, {
        label: toolName ?? 'tool',
        status: nextStatus,
        outputSummary: outputSummary ?? undefined,
        ...(rawOutput !== undefined ? { output: rawOutput } : {}),
        artifactRef: artifactIds[0],
        endedAt: nextStatus !== 'running' ? Date.now() : undefined,
      })
      upsertToolResultMessage({
        sessionId,
        taskId,
        backendTaskId,
        backendStepId,
        content: outputSummary,
        artifactIds,
      })
    })

    // Phase α — post-execution approval gate. The orchestrator emits this
    // after a tool with `approvalPolicy: 'require'` finishes, and blocks
    // on a promise that session-store's `setStepApproval` resolves via
    // the shared `agent-orchestrator-approvals` bridge.
    bind('approval_required', (e) => {
      onStructuredEvent()
      const raw = asObject(eventData(e))
      const backendTaskId = stringOrNull(raw.task_id)
      const backendStepId = stringOrNull(raw.step_id) ?? stringOrNull(raw.id)
      if (!backendStepId) return
      const toolName = stringOrNull(raw.tool_name) ?? stringOrNull(raw.tool)
      const outputSummary = stringOrNull(raw.output_summary)
      const { sessionId, taskId } = ensureTask({
        backendTaskId,
        sessionHint: raw.session_id,
        title: 'Agent Task',
      })
      const resolved = ensureStep({
        sessionId,
        taskId,
        backendTaskId,
        backendStepId,
        kind: 'tool_call',
        label: toolName ?? 'tool',
        toolName,
        status: 'succeeded',
      })
      useRuntimeStore.getState().updateStep(sessionId, taskId, resolved.stepId, {
        approvalState: 'pending',
        output: raw.output,
        outputSummary: outputSummary ?? undefined,
        // Stamp the backend id so setStepApproval can wake the orchestrator
        // even for a step that was first observed here (not via ensureStep's
        // map seed). ensureStep already ensures the key is in the map but
        // the step record itself needs the id persisted for the action's
        // lookup to work after a reload / HMR.
        backendStepId,
      })
    })

    bind('artifact_created', (e) => {
      onStructuredEvent()
      const raw = asObject(eventData(e))
      const artifact = normalizeArtifact(raw.artifact ?? raw)
      if (!artifact) return
      const sessionId = resolveLocalSessionId(raw.session_id)
      useRuntimeStore.getState().upsertArtifact(sessionId, artifact)
    })

    bind('artifact_updated', (e) => {
      onStructuredEvent()
      const raw = asObject(eventData(e))
      const sessionId = resolveLocalSessionId(raw.session_id)
      const artifactId = stringOrNull(raw.artifact_id)
      if (!artifactId) return
      useRuntimeStore.getState().patchArtifact(sessionId, artifactId, asObject(raw.patch))
    })

    bind('task_end', (e) => {
      onStructuredEvent()
      const raw = asObject(eventData(e))
      finalizeTask(stringOrNull(raw.task_id), stringOrNull(raw.status) ?? undefined)
    })

    bind('spectrum_update', (e) => {
      const data = asObject(eventData(e))
      const payload: SpectrumPayload = {
        x: asArray<number>(data.x),
        y: asArray<number>(data.y),
        xLabel: typeof data.xLabel === 'string'
          ? data.xLabel
          : typeof data.x_label === 'string'
            ? data.x_label
            : 'x',
        yLabel: typeof data.yLabel === 'string'
          ? data.yLabel
          : typeof data.y_label === 'string'
            ? data.y_label
            : 'y',
        spectrumType: typeof data.type === 'string' ? data.type : null,
        processingChain: asArray<string>(data.processingChain),
      }
      const file =
        typeof data.file === 'string'
          ? data.file
          : typeof data.filename === 'string'
            ? data.filename
            : null

      const workspace = useWorkspaceStore.getState()
      if (!workspace.rootPath) {
        warnNoWorkspaceOnce('spectrum_update')
        return
      }
      // Persist as a workspace envelope. The editor autosurfaces the new
      // file when no tab is open.
      void (async () => {
        try {
          const fs = workspace.getFs()
          const relPath = await persistSpectrumUpdate(fs, payload, {
            sourceFile: file,
          })
          await useWorkspaceStore.getState().refreshDir('raw')
          const editor = useEditorStore.getState()
          if (Object.keys(editor.openFiles).length === 0) {
            editor.openFile(relPath)
          }
        } catch (err) {
          console.error('[ws] persistSpectrumUpdate failed', err)
        }
      })()
    })

    bind('peaks_update', (e) => {
      // `peaks_update` is historically a bare array of peak records; some
      // emitters nest peaks under a `{ peaks, source_file, ... }` object.
      // Accept both shapes.
      const raw = eventData(e)
      const peaksSource = Array.isArray(raw)
        ? raw
        : asArray<Record<string, any>>(asObject(raw).peaks)
      const envelope = Array.isArray(raw) ? {} : asObject(raw)
      const sourceFileHint =
        typeof envelope.source_file === 'string'
          ? envelope.source_file
          : typeof envelope.sourceFile === 'string'
            ? envelope.sourceFile
            : typeof envelope.file === 'string'
              ? envelope.file
              : null
      const peaks = peaksSource.map((rawPeak, i) => {
        const p = asObject(rawPeak)
        return {
          index: typeof p.index === 'number' ? p.index : i,
          position: typeof p.position === 'number' ? p.position : 0,
          intensity: typeof p.intensity === 'number' ? p.intensity : 0,
          fwhm: typeof p.fwhm === 'number' ? p.fwhm : null,
          area: typeof p.area === 'number' ? p.area : null,
          snr: typeof p.snr === 'number' ? p.snr : null,
          label: typeof p.label === 'string' ? p.label : '',
        }
      })

      const workspace = useWorkspaceStore.getState()
      if (!workspace.rootPath) {
        warnNoWorkspaceOnce('peaks_update')
        return
      }
      // Derive the spectrum-rel hint from the currently focused editor tab
      // when it's a `.spectrum.json`, so a peak fit lands next to its
      // spectrum by default (`raw/foo.spectrum.json` → `analysis/foo.peakfit.json`).
      let spectrumRel: string | null = null
      const editor = useEditorStore.getState()
      for (const group of editor.groups) {
        const tab = group.activeTab
        if (tab && tab.toLowerCase().endsWith('.spectrum.json')) {
          spectrumRel = tab
          break
        }
      }
      const payload: PeakFitPayload = {
        spectrumId: null,
        algorithm: 'auto',
        peaks,
      }
      void (async () => {
        try {
          const fs = workspace.getFs()
          const relPath = await persistPeaksUpdate(fs, payload, {
            sourceFile: sourceFileHint,
            spectrumRel,
          })
          await useWorkspaceStore.getState().refreshDir('analysis')
          const editor = useEditorStore.getState()
          if (Object.keys(editor.openFiles).length === 0) {
            editor.openFile(relPath)
          }
        } catch (err) {
          console.error('[ws] persistPeaksUpdate failed', err)
        }
      })()
    })

    bind('chat_message', (e) => {
      const msg = asObject(eventData(e))
      const id = stringOrNull(msg.id)
      if (!id) return
      const timestamp = toTimestampMs(msg.timestamp)

      // Phase 4b new path: when a chat file is focused and a workspace is
      // active, persist transcript bubbles as streaming updates to the
      // `.chat.json` envelope. Step / reasoning / tool_call frames still
      // flow to session-store (they're not part of the chat file's
      // transcript shape). We match the session-store branch's guard
      // against duplicate tool_call / thinking frames so the new path
      // doesn't render them as regular bubbles either.
      if (
        sawStructuredProtocol.current &&
        (msg.msg_type === 'tool_call' ||
          msg.msg_type === 'thinking' ||
          msg.msg_type === 'reasoning')
      ) {
        return
      }

      // Legacy-protocol step frames (tool_call / thinking / reasoning shipped
      // inside a chat_message envelope) are dropped in Phase 6. The
      // structured protocol delivers the same information through
      // `tool_invocation` / `agent_reasoning`, which the agent runtime
      // records directly into session-store's task system.
      if (
        msg.msg_type === 'tool_call' ||
        msg.msg_type === 'thinking' ||
        msg.msg_type === 'reasoning'
      ) {
        return
      }

      const activeChatRel = useEditorStore.getState().activeChatFile
      const workspace = useWorkspaceStore.getState()
      if (!activeChatRel || !workspace.rootPath) {
        warnNoWorkspaceOnce('chat_message')
        return
      }

      const role: TranscriptRole =
        msg.role === 'user' || msg.role === 'system'
          ? (msg.role as TranscriptRole)
          : 'assistant'
      const transcriptMessage: TranscriptMessage = {
        id,
        role,
        content: typeof msg.content === 'string' ? msg.content : '',
        timestamp,
      }
      const statusStr =
        typeof msg.status === 'string' ? msg.status : undefined
      const isComplete =
        statusStr === undefined ||
        mapBackendStatus(statusStr) !== 'running'
      const fs = workspace.getFs()
      void (async () => {
        try {
          await persistChatMessage(
            fs,
            activeChatRel,
            transcriptMessage,
            () =>
              useWorkspaceStore.getState().dirtyBuffer[activeChatRel]?.data,
            (d) =>
              useWorkspaceStore.getState().setDirty(activeChatRel, d),
            () => useWorkspaceStore.getState().clearDirty(activeChatRel),
            isComplete,
          )
          if (isComplete) {
            const slash = activeChatRel.lastIndexOf('/')
            const parent = slash < 0 ? '' : activeChatRel.slice(0, slash)
            await useWorkspaceStore.getState().refreshDir(parent)
          }
        } catch (err) {
          console.error('[ws] persistChatMessage failed', err)
        }
      })()
    })

    bind('chat_message_update', (e) => {
      const updates = asObject(eventData(e))
      const id = stringOrNull(updates.id)
      if (!id) return

      // Two overlapping concerns share this event:
      //   (a) streaming transcript bubbles — the backend pushes either an
      //       incremental `content_delta` (accumulate) or a terminal
      //       `content` (replace); neither is documented as mutually
      //       exclusive so we defensively handle both. See
      //       `TranscriptMessage.status` JSDoc for the open protocol note.
      //   (b) per-step `tool_call`/`thinking` status mutations — routed via
      //       `stepByMessageId` populated in the `chat_message` handler.
      // A single update may touch either path but not typically both; keep
      // the branches independent so a missing stepByMessageId entry never
      // blocks a legitimate transcript delta.
      const contentDelta =
        typeof updates.content_delta === 'string' ? updates.content_delta : null
      const contentReplace =
        typeof updates.content === 'string' ? updates.content : null

      const activeChatRel = useEditorStore.getState().activeChatFile
      const workspace = useWorkspaceStore.getState()
      if (!activeChatRel || !workspace.rootPath) {
        warnNoWorkspaceOnce('chat_message_update')
        return
      }
      const fs = workspace.getFs()
      // Resolve whether the frame is terminal. Protocol contract: a terminal
      // frame carries `content` OR an explicit non-running status AND no
      // `content_delta`. Pure deltas keep the bubble in 'streaming'.
      const statusStr =
        typeof updates.status === 'string' ? updates.status : undefined
      const statusIsTerminal =
        statusStr !== undefined && mapBackendStatus(statusStr) !== 'running'
      const isComplete =
        (contentReplace !== null && contentDelta === null) ||
        (contentDelta === null &&
          contentReplace === null &&
          statusIsTerminal)

      // Compose the patch. `content_delta` requires reading the buffered
      // message's current content to compute the accumulated string; we
      // resolve that inside the async IIFE so we see the latest state.
      void (async () => {
        try {
          const bufferedRaw =
            useWorkspaceStore.getState().dirtyBuffer[activeChatRel]?.data
          let currentContent = ''
          if (
            bufferedRaw &&
            typeof bufferedRaw === 'object' &&
            Array.isArray((bufferedRaw as any).messages)
          ) {
            const msg = (bufferedRaw as any).messages.find(
              (m: any) => m?.id === id,
            )
            if (msg && typeof msg.content === 'string') {
              currentContent = msg.content
            }
          }
          const patch: Partial<TranscriptMessage> = {}
          if (contentDelta !== null && contentDelta.length > 0) {
            patch.content = currentContent + contentDelta
            patch.status = 'streaming'
          } else if (contentReplace !== null) {
            patch.content = contentReplace
            patch.status = 'complete'
          } else if (statusIsTerminal) {
            patch.status = 'complete'
          }
          if (Object.keys(patch).length === 0) return

          await persistChatMessageUpdate(
            fs,
            activeChatRel,
            id,
            patch,
            () =>
              useWorkspaceStore.getState().dirtyBuffer[activeChatRel]?.data,
            (d) =>
              useWorkspaceStore.getState().setDirty(activeChatRel, d),
            () => useWorkspaceStore.getState().clearDirty(activeChatRel),
            isComplete,
          )
          if (isComplete) {
            const slash = activeChatRel.lastIndexOf('/')
            const parent = slash < 0 ? '' : activeChatRel.slice(0, slash)
            await useWorkspaceStore.getState().refreshDir(parent)
          }
        } catch (err) {
          console.error('[ws] persistChatMessageUpdate failed', err)
        }
      })()
    })

    bind('workspace_update', (e) => {
      const workspace = useWorkspaceStore.getState()
      if (!workspace.rootPath) {
        warnNoWorkspaceOnce('workspace_update')
        return
      }
      const list = asArray<unknown>(eventData(e))
      // Treat the push as a refresh hint. Collect unique parent directories
      // so we only hit the fs once per dir, even when the backend pushes
      // dozens of sibling files.
      const dirsToRefresh = new Set<string>()
      for (const raw of list) {
        const file = asObject(raw)
        const relPath =
          typeof file.relPath === 'string'
            ? file.relPath
            : typeof file.rel_path === 'string'
              ? file.rel_path
              : typeof raw === 'string'
                ? raw
                : null
        if (!relPath) continue
        const normalized = relPath.replace(/^\/+|\/+$/g, '')
        const slash = normalized.lastIndexOf('/')
        const parent = slash < 0 ? '' : normalized.slice(0, slash)
        dirsToRefresh.add(parent)
      }
      if (list.length === 0) dirsToRefresh.add('')
      void (async () => {
        for (const dir of dirsToRefresh) {
          try {
            await useWorkspaceStore.getState().refreshDir(dir)
          } catch (err) {
            console.error('[ws] workspace_update refresh failed', dir, err)
          }
        }
      })()
    })

    if (backendReady && backendPort && backendToken) {
      wsClient.connect(backendPort, backendToken)
    }

    return () => {
      unsubs.forEach((off) => off())
      wsClient.disconnect()
      stepByMessageId.current.clear()
      taskByBackendId.current.clear()
      stepByBackendId.current.clear()
      summaryMessageByBackendStep.current.clear()
      announcedArtifactsByTask.current.clear()
      sawStructuredProtocol.current = false
    }
  }, [backendReady, backendPort, backendToken, setConnected, updateStatus])
}
