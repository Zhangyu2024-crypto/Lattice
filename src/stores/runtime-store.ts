import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { idbGet, idbSet, idbRemove } from '../lib/idb-storage'
import { genShortId } from '../lib/id-gen'
import type {
  Artifact,
  ArtifactId,
  ArtifactKind,
  ComputeCell,
  ComputeCellKind,
  ComputeProHealth,
  ComputeProPayload,
  ComputeProRun,
  PeakFitArtifact,
  PeakFitPayload,
  ProWorkbenchStatus,
  RamanIdArtifact,
  RamanMatch,
  XpsAnalysisArtifact,
  XpsAnalysisPayload,
  XpsFit,
  XpsPeak,
  XpsQuantRow,
  XrdAnalysisArtifact,
  XrdPhase,
} from '../types/artifact'
import type { MentionRef } from '../types/mention'
import type { Mentionable, MentionPreview } from '../types/mention-resolver'
import type {
  AgentTask,
  ConversationMode,
  ConversationResearchState,
  FocusedElementTarget,
  Session,
  SessionFile,
  SessionId,
  StepApprovalState,
  Task,
  TaskId,
  TaskStatus,
  TaskStep,
  TaskStepId,
  TaskStepStatus,
  TranscriptId,
  TranscriptMessage,
} from '../types/session'
import { resolvePendingApproval } from '../lib/agent-orchestrator-approvals'
import { sanitizeRunHistory } from '../lib/pro-run-history'
import type { ProRunRecord } from '../types/artifact'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { fileKindFromName } from '@/lib/workspace/file-kind'

const TRANSCRIPT_MAX = 500
const SPECTRUM_POINTS_MAX_PERSIST = 50_000

// ─── Debounced localStorage wrapper ─────────────────────────────────
// Zustand's `persist` middleware writes to storage on every `set()`. During
// an agent turn the app can easily emit 100+ store writes (WS deltas,
// artifact patches, task steps), each triggering a synchronous
// `JSON.stringify` + `localStorage.setItem` — 10–50 ms of main-thread stall
// per burst. This wrapper coalesces writes into 300 ms windows and flushes
// on visibility loss / unload so no committed state is lost across an app
// close or background transition. A read after a pending write returns the
// pending value so the same tick never observes stale data.
const PERSIST_FLUSH_MS = 300
const pendingWrites = new Map<string, string>()
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null
/** Keys whose blob already outgrew localStorage once and now live in
 *  IndexedDB. Once a key overflows, every subsequent write goes straight
 *  to IDB to avoid the cost (and log noise) of retrying localStorage. */
const idbOverflowKeys = new Set<string>()

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: unknown; code?: unknown }
  if (e.name === 'QuotaExceededError') return true
  if (e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
  // Safari fallback: numeric code 22
  if (e.code === 22) return true
  return false
}

function writeWithOverflow(key: string, value: string): 'ls' | 'idb' | 'failed' {
  if (idbOverflowKeys.has(key)) {
    void idbSet(key, value).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[runtime-store] IDB overflow write failed:', err)
    })
    return 'idb'
  }
  try {
    localStorage.setItem(key, value)
    return 'ls'
  } catch (err) {
    if (!isQuotaError(err)) {
      // eslint-disable-next-line no-console
      console.warn('[runtime-store] localStorage write failed:', err)
      return 'failed'
    }
    // Quota hit — migrate this key to IDB permanently and clear the LS
    // entry so future sync reads return null (the boot pre-warm will
    // copy IDB back into LS on the next cold start).
    idbOverflowKeys.add(key)
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore — LS removeItem rarely throws but belt-and-braces
    }
    void idbSet(key, value).catch((writeErr) => {
      // eslint-disable-next-line no-console
      console.warn('[runtime-store] IDB overflow write failed:', writeErr)
    })
    return 'idb'
  }
}

function flushPendingWrites(): void {
  if (pendingFlushTimer) {
    clearTimeout(pendingFlushTimer)
    pendingFlushTimer = null
  }
  if (pendingWrites.size === 0) return
  for (const [key, value] of pendingWrites) {
    const result = writeWithOverflow(key, value)
    if (result === 'failed') {
      // Keep the pending entry so a later flush can retry.
      return
    }
  }
  pendingWrites.clear()
}
function schedulePendingFlush(): void {
  if (pendingFlushTimer) return
  pendingFlushTimer = setTimeout(flushPendingWrites, PERSIST_FLUSH_MS)
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingWrites)
  window.addEventListener('pagehide', flushPendingWrites)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingWrites()
  })
}

/** Force any pending debounced persist writes to flush synchronously.
 *
 * Needed whenever a freshly-created session/artifact must be visible to a
 * sibling BrowserWindow that hydrates from the same localStorage on spawn —
 * notably before `window.electronAPI.openWorkbenchWindow(...)`. Without the
 * flush, the satellite window hydrates from a snapshot that predates the
 * write and stays stuck on "Loading workbench…" because Zustand's persist
 * subscription doesn't cross window boundaries. */
export function flushRuntimePersist(): void {
  flushPendingWrites()
}
const debouncedLocalStorage: Storage = {
  getItem(key) {
    // In-flight writes take precedence over whatever localStorage has — a
    // read-after-write in the same tick must see its own value.
    if (pendingWrites.has(key)) return pendingWrites.get(key) ?? null
    return localStorage.getItem(key)
  },
  setItem(key, value) {
    pendingWrites.set(key, value)
    schedulePendingFlush()
  },
  removeItem(key) {
    pendingWrites.delete(key)
    localStorage.removeItem(key)
    if (idbOverflowKeys.has(key)) {
      idbOverflowKeys.delete(key)
      void idbRemove(key)
    }
  },
  clear() {
    pendingWrites.clear()
    localStorage.clear()
  },
  key(i) {
    return localStorage.key(i)
  },
  get length() {
    return localStorage.length
  },
}

/**
 * Called once from the app entry BEFORE the React tree renders. Checks
 * whether the runtime-store's persisted blob lives only in IndexedDB
 * (because a previous write overflowed localStorage's ~5 MB cap) and, if
 * so, hydrates it back into localStorage so zustand's synchronous boot
 * sees it. Safe to call unconditionally — a no-op when IDB is empty,
 * unavailable, or localStorage already has the key.
 */
export async function preWarmRuntimePersist(
  key = 'lattice.session',
): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    if (localStorage.getItem(key) !== null) return
    const saved = await idbGet(key)
    if (saved == null || saved.length === 0) return
    try {
      localStorage.setItem(key, saved)
    } catch (err) {
      // Still over quota in some new form — leave the IDB copy in place
      // and mark this key as IDB-resident so the first write after boot
      // doesn't stampede back into localStorage.
      if (isQuotaError(err)) idbOverflowKeys.add(key)
    }
  } catch {
    // Best-effort pre-warm — failure should not block app startup.
  }
}

/**
 * Cap on {@link Session.recentMentions}. 20 is enough to cover a full picker
 * "recent" group (usually 5–8 visible rows) without inflating persisted state
 * when a chatty session accumulates hundreds of @-mentions.
 */
const RECENT_MENTIONS_MAX = 20

// Deep clone helper for artifact payloads. Uses structuredClone where
// available (all modern browsers + Node 17+ + Electron) and falls back to
// JSON round-trip for safety. This matters because spread syntax only
// shallow-copies — mutating a cloned artifact's nested payload arrays would
// otherwise corrupt the original artifact.
const deepClone = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // structuredClone fails on functions / DOM nodes; fall through.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

const LATEX_LOG_TAIL_MAX_PERSIST = 16 * 1024
const FIGURE_SENTINEL = '__LATTICE_FIGURES__'

const pruneArtifactForPersist = (a: Artifact): Artifact => {
  if (a.kind === 'spectrum' && a.payload) {
    const payload = a.payload as unknown as { x: number[]; y: number[] }
    if (Array.isArray(payload.x) && payload.x.length > SPECTRUM_POINTS_MAX_PERSIST) {
      return { ...a, payload: { ...a.payload, x: [], y: [] } as typeof a.payload }
    }
  }
  if (a.kind === 'compute' && a.payload) {
    const stdout = (a.payload as { stdout?: string }).stdout
    if (typeof stdout === 'string' && stdout.includes(FIGURE_SENTINEL)) {
      const idx = stdout.lastIndexOf(FIGURE_SENTINEL)
      return {
        ...a,
        payload: {
          ...a.payload,
          stdout: stdout.slice(0, idx).trimEnd(),
        } as typeof a.payload,
      }
    }
  }
  if (a.kind === 'latex-document' && a.payload) {
    const log = a.payload.logTail
    if (typeof log === 'string' && log.length > LATEX_LOG_TAIL_MAX_PERSIST) {
      return {
        ...a,
        payload: {
          ...a.payload,
          logTail: log.slice(-LATEX_LOG_TAIL_MAX_PERSIST),
        },
      }
    }
  }
  if (
    a.kind === 'xrd-pro' ||
    a.kind === 'xps-pro' ||
    a.kind === 'raman-pro' ||
    a.kind === 'curve-pro'
  ) {
    const history = (a.payload as { runHistory?: ProRunRecord[] }).runHistory
    const next = sanitizeRunHistory(history)
    if (next !== history) {
      // The four Pro-workbench payloads all carry optional `runHistory`
      // via a shared field declaration; the widening cast is needed
      // because TS can't infer through the union's kind narrowing here.
      return {
        ...a,
        payload: { ...a.payload, runHistory: next },
      } as Artifact
    }
  }
  if (a.kind === 'spectrum-pro' && a.payload) {
    // spectrum-pro carries one sub-state per technique; each can have its
    // own `runHistory`. Prune all four branches, return a fresh payload
    // only if any branch actually changed.
    const payload = a.payload
    const xrdNext = sanitizeRunHistory(payload.xrd?.runHistory)
    const xpsNext = sanitizeRunHistory(payload.xps?.runHistory)
    const ramanNext = sanitizeRunHistory(payload.raman?.runHistory)
    const curveNext = sanitizeRunHistory(payload.curve?.runHistory)
    if (
      xrdNext !== payload.xrd?.runHistory ||
      xpsNext !== payload.xps?.runHistory ||
      ramanNext !== payload.raman?.runHistory ||
      curveNext !== payload.curve?.runHistory
    ) {
      return {
        ...a,
        payload: {
          ...payload,
          xrd: { ...payload.xrd, runHistory: xrdNext },
          xps: { ...payload.xps, runHistory: xpsNext },
          raman: { ...payload.raman, runHistory: ramanNext },
          curve: payload.curve
            ? { ...payload.curve, runHistory: curveNext }
            : payload.curve,
        },
      }
    }
  }
  return a
}

