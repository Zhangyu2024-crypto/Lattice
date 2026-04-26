// Per-tool patch applier registry.
//
// The orchestrator's approval flow feeds `editedOutput` back to the LLM as
// the tool_result, but does NOT mutate artifacts. For tools whose output
// represents a mutation the user just approved (apply a diff, insert a
// snippet, write citations), we register an imperative applier here.
// AgentCard's Approve handler calls the registered function with the
// current output (edited or raw) BEFORE routing approval back through
// setStepApproval, so the artifact and the LLM's view stay in sync.

import { toast } from '../../../stores/toast-store'
import {
  applyLatexEditSelectionPatch,
  type LatexEditSelectionOutput,
} from '../../../lib/agent-tools/latex-selection'
import { applyLatexFixCompileErrorPatch } from '../../../lib/agent-tools/latex-fix-compile-error'
import { applyLatexInsertFigurePatch } from '../../../lib/agent-tools/latex-insert-figure-from-artifact'
import { applyLatexCitationOps } from '../../../lib/agent-tools/latex-add-citation'
import type {
  WorkspaceEditProposal,
  WorkspaceWriteProposal,
} from '../../../lib/agent-tools/workspace-files'
import { useRuntimeStore } from '../../../stores/runtime-store'

export type ToolApplier = (sessionId: string, output: unknown) => void

const PROPOSAL_FIRST_TOOLS = new Set([
  'detect_peaks',
  'format_convert',
  'latex_add_citation',
  'latex_edit_selection',
  'latex_fix_compile_error',
  'latex_insert_figure_from_artifact',
  'workspace_edit_file',
  'workspace_write_file',
])

export function isProposalFirstTool(toolName: string | undefined): boolean {
  return typeof toolName === 'string' && PROPOSAL_FIRST_TOOLS.has(toolName)
}

// Type-narrowing guards. Each applier re-validates the output shape so
// AgentCard's unknown `editedOutput` is never dereferenced without a check.
function asEditSelection(output: unknown): LatexEditSelectionOutput | null {
  if (!output || typeof output !== 'object') return null
  const c = output as Partial<LatexEditSelectionOutput>
  if (typeof c.artifactId !== 'string') return null
  if (typeof c.file !== 'string') return null
  if (typeof c.from !== 'number' || typeof c.to !== 'number') return null
  if (typeof c.after !== 'string') return null
  return output as LatexEditSelectionOutput
}

function asWorkspaceWriteProposal(
  output: unknown,
): WorkspaceWriteProposal | null {
  if (!output || typeof output !== 'object') return null
  const c = output as Partial<WorkspaceWriteProposal>
  if (typeof c.relPath !== 'string' || typeof c.proposedContent !== 'string') {
    return null
  }
  return output as WorkspaceWriteProposal
}

function asWorkspaceEditProposal(
  output: unknown,
): WorkspaceEditProposal | null {
  if (!output || typeof output !== 'object') return null
  const c = output as Partial<WorkspaceEditProposal>
  if (typeof c.relPath !== 'string') return null
  if (typeof c.existingContent !== 'string') return null
  if (!Array.isArray(c.patches)) return null
  for (const p of c.patches) {
    if (!p || typeof p !== 'object') return null
    const patch = p as { oldString?: unknown; newString?: unknown }
    if (typeof patch.oldString !== 'string') return null
    if (typeof patch.newString !== 'string') return null
  }
  return output as WorkspaceEditProposal
}

function asComputeScriptEdit(
  output: unknown,
): { artifactId: string; code: string } | null {
  if (!output || typeof output !== 'object') return null
  const c = output as { artifactId?: unknown; code?: unknown }
  if (typeof c.artifactId !== 'string') return null
  if (typeof c.code !== 'string') return null
  return { artifactId: c.artifactId, code: c.code }
}

function applyComputeScriptEdit(sessionId: string, output: unknown): void {
  const parsed = asComputeScriptEdit(output)
  if (!parsed) return
  const store = useRuntimeStore.getState()
  const session = store.sessions[sessionId]
  const artifact = session?.artifacts[parsed.artifactId]
  if (!artifact || artifact.kind !== 'compute') return
  store.patchArtifact(sessionId, parsed.artifactId, {
    payload: {
      ...artifact.payload,
      code: parsed.code,
      stdout: '',
      stderr: '',
      figures: [],
      exitCode: null,
      status: 'idle',
      runId: null,
      durationMs: undefined,
    },
  } as never)
}

/** Write via the root-scoped IPC. Shared between the write + edit
 *  appliers because both paths end with a single atomic workspace:write
 *  call. Non-blocking: the applier contract is synchronous; the actual
 *  IPC is async so we fire-and-forget and surface any error via toast. */
