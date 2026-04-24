// Side-effectful I/O for `latex_insert_figure_from_artifact`:
//   - `generateCaption` asks the LLM for a one-sentence caption when the
//     caller doesn't supply one.
//   - `applyLatexInsertFigurePatch` mutates the runtime store to splice
//     the drafted snippet into the target latex-document artifact on
//     user approval (wired via the applier-registry).

import type { Artifact } from '../../../types/artifact'
import type { LatexDocumentPayload } from '../../../types/latex'
import { useRuntimeStore } from '../../../stores/runtime-store'
import { sendLlmChat } from '../../llm-chat'
import { CAPTION_SYSTEM, summarizeForCaption } from './helpers'
import type { SuccessOutput } from './types'

export async function generateCaption(
  sessionId: string,
  artifact: Artifact,
  userCaption: string | undefined,
): Promise<string> {
  const trimmed = userCaption?.trim()
  if (trimmed && trimmed.length > 0) return trimmed

  const payloadSketch = {
    kind: artifact.kind,
    title: artifact.title,
    // Ship a tight sketch rather than the whole payload — one sentence of
    // caption doesn't warrant shipping arbitrarily large y-arrays.
    payload: summarizeForCaption(artifact),
  }
  const prompt =
    `${CAPTION_SYSTEM}\n\n` +
    `Artifact JSON:\n${JSON.stringify(payloadSketch)}\n\n` +
    `Write ONE sentence (no prose around it).`

  const llm = await sendLlmChat({
    mode: 'agent',
    userMessage: prompt,
    transcript: [],
    sessionId,
  })
  if (!llm.success) {
    return `Summary of ${artifact.title}.`
  }
  const line = llm.content.split('\n').find((l) => l.trim().length > 0)
  const clean = (line ?? '').trim().replace(/^["']|["']$/g, '')
  return clean.length > 0 ? clean : `Summary of ${artifact.title}.`
}

// ─── Patch applier ─────────────────────────────────────────────────────
//
// Insert `snippet` at `insertAt` in `insertFile`. Called from AgentCard's
// Approve handler via the tool applier-registry.

export function applyLatexInsertFigurePatch(
  sessionId: string,
  output: SuccessOutput,
): void {
  const store = useRuntimeStore.getState()
  const session = store.sessions[sessionId]
  if (!session) return
  const artifact = session.artifacts[output.artifactId]
  if (!artifact || artifact.kind !== 'latex-document') return
  const payload = artifact.payload as LatexDocumentPayload
  const fileIdx = payload.files.findIndex((f) => f.path === output.insertFile)
  if (fileIdx < 0) return
  const target = payload.files[fileIdx]
  const at = Math.max(0, Math.min(target.content.length, output.insertAt))
  // Add surrounding newlines if the insertion point isn't already on a
  // blank line — keeps figures visually separated from prose.
  const leading = at > 0 && target.content[at - 1] !== '\n' ? '\n\n' : ''
  const trailing =
    at < target.content.length && target.content[at] !== '\n' ? '\n\n' : ''
  const insert = `${leading}${output.snippet}${trailing}`
  const next = target.content.slice(0, at) + insert + target.content.slice(at)
  const nextFiles = payload.files.map((f, i) =>
    i === fileIdx ? { ...f, content: next } : f,
  )
  store.patchArtifact(sessionId, artifact.id, {
    payload: { ...payload, files: nextFiles },
  } as never)
}