const prunedSessionForPersist = (s: Session): Session => ({
  ...s,
  transcript: s.transcript.slice(-TRANSCRIPT_MAX),
  artifacts: Object.fromEntries(
    Object.entries(s.artifacts).map(([id, a]) => [id, pruneArtifactForPersist(a)]),
  ),
  tasks: {},
  taskOrder: [],
  activeTaskId: null,
  // Preserve user's last focus selection; fall back to first artifact if
  // the focused id no longer exists (defensive — shouldn't normally happen).
  focusedArtifactId:
    s.focusedArtifactId && s.artifacts[s.focusedArtifactId]
      ? s.focusedArtifactId
      : s.artifactOrder[0] ?? null,
  focusedElement:
    s.focusedElement && s.artifacts[s.focusedElement.artifactId]
      ? s.focusedElement
      : null,
  // Cap recentMentions on the way out so a runaway writer can't bloat the
  // persisted blob. Tolerant of `undefined` from older in-memory states.
  recentMentions: (s.recentMentions ?? []).slice(0, RECENT_MENTIONS_MAX),
})

const genId = (prefix: string): string => genShortId(prefix, 5)

/** Legacy per-thread record (v3). Folded into {@link Session} on rehydrate. */
interface LegacyConversationV3 {
  id: string
  title: string
  mode: ConversationMode
  transcript: TranscriptMessage[]
  createdAt: number
  updatedAt: number
  pinned?: boolean
  archived?: boolean
  researchState?: ConversationResearchState
}

function isPlaceholderSessionTitle(title: string): boolean {
  const exact = new Set([
    'Main',
    'New conversation',
    'Research',
    'Untitled Session',
  ])
  if (exact.has(title)) return true
  return /^Session \d+$/.test(title.trim())
}

/**
 * When the session still has a generic title and the user sends their first
 * user message, derive a short title from that message.
 */
function autoTitleFromFirstMessage(
  session: Session,
  nextMsg: TranscriptMessage,
): string {
  if (!isPlaceholderSessionTitle(session.title)) return session.title
  const firstUserMsg = session.transcript.find((m) => m.role === 'user')
  if (firstUserMsg) return session.title
  if (nextMsg.role !== 'user') return session.title
  const text = nextMsg.content.trim().replace(/\s+/g, ' ')
  if (!text) return session.title
  return text.length <= 40 ? text : `${text.slice(0, 39)}…`
}

type SessionRehydrateInput = Partial<Session> & {
  conversations?: Record<string, LegacyConversationV3>
  conversationOrder?: string[]
  activeConversationId?: string | null
}

function stripLegacyConversationFields(
  raw: SessionRehydrateInput,
): Partial<Session> {
  const {
    conversations: _c,
    conversationOrder: _o,
    activeConversationId: _a,
    ...rest
  } = raw as Record<string, unknown>
  return rest as Partial<Session>
}

/**
 * Migration v4: fold v3 `conversations` (and pre-v3 top-level `transcript`)
 * into a single transcript + `chatMode` per session.
 */
function normalizeSessionToV4(raw: SessionRehydrateInput): Session {
  const convMap = raw.conversations
  if (convMap && typeof convMap === 'object' && Object.keys(convMap).length > 0) {
    const order =
      raw.conversationOrder && raw.conversationOrder.length > 0
        ? raw.conversationOrder
        : Object.keys(convMap)
    const activeId =
      raw.activeConversationId && convMap[raw.activeConversationId]
        ? raw.activeConversationId
        : order[0]
    const conv = activeId ? convMap[activeId] : null
    const base = stripLegacyConversationFields(raw)
    return {
      ...(base as Session),
      transcript: conv?.transcript ?? base.transcript ?? [],
      chatMode: conv?.mode ?? base.chatMode ?? 'agent',
      researchState: conv?.researchState ?? base.researchState,
    }
  }

  const base = stripLegacyConversationFields(raw)
  return {
    ...(base as Session),
    transcript: base.transcript ?? [],
    chatMode: base.chatMode ?? 'agent',
  }
}

// ── MP-1 rehydrate backfill ────────────────────────────────────────
//
// Artifact subtypes that can be @-mentioned carry stable ids on their inner
// elements (peaks, XPS fits, XPS peaks). The type declarations make those ids
// optional because older persisted sessions + demo fixtures predate the
// field; at runtime everything reached by the mention layer is expected to
// have an id. The helpers below walk a rehydrated session's artifacts and
// fill in any missing ids. They're pure (new objects only when something
// actually changed) so idempotent re-runs are free.

const BACKFILL_SUFFIX_LEN = 4

const backfillSuffix = (): string =>
  Math.random().toString(36).slice(2, 2 + BACKFILL_SUFFIX_LEN)

