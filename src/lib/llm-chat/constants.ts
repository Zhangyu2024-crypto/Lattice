// Tunables + prompt snippets shared by the llm-chat dispatcher and its
// helper modules. Split from `llm-chat.ts` — pure code motion.

import type { LatticeFileKind } from '../workspace/fs/types'
import type { MentionRef } from '../../types/mention'

// ── Per-mention payload size caps ────────────────────────────────
//
// Sized in characters (not tokens) — tuned for the JSON serialisation we
// emit in mentions.ts. artifact bodies dominate; element-level previews
// are cheaper; file blocks ship metadata only (JSON envelope with
// relPath / kind / sizeBytes / isBinary — no file body inlined).
export const MENTION_BUDGET: Readonly<Record<MentionRef['type'], number>> = {
  artifact: 4096,
  'artifact-element': 2048,
  file: 128,
  'pdf-quote': 512,
}

// Reserve some tokens between "everything we already counted" and the
// model's hard ceiling so a slightly-off estimator (CJK ratio, JSON quoting
// overhead) does not push the request over the cliff. 1k is conservative
// for ~200k context windows; cheaper to throw away one extra history turn.
export const HISTORY_SAFETY_MARGIN = 1024

export const REDACTED_BODY = '[redacted by provider policy]'

// One-shot operator note we prepend whenever the turn has any `type: 'file'`
// mention. The file block itself ships metadata only (relPath/kind/size/
// isBinary) so the agent has to go through a workspace_* tool to see the
// body. Kept as a module-level const so prompt tuning lands in one place.
export const WORKSPACE_FILE_MENTION_NOTE = [
  '=== workspace files — how to use ===',
  'The user @-mentioned workspace files. Contents are NOT inlined.',
  '- Use `workspace_read_file` to read full text (max 8 MB per call).',
  '- Use `workspace_grep` / `workspace_glob` to search before reading.',
  '- For writes / edits, always emit `workspace_write_file` or `workspace_edit_file` PROPOSALS — the user reviews the diff in a card before anything lands on disk.',
  '- Binary files (isBinary=true, e.g. PDF / image) should NOT be read through workspace_read_file; use knowledge_search / paper_rag_ask for PDFs.',
  '- Spectrum files (.vms/.vamas/.xrdml/.chi/.csv/.xy/.dat/.jdx/.spc/.wdf/.rruf/...): when the user asks for ANALYSIS (peak detection, fit, identify, refine, quantify), DO NOT answer from raw text. First call `open_spectrum_workbench` with the relPath to create a focused workbench artifact, then chain the analysis tools (`detect_peaks`, `xps_fit_peaks`, `raman_identify`, `xrd_refine`, ...) — each step renders its own AgentCard so the user can inspect / approve / edit intermediate results.',
  '- XRD phase identification chain: after `detect_peaks`, call `xrd_search_phases` BEFORE `xrd_refine`. `xrd_search_phases` REQUIRES an `elements` array (e.g. ["Fe","O"]) to narrow the 155k-row Materials Project DB — if the sample composition is not already established in the conversation (prior XPS quant, user statement, filename hint), STOP and ASK the user for the element list in a single short question instead of guessing or skipping the step. Only after phases are selected should `xrd_refine` run; calling `xrd_refine` without candidates will fail with a "No phases to refine" error.',
  '- XPS element validation: after identifying elements (via `xps.lookup` or LLM analysis), ALWAYS call `xps_validate_elements` with the predicted element list. This tool checks each element against a curated binding-energy reference database with automatic charge correction. Elements with status "rejected" must be removed from the analysis; "weak_match" elements are tentative. Only proceed to chemical state analysis / quantification with confirmed elements.',
  '- For format conversion (e.g. .vms → .csv, or any supported input → xy/csv/jcamp), call `format_convert`. It returns a write proposal the user reviews in an AgentCard before it lands on disk.',
  '- For a publication-quality PNG or SVG of a spectrum file, call `plot_spectrum`. `.svg` output is LaTeX-friendly. Peaks accept `{x, label?}` objects for text annotations like "Si 2p"; pass reference curves through `references: [{label, x, y, dashed?}]` (e.g. database patterns, theoretical peaks). Stacked subplots via `panels: [{relPath, peaks?, references?}, ...]` up to 4. Journal presets: default | minimal | acs | rsc | nature. XPS x-axis auto-inverts.',
  '- For multi-file comparisons (2-10 files), call `compare_spectra` with a `mode`: `overlay` (one axis) | `offset` (vertical shift) | `stacked` (one subplot per file, up to 4) | `difference` (A−B, exactly 2 files). Optional `normalize: max | area` lines up amplitudes across instruments.',
].join('\n')

// Stable refKey for the operator note block so it stands apart from the
// 5-char base36 mention anchors that key the per-mention blocks; the proxy
// renders blocks as `--- mention <refKey> ---` so a distinctive key reads
// cleanly in the system prompt.
export const WORKSPACE_FILE_MENTION_NOTE_REF_KEY = 'workspace-files-note'

// Kinds whose canonical on-disk representation is a binary stream. Agents
// must NOT feed these through `workspace_read_file` (text-only); the note
// above points them at knowledge_search / paper_rag_ask instead.
const BINARY_FILE_KINDS: ReadonlySet<LatticeFileKind> = new Set<LatticeFileKind>([
  'image',
  'pdf',
])

export function isBinaryKind(kind: LatticeFileKind): boolean {
  return BINARY_FILE_KINDS.has(kind)
}

export const TIMEOUT_DIALOG = 60_000
export const TIMEOUT_AGENT = 120_000
