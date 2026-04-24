// Phase ε — preview registry for the unified AgentCard.
//
// Two lookup axes:
//
//   1. `getToolPreview(toolName)` — returns a per-tool preview resolver
//      used when AgentCard is rendering a TaskStep. Tools added in
//      Phase ζ (spectrum / compute / structure) contribute entries
//      here. The resolver receives `(step, artifact)` so a preview can
//      reuse the tool's structured output AND pull additional context
//      from the artifact store when useful.
//
//   2. `getArtifactPreview(kind)` — the legacy Phase-δ per-kind preview,
//      used when AgentCard is rendering a pure `artifactCardRef` bubble
//      (no tool-call step). This is the code that used to live as the
//      `renderPreview` switch inside ChatArtifactCard.
//
// Keeping both in one file — and isolated from AgentCard itself — means
// new tools drop an entry without touching the shell, and the fallback
// path stays stable while ζ is in flight.
//
// Implementation split (2026-04-20): the per-kind fallback renderers were
// moved to `./preview-registry/artifact-kind-previews.tsx`, and the
// compute/structure/latex/library inline tool registrations were moved
// into sibling `./tool-previews/register-*-previews.tsx` modules. This
// file keeps the registry core + the kind constants that sit at the top
// of the fallback chain. Public API is unchanged — the artifact-kind
// fallback is re-exported below so callers can keep importing
// `getArtifactPreview` from here.

import type { ReactNode } from 'react'
import type { TaskStep } from '../../../types/session'
import type { Artifact, ArtifactKind } from '../../../types/artifact'
import GenericToolCard from './GenericToolCard'
import { buildOneLiner as buildGenericOneLiner } from './generic-tool-card/helpers'
import { getArtifactPreview } from './preview-registry/artifact-kind-previews'
import { looksLikeJsonLiteral } from './preview-registry/helpers'

/** A preview is three optional slots: a short inline summary rendered
 *  next to the card title, a compact always-visible body, and an
 *  expanded body revealed when the user clicks "Expand". Tools and
 *  artifact kinds may populate any subset. */
export interface PreviewBlocks {
  oneLiner?: string
  meta?: Array<{ label: string; value: string }>
  compact?: ReactNode
  expanded?: ReactNode
}

/** Per-tool preview resolver. `artifact` is the artifact referenced by
 *  the step's output (looked up by AgentCard) — `undefined` when the
 *  tool did not produce one. */
export type ToolPreviewResolver = (
  step: TaskStep,
  artifact: Artifact | undefined,
) => PreviewBlocks

const TOOL_PREVIEW_REGISTRY: Record<string, ToolPreviewResolver> = {}

/** Register a tool's preview resolver. Callers should use a stable tool
 *  name — the same string the orchestrator stamps on `TaskStep.toolName`
 *  and the LocalTool catalog. */
export function registerToolPreview(
  toolName: string,
  resolver: ToolPreviewResolver,
): void {
  TOOL_PREVIEW_REGISTRY[toolName] = resolver
}

/** Look up a tool's preview resolver. Returns `null` when no entry is
 *  registered so the caller can fall back to the artifact-kind path. */
export function getToolPreview(
  toolName: string | undefined,
): ToolPreviewResolver | null {
  if (!toolName) return null
  return TOOL_PREVIEW_REGISTRY[toolName] ?? null
}

/**
 * Resolve the preview blocks for a TaskStep using the full three-tier
 * fallback chain the unified AgentCard expects:
 *
 *   1. Tool-specific resolver registered via {@link registerToolPreview}.
 *      Tools with bespoke UIs (detect_peaks, xrd_search_phases, …) fall
 *      into this bucket.
 *   2. Artifact-kind generic preview, when the step produced an artifact
 *      but the tool itself has no custom resolver. This is what lets
 *      RAG / meta tools like `literature_search` show a meaningful
 *      preview without every tool owning a bespoke renderer.
 *   3. `step.outputSummary` as a plain one-liner — last-resort fallback
 *      so the card never renders empty when the tool reported *something*.
 *
 * Callers should pass the artifact the step referenced via
 * `outputMentions` (if any). Returning `{}` here means the card is
 * genuinely contentless — the header will show only the tool name.
 */