const hasStableId = (value: unknown): value is { id: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  (value as { id: string }).id.length > 0

const backfillPeakFitPayload = (payload: PeakFitPayload): PeakFitPayload => {
  let changed = false
  const peaks = payload.peaks.map((peak, index) => {
    if (hasStableId(peak)) return peak
    changed = true
    return { ...peak, id: `peak_${index}_${backfillSuffix()}` }
  })
  return changed ? { ...payload, peaks } : payload
}

const backfillXpsFit = (
  fit: XpsFit,
  fitIndex: number,
): { fit: XpsFit; changed: boolean } => {
  let peaksChanged = false
  const peaks = fit.peaks.map((peak: XpsPeak, peakIndex) => {
    if (hasStableId(peak)) return peak
    peaksChanged = true
    return { ...peak, id: `xp_${fitIndex}_${peakIndex}_${backfillSuffix()}` }
  })
  const needsFitId = !hasStableId(fit)
  if (!needsFitId && !peaksChanged) return { fit, changed: false }
  return {
    fit: {
      ...fit,
      id: needsFitId ? `xfit_${fitIndex}_${backfillSuffix()}` : fit.id,
      peaks,
    },
    changed: true,
  }
}

const backfillXpsAnalysisPayload = (
  payload: XpsAnalysisPayload,
): XpsAnalysisPayload => {
  let changed = false
  const fits = payload.fits.map((fit, i) => {
    const result = backfillXpsFit(fit, i)
    if (result.changed) changed = true
    return result.fit
  })
  return changed ? { ...payload, fits } : payload
}

/**
 * Fold a pre-cells compute-pro payload into the cells-based shape. Two
 * historical variants:
 *   - v1:   `{ code, language, runs, chat, activeRunId, … }`
 *   - v1.5: v1 plus `structureMode: 'natural' | 'code'` when `language === 'structure'`
 *
 * Strategy: one surviving cell that inherits the old top-level code +
 * language (structure variants route through `structureMode` into
 * `structure-ai` / `structure-code` cell kinds). `runs[0]` becomes
 * `lastRun`; earlier runs are dropped (the new UI only shows one
 * output per cell — duplicate the cell to preserve comparisons).
 * `chat` is discarded; Cmd+K replaces the persistent transcript.
 */
const backfillComputeProPayload = (
  raw: unknown,
): ComputeProPayload => {
  const obj = (raw ?? {}) as Record<string, unknown>
  // Already migrated — trust it.
  if (Array.isArray((obj as { cells?: unknown }).cells)) {
    return {
      cells: (obj.cells as ComputeCell[]) ?? [],
      focusedCellId:
        typeof obj.focusedCellId === 'string'
          ? (obj.focusedCellId as string)
          : null,
      timeoutS: typeof obj.timeoutS === 'number' ? obj.timeoutS : 60,
      health: (obj.health as ComputeProHealth | null) ?? null,
      status: (obj.status as ProWorkbenchStatus) ?? 'idle',
      lastError:
        typeof obj.lastError === 'string'
          ? (obj.lastError as string)
          : undefined,
    }
  }
  const legacyCode = typeof obj.code === 'string' ? obj.code : ''
  const legacyLanguage =
    typeof obj.language === 'string' ? (obj.language as string) : 'python'
  const legacyStructureMode =
    obj.structureMode === 'code' || obj.structureMode === 'natural'
      ? (obj.structureMode as 'natural' | 'code')
      : 'natural'
  const kind: ComputeCellKind =
    legacyLanguage === 'structure'
      ? legacyStructureMode === 'code'
        ? 'structure-code'
        : 'structure-ai'
      : (legacyLanguage as 'python' | 'lammps' | 'cp2k')
  const legacyRuns = Array.isArray(obj.runs) ? (obj.runs as unknown[]) : []
  const head = (legacyRuns[0] ?? null) as
    | (ComputeProRun & { language?: string })
    | null
  const lastRun: ComputeProRun | null = head
    ? {
        id: typeof head.id === 'string' ? head.id : genId('run'),
        // Older runs carried `language` instead of `cellKind`; rewrite it
        // using the same structure routing as above so the UI can switch
        // on `run.cellKind` uniformly.
        cellKind: head.cellKind ?? kind,
        startedAt: head.startedAt ?? Date.now(),
        endedAt: head.endedAt ?? null,
        exitCode: head.exitCode ?? null,
        durationMs: head.durationMs,
        timedOut: head.timedOut ?? false,
        stdout: head.stdout ?? '',
        stderr: head.stderr ?? '',
        figures: Array.isArray(head.figures) ? head.figures : [],
        error: head.error,
      }
    : null
  const now = Date.now()
  const cellId = genId('cell')
  const onlyCell: ComputeCell = legacyCode
    ? {
        id: cellId,
        kind,
        code: legacyCode,
        lastRun,
        createdAt: now,
        updatedAt: now,
      }
    : // Empty legacy payload → start fresh with no cells.
      null!
  return {
    cells: onlyCell ? [onlyCell] : [],
    focusedCellId: onlyCell ? onlyCell.id : null,
    timeoutS: typeof obj.timeoutS === 'number' ? obj.timeoutS : 60,
    health: (obj.health as ComputeProHealth | null) ?? null,
    status: (obj.status as ProWorkbenchStatus) ?? 'idle',
    lastError:
      typeof obj.lastError === 'string'
        ? (obj.lastError as string)
        : undefined,
  }
}

const backfillArtifact = (artifact: Artifact): Artifact => {
  if (artifact.kind === 'peak-fit') {
    const next = backfillPeakFitPayload(artifact.payload as PeakFitPayload)
    return next === artifact.payload
      ? artifact
      : { ...artifact, payload: next as typeof artifact.payload }
  }
  if (artifact.kind === 'xps-analysis') {
    const next = backfillXpsAnalysisPayload(artifact.payload as XpsAnalysisPayload)
    return next === artifact.payload
      ? artifact
      : { ...artifact, payload: next as typeof artifact.payload }
  }
  if (artifact.kind === 'compute-pro') {
    const next = backfillComputeProPayload(artifact.payload)
    return next === artifact.payload
      ? artifact
      : { ...artifact, payload: next as typeof artifact.payload }
  }
  return artifact
}

const stripComputeFigureSentinels = (session: Session): Session => {
  if (!session.artifacts || typeof session.artifacts !== 'object') return session
  let changed = false
  const next: Record<ArtifactId, Artifact> = {}
  for (const [id, a] of Object.entries(session.artifacts)) {
    if (a.kind !== 'compute') { next[id] = a; continue }
    const payload = a.payload as { stdout?: string; status?: string; runId?: string | null }
    let patched = false
    let nextPayload = { ...a.payload }
    if (typeof payload.stdout === 'string' && payload.stdout.includes(FIGURE_SENTINEL)) {
      const idx = payload.stdout.lastIndexOf(FIGURE_SENTINEL);
      (nextPayload as { stdout: string }).stdout = payload.stdout.slice(0, idx).trimEnd()
      patched = true
    }
    if (payload.status === 'running') {
      (nextPayload as { status: string }).status = 'idle';
      (nextPayload as { runId: string | null }).runId = null
      patched = true
    }
    next[id] = patched ? { ...a, payload: nextPayload as typeof a.payload } : a
    if (patched) changed = true
  }
  return changed ? { ...session, artifacts: next } : session
}

const backfillSessionArtifacts = (session: Session): Session => {
  // Tolerate partial shapes from older / malformed persisted state. If the
  // artifacts map is missing entirely we return the session untouched so the
  // migrate caller can still keep it in the store.
  if (!session.artifacts || typeof session.artifacts !== 'object') {
    return normalizeSessionToV4(session as SessionRehydrateInput)
  }
  let changed = false
  const nextArtifacts: Record<ArtifactId, Artifact> = {}
  for (const [id, artifact] of Object.entries(session.artifacts)) {
    if (!artifact || typeof artifact !== 'object') continue
    const migrated = backfillArtifact(artifact)
    if (migrated !== artifact) changed = true
    nextArtifacts[id] = migrated
  }
  const withArtifacts = changed ? { ...session, artifacts: nextArtifacts } : session
  return normalizeSessionToV4(withArtifacts as SessionRehydrateInput)
}

// ── Mention helpers ────────────────────────────────────────────────
//
// Lookup utilities shared by `selectMentionablesForActiveSession` and
// `resolveMentionPreview`. They mirror the matching semantics of the
// `src/components/inspector/renderers/*` files: a sub-object is located
// first by its stable MP-1 id, then by the pre-MP-1 index-based legacy id
// (`peak_${index}`, `xp_${fitIndex}_${peakIndex}`, `quant_${index}`),
// which keeps already-sent @-mentions working after a persisted session
// is rehydrated. Deliberately not exported: the outward contract is the
// two selectors below.

const ARTIFACT_KIND_LABEL: Readonly<Record<ArtifactKind, string>> = {
  spectrum: 'spectrum',
  'peak-fit': 'peak-fit',
  'xrd-analysis': 'xrd',
  'xps-analysis': 'xps',
  'raman-id': 'raman',
  structure: 'structure',
  compute: 'compute',
  'compute-experiment': 'experiment',
  job: 'job',
  'research-report': 'report',
  batch: 'batch',
  'material-comparison': 'compare',
  paper: 'paper',
  'similarity-matrix': 'similarity',
  optimization: 'optim',
  hypothesis: 'hypothesis',
  'xrd-pro': 'xrd-pro',
  'xps-pro': 'xps-pro',
  'raman-pro': 'raman-pro',
  'curve-pro': 'curve',
  'curve-analysis': 'curve',
  'spectrum-pro': 'spectrum-pro',
  'compute-pro': 'compute-pro',
  'latex-document': 'latex',
  plot: 'plot',
}

const artifactKindLabel = (kind: ArtifactKind): string =>
  ARTIFACT_KIND_LABEL[kind] ?? kind

/**
 * Structural equality key for {@link MentionRef}. Stable across sessions as
 * long as we emit fields in a fixed order — hence the explicit `type` branch
 * rather than a naive `JSON.stringify(ref)` (whose key order is driven by
 * property insertion order on the caller side and could drift).
 */
const canonicalMentionKey = (ref: MentionRef): string => {
  switch (ref.type) {
    case 'file':
      return `file:${ref.sessionId}:${ref.relPath}`
    case 'artifact':
      return `artifact:${ref.sessionId}:${ref.artifactId}`
    case 'artifact-element':
      return `element:${ref.sessionId}:${ref.artifactId}:${ref.elementKind}:${ref.elementId}`
    case 'pdf-quote':
      // pdf-quote mentions are not session-scoped — the quote lives in the
      // library (cross-session). Hash is already unique per (paper, page,
      // text), so no sessionId component is needed.
      return `pdf-quote:${ref.paperId}:${ref.page}:${ref.quoteHash}`
  }
}

const findPeakById = (
  artifact: PeakFitArtifact,
  elementId: string,
): PeakFitPayload['peaks'][number] | null => {
  for (const peak of artifact.payload.peaks) {
    if (peak.id === elementId) return peak
    const legacy = `peak_${peak.index}`
    if (elementId === legacy) return peak
    if (typeof peak.id === 'string' && peak.id.startsWith(`${legacy}_`)) {
      return peak
    }
  }
  return null
}

const findPhaseById = (
  artifact: XrdAnalysisArtifact,
  elementId: string,
): XrdPhase | null =>
  artifact.payload.phases.find((p) => p.id === elementId) ?? null

const findXpsComponent = (
  artifact: XpsAnalysisArtifact,
  elementId: string,
): { fit: XpsFit; peak: XpsPeak; fitIndex: number; peakIndex: number } | null => {
  const fits = artifact.payload.fits
  for (let fitIndex = 0; fitIndex < fits.length; fitIndex++) {
    const fit = fits[fitIndex]
    for (let peakIndex = 0; peakIndex < fit.peaks.length; peakIndex++) {
      const peak = fit.peaks[peakIndex]
      if (peak.id === elementId) return { fit, peak, fitIndex, peakIndex }
      if (typeof peak.id === 'string' && peak.id.startsWith(`${elementId}_`)) {
        return { fit, peak, fitIndex, peakIndex }
      }
      if (elementId === `xp_${fitIndex}_${peakIndex}`) {
        return { fit, peak, fitIndex, peakIndex }
      }
    }
  }
  return null
}

const findXpsQuantRow = (
  artifact: XpsAnalysisArtifact,
  elementId: string,
): { row: XpsQuantRow; index: number } | null => {
  const rows = artifact.payload.quantification
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (
      elementId === row.element ||
      elementId === `quant_${i}` ||
      elementId === `xps_quant_${i}`
    ) {
      return { row, index: i }
    }
  }
  return null
}

const findRamanMatchById = (
  artifact: RamanIdArtifact,
  elementId: string,
): RamanMatch | null =>
  artifact.payload.matches.find((m) => m.id === elementId) ?? null

interface NewSessionOptions {
  title?: string
  /** Pre-assign a specific id (e.g. when hydrating from a `.chat.json`
   *  envelope). If the id already exists in the store the call is a
   *  no-op and the existing id is returned. When omitted a fresh id is
   *  generated. */
  id?: SessionId
}

interface StartTaskOptions {
  title: string
  rootMessageId?: string
}

interface AppendStepInput {
  kind: TaskStep['kind']
  label: string
  toolName?: string
  inputSummary?: string
  /** Phase 1 · raw tool input args, captured so cards can render the
   *  exact parameters the LLM sent. See {@link TaskStep.input}. */
  input?: unknown
  status?: TaskStepStatus
  artifactRef?: ArtifactId
  /** Phase α — backend step id the orchestrator stamped on the matching
   *  `tool_invocation` WS event. Required on tool-call steps so the
   *  session store can map a user approval click back to the orchestrator
   *  resolver. */
  backendStepId?: string
}

