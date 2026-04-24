// Phase 7a — workspace-first orchestrator context.
//
// Seam that lets the orchestrator (and Phase 7c agent-tools) persist their
// output as workspace envelopes instead of mutating `useRuntimeStore`.
// This module owns the filename derivation rules so individual tools do not
// each invent their own `<kind>/<name>.<ext>` layout.
//
// Intentional no-ops when no workspace is mounted: `fs` is null, `emitArtifact`
// returns `''`, `emitTranscript` is a silent skip. Callers decide whether to
// fall back to the legacy runtime-store path (Phase 7c tools) or to early-
// return (Phase 7d workspace-only tools).

import { useEditorStore } from '@/stores/editor-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { writeEnvelope, type WriteEnvelopeInput } from '@/lib/workspace/envelope'
import { extensionForKind } from '@/lib/workspace/file-kind'
import type { IWorkspaceFs } from '@/lib/workspace/fs'
import type { LatticeFileKind } from '@/lib/workspace/fs/types'
import type { TranscriptMessage } from '@/types/session'
import {
  persistChatMessage,
} from '@/lib/workspace/persist-ws-events'

export interface EmitArtifactHint {
  /** Relative directory under the workspace root. Defaults to the kind name
   *  (e.g. `research-report/`). No leading or trailing slash. */
  dir?: string
  /** Base name without extension. Defaults to `<kind>-<timestampMs>`. */
  basename?: string
  /** Envelope meta — persisted verbatim alongside the payload. */
  meta?: Record<string, unknown>
  /** Relative paths of parent artifacts; merged into `meta.parents`. */
  parents?: string[]
  /** Optional explicit envelope id; defaults to `<kind>_<ts>_<rand>`. */
  id?: string
}

export interface StructureArtifactRefs {
  /** Relative path to the `.cif` text file — canonical structure body. */
  cifRel: string
  /** Relative path to the `.structure.meta.json` envelope carrying
   *  lattice / formula / transforms metadata alongside the CIF. */
  metaRel: string
}

export interface OrchestratorCtx {
  /** Absolute root path of the mounted workspace, or null when none. */
  workspaceRoot: string | null
  /** Shared IWorkspaceFs when a workspace is mounted; null otherwise. */
  fs: IWorkspaceFs | null
  /** Persist `payload` as a workspace envelope. Returns the relative path
   *  written to, or `''` when no workspace is mounted. */
  emitArtifact(
    kind: LatticeFileKind,
    payload: unknown,
    hint?: EmitArtifactHint,
  ): Promise<string>
  /** Write a raw text file (e.g. `.py` script body, `.cif` structure body)
   *  at `relPath`. Returns the relative path, or `''` when no workspace. */
  emitTextFile(relPath: string, text: string): Promise<string>
  /** Write a structure artifact as a `.cif` body + sibling
   *  `.structure.meta.json` envelope. Returns both rel paths, or null when
   *  no workspace is mounted. */
  emitStructureArtifact(
    cifText: string,
    meta: Record<string, unknown>,
    hint?: EmitArtifactHint,
  ): Promise<StructureArtifactRefs | null>
  /** Append a transcript message to the editor's active chat file.
   *  No-op when there is no active chat file or no workspace. */
  emitTranscript(message: TranscriptMessage): Promise<void>
  /** Open a workspace file in the editor. Silent no-op outside of a browser
   *  render context. */
  openFile(relPath: string): void
}

const DEFAULT_EXTENSION = '.json'

