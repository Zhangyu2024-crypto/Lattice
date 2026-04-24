// Pending-state headline helpers for AgentCard.
//
// When a tool step is awaiting user approval (`approvalState === 'pending'`)
// the card should lead with *what is about to happen*, not the technical
// tool name or the (already computed) output summary. The helpers here
// pull the most user-meaningful slice out of `step.toolName` and
// `step.input` so the header reads "Write file · foo.md" instead of
// "workspace_write_file · {bytes:48416,…}".

import type { TaskStep } from '../../../types/session'

/**
 * Maps a LocalTool name to a short action verb suitable for a card
 * headline. Entries in the table were picked to be self-explanatory
 * without the tool's implementation details — a user glancing at the
 * chat should understand *what* the agent is about to do at a read.
 *
 * Anything not in the table falls back to the raw tool name, so new
 * tools continue to render; they'll just read slightly less prettily
 * until added here.
 */
const PENDING_HEADLINE: Record<string, string> = {
  workspace_write_file: 'Write file',
  workspace_edit_file: 'Edit file',
  compute_create_script: 'Create script',
  compute_edit_script: 'Edit script',
  format_convert: 'Convert file',
  latex_add_citation: 'Add citation',
  latex_insert_figure_from_artifact: 'Insert figure',
  latex_selection_edit: 'Edit selection',
  detect_peaks: 'Detect peaks',
  xps_fit_peaks: 'Fit peaks',
  xps_charge_correct: 'Charge correct',
  xrd_refine: 'Refine XRD',
  xrd_search_phases: 'Search phases',
  raman_identify: 'Identify Raman',
  smooth_spectrum: 'Smooth spectrum',
  correct_baseline: 'Correct baseline',
  compare_spectra: 'Compare spectra',
  assess_spectrum_quality: 'Assess quality',
  structure_from_cif: 'Import CIF',
  structure_fetch: 'Fetch structure',
  build_structure: 'Build structure',
}

export function pendingHeadline(toolName: string | undefined): string {
  if (!toolName) return 'Tool call'
  return PENDING_HEADLINE[toolName] ?? toolName
}

/** Take only the final path segment so an 80-character relPath doesn't
 *  overflow the header. We intentionally keep a leading slash-segment
 *  when present so the user can see the file sits inside a subfolder
 *  ("chats/foo.md" stays "chats/foo.md"; "a/b/c/d/e.md" collapses to
 *  "…/e.md"). */
function trimPath(relPath: string): string {
  const segments = relPath.split('/')
  if (segments.length <= 2) return relPath
  return `…/${segments[segments.length - 1]}`
}

function stringField(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Extract a short user-meaningful subject line from the step's input.
 * Returns `undefined` when no sensible field exists; the caller should
 * then render just the action verb (e.g. "Detect peaks") and skip the
 * "·" separator.
 *
 * We prefer `relPath` when present (file-scoped tools), fall back to the
 * command string (`workspace_bash` — usually routed to the host-exec
 * modal, but defensive in case that path changes), and finally to the
 * artifact id so compute / spectroscopy tools still get a subject even
 * when the card has no artifact badge yet.
 */
export function pendingSubject(step: TaskStep): string | undefined {
  const input = step.input
  const relPath = stringField(input, 'relPath')
  if (relPath) return trimPath(relPath)
  const command = stringField(input, 'command')
  if (command) return command.length > 60 ? `${command.slice(0, 59)}…` : command
  // `build_structure` / other natural-language tools carry their intent
  // in a `description` field; surface it before falling back to ids.
  const description = stringField(input, 'description')
  if (description) {
    return description.length > 60 ? `${description.slice(0, 59)}…` : description
  }
  const artifactId = stringField(input, 'artifactId')
  if (artifactId) return artifactId
  return undefined
}