interface UpdateStepPatch {
  status?: TaskStepStatus
  label?: string
  toolName?: string
  inputSummary?: string
  /** Phase 1 · raw tool input args. Usually written once at
   *  `tool_invocation` time; exposed on the patch so later events that
   *  carry a richer payload can upgrade the record. */
  input?: unknown
  outputSummary?: string
  artifactRef?: ArtifactId
  endedAt?: number
  /** Phase α — lifecycle patches from the WS layer / card. */
  approvalState?: StepApprovalState
  output?: unknown
  editedOutput?: unknown
  backendStepId?: string
}

interface SessionState {
  sessions: Record<SessionId, Session>
  sessionOrder: SessionId[]
  activeSessionId: SessionId | null

  createSession: (opts?: NewSessionOptions) => SessionId
  setActiveSession: (id: SessionId) => void
  renameSession: (id: SessionId, title: string) => void
  removeSession: (id: SessionId) => void
  /** Pin / unpin a chat so ChatsDropdown surfaces it above the
   *  Recent timeline. No-op for unknown ids. */
  pinSession: (id: SessionId, pinned: boolean) => void
  /** Soft-delete (archive) / restore a chat. Archived chats stay in
   *  the store so they can be un-archived later; the dropdown filters
   *  them out of the default Recent list. */
  setSessionArchived: (id: SessionId, archived: boolean) => void

  addFile: (sessionId: SessionId, file: SessionFile) => void

  upsertArtifact: (
    sessionId: SessionId,
    artifact: Artifact,
    options?: { preserveFocus?: boolean },
  ) => ArtifactId
  patchArtifact: (
    sessionId: SessionId,
    id: ArtifactId,
    patch: Partial<Omit<Artifact, 'id' | 'kind'>>,
  ) => void
  duplicateArtifact: (sessionId: SessionId, id: ArtifactId) => ArtifactId | null
  removeArtifact: (sessionId: SessionId, id: ArtifactId) => void
  focusArtifact: (sessionId: SessionId, id: ArtifactId | null) => void
  setFocusedElement: (
    sessionId: SessionId,
    target: FocusedElementTarget | null,
  ) => void
  clearFocusedElement: (sessionId: SessionId) => void
  togglePinArtifact: (sessionId: SessionId, id: ArtifactId) => void
  findArtifactByKind: (
    sessionId: SessionId,
    kind: ArtifactKind,
  ) => Artifact | undefined

  setChatMode: (sessionId: SessionId, mode: ConversationMode) => void
  setSessionResearchState: (
    sessionId: SessionId,
    patch: Partial<ConversationResearchState>,
  ) => void

  appendTranscript: (sessionId: SessionId, msg: TranscriptMessage) => void
  /** Append only if no existing transcript message shares this id.
   *  Returns true on actual append, false on skip. Used by the WS hook to
   *  survive reconnect replays without producing duplicate bubbles. */
  appendTranscriptIfAbsent: (
    sessionId: SessionId,
    msg: TranscriptMessage,
  ) => boolean
  /**
   * Phase δ — append a system-role transcript message whose sole purpose is
   * to render an artifact card inline in chat. Returns the new message id so
   * callers can reference / dismiss it later.
   */
  appendArtifactCardMessage: (
    sessionId: SessionId,
    artifactId: ArtifactId,
    label?: string,
  ) => TranscriptId
  updateTranscriptMessage: (
    sessionId: SessionId,
    msgId: string,
    patch: Partial<Omit<TranscriptMessage, 'id'>>,
  ) => void
  /** Remove a transcript bubble by id. */
  removeTranscriptMessage: (sessionId: SessionId, msgId: string) => void
  /**
   * Append a delta chunk to an existing transcript message's `content`.
   * No-op if the message is not found. Used by the WS layer to accumulate
   * streaming `chat_message_update { content_delta }` frames without
   * flashing intermediate snapshots through `updateTranscriptMessage`.
   * Returns true on hit, false on miss. */
  appendToTranscriptContent: (
    sessionId: SessionId,
    msgId: string,
    delta: string,
  ) => boolean
  clearTranscript: (sessionId: SessionId) => void

  setSessionParam: (sessionId: SessionId, key: string, value: unknown) => void
  setArtifactParam: (
    sessionId: SessionId,
    artifactId: ArtifactId,
    key: string,
    value: unknown,
  ) => void
  resetArtifactParams: (sessionId: SessionId, artifactId: ArtifactId) => void

  /**
   * Push `ref` to the head of the active mention MRU list for `sessionId`,
   * deduplicated by structural equality. Silently noops if `ref.sessionId`
   * does not match (cross-session mentions are MVP-forbidden — see
   * docs/CHAT_PANEL_REDESIGN.md §8).
   */
  pushRecentMention: (sessionId: SessionId, ref: MentionRef) => void

  startTask: (sessionId: SessionId, opts: StartTaskOptions) => TaskId
  appendStep: (
    sessionId: SessionId,
    taskId: TaskId,
    step: AppendStepInput,
  ) => TaskStepId
  updateStep: (
    sessionId: SessionId,
    taskId: TaskId,
    stepId: TaskStepId,
    patch: UpdateStepPatch,
  ) => void
  /**
   * Phase α — record the user's approval decision on a paused tool step.
   * Mutates `approvalState` + (on approve) `editedOutput`, then resolves
   * the matching orchestrator-side promise so the agent loop continues.
   * No-op when the step / task / session can't be found, so a stale click
   * from a torn-down card never throws.
   */
  setStepApproval: (
    sessionId: SessionId,
    taskId: TaskId,
    stepId: TaskStepId,
    state: StepApprovalState,
    editedOutput?: unknown,
  ) => void
  /**
   * Phase 1 · tool-card coverage — reject an already-completed tool step
   * after the fact. Unlike {@link setStepApproval}, which gates a paused
   * tool before its result reaches the LLM, this action is for the
   * info / review cards whose output has *already* been consumed: it
   * marks the step as rejected (idempotent) and appends a `system`
   * transcript note so the agent's next turn can read "the user rejected
   * the previous tool call — reconsider your approach". Silently no-ops
   * if the session / step cannot be located.
   */
  rejectCompletedStep: (
    sessionId: SessionId,
    stepId: TaskStepId,
    reason?: string,
  ) => void
  endTask: (sessionId: SessionId, taskId: TaskId, status: TaskStatus) => void

  // ── Phase B+ · plan mode ───────────────────────────────────────────
  enterPlanMode: (sessionId: SessionId, reason?: string) => void
  setPlanText: (sessionId: SessionId, plan: string) => void
  exitPlanMode: (sessionId: SessionId) => void

  // ── Phase B+ · agent-managed todo ─────────────────────────────────
  addAgentTask: (sessionId: SessionId, task: AgentTask) => void
  updateAgentTask: (
    sessionId: SessionId,
    taskId: string,
    patch: Partial<Omit<AgentTask, 'id' | 'createdAt'>>,
  ) => void
  removeAgentTask: (sessionId: SessionId, taskId: string) => void
}

/** Seed a fresh session with an empty transcript and default agent mode. */
const emptySession = (title: string): Session => {
  const now = Date.now()
  return {
    id: genId('ses'),
    title,
    createdAt: now,
    updatedAt: now,
    files: [],
    artifacts: {},
    artifactOrder: [],
    pinnedArtifactIds: [],
    focusedArtifactId: null,
    focusedElement: null,
    transcript: [],
    chatMode: 'agent',
    tasks: {},
    taskOrder: [],
    activeTaskId: null,
    paramSnapshot: {},
    recentMentions: [],
  }
}

const touch = <T extends Session>(session: T): T => ({
  ...session,
  updatedAt: Date.now(),
})

const withSession = (
  state: SessionState,
  sessionId: SessionId,
  mutator: (session: Session) => Session,
): Partial<SessionState> => {
  const current = state.sessions[sessionId]
  if (!current) return {}
  return {
    sessions: { ...state.sessions, [sessionId]: touch(mutator(current)) },
  }
}