function genEnvelopeId(kind: LatticeFileKind): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${kind}_${Date.now().toString(36)}_${rand}`
}

function sanitizeBasename(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return trimmed
    // Strip directory separators — hint basenames must stay within their dir.
    .replace(/[\\/]+/g, '_')
    // Neutralise characters hostile on Windows / shells.
    .replace(/[:*?"<>|\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120)
}

function sanitizeDir(raw: string | undefined, fallback: string): string {
  const candidate = (raw ?? '').trim().replace(/^\/+|\/+$/g, '')
  return candidate.length > 0 ? candidate : fallback
}

function derivePath(kind: LatticeFileKind, hint?: EmitArtifactHint): string {
  const dir = sanitizeDir(hint?.dir, kind)
  const basename =
    sanitizeBasename(hint?.basename ?? '') ||
    `${kind}-${Date.now().toString(36)}`
  const ext = extensionForKind(kind) ?? DEFAULT_EXTENSION
  return `${dir}/${basename}${ext}`
}

async function ensureDir(fs: IWorkspaceFs, rel: string): Promise<void> {
  try {
    await fs.mkdir(rel)
  } catch {
    // mkdir is best-effort idempotent on the backend; swallow "already exists".
  }
}

async function emitArtifactImpl(
  fs: IWorkspaceFs | null,
  kind: LatticeFileKind,
  payload: unknown,
  hint: EmitArtifactHint | undefined,
): Promise<string> {
  if (!fs) {
    console.warn(
      `[orchestrator-ctx] emitArtifact(${kind}): no workspace mounted — drop`,
    )
    return ''
  }
  const relPath = derivePath(kind, hint)
  const dir = relPath.slice(0, relPath.lastIndexOf('/'))
  if (dir) await ensureDir(fs, dir)

  const meta: Record<string, unknown> = { ...(hint?.meta ?? {}) }
  if (hint?.parents && hint.parents.length > 0) {
    meta.parents = hint.parents
  }

  const envelope: WriteEnvelopeInput<unknown> = {
    kind,
    id: hint?.id ?? genEnvelopeId(kind),
    payload,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  }
  await writeEnvelope(fs, relPath, envelope)
  // Refresh the parent dir so Explorer / file index observe the new entry
  // without waiting on a chokidar event.
  try {
    await useWorkspaceStore.getState().refreshDir(dir)
  } catch {
    // workspace-store may be un-hydrated in a headless context; the write
    // itself is the authoritative action.
  }
  return relPath
}

async function emitTextFileImpl(
  fs: IWorkspaceFs | null,
  relPath: string,
  text: string,
): Promise<string> {
  if (!fs) {
    console.warn(
      `[orchestrator-ctx] emitTextFile(${relPath}): no workspace mounted — drop`,
    )
    return ''
  }
  const normalized = relPath.replace(/^\/+|\/+$/g, '')
  if (!normalized) return ''
  const dir = normalized.slice(0, normalized.lastIndexOf('/'))
  if (dir) await ensureDir(fs, dir)
  await fs.writeText(normalized, text)
  try {
    await useWorkspaceStore.getState().refreshDir(dir)
  } catch {
    // see emitArtifactImpl
  }
  return normalized
}

async function emitStructureArtifactImpl(
  fs: IWorkspaceFs | null,
  cifText: string,
  meta: Record<string, unknown>,
  hint: EmitArtifactHint | undefined,
): Promise<{ cifRel: string; metaRel: string } | null> {
  if (!fs) {
    console.warn(
      '[orchestrator-ctx] emitStructureArtifact: no workspace mounted — drop',
    )
    return null
  }
  const dir = sanitizeDir(hint?.dir, 'structure')
  const basename =
    sanitizeBasename(hint?.basename ?? '') ||
    `structure-${Date.now().toString(36)}`
  const cifRel = `${dir}/${basename}.cif`
  const metaRel = `${dir}/${basename}.structure.meta.json`

  await ensureDir(fs, dir)
  await fs.writeText(cifRel, cifText)

  const envelopeMeta: Record<string, unknown> = {
    ...meta,
    cifRel,
  }
  if (hint?.parents && hint.parents.length > 0) {
    envelopeMeta.parents = hint.parents
  }
  await writeEnvelope(fs, metaRel, {
    kind: 'structure-meta',
    id: hint?.id ?? genEnvelopeId('structure-meta'),
    payload: meta,
    meta: envelopeMeta,
  })

  try {
    await useWorkspaceStore.getState().refreshDir(dir)
  } catch {
    // see emitArtifactImpl
  }
  return { cifRel, metaRel }
}

async function emitTranscriptImpl(
  fs: IWorkspaceFs | null,
  message: TranscriptMessage,
): Promise<void> {
  if (!fs) return
  const activeChatRel = useEditorStore.getState().activeChatFile
  if (!activeChatRel) return
  try {
    await persistChatMessage(
      fs,
      activeChatRel,
      message,
      () => useWorkspaceStore.getState().dirtyBuffer[activeChatRel]?.data,
      (d) => useWorkspaceStore.getState().setDirty(activeChatRel, d),
      () => useWorkspaceStore.getState().clearDirty(activeChatRel),
      true,
    )
  } catch (err) {
    console.error('[orchestrator-ctx] emitTranscript failed', err)
  }
}

/** Build an `OrchestratorCtx` bound to the live workspace + editor stores.
 *  Intended to be called once per `runAgentTurn`; the resulting ctx is
 *  passed into every `tool.execute()` on that turn. Headless callers (tests)
 *  can pass an explicit `fs` override. */
export function createOrchestratorCtx(
  overrides?: { fs?: IWorkspaceFs | null },
): OrchestratorCtx {
  const workspace = useWorkspaceStore.getState()
  const fs = overrides?.fs !== undefined
    ? overrides.fs
    : workspace.rootPath
      ? workspace.getFs()
      : null
  return {
    workspaceRoot: workspace.rootPath,
    fs,
    emitArtifact: (kind, payload, hint) =>
      emitArtifactImpl(fs, kind, payload, hint),
    emitTextFile: (relPath, text) => emitTextFileImpl(fs, relPath, text),
    emitStructureArtifact: (cifText, meta, hint) =>
      emitStructureArtifactImpl(fs, cifText, meta, hint),
    emitTranscript: (message) => emitTranscriptImpl(fs, message),
    openFile: (relPath) => {
      if (!relPath) return
      try {
        useEditorStore.getState().openFile(relPath)
      } catch (err) {
        console.warn('[orchestrator-ctx] openFile failed', relPath, err)
      }
    },
  }
}
