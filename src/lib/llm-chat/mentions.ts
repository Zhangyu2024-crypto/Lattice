// Mention context-block serialisation. Walks the session + workspace
// stores to pull prompt-friendly slices out of artifacts / files / PDF
// quotes, applies the provider's resolve policy, and packages everything
// into the IPC `contextBlocks` shape. Split from `llm-chat.ts` — pure
// code motion.

import { useWorkspaceStore } from '@/stores/workspace-store'
import { fileKindFromName } from '@/lib/workspace/file-kind'
import { resolveMentionPreview, useRuntimeStore } from '../../stores/runtime-store'
import { estimateTokens } from '../token-estimator'
import { extractLatexMentionContext } from '../latex/mention-resolver-latex'
import type { LatticeFileKind } from '../workspace/fs/types'
import type { LlmContextBlockPayload } from '../../types/electron'
import type { MentionResolvePolicy } from '../../types/llm'
import type { MentionRef } from '../../types/mention'
import {
  MENTION_BUDGET,
  REDACTED_BODY,
  WORKSPACE_FILE_MENTION_NOTE,
  WORKSPACE_FILE_MENTION_NOTE_REF_KEY,
  isBinaryKind,
} from './constants'

export interface ContextBlocksOutcome {
  blocks: LlmContextBlockPayload[]
  /** Display labels for each surviving block, in input order — used by the
   *  `'confirm'` toast to remind the user what is going out. */
  labels: string[]
}

/**
 * Serialise `mentions` into IPC-ready context blocks, applying the provider
 * policy in the process. `'block'` swaps the body for {@link REDACTED_BODY}
 * but still emits one block per mention so the prompt structure (anchor
 * count, header order) is preserved.
 */
export function buildContextBlocks(
  state: ReturnType<typeof useRuntimeStore.getState>,
  mentions: ReadonlyArray<{ anchor: string; ref: MentionRef }>,
  policy: MentionResolvePolicy,
): ContextBlocksOutcome {
  const blocks: LlmContextBlockPayload[] = []
  const labels: string[] = []
  let hasFileMention = false
  for (const { anchor, ref } of mentions) {
    if (ref.type === 'file') hasFileMention = true
    const preview = resolveMentionPreview(state, ref)
    labels.push(preview.label)
    let body: string
    if (policy === 'block') {
      body = REDACTED_BODY
    } else {
      const serialized = serializeMentionForLLM(state, ref, preview)
      const raw = `anchor: ${anchor}\n${serialized}`
      body = truncateForBudget(raw, MENTION_BUDGET[ref.type])
    }
    blocks.push({
      refKey: anchor,
      body,
      tokenEstimate: estimateTokens(body),
    })
  }
  // Phase 3: prepend the one-shot operator note exactly once per turn when
  // any file mention is present. Emitted before per-mention blocks so the
  // agent reads the "how to use" guidance before the metadata payloads
  // that follow.
  if (hasFileMention) {
    blocks.unshift({
      refKey: WORKSPACE_FILE_MENTION_NOTE_REF_KEY,
      body: WORKSPACE_FILE_MENTION_NOTE,
      tokenEstimate: estimateTokens(WORKSPACE_FILE_MENTION_NOTE),
    })
  }
  return { blocks, labels }
}

/**
 * Produce a JSON line describing `ref` for the LLM. The shape is
 * deliberately stable (always `{ ref, label, previewText, missing, data }`)
 * so prompt-engineering iteration can rely on a known schema; `data` is
 * `null` for missing references so the model can detect them without a
 * separate code path.
 */
function serializeMentionForLLM(
  state: ReturnType<typeof useRuntimeStore.getState>,
  ref: MentionRef,
  preview: { label: string; previewText?: string; missing?: boolean },
): string {
  const data = preview.missing ? null : extractMentionData(state, ref)
  const payload = {
    ref,
    label: preview.label,
    previewText: preview.previewText,
    missing: preview.missing ?? false,
    data,
  }
  try {
    return JSON.stringify(payload)
  } catch {
    // Cyclic payloads should be impossible (artifact payloads are plain
    // structured data) but a defensive fallback keeps the prompt shippable.
    return JSON.stringify({
      ...payload,
      data: '[unserializable]',
    })
  }
}