export const useRuntimeStore = create<SessionState>()(
  persist(
    (set, get) => ({
  sessions: {},
  sessionOrder: [],
  activeSessionId: null,

  createSession: (opts) => {
    const proposedId = opts?.id
    if (proposedId && get().sessions[proposedId]) return proposedId
    const base = emptySession(opts?.title ?? 'Untitled Session')
    const session = proposedId ? { ...base, id: proposedId } : base
    set((s) => ({
      sessions: { ...s.sessions, [session.id]: session },
      sessionOrder: [session.id, ...s.sessionOrder],
      activeSessionId: s.activeSessionId ?? session.id,
    }))
    return session.id
  },

  setActiveSession: (id) => {
    if (!get().sessions[id]) return
    set({ activeSessionId: id })
  },

  renameSession: (id, title) => {
    set((s) => withSession(s, id, (ses) => ({ ...ses, title })))
  },

  removeSession: (id) => {
    set((s) => {
      if (!s.sessions[id]) return {}
      const { [id]: _, ...rest } = s.sessions
      const order = s.sessionOrder.filter((sid) => sid !== id)
      const activeSessionId =
        s.activeSessionId === id ? order[0] ?? null : s.activeSessionId
      return { sessions: rest, sessionOrder: order, activeSessionId }
    })
  },

  pinSession: (id, pinned) => {
    set((s) =>
      withSession(s, id, (ses) => ({
        ...ses,
        pinnedAt: pinned ? Date.now() : undefined,
      })),
    )
  },

  setSessionArchived: (id, archived) => {
    set((s) => {
      if (!s.sessions[id]) return {}
      const archivedAt = archived ? Date.now() : undefined
      // When archiving the currently active session, pick another
      // non-archived session (or null) so the app doesn't keep a
      // hidden chat loaded.
      let activeSessionId = s.activeSessionId
      if (archived && s.activeSessionId === id) {
        const fallback = s.sessionOrder.find(
          (sid) => sid !== id && !s.sessions[sid]?.archivedAt,
        )
        activeSessionId = fallback ?? null
      }
      return {
        sessions: {
          ...s.sessions,
          [id]: touch({ ...s.sessions[id], archivedAt }),
        },
        activeSessionId,
      }
    })
  },

  addFile: (sessionId, file) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const existing = ses.files.findIndex((f) => f.relPath === file.relPath)
        const files =
          existing >= 0
            ? ses.files.map((f, i) => (i === existing ? { ...f, ...file } : f))
            : [...ses.files, file]
        return { ...ses, files }
      }),
    )
  },

  upsertArtifact: (sessionId, artifact, options) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const existing = ses.artifacts[artifact.id]
        const nextArtifacts = { ...ses.artifacts, [artifact.id]: artifact }
        const nextOrder = existing
          ? ses.artifactOrder
          : [...ses.artifactOrder, artifact.id]
        const preserve = Boolean(options?.preserveFocus)
        const nextFocused =
          ses.focusedArtifactId ?? (preserve ? null : artifact.id)
        return {
          ...ses,
          artifacts: nextArtifacts,
          artifactOrder: nextOrder,
          focusedArtifactId: nextFocused,
        }
      }),
    )
    return artifact.id
  },

  patchArtifact: (sessionId, id, patch) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const current = ses.artifacts[id]
        if (!current) return ses
        const merged = {
          ...current,
          ...patch,
          id: current.id,
          kind: current.kind,
          updatedAt: Date.now(),
        } as Artifact
        return {
          ...ses,
          artifacts: { ...ses.artifacts, [id]: merged },
        }
      }),
    )
  },

  duplicateArtifact: (sessionId, id) => {
    const state = get()
    const session = state.sessions[sessionId]
    if (!session) return null
    const source = session.artifacts[id]
    if (!source) return null
    const newId = genArtifactId()
    const now = Date.now()
    // Deep clone so the duplicate's nested payload arrays/objects are
    // independent of the original. Without this, editing one artifact's
    // peaks/values/sections would silently mutate the other.
    const clonedPayload = deepClone(source.payload)
    const clonedParams = source.params ? deepClone(source.params) : undefined
    const clone: Artifact = {
      ...source,
      id: newId,
      title: `${source.title} (copy)`,
      createdAt: now,
      updatedAt: now,
      parents: [id],
      payload: clonedPayload,
      params: clonedParams,
    } as Artifact
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        artifacts: { ...ses.artifacts, [newId]: clone },
        artifactOrder: [...ses.artifactOrder, newId],
        focusedArtifactId: newId,
        // Duplicate is a brand-new artifact, so the previous element selection
        // (if any) doesn't apply. Clear it explicitly rather than relying on
        // focusArtifact, which is bypassed by this code path.
        focusedElement: null,
      })),
    )
    return newId
  },

  removeArtifact: (sessionId, id) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        if (!ses.artifacts[id]) return ses
        const { [id]: _removed, ...rest } = ses.artifacts
        const nextOrder = ses.artifactOrder.filter((a) => a !== id)
        const nextPinned = ses.pinnedArtifactIds.filter((a) => a !== id)
        const nextFocused =
          ses.focusedArtifactId === id
            ? nextOrder[nextOrder.length - 1] ?? null
            : ses.focusedArtifactId
        const nextFocusedElement =
          ses.focusedElement?.artifactId === id
            ? null
            : ses.focusedElement ?? null
        return {
          ...ses,
          artifacts: rest,
          artifactOrder: nextOrder,
          pinnedArtifactIds: nextPinned,
          focusedArtifactId: nextFocused,
          focusedElement: nextFocusedElement,
        }
      }),
    )
  },

  focusArtifact: (sessionId, id) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        // Track the last-focused `spectrum-pro` artifact per technique
        // cursor so the App palette's domain-router can revive the user's
        // previous workbench instead of spawning a new one. We refresh
        // this map only when `id` is a live `spectrum-pro` artifact with
        // a populated `technique` field; other kinds leave the map
        // untouched.
        const focused = id ? ses.artifacts[id] : null
        let nextLastFocused = ses.lastFocusedProByTechnique
        if (focused && focused.kind === 'spectrum-pro') {
          const technique = (focused.payload as { technique?: string } | null)
            ?.technique
          if (typeof technique === 'string' && technique.length > 0) {
            // No-op guard: refocusing the same (artifact, technique) pair
            // shouldn't produce a new map reference — that would trigger
            // downstream subscribers on every cursor move through Pro
            // artifacts.
            if (ses.lastFocusedProByTechnique?.[technique] !== id) {
              nextLastFocused = {
                ...(ses.lastFocusedProByTechnique ?? {}),
                [technique]: id as ArtifactId,
              }
            }
          }
        }
        return {
          ...ses,
          focusedArtifactId: id,
          // Keep the element selection only if we're refocusing the same
          // artifact; switching to another artifact (or clearing focus)
          // drops any sub-object selection.
          focusedElement:
            id && ses.focusedElement?.artifactId === id
              ? ses.focusedElement
              : null,
          lastFocusedProByTechnique: nextLastFocused,
        }
      }),
    )
  },

  setFocusedElement: (sessionId, target) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        if (!target) return { ...ses, focusedElement: null }
        if (!ses.artifacts[target.artifactId]) {
          // Refuse stale targets — caller probably raced an artifact removal.
          return { ...ses, focusedElement: null }
        }
        return {
          ...ses,
          focusedArtifactId: target.artifactId,
          focusedElement: target,
        }
      }),
    )
  },

  clearFocusedElement: (sessionId) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({ ...ses, focusedElement: null })),
    )
  },

  togglePinArtifact: (sessionId, id) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const pinned = ses.pinnedArtifactIds.includes(id)
          ? ses.pinnedArtifactIds.filter((pid) => pid !== id)
          : [...ses.pinnedArtifactIds, id]
        return { ...ses, pinnedArtifactIds: pinned }
      }),
    )
  },

  findArtifactByKind: (sessionId, kind) => {
    const ses = get().sessions[sessionId]
    if (!ses) return undefined
    for (let i = ses.artifactOrder.length - 1; i >= 0; i--) {
      const a = ses.artifacts[ses.artifactOrder[i]]
      if (a && a.kind === kind) return a
    }
    return undefined
  },

  setChatMode: (sessionId, mode) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({ ...ses, chatMode: mode })),
    )
  },

  setSessionResearchState: (sessionId, patch) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const merged: ConversationResearchState = {
          ...(ses.researchState ?? {}),
          ...patch,
        }
        return { ...ses, researchState: merged }
      }),
    )
  },

  appendTranscript: (sessionId, msg) => {
    let kickAutoTitle = false
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const now = Date.now()
        const nextTitle = autoTitleFromFirstMessage(ses, msg)
        // Fire the LLM retitle the first time an assistant reply lands —
        // by then we know the session is real and the naive slug has
        // already been stamped on the prior user turn.
        if (
          msg.role === 'assistant' &&
          ses.transcript.some((m) => m.role === 'user')
        ) {
          kickAutoTitle = true
        }
        return {
          ...ses,
          transcript: [...ses.transcript, msg],
          title: nextTitle,
          updatedAt: now,
        }
      }),
    )
    if (kickAutoTitle) {
      // Async-imported so the runtime-store module stays free of renderer
      // UI / LLM-config dependencies at load time.
      void import('../lib/auto-title').then(({ maybeAutoTitle }) => {
        maybeAutoTitle(sessionId)
      })
    }
  },

  appendTranscriptIfAbsent: (sessionId, msg) => {
    const ses = get().sessions[sessionId]
    if (!ses) return false
    const present = ses.transcript.some((m) => m.id === msg.id)
    if (present) return false
    get().appendTranscript(sessionId, msg)
    return true
  },

  appendArtifactCardMessage: (sessionId, artifactId, label) => {
    const id = genId('tmsg') as TranscriptId
    const msg: TranscriptMessage = {
      id,
      role: 'system',
      content: '',
      timestamp: Date.now(),
      status: 'complete',
      artifactCardRef: { artifactId, label },
    }
    get().appendTranscript(sessionId, msg)
    return id
  },

  updateTranscriptMessage: (sessionId, msgId, patch) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const update = (arr: TranscriptMessage[]) =>
          arr.map((m) => (m.id === msgId ? { ...m, ...patch } : m))
        return {
          ...ses,
          transcript: update(ses.transcript),
        }
      }),
    )
  },

  removeTranscriptMessage: (sessionId, msgId) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const filterOut = (arr: TranscriptMessage[]) =>
          arr.filter((m) => m.id !== msgId)
        return {
          ...ses,
          transcript: filterOut(ses.transcript),
        }
      }),
    )
  },

  appendToTranscriptContent: (sessionId, msgId, delta) => {
    if (!delta) return false
    const state = get()
    const ses = state.sessions[sessionId]
    if (!ses) return false
    const present = ses.transcript.some((m) => m.id === msgId)
    if (!present) return false
    set((s) =>
      withSession(s, sessionId, (innerSes) => {
        const accumulate = (arr: TranscriptMessage[]) =>
          arr.map((m) =>
            m.id === msgId
              ? { ...m, content: m.content + delta, status: 'streaming' as const }
              : m,
          )
        return {
          ...innerSes,
          transcript: accumulate(innerSes.transcript),
        }
      }),
    )
    return true
  },

  clearTranscript: (sessionId) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        transcript: [],
      })),
    )
  },

  pushRecentMention: (sessionId, ref) => {
    // `pdf-quote` mentions live in the library (cross-session) so they
    // carry no sessionId — skip the session-consistency guard for them.
    if (ref.type === 'pdf-quote') {
      // falls through to the generic append below
    } else if (ref.sessionId !== sessionId) {
      // Bug-loud-at-dev: cross-session refs reaching this action mean a
      // caller bypassed the picker's session filter. Silent in prod so a
      // single misuse doesn't spam the toast/console for the end user.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          '[runtime-store] pushRecentMention: ref.sessionId does not match sessionId',
          { sessionId, ref },
        )
      }
      return
    }
    const dedupKey = canonicalMentionKey(ref)
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const prev = ses.recentMentions ?? []
        const filtered = prev.filter((r) => canonicalMentionKey(r) !== dedupKey)
        const next = [ref, ...filtered].slice(0, RECENT_MENTIONS_MAX)
        return { ...ses, recentMentions: next }
      }),
    )
  },

  setSessionParam: (sessionId, key, value) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        paramSnapshot: { ...ses.paramSnapshot, [key]: value },
      })),
    )
  },

  setArtifactParam: (sessionId, artifactId, key, value) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const current = ses.artifacts[artifactId]
        if (!current) return ses
        const nextParams = { ...(current.params ?? {}), [key]: value }
        return {
          ...ses,
          artifacts: {
            ...ses.artifacts,
            [artifactId]: { ...current, params: nextParams, updatedAt: Date.now() },
          },
        }
      }),
    )
  },

  resetArtifactParams: (sessionId, artifactId) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const current = ses.artifacts[artifactId]
        if (!current) return ses
        return {
          ...ses,
          artifacts: {
            ...ses.artifacts,
            [artifactId]: { ...current, params: undefined, updatedAt: Date.now() },
          },
        }
      }),
    )
  },

  startTask: (sessionId, opts) => {
    const task: Task = {
      id: genId('task'),
      sessionId,
      title: opts.title,
      rootMessageId: opts.rootMessageId,
      status: 'running',
      steps: [],
      startedAt: Date.now(),
    }
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        tasks: { ...ses.tasks, [task.id]: task },
        taskOrder: [...ses.taskOrder, task.id],
        activeTaskId: task.id,
      })),
    )
    return task.id
  },

  appendStep: (sessionId, taskId, step) => {
    const stepId = genId('step')
    const now = Date.now()
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const task = ses.tasks[taskId]
        if (!task) return ses
        const fullStep: TaskStep = {
          id: stepId,
          kind: step.kind,
          status: step.status ?? 'running',
          label: step.label,
          toolName: step.toolName,
          inputSummary: step.inputSummary,
          input: step.input,
          artifactRef: step.artifactRef,
          backendStepId: step.backendStepId,
          startedAt: now,
        }
        return {
          ...ses,
          tasks: {
            ...ses.tasks,
            [taskId]: { ...task, steps: [...task.steps, fullStep] },
          },
        }
      }),
    )
    return stepId
  },

  updateStep: (sessionId, taskId, stepId, patch) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const task = ses.tasks[taskId]
        if (!task) return ses
        const steps = task.steps.map((step) =>
          step.id === stepId ? { ...step, ...patch } : step,
        )
        return {
          ...ses,
          tasks: { ...ses.tasks, [taskId]: { ...task, steps } },
        }
      }),
    )
  },

  setStepApproval: (sessionId, taskId, stepId, state, editedOutput) => {
    // Locate the step first so we can resolve the orchestrator promise
    // with the correct backend id; a card click whose session / task /
    // step vanished (e.g. the user cleared the transcript before acting)
    // should neither throw nor leave a stuck wait behind.
    const current = get().sessions[sessionId]?.tasks[taskId]?.steps.find(
      (s) => s.id === stepId,
    )
    if (!current) return
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const task = ses.tasks[taskId]
        if (!task) return ses
        const steps = task.steps.map((step) => {
          if (step.id !== stepId) return step
          // Only record editedOutput on approve — a reject click should
          // leave the previous edit visible for the user's reference but
          // not get propagated to the LLM as the tool_result.
          const nextEdited =
            state === 'approved' && editedOutput !== undefined
              ? editedOutput
              : step.editedOutput
          return {
            ...step,
            approvalState: state,
            editedOutput: nextEdited,
          }
        })
        return {
          ...ses,
          tasks: { ...ses.tasks, [taskId]: { ...task, steps } },
        }
      }),
    )
    // Wake the orchestrator even if the step lacked a backendStepId — the
    // resolver is a no-op on unknown keys, so this is strictly additive.
    if (current.backendStepId) {
      resolvePendingApproval(current.backendStepId, {
        state,
        editedOutput: state === 'approved' ? editedOutput : undefined,
      })
    }
  },

  rejectCompletedStep: (sessionId, stepId, reason) => {
    // Locate the step across all tasks on the session. Steps live under
    // `tasks[taskId].steps`, so a flat search keeps the call-site API
    // simple (cards only know the stepId, not the owning task).
    const ses = get().sessions[sessionId]
    if (!ses) return
    let owningTaskId: TaskId | null = null
    for (const tid of ses.taskOrder) {
      const task = ses.tasks[tid]
      if (!task) continue
      if (task.steps.some((step) => step.id === stepId)) {
        owningTaskId = tid
        break
      }
    }

    const trimmedReason = reason?.trim()
    const noteContent = `User rejected the previous tool call${
      trimmedReason ? `: ${trimmedReason}` : ''
    }. Please reconsider your approach — do not rely on that output.`
    const note: TranscriptMessage = {
      id: genId('tmsg') as TranscriptId,
      role: 'system',
      content: noteContent,
      timestamp: Date.now(),
      status: 'complete',
    }

    set((s) =>
      withSession(s, sessionId, (innerSes) => {
        // Mark the step's approvalState as rejected (idempotent — if the
        // user already hit reject through the pending-approval path we
        // leave it alone). The step object is shallow-cloned so other
        // readers don't see a stale reference.
        let nextTasks = innerSes.tasks
        if (owningTaskId) {
          const task = innerSes.tasks[owningTaskId]
          if (task) {
            const nextSteps = task.steps.map((step) =>
              step.id === stepId
                ? step.approvalState === 'rejected'
                  ? step
                  : { ...step, approvalState: 'rejected' as const }
                : step,
            )
            nextTasks = {
              ...innerSes.tasks,
              [owningTaskId]: { ...task, steps: nextSteps },
            }
          }
        }
        // `updatedAt` is refreshed by `withSession -> touch`.
        return {
          ...innerSes,
          transcript: [...innerSes.transcript, note],
          tasks: nextTasks,
        }
      }),
    )
  },

  endTask: (sessionId, taskId, status) => {
    set((s) =>
      withSession(s, sessionId, (ses) => {
        const task = ses.tasks[taskId]
        if (!task) return ses
        return {
          ...ses,
          activeTaskId:
            ses.activeTaskId === taskId ? null : ses.activeTaskId,
          tasks: {
            ...ses.tasks,
            [taskId]: { ...task, status, endedAt: Date.now() },
          },
        }
      }),
    )
  },

  // ── Phase B+ · plan mode ───────────────────────────────────────────
  enterPlanMode: (sessionId, reason) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        planMode: { active: true, reason, enteredAt: Date.now() },
      })),
    )
  },
  setPlanText: (sessionId, plan) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        planMode: { ...(ses.planMode ?? { active: true }), plan },
      })),
    )
  },
  exitPlanMode: (sessionId) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        planMode: ses.planMode ? { ...ses.planMode, active: false } : undefined,
      })),
    )
  },

  // ── Phase B+ · agent-managed todo ─────────────────────────────────
  addAgentTask: (sessionId, task) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        agentTasks: [...(ses.agentTasks ?? []), task],
      })),
    )
  },
  updateAgentTask: (sessionId, taskId, patch) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        agentTasks: (ses.agentTasks ?? []).map((t) =>
          t.id === taskId ? { ...t, ...patch, updatedAt: Date.now() } : t,
        ),
      })),
    )
  },
  removeAgentTask: (sessionId, taskId) => {
    set((s) =>
      withSession(s, sessionId, (ses) => ({
        ...ses,
        agentTasks: (ses.agentTasks ?? []).filter((t) => t.id !== taskId),
      })),
    )
  },
    }),
    {
      name: 'lattice.session',
      // v5: compute-pro payload shape switched from `code + language + runs
      // v6: strip __LATTICE_FIGURES__ base64 blobs from compute stdout +
      // reset stale 'running' status on hydration (orphaned by crash).
      version: 6,
      storage: createJSONStorage(() => debouncedLocalStorage),
      partialize: (state) => ({
        sessions: Object.fromEntries(
          Object.entries(state.sessions).map(([id, s]) => [id, prunedSessionForPersist(s)]),
        ),
        sessionOrder: state.sessionOrder,
        activeSessionId: state.activeSessionId,
      }),
      // v2 backfills stable ids on peak-fit / xps-analysis artifact elements
      // so the mention layer can use them as anchors. See docs/
      // CHAT_PANEL_REDESIGN.md §9 MP-1. The migration is tolerant of
      // partial / malformed persisted state: a single corrupt session is
      // skipped (logged) rather than nuking the entire store.
      migrate: (persistedState: unknown, _fromVersion: number) => {
        const state = (persistedState ?? {}) as {
          sessions?: unknown
          sessionOrder?: unknown
          activeSessionId?: unknown
        }
        const sessions: Record<string, Session> = {}
        const rawSessions = state.sessions
        if (rawSessions && typeof rawSessions === 'object') {
          for (const [id, raw] of Object.entries(
            rawSessions as Record<string, unknown>,
          )) {
            if (!raw || typeof raw !== 'object') continue
            try {
              const migrated = backfillSessionArtifacts(raw as Session)
              sessions[id] = stripComputeFigureSentinels(migrated)
            } catch (err) {
              // Preserve the session's data as-is rather than dropping it —
              // the mention layer will treat any peak without an id as
              // un-@-able, which is a soft degradation. A future write will
              // re-save the session and a later rehydrate can try again.
              // eslint-disable-next-line no-console
              console.warn(
                `[runtime-store] v2 backfill skipped session ${id}:`,
                err,
              )
              sessions[id] = raw as Session
            }
          }
        }
        return {
          sessions,
          sessionOrder: Array.isArray(state.sessionOrder)
            ? (state.sessionOrder as SessionId[])
            : [],
          activeSessionId:
            typeof state.activeSessionId === 'string'
              ? (state.activeSessionId as SessionId)
              : null,
        }
      },
    },
  ),
)

