// Agent tool — `latex_insert_figure_from_artifact`. Drafts a LaTeX
// figure / table snippet sourced from another artifact (XRD phases,
// spectrum, structure, …) and proposes an insert point inside a target
// `latex-document` artifact. The draft is returned for human approval;
// the actual splice happens in the registered patch applier.
//
// The concrete implementation is split across ./latex-insert-figure/*:
//   - types.ts    Placement enum, Input / SuccessOutput / ErrorOutput
//   - helpers.ts  pure LaTeX escaping, snippet builders, anchor resolver
//   - io.ts       LLM caption generation + runtime-store patch applier
// This file keeps only the public LocalTool wiring and execute flow,
// plus a re-export of `applyLatexInsertFigurePatch` so the applier
// registry's import path stays stable.

import type { LocalTool } from '../../types/agent-tool'
import type { LatexDocumentPayload } from '../../types/latex'
import { useRuntimeStore } from '../../stores/runtime-store'
import { buildSnippet, resolveInsertPoint } from './latex-insert-figure/helpers'
import {
  applyLatexInsertFigurePatch,
  generateCaption,
} from './latex-insert-figure/io'
import type { Input, Output, Placement } from './latex-insert-figure/types'

export { applyLatexInsertFigurePatch }

export const latexInsertFigureFromArtifactTool: LocalTool<Input, Output> = {
  name: 'latex_insert_figure_from_artifact',
  description:
    'Draft a LaTeX figure / table snippet for insertion into a latex-' +
    'document artifact, sourced from another artifact (XRD phases, ' +
    'spectrum, structure, …). Returns the snippet + proposed insert point ' +
    'for human approval. MVP emits tabular-only fragments; \\includegraphics ' +
    'is reserved for Phase D when artifact PNG export lands.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      latexArtifactId: {
        type: 'string',
        description: 'Destination latex-document artifact id.',
      },
      sourceArtifactId: {
        type: 'string',
        description: 'Source artifact whose contents drive the snippet.',
      },
      caption: {
        type: 'string',
        description:
          'Optional caption text. When omitted the tool generates a one-' +
          'sentence academic caption via the LLM.',
      },
      placement: {
        type: 'string',
        description:
          'Where to anchor the insertion: "cursor" (default) uses the ' +
          'active file\'s saved cursor; "end" appends to the root file; ' +
          '"section" inserts before the next \\section.',
      },
    },
    required: ['latexArtifactId', 'sourceArtifactId'],
  },

  async execute(input, ctx) {
    const latexArtifactId =
      typeof input?.latexArtifactId === 'string'
        ? input.latexArtifactId.trim()
        : ''
    const sourceArtifactId =
      typeof input?.sourceArtifactId === 'string'
        ? input.sourceArtifactId.trim()
        : ''
    if (!latexArtifactId) {
      return { success: false, error: 'latexArtifactId is required' }
    }
    if (!sourceArtifactId) {
      return { success: false, error: 'sourceArtifactId is required' }
    }

    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) {
      return { success: false, error: `Session not found: ${ctx.sessionId}` }
    }
    const latex = session.artifacts[latexArtifactId]
    if (!latex || latex.kind !== 'latex-document') {
      return {
        success: false,
        error: `latex-document artifact not found: ${latexArtifactId}`,
      }
    }
    const source = session.artifacts[sourceArtifactId]
    if (!source) {
      return {
        success: false,
        error: `Source artifact not found: ${sourceArtifactId}`,
      }
    }

    const placement: Placement =
      input.placement === 'end' || input.placement === 'section'
        ? input.placement
        : 'cursor'

    const payload = latex.payload as LatexDocumentPayload
    const anchor = resolveInsertPoint(payload, placement)

    const caption = await generateCaption(
      ctx.sessionId,
      source,
      typeof input.caption === 'string' ? input.caption : undefined,
    )
    const snippet = buildSnippet(source, caption)

    return {
      success: true,
      artifactId: latexArtifactId,
      insertFile: anchor.file,
      insertAt: anchor.offset,
      snippet,
      sourceKind: source.kind,
      summary: `Drafted ${source.kind} snippet for ${anchor.file}@${anchor.offset}`,
    }
  },
}