export function resolveStepPreview(
  step: TaskStep,
  artifact: Artifact | undefined,
): PreviewBlocks {
  const toolPreview = getToolPreview(step.toolName)
  if (toolPreview) {
    const blocks = toolPreview(step, artifact)
    // A custom resolver may return an empty object on purpose (e.g. it
    // has no additional info to surface over `outputSummary`). Fall
    // through to the generic structural card in that case rather than
    // dropping to a bare one-liner.
    if (!blocks.oneLiner && !blocks.compact && !blocks.expanded) {
      return buildGenericPreview(step)
    }
    return blocks
  }
  if (artifact) return getArtifactPreview(artifact)
  // Phase 2 — Tool-Card Coverage: instead of emitting a bare
  // `outputSummary` one-liner when no tool-specific resolver exists,
  // hand off to the GenericToolCard so the card still shows the
  // structured input args + output shape.
  return buildGenericPreview(step)
}

/** Build a PreviewBlocks triple backed entirely by GenericToolCard. The
 *  `oneLiner` falls back to `step.outputSummary` so the header stays
 *  visually identical for steps whose output is empty or unstructured.
 *
 *  NOTE: AgentCard renders `compact` and `expanded` side by side once the
 *  user opens the card body, so we only fill the `compact` slot here —
 *  the GenericToolCard's `"expanded"` density already shows everything
 *  the user would want to see. Populating both would duplicate the
 *  input KV block and the output shape renderer. */
function buildGenericPreview(step: TaskStep): PreviewBlocks {
  const raw = buildGenericOneLiner(step) ?? step.outputSummary
  // Never let a raw JSON blob (e.g. the orchestrator's
  // `summarizeToolOutput` fallback) surface as the card's one-line
  // summary. When the only thing we have is stringified wire noise, fall
  // back to the tool name so the header reads "workspace_read_file" over
  // "{\"content\":\"<N B elided>\",…}".
  const oneLiner =
    raw && !looksLikeJsonLiteral(raw) ? raw : step.toolName || undefined
  return {
    oneLiner,
    compact: <GenericToolCard step={step} density="expanded" />,
  }
}

// ─── Artifact-kind fallback (re-exported from split module) ───────────

// `getArtifactPreview` lives in `./preview-registry/artifact-kind-previews.tsx`.
// Re-exported here so external callers keep the original import path.
export { getArtifactPreview }

// ─── Kind → icon + label (shared across the card) ─────────────────────

export const WORKBENCH_ARTIFACT_KINDS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>([
  'xrd-pro',
  'xps-pro',
  'raman-pro',
  'spectrum-pro',
  'curve-pro',
  'compute-pro',
  'latex-document',
  'research-report',
  'plot',
])

export const ARTIFACT_KIND_LABEL: Partial<Record<ArtifactKind, string>> = {
  spectrum: 'Spectrum',
  'peak-fit': 'Peak Fit',
  'xrd-analysis': 'XRD Analysis',
  'xps-analysis': 'XPS Analysis',
  'raman-id': 'Raman ID',
  structure: 'Structure',
  compute: 'Compute',
  job: 'Job',
  'research-report': 'Report',
  batch: 'Batch',
  'knowledge-graph': 'Knowledge Graph',
  'material-comparison': 'Material Compare',
  paper: 'Paper',
  'similarity-matrix': 'Similarity',
  optimization: 'Optimization',
  hypothesis: 'Hypothesis',
  'xrd-pro': 'XRD Workbench',
  'xps-pro': 'XPS Workbench',
  'raman-pro': 'Raman Workbench',
  'curve-pro': 'Curve Workbench',
  'curve-analysis': 'Curve Analysis',
  'spectrum-pro': 'Spectrum Workbench',
  'compute-pro': 'Compute Workbench',
  'latex-document': 'LaTeX',
}