export const selectActiveSession = (s: SessionState): Session | null =>
  s.activeSessionId ? s.sessions[s.activeSessionId] ?? null : null

export function getSessionChatMode(session: Session): ConversationMode {
  return session.chatMode ?? 'agent'
}

export function getActiveTranscript(session: Session): TranscriptMessage[] {
  return session.transcript ?? []
}

/**
 * Resolve the tool-call steps that belong to a given assistant message.
 * Each agent turn is dispatched with `task_start` carrying the assistant
 * placeholder's id as `rootMessageId`; we look up the matching task and
 * filter to `kind === 'tool_call'` steps.
 *
 * Used by MessageBubble to render inline tool cards above the LLM's text
 * reply (mirrors ChatGPT/Claude tool disclosures).
 */
export function selectToolStepsForMessage(
  session: Session | null,
  messageId: TranscriptId,
): TaskStep[] {
  if (!session) return []
  for (const taskId of session.taskOrder) {
    const task = session.tasks[taskId]
    if (!task) continue
    if (task.rootMessageId === messageId) {
      return task.steps.filter((step) => step.kind === 'tool_call')
    }
  }
  return []
}

/**
 * Phase 1 · tool-card coverage — locate the task/step pair that owns
 * {@link stepId} within a session. Returns `null` when the step cannot
 * be found so UI callers (e.g. a card's "reject" button) can degrade
 * gracefully. Kept as a pure helper so consumers can memoize.
 */