function applyWorkspaceWriteAsync(relPath: string, content: string): void {
  const api = window.electronAPI as unknown as {
    workspaceWrite?: (
      rel: string,
      content: string,
    ) => Promise<{ ok: boolean; error?: string; bytes?: number }>
  } | undefined
  if (!api?.workspaceWrite) {
    toast.error('Workspace IPC unavailable — write not applied.')
    return
  }
  void api
    .workspaceWrite(relPath, content)
    .then((res) => {
      if (!res?.ok) {
        toast.error(`Write failed: ${res?.error ?? 'unknown error'}`)
      }
    })
    .catch((err: unknown) => {
      toast.error(
        `Write failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
}

const REGISTRY: Record<string, ToolApplier> = {
  detect_peaks: (sessionId, output) => {
    if (!output || typeof output !== 'object') return
    const o = output as { artifactId?: string; peaks?: unknown[] }
    if (!o.artifactId || !Array.isArray(o.peaks)) return
    const store = useRuntimeStore.getState()
    const session = store.sessions[sessionId]
    if (!session) return
    const artifact = session.artifacts[o.artifactId]
    if (!artifact) return
    const isXps = artifact.kind === 'xps-pro'
    const field = isXps ? 'detectedPeaks' : 'peaks'
    store.patchArtifact(sessionId, o.artifactId, {
      payload: { ...artifact.payload, [field]: o.peaks },
    } as never)
  },
  compute_create_script: applyComputeScriptEdit,
  compute_from_snippet: applyComputeScriptEdit,
  export_for_engine: applyComputeScriptEdit,
  simulate_structure: applyComputeScriptEdit,
  structure_tweak: applyComputeScriptEdit,
  latex_edit_selection: (sessionId, output) => {
    const parsed = asEditSelection(output)
    if (!parsed) return
    applyLatexEditSelectionPatch(sessionId, parsed)
  },
  latex_fix_compile_error: (sessionId, output) => {
    if (!output || typeof output !== 'object') return
    if ((output as { success?: unknown }).success !== true) return
    applyLatexFixCompileErrorPatch(
      sessionId,
      output as Parameters<typeof applyLatexFixCompileErrorPatch>[1],
    )
  },
  latex_insert_figure_from_artifact: (sessionId, output) => {
    if (!output || typeof output !== 'object') return
    if ((output as { success?: unknown }).success !== true) return
    applyLatexInsertFigurePatch(
      sessionId,
      output as Parameters<typeof applyLatexInsertFigurePatch>[1],
    )
  },
  latex_add_citation: (sessionId, output) => {
    if (!output || typeof output !== 'object') return
    if ((output as { success?: unknown }).success !== true) return
    applyLatexCitationOps(
      sessionId,
      output as Parameters<typeof applyLatexCitationOps>[1],
    )
  },
  // Workspace write/edit tools are proposal-first. execute() returns a
  // diff-shaped payload; the user approves via the AgentCard; these
  // appliers then commit to disk through the user-root workspace IPC.
  workspace_write_file: (_sessionId, output) => {
    const proposal = asWorkspaceWriteProposal(output)
    if (!proposal) {
      toast.error('workspace_write_file applier: malformed output.')
      return
    }
    applyWorkspaceWriteAsync(proposal.relPath, proposal.proposedContent)
  },
  // format_convert returns the same `WorkspaceWriteProposal` shape as
  // workspace_write_file — same applier + same editor card work
  // unchanged.
  format_convert: (_sessionId, output) => {
    const proposal = asWorkspaceWriteProposal(output)
    if (!proposal) {
      toast.error('format_convert applier: malformed output.')
      return
    }
    applyWorkspaceWriteAsync(proposal.relPath, proposal.proposedContent)
  },
  workspace_edit_file: (_sessionId, output) => {
    const proposal = asWorkspaceEditProposal(output)
    if (!proposal) {
      toast.error('workspace_edit_file applier: malformed output.')
      return
    }
    // An empty patch list after editor-side pruning means the user
    // rejected every proposed change — nothing to write.
    if (proposal.patches.length === 0) return
    // Re-run each patch against the current existingContent the proposal
    // captured. This is the source of truth at apply time — Phase 5's
    // editor may have dropped rejected patches but will not rewrite
    // existingContent, so a clean replay here is safe.
    let content = proposal.existingContent
    for (const p of proposal.patches) {
      const occurrences = content.split(p.oldString).length - 1
      if (occurrences !== 1) {
        const snippet = p.oldString.slice(0, 40)
        const suffix = p.oldString.length > 40 ? '…' : ''
        toast.error(
          `Edit failed: patch oldString not uniquely found (${occurrences} matches): "${snippet}${suffix}"`,
        )
        return
      }
      content = content.replace(p.oldString, p.newString)
    }
    applyWorkspaceWriteAsync(proposal.relPath, content)
  },
}

export function getToolApplier(toolName: string | undefined): ToolApplier | null {
  if (!toolName) return null
  return REGISTRY[toolName] ?? null
}