/**
 * Pull the lightweight, prompt-friendly slice of a session object that
 * matches `ref`. This is intentionally narrower than the artifact's full
 * runtime shape — payload arrays may be huge, so the caller still applies
 * {@link MENTION_BUDGET} truncation on the JSON afterwards.
 */
function extractMentionData(
  state: ReturnType<typeof useRuntimeStore.getState>,
  ref: MentionRef,
): unknown {
  if (ref.type === 'pdf-quote') {
    return {
      type: 'pdf-quote',
      paperId: ref.paperId,
      page: ref.page,
      excerpt: ref.excerpt,
    }
  }
  const session = state.sessions[ref.sessionId]
  if (!session) return null
  switch (ref.type) {
    case 'file': {
      // Phase 3: file mentions ship metadata only (`relPath`, `kind`,
      // `sizeBytes`, `isBinary`). Contents are deliberately NOT inlined —
      // the agent reads the body through workspace_* tools so we don't
      // blow the context window on a casual @-mention.
      //
      // Lookup order:
      //   1. session.files — the session-scoped copy (fastest; may carry
      //      a derived `spectrumType` we don't currently surface on the
      //      SessionFile shape but preserve for future enrichment).
      //   2. workspace-store fileIndex — workspace-root @-mentions the
      //      user can drop in before the file has been imported into any
      //      session yet.
      //   3. fall through to a `missing` envelope so the model still sees
      //      the ref and can decide to probe with workspace_grep/glob.
      // SessionFile currently carries just `{relPath, spectrumType?, size?,
      // importedAt}`. We narrow through an `as` cast so forward-compat
      // enrichment (adding `kind`/`name` to the type later) is a drop-in
      // change that does not re-invent this lookup.
      const sessionFile = session.files.find((f) => f.relPath === ref.relPath)
      if (sessionFile) {
        const sessionFileEx = sessionFile as typeof sessionFile & {
          kind?: LatticeFileKind
          name?: string
        }
        const basename =
          sessionFileEx.name ?? ref.relPath.split('/').pop() ?? ''
        const kind: LatticeFileKind =
          sessionFileEx.kind ?? fileKindFromName(basename)
        return {
          relPath: ref.relPath,
          kind,
          sizeBytes: sessionFile.size ?? null,
          isBinary: isBinaryKind(kind),
          source: 'session',
        }
      }
      const entry = useWorkspaceStore.getState().fileIndex[ref.relPath]
      if (!entry) {
        return {
          relPath: ref.relPath,
          kind: 'unknown' as LatticeFileKind,
          sizeBytes: null,
          isBinary: false,
          source: 'missing',
        }
      }
      const kind: LatticeFileKind = entry.kind ?? fileKindFromName(entry.name)
      return {
        relPath: ref.relPath,
        kind,
        sizeBytes: entry.size,
        isBinary: isBinaryKind(kind),
        source: 'workspace',
      }
    }
    case 'artifact': {
      const artifact = session.artifacts[ref.artifactId]
      if (!artifact) return null
      const payload =
        artifact.kind === 'latex-document'
          ? extractLatexMentionContext(artifact.payload)
          : artifact.payload
      return {
        title: artifact.title,
        kind: artifact.kind,
        sourceFile: artifact.sourceFile ?? null,
        params: artifact.params ?? null,
        // Payload may be large; the JSON-level truncation downstream is the
        // hard cap. We keep it untouched here so any structured field still
        // visible after truncation reads cleanly.
        payload,
      }
    }
    case 'artifact-element': {
      const artifact = session.artifacts[ref.artifactId]
      if (!artifact) return null
      return {
        artifactTitle: artifact.title,
        artifactKind: artifact.kind,
        elementKind: ref.elementKind,
        elementId: ref.elementId,
        // The renderer's `resolveMentionPreview` already pulled the matching
        // sub-object's identifying fields into `previewText`; including the
        // full artifact payload again would defeat the per-element budget.
      }
    }
  }
}

/**
 * Truncate `body` to at most `limit` characters, appending an explicit
 * marker so the model can tell when it's been clipped. Returns the body
 * unchanged when it already fits.
 */
function truncateForBudget(body: string, limit: number): string {
  if (body.length <= limit) return body
  // Reserve room for the marker so the result truly fits within `limit`.
  const marker = '\n...[truncated]'
  const headLen = Math.max(0, limit - marker.length)
  return `${body.slice(0, headLen)}${marker}`
}