export function findTaskStep(
  session: Session | null,
  stepId: TaskStepId,
): { task: Task; step: TaskStep } | null {
  if (!session) return null
  for (const taskId of session.taskOrder) {
    const task = session.tasks[taskId]
    if (!task) continue
    const step = task.steps.find((entry) => entry.id === stepId)
    if (step) return { task, step }
  }
  return null
}

export const selectActiveTask = (s: SessionState): Task | null => {
  const session = selectActiveSession(s)
  if (!session || !session.activeTaskId) return null
  return session.tasks[session.activeTaskId] ?? null
}

export const selectFocusedArtifact = (s: SessionState): Artifact | null => {
  const session = selectActiveSession(s)
  if (!session || !session.focusedArtifactId) return null
  return session.artifacts[session.focusedArtifactId] ?? null
}

export const selectFocusedElement = (
  s: SessionState,
): FocusedElementTarget | null => {
  const session = selectActiveSession(s)
  return session?.focusedElement ?? null
}

// NOTE: no `selectActiveArtifacts` selector on purpose — deriving an array
// inside a zustand selector returns a new reference every call and triggers
// infinite re-renders. Components should read `activeSession` and derive
// the list with `useMemo` keyed on session.artifactOrder / session.artifacts.

export interface CellUsingStructure {
  computeArtifactId: ArtifactId
  computeArtifactTitle: string
  cellId: string
  cellTitle?: string
  cellKind: string
  operation?: string
}

/**
 * Walk every compute-pro artifact in a session and return cells whose
 * `provenance.parentStructureId` equals `structureArtifactId`. Drives
 * the StructureCard's "Used in" back-link list. Not a zustand selector
 * (returns a fresh array) — callers wrap in `useMemo` or just derive
 * on render: the scan is tiny (≤100 comparisons in a typical session).
 */
export function selectCellsUsingStructure(
  session: Session | null,
  structureArtifactId: ArtifactId,
): CellUsingStructure[] {
  if (!session) return []
  const out: CellUsingStructure[] = []
  for (const id of session.artifactOrder) {
    const a = session.artifacts[id]
    if (!a || a.kind !== 'compute-pro') continue
    const payload = a.payload as {
      cells?: Array<{
        id: string
        title?: string
        kind: string
        provenance?: { parentStructureId?: string; operation?: string }
      }>
    }
    for (const cell of payload.cells ?? []) {
      if (cell.provenance?.parentStructureId !== structureArtifactId) continue
      out.push({
        computeArtifactId: a.id,
        computeArtifactTitle: a.title,
        cellId: cell.id,
        cellTitle: cell.title,
        cellKind: cell.kind,
        operation: cell.provenance?.operation,
      })
    }
  }
  return out
}

export const genArtifactId = (): ArtifactId => genId('art')

// ── Mention selectors (public) ─────────────────────────────────────

/**
 * Return the active session's MRU mention list, or an empty array if no
 * session is active / the field is absent (pre-MP-2 persisted sessions).
 * Safe to call every render: the return is the underlying array reference
 * so a session without new writes keeps referential identity.
 */
// Frozen to make the "no active session" branch referentially stable —
// re-returning `[]` literals on every call would defeat memoized consumers.
// Typed as a mutable array (the freeze stops actual mutation) so the
// selector return type stays `MentionRef[]` for ergonomic use at call sites.
const EMPTY_MENTIONS: MentionRef[] = Object.freeze([] as MentionRef[]) as unknown as MentionRef[]

export const selectRecentMentions = (s: SessionState): MentionRef[] => {
  const session = selectActiveSession(s)
  return session?.recentMentions ?? EMPTY_MENTIONS
}

const MAX_ELEMENT_ROWS_PER_KIND = 25

/**
 * Flatten the active session into a list of pickable mention rows, in the
 * order the MentionPicker should display them:
 *
 *   1. Focused-artifact sub-elements (peak / phase / xps-component /
 *      xps-quant-row / raman-match) — highest intent signal.
 *   2. Session files.
 *   3. All other artifacts (including the focused one, so it stays reachable
 *      as a whole-artifact reference).
 *
 * Plain selector (no curry / no higher-order): currying forces a new closure
 * per render, which triggers zustand's shallow-equality re-render bailout to
 * always miss. Consumers should wrap the returned array in `useMemo` keyed
 * on the session identifiers they care about if they want stable references
 * across frames with no actual changes.
 */
/**
 * Take a session (or null) and return the flat mentionables list. Split
 * out of `selectMentionablesForActiveSession` so React components can call
 * it from `useMemo(() => mentionablesForSession(session), [session])` —
 * subscribing the store selector directly caused an infinite render loop
 * in React 18 because the selector rebuilt a fresh array on every
 * `useSyncExternalStore` snapshot, defeating the cached-result check.
 */
export const mentionablesForSession = (
  session: Session | null,
): Mentionable[] => {
  if (!session) return []
  const out: Mentionable[] = []

  // (1) Focused-artifact sub-elements. Only emit when the focused artifact
  //     actually exists — during a concurrent removal we might have a dangling
  //     id in `focusedArtifactId`.
  const focusedId = session.focusedArtifactId
  const focused = focusedId ? session.artifacts[focusedId] : null
  if (focused) {
    collectFocusedElementRows(focused, session.id, out)
  }

  // (2) Session files — sorted by most-recent import so the picker's "files"
  //     section matches the user's temporal memory.
  const files = [...session.files].sort(
    (a, b) => (b.importedAt ?? 0) - (a.importedAt ?? 0),
  )
  for (const file of files) {
    out.push({
      ref: { type: 'file', sessionId: session.id, relPath: file.relPath },
      label: file.relPath,
      sublabel: file.spectrumType ?? undefined,
      kindLabel: 'file',
      group: 'files',
    })
  }

  // (2b) Workspace-root files — every file that lives in the Explorer tree,
  //      so `@` surfaces the full on-disk workspace (not just files the user
  //      has explicitly attached to this session). Directories are skipped
  //      (they are not targetable by a file mention ref), and any entry whose
  //      `relPath` already appeared in `session.files` is dropped to avoid
  //      double-listing. The workspace group is emitted sorted by mtime
  //      descending so the picker surfaces recently-touched files first.
  const sessionFileRelPaths = new Set(session.files.map((f) => f.relPath))
  const workspaceEntries = Object.values(
    useWorkspaceStore.getState().fileIndex,
  )
    .filter((entry) => !entry.isDirectory)
    .filter((entry) => !sessionFileRelPaths.has(entry.relPath))
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
  for (const entry of workspaceEntries) {
    const kindLabel = entry.kind ?? fileKindFromName(entry.name) ?? 'file'
    out.push({
      ref: { type: 'file', sessionId: session.id, relPath: entry.relPath },
      label: entry.name,
      sublabel: entry.relPath,
      kindLabel,
      group: 'workspace',
    })
  }

  // (3) Artifacts — iterate the authoritative order. We emit the whole-artifact
  //     row for every artifact (including the focused one) so the user can
  //     always pick "the whole thing" even after drilling into elements.
  for (const artifactId of session.artifactOrder) {
    const artifact = session.artifacts[artifactId]
    if (!artifact) continue
    out.push({
      ref: { type: 'artifact', sessionId: session.id, artifactId },
      label: artifact.title,
      sublabel: artifact.sourceFile ?? undefined,
      kindLabel: artifactKindLabel(artifact.kind),
      group: 'artifacts',
    })
  }

  return out
}

/**
 * Legacy adapter — mirrors `mentionablesForSession` but reads from the
 * full state tree. Kept for non-React callers (tests, ad-hoc probes via
 * `useRuntimeStore.getState()`); React components must NOT call this via
 * `useRuntimeStore(selectMentionablesForActiveSession)` — see the comment
 * on `mentionablesForSession` for why.
 */
export const selectMentionablesForActiveSession = (
  s: SessionState,
): Mentionable[] => mentionablesForSession(selectActiveSession(s))

const collectFocusedElementRows = (
  artifact: Artifact,
  sessionId: SessionId,
  out: Mentionable[],
): void => {
  const kindLabel = artifactKindLabel(artifact.kind)
  switch (artifact.kind) {
    case 'peak-fit': {
      const peaks = artifact.payload.peaks.slice(0, MAX_ELEMENT_ROWS_PER_KIND)
      for (const peak of peaks) {
        const elementId = peak.id ?? `peak_${peak.index}`
        out.push({
          ref: {
            type: 'artifact-element',
            sessionId,
            artifactId: artifact.id,
            elementKind: 'peak',
            elementId,
            label: peak.label || `Peak ${peak.index + 1}`,
          },
          label: peak.label || `Peak ${peak.index + 1}`,
          sublabel: `pos ${peak.position.toFixed(2)}`,
          kindLabel: `${kindLabel} · peak`,
          group: 'focused',
        })
      }
      break
    }
    case 'xrd-analysis': {
      const phases = artifact.payload.phases.slice(0, MAX_ELEMENT_ROWS_PER_KIND)
      for (const phase of phases) {
        out.push({
          ref: {
            type: 'artifact-element',
            sessionId,
            artifactId: artifact.id,
            elementKind: 'phase',
            elementId: phase.id,
            label: phase.name,
          },
          label: phase.name,
          sublabel: phase.formula,
          kindLabel: `${kindLabel} · phase`,
          group: 'focused',
        })
      }
      break
    }
    case 'xps-analysis': {
      let emittedComponents = 0
      outer: for (
        let fitIndex = 0;
        fitIndex < artifact.payload.fits.length;
        fitIndex++
      ) {
        const fit = artifact.payload.fits[fitIndex]
        for (let peakIndex = 0; peakIndex < fit.peaks.length; peakIndex++) {
          const peak = fit.peaks[peakIndex]
          const elementId = peak.id ?? `xp_${fitIndex}_${peakIndex}`
          const label = `${fit.element} ${fit.line}: ${peak.label || 'component'}`
          out.push({
            ref: {
              type: 'artifact-element',
              sessionId,
              artifactId: artifact.id,
              elementKind: 'xps-component',
              elementId,
              label,
            },
            label,
            sublabel: `${peak.binding.toFixed(2)} eV`,
            kindLabel: `${kindLabel} · component`,
            group: 'focused',
          })
          if (++emittedComponents >= MAX_ELEMENT_ROWS_PER_KIND) break outer
        }
      }
      const rows = artifact.payload.quantification.slice(
        0,
        MAX_ELEMENT_ROWS_PER_KIND,
      )
      for (const row of rows) {
        out.push({
          ref: {
            type: 'artifact-element',
            sessionId,
            artifactId: artifact.id,
            elementKind: 'xps-quant-row',
            elementId: row.element,
            label: row.element,
          },
          label: row.element,
          sublabel: `${row.atomicPercent.toFixed(2)} at%`,
          kindLabel: `${kindLabel} · quant`,
          group: 'focused',
        })
      }
      break
    }
    case 'raman-id': {
      const matches = artifact.payload.matches.slice(
        0,
        MAX_ELEMENT_ROWS_PER_KIND,
      )
      for (const match of matches) {
        out.push({
          ref: {
            type: 'artifact-element',
            sessionId,
            artifactId: artifact.id,
            elementKind: 'raman-match',
            elementId: match.id,
            label: match.mineralName,
          },
          label: match.mineralName,
          sublabel: `${(match.cosineScore * 100).toFixed(1)}%`,
          kindLabel: `${kindLabel} · match`,
          group: 'focused',
        })
      }
      break
    }
    default:
      // Other artifact kinds have no element-level mention surface in MVP —
      // the whole-artifact row in pass (3) still covers them.
      break
  }
}

/**
 * Synchronous best-effort preview of a mention ref against `state`. Never
 * throws; any lookup failure becomes `{ missing: true, label }` so UI chips
 * and the prompt assembler can degrade gracefully. The `previewText` is a
 * short one-liner suitable for chip tooltips and LLM context headers.
 */
export const resolveMentionPreview = (
  state: SessionState,
  ref: MentionRef,
): MentionPreview => {
  // pdf-quote mentions are cross-session (live in the library) — resolve
  // them independently from any session lookup.
  if (ref.type === 'pdf-quote') {
    return {
      label: mentionColdLabel(ref),
      previewText: `pdf · p.${ref.page}`,
    }
  }
  const session = state.sessions[ref.sessionId]
  if (!session) {
    return {
      label: mentionColdLabel(ref),
      missing: true,
    }
  }
  switch (ref.type) {
    case 'file': {
      const file = session.files.find((f) => f.relPath === ref.relPath)
      if (!file) return { label: ref.relPath, missing: true }
      const sizeText = file.size != null ? `${file.size} bytes` : '? bytes'
      const kind = file.spectrumType ?? 'file'
      return {
        label: file.relPath,
        previewText: `${kind} · ${sizeText}`,
      }
    }
    case 'artifact': {
      const artifact = session.artifacts[ref.artifactId]
      if (!artifact) {
        return { label: mentionColdLabel(ref), missing: true }
      }
      if (artifact.kind === 'latex-document') {
        const files = artifact.payload.files ?? []
        const totalChars = files.reduce((n, f) => n + f.content.length, 0)
        const kChars = (totalChars / 1000).toFixed(1)
        return {
          label: artifact.title,
          previewText: `latex · ${files.length} file${files.length === 1 ? '' : 's'} · ${kChars}k chars`,
        }
      }
      const source = artifact.sourceFile ?? ''
      return {
        label: artifact.title,
        // trimEnd removes the trailing " · " when there's no sourceFile.
        previewText: `${artifact.kind} · ${source}`.trimEnd(),
      }
    }
    case 'artifact-element':
      return resolveArtifactElementPreview(session, ref)
  }
}

const mentionColdLabel = (ref: MentionRef): string => {
  if (ref.type === 'file') return ref.relPath
  if (ref.type === 'artifact') return ref.artifactId
  if (ref.type === 'pdf-quote') {
    const short = ref.excerpt.length > 40 ? `${ref.excerpt.slice(0, 39)}…` : ref.excerpt
    return short || `p.${ref.page}`
  }
  return ref.label ?? ref.elementId
}

const resolveArtifactElementPreview = (
  session: Session,
  ref: Extract<MentionRef, { type: 'artifact-element' }>,
): MentionPreview => {
  const artifact = session.artifacts[ref.artifactId]
  if (!artifact) {
    return { label: mentionColdLabel(ref), missing: true }
  }
  switch (ref.elementKind) {
    case 'peak': {
      if (artifact.kind !== 'peak-fit') break
      const peak = findPeakById(artifact as PeakFitArtifact, ref.elementId)
      if (!peak) break
      const label = peak.label || `Peak ${peak.index + 1}`
      const extra: string[] = [`pos ${peak.position.toFixed(2)}`]
      if (peak.fwhm != null) extra.push(`fwhm ${peak.fwhm.toFixed(2)}`)
      return { label, previewText: extra.join(' · ') }
    }
    case 'phase': {
      if (artifact.kind !== 'xrd-analysis') break
      const phase = findPhaseById(
        artifact as XrdAnalysisArtifact,
        ref.elementId,
      )
      if (!phase) break
      return {
        label: phase.name,
        previewText: `${phase.formula} · conf ${(phase.confidence * 100).toFixed(1)}%`,
      }
    }
    case 'xps-component': {
      if (artifact.kind !== 'xps-analysis') break
      const hit = findXpsComponent(
        artifact as XpsAnalysisArtifact,
        ref.elementId,
      )
      if (!hit) break
      const label = `${hit.fit.element} ${hit.fit.line}: ${hit.peak.label || 'component'}`
      return {
        label,
        previewText: `${hit.peak.binding.toFixed(2)} eV · fwhm ${hit.peak.fwhm.toFixed(2)}`,
      }
    }
    case 'xps-quant-row': {
      if (artifact.kind !== 'xps-analysis') break
      const hit = findXpsQuantRow(
        artifact as XpsAnalysisArtifact,
        ref.elementId,
      )
      if (!hit) break
      return {
        label: hit.row.element,
        previewText: `${hit.row.atomicPercent.toFixed(2)} at% · rsf ${hit.row.relativeSensitivity.toFixed(3)}`,
      }
    }
    case 'raman-match': {
      if (artifact.kind !== 'raman-id') break
      const match = findRamanMatchById(
        artifact as RamanIdArtifact,
        ref.elementId,
      )
      if (!match) break
      return {
        label: match.mineralName,
        previewText: `${match.formula} · score ${(match.cosineScore * 100).toFixed(1)}%`,
      }
    }
    // Element kinds not yet surfaced in MVP (peak-group / residual /
    // rietveld-param / xps-fit / graph-* / paper-section) intentionally fall
    // through to `missing`; the chip renders dimmed and the LLM sees a
    // redacted reference. They're added as the owning inspectors grow.
    default:
      break
  }
  return { label: mentionColdLabel(ref), missing: true }
}
