// Local tool registry.
//
// The orchestrator receives this list every Agent turn and forwards it to
// the LLM as tool schemas. Keep it narrow: tools here are what the model
// can invoke with no user approval, so they must be safe (read-only or
// minor-UI-only). Destructive operations (delete, re-fit, network
// fetches) should stay off the default catalog until a gating UX exists.

import type { LocalTool } from '../../types/agent-tool'
import { focusArtifactTool } from './focus-artifact'
import { getArtifactTool } from './get-artifact'
import { listArtifactsTool } from './list-artifacts'
import { literatureSearchTool } from './literature-search'
import { researchDraftSectionTool } from './research-draft-section'
import { researchFinalizeReportTool } from './research-finalize-report'
import { researchPlanOutlineTool } from './research-plan-outline'
// Phase A Tier S — spectrum analysis + paper / knowledge RAG.
import { assessSpectrumQualityTool } from './assess-spectrum-quality'
import { detectPeaksTool } from './detect-peaks'
import { xrdSearchPhasesTool } from './xrd-search-phases'
import { xrdRefineTool } from './xrd-refine'
import { xpsChargeCorrectTool } from './xps-charge-correct'
import { xpsFitPeaksTool } from './xps-fit-peaks'
import { xpsValidateElementsTool } from './xps-validate-elements'
import { ramanIdentifyTool } from './raman-identify'
import { paperRagAskTool } from './paper-rag-ask'
import { knowledgeSearchTool } from './knowledge-search'
import { knowledgeExtractTool } from './knowledge-extract'
import { listPapersTool } from './list-papers'
// Phase B+ — plan mode, ask user, agent todo, tool search.
import { enterPlanModeTool, exitPlanModeTool } from './plan-mode'
import { askUserQuestionTool } from './ask-user-question'
import {
  taskCreateTool,
  taskListTool,
  taskUpdateTool,
} from './agent-tasks'
import { toolSearchTool } from './tool-search'
import { spawnAgentTool, listAgentsTool } from './spawn-agent'
import { sendMessageTool } from './send-message'
import {
  workspaceEditFileTool,
  workspaceGlobTool,
  workspaceGrepTool,
  workspaceReadFileTool,
  workspaceWriteFileTool,
} from './workspace-files'
import { workspaceBashTool } from './workspace-bash'
import { smoothSpectrumTool } from './smooth-spectrum'
import { correctBaselineTool } from './correct-baseline'
import { detectSpectrumTypeTool } from './detect-spectrum-type'
import { openSpectrumWorkbenchTool } from './open-spectrum-workbench'
import { webFetchTool } from './web-fetch'
import { webSearchTool } from './web-search'
import { formatConvertTool } from './format-convert'
import { plotSpectrumTool } from './plot-spectrum'
import { compareSpectraTool } from './compare-spectra'
// Phase 0 — Compute (Python script author / run / edit) + Structure (3D modeling).
import { computeCreateScriptTool } from './compute-create-script'
import { computeRunTool } from './compute-run'
import { computeEditScriptTool } from './compute-edit-script'
import { structureFromCifTool } from './structure-from-cif'
import { buildStructureTool } from './build-structure'
import { structureFetchTool } from './structure-fetch'
import { structureAnalyzeTool } from './structure-analyze'
import { structureModifyTool } from './structure-modify'
// Phase A2/A3 — LaTeX-aware agent tools (selection edit, compile-error fix,
// figure insert from artifact, auto citation). All route through the
// unified AgentCard flow.
import { latexEditSelectionTool } from './latex-selection'
import { latexFixCompileErrorTool } from './latex-fix-compile-error'
import { latexInsertFigureFromArtifactTool } from './latex-insert-figure-from-artifact'
import { latexAddCitationTool } from './latex-add-citation'
import { autoTagPaperTool } from './auto-tag-paper'
import { autoExtractKnowledgeTool } from './auto-extract-knowledge'
// Literature fetch — search + download OA PDFs + import to Library.
import { literatureFetchTool } from './literature-fetch'
// Phase 1 — Domain-aware compute + simulation agent tools.
import { computeCheckHealthTool } from './compute-check-health'
import { computeFromSnippetTool } from './compute-from-snippet'
import { simulateStructureTool } from './simulate-structure'
import { structureTweakTool } from './structure-tweak'
import { exportForEngineTool } from './export-for-engine'
import { computeRunNativeTool } from './compute-run-native'
import { listComputeSnippetsTool } from './list-compute-snippets'
// Hypothesis workflow — create → gather evidence → evaluate.
import { hypothesisCreateTool } from './hypothesis-create'
import { hypothesisGatherEvidenceTool } from './hypothesis-gather-evidence'
import { hypothesisEvaluateTool } from './hypothesis-evaluate'
// CIF database — local Materials Project crystal-structure lookup.
import { cifLookupTool, cifSearchTool } from './cif-lookup'
// Slash-command dispatch — LLM invocation of registered /cmd prompts.
import { slashCommandTool } from './slash-command-tool'

export const LOCAL_TOOL_CATALOG: LocalTool[] = [
  listArtifactsTool,
  getArtifactTool,
  focusArtifactTool,
  // Research flow — invoke in this order on a single session:
  //   1. research_plan_outline (creates skeleton, returns sectionIds)
  //   2. literature_search (optional, before drafting; grounds citations
  //      in real OpenAlex/arXiv metadata)
  //   3. research_draft_section (one per outline item, in order)
  //   4. research_finalize_report (consolidate + close out)
  researchPlanOutlineTool,
  literatureSearchTool,
  researchDraftSectionTool,
  researchFinalizeReportTool,
  // Spectrum analysis — operate on a focused XRD/XPS/Raman Pro workbench
  // artifact unless an explicit `artifactId` is provided. When the user
  // references a workspace file with no existing workbench, call
  // `open_spectrum_workbench` first to create + focus one; every
  // subsequent analysis step then renders its own AgentCard.
  openSpectrumWorkbenchTool,
  assessSpectrumQualityTool,
  detectPeaksTool,
  smoothSpectrumTool,
  correctBaselineTool,
  detectSpectrumTypeTool,
  xrdSearchPhasesTool,
  xrdRefineTool,
  xpsChargeCorrectTool,
  xpsFitPeaksTool,
  xpsValidateElementsTool,
  ramanIdentifyTool,
  // Web access — general-purpose URL fetching and web search. For
  // academic literature prefer literature_search (OpenAlex + arXiv).
  webFetchTool,
  webSearchTool,
  // Literature / knowledge.
  listPapersTool,
  paperRagAskTool,
  knowledgeSearchTool,
  knowledgeExtractTool,
  // Phase B+ meta-tools — plan mode gate, user interaction,
  // agent-managed todo, deferred-tool discovery.
  enterPlanModeTool,
  exitPlanModeTool,
  askUserQuestionTool,
  // Model-facing access to user slash commands. Surfaces prompt-type
  // registry entries so the LLM can request an expanded scaffold on
  // demand; expanded text returns as the tool result for the next turn.
  slashCommandTool,
  taskCreateTool,
  taskListTool,
  taskUpdateTool,
  toolSearchTool,
  // Sub-agent system — spawn child agents for parallel / delegated work.
  // spawn_agent creates a new LLM loop; send_message retrieves results;
  // list_agents shows all spawned agents and their status.
  spawnAgentTool,
  sendMessageTool,
  listAgentsTool,
  // Workspace primitives — main-chat only. read / glob / grep are safe
  // auto-run tools that surface their output inline. write / edit are
  // proposal-first: `execute()` returns a diff-shaped payload that the
  // user approves in the AgentCard, and the applier registry
  // (src/components/agent/tool-cards/applier-registry.ts) performs the
  // disk write on Approve. `workspace_bash` is hostExec → the trust
  // gate's ApprovalDialog pre-confirms every run.
  workspaceReadFileTool,
  workspaceWriteFileTool,
  workspaceEditFileTool,
  workspaceGlobTool,
  workspaceGrepTool,
  workspaceBashTool,
  // Format interchange — read any supported spectrum and re-emit as
  // xy / csv / jcamp so downstream tools (Origin, Excel, ChemAxon) can
  // open it without a proprietary reader. Returns a write proposal so
  // the user reviews the new file in the same diff card as
  // `workspace_write_file`.
  formatConvertTool,
  // Publication-style PNG/SVG plotting via off-screen ECharts. Writes
  // the image to the workspace through the binary/text IPC. Supports
  // peak text labels, reference overlays (theoretical curves), subplots
  // up to 4 panels, log-y, and journal typography presets (ACS/RSC/
  // Nature/minimal). Pair with `detect_peaks` to annotate peaks, or
  // `xrd_search_phases` to overlay theoretical patterns.
  plotSpectrumTool,
  // Multi-file spectrum comparison: overlay / offset / stacked /
  // difference modes + max/area normalisation. Use when the user asks
  // "compare these files" or wants a temperature series / QA sweep.
  compareSpectraTool,
  // Phase 0 — Compute. `compute_create_script` authors a Python script into a
  // new artifact (draft state); `compute_run` executes it via the existing
  // runCompute pipe; `compute_edit_script` rewrites an existing artifact's
  // script. compute_run is trust:hostExec so the approval framework gates it.
  computeCreateScriptTool,
  computeRunTool,
  computeEditScriptTool,
  // Phase 0 — Structure / 3D modeling. `structure_from_cif` upserts a
  // structure artifact from a pasted CIF; `structure_fetch` pulls a structure
  // from Materials Project (needs MP_API_KEY — graceful fallback); analyze
  // computes bond lengths / density / cell volume purely in-JS; modify
  // supports supercell + element replacement as a new child artifact.
  structureFromCifTool,
  // Natural-language → pymatgen → structure artifact. Primary path for
  // "give me a BaTiO3" style intents; pairs with the notebook's "Add
  // Structure" modal so agent and UI share the same builder.
  buildStructureTool,
  structureFetchTool,
  structureAnalyzeTool,
  structureModifyTool,
  // LaTeX-aware tools.
  latexEditSelectionTool,
  latexFixCompileErrorTool,
  latexInsertFigureFromArtifactTool,
  latexAddCitationTool,
  // Library management.
  autoTagPaperTool,
  autoExtractKnowledgeTool,
  // Literature fetch — search + download + import to Library for RAG.
  literatureFetchTool,
  // Phase 1 — Domain-aware compute. Health check, snippet-based creation,
  // simulation launch, structure tweaks (surface/vacancy/dope), engine
  // export (LAMMPS/CP2K), native-language execution, snippet catalog.
  computeCheckHealthTool,
  computeFromSnippetTool,
  simulateStructureTool,
  structureTweakTool,
  exportForEngineTool,
  computeRunNativeTool,
  listComputeSnippetsTool,
  // Hypothesis workflow — create hypotheses, gather evidence from multiple
  // sources (artifacts, papers, web), then evaluate and resolve statuses.
  // Composable: the orchestrator can chain all three in a single session.
  hypothesisCreateTool,
  hypothesisGatherEvidenceTool,
  hypothesisEvaluateTool,
  // CIF database — query the bundled MP crystal-structure collection
  // (~155k entries). cif_lookup retrieves CIF text by material_id(s);
  // cif_search finds materials by formula / elements / space group.
  cifLookupTool,
  cifSearchTool,
]

export function findLocalTool(name: string): LocalTool | null {
  return LOCAL_TOOL_CATALOG.find((tool) => tool.name === name) ?? null
}

// ── Dynamic tool filtering ─────────────────────────────────────────
//
// Instead of sending all ~60 tools to the LLM every turn, filter by
// session context. Core tools always load; domain tools load only when
// relevant artifacts or files exist in the session.

type ToolGroup =
  | 'core'          // always loaded
  | 'spectrum'      // XRD/XPS/Raman analysis
  | 'structure'     // 3D structure modeling
  | 'compute'       // script authoring + execution
  | 'research'      // literature + research reports
  | 'latex'         // LaTeX editing
  | 'library'       // paper management
  | 'hypothesis'    // hypothesis management + evidence gathering

const TOOL_GROUP: Record<string, ToolGroup> = {
  // Core — always loaded
  list_artifacts: 'core',
  get_artifact: 'core',
  focus_artifact: 'core',
  enter_plan_mode: 'core',
  exit_plan_mode: 'core',
  ask_user_question: 'core',
  task_create: 'core',
  task_list: 'core',
  task_update: 'core',
  tool_search: 'core',
  workspace_read_file: 'core',
  workspace_write_file: 'core',
  workspace_edit_file: 'core',
  workspace_glob: 'core',
  workspace_grep: 'core',
  workspace_bash: 'core',
  web_fetch: 'core',
  web_search: 'core',
  spawn_agent: 'core',
  send_message: 'core',
  list_agents: 'core',

  // Spectrum analysis
  open_spectrum_workbench: 'spectrum',
  assess_spectrum_quality: 'spectrum',
  detect_peaks: 'spectrum',
  smooth_spectrum: 'spectrum',
  correct_baseline: 'spectrum',
  detect_spectrum_type: 'spectrum',
  xrd_search_phases: 'spectrum',
  xrd_refine: 'spectrum',
  xps_charge_correct: 'spectrum',
  xps_fit_peaks: 'spectrum',
  xps_validate_elements: 'spectrum',
  raman_identify: 'spectrum',
  format_convert: 'spectrum',
  plot_spectrum: 'spectrum',
  compare_spectra: 'spectrum',

  // Structure modeling
  structure_from_cif: 'structure',
  build_structure: 'structure',
  structure_fetch: 'structure',
  structure_analyze: 'structure',
  structure_modify: 'structure',
  structure_tweak: 'structure',
  simulate_structure: 'structure',
  export_for_engine: 'structure',

  // Compute
  compute_check_health: 'compute',
  compute_create_script: 'compute',
  compute_run: 'compute',
  compute_edit_script: 'compute',
  compute_from_snippet: 'compute',
  compute_run_native: 'compute',
  list_compute_snippets: 'compute',

  // Research
  research_plan_outline: 'research',
  literature_search: 'research',
  research_draft_section: 'research',
  research_finalize_report: 'research',

  // Literature / knowledge
  list_papers: 'library',
  paper_rag_ask: 'library',
  knowledge_search: 'library',
  knowledge_extract: 'library',
  auto_tag_paper: 'library',
  auto_extract_knowledge: 'library',
  literature_fetch: 'library',

  // LaTeX
  latex_edit_selection: 'latex',
  latex_fix_compile_error: 'latex',
  latex_insert_figure_from_artifact: 'latex',
  latex_add_citation: 'latex',

  // Hypothesis
  hypothesis_create: 'hypothesis',
  hypothesis_gather_evidence: 'hypothesis',
  hypothesis_evaluate: 'hypothesis',

  // CIF database
  cif_lookup: 'spectrum',
  cif_search: 'spectrum',
}

function getToolGroup(tool: LocalTool): ToolGroup {
  return TOOL_GROUP[tool.name] ?? 'core'
}

export interface SessionContext {
  hasSpectrumArtifacts: boolean
  hasStructureArtifacts: boolean
  hasComputeArtifacts: boolean
  hasResearchArtifacts: boolean
  hasLatexArtifacts: boolean
  hasPapers: boolean
  hasWorkspaceFiles: boolean
  hasHypothesisArtifacts: boolean
  userMessage: string
}

const SPECTRUM_KEYWORDS = /spectrum|xrd|xps|raman|ftir|diffract|peak|phase|refine|fit|谱|衍射|峰|拉曼/i
const STRUCTURE_KEYWORDS = /structure|crystal|cif|nacl|batio|build.*struct|supercell|晶体|结构|建模/i
const COMPUTE_KEYWORDS = /compute|script|simulate|lammps|cp2k|dft|md|docker|计算|模拟|脚本/i
const RESEARCH_KEYWORDS = /research|literature|survey|report|研究|文献|报告/i
const LATEX_KEYWORDS = /latex|tex|论文|写作|cite|citation/i
const LIBRARY_KEYWORDS = /paper|pdf|library|knowledge|文献|知识|论文/i
const HYPOTHESIS_KEYWORDS = /hypothesis|hypothes|假说|假设|机制|验证|证据|evidence/i

export function resolveToolsForContext(
  allTools: LocalTool[],
  ctx: SessionContext,
): LocalTool[] {
  const activeGroups = new Set<ToolGroup>(['core'])

  // Always include spectrum (most common use case) and open_spectrum_workbench
  activeGroups.add('spectrum')

  if (ctx.hasStructureArtifacts || STRUCTURE_KEYWORDS.test(ctx.userMessage)) {
    activeGroups.add('structure')
  }
  if (ctx.hasComputeArtifacts || COMPUTE_KEYWORDS.test(ctx.userMessage)) {
    activeGroups.add('compute')
  }
  if (ctx.hasResearchArtifacts || RESEARCH_KEYWORDS.test(ctx.userMessage)) {
    activeGroups.add('research')
  }
  if (ctx.hasLatexArtifacts || LATEX_KEYWORDS.test(ctx.userMessage)) {
    activeGroups.add('latex')
  }
  if (ctx.hasPapers || LIBRARY_KEYWORDS.test(ctx.userMessage)) {
    activeGroups.add('library')
  }
  if (ctx.hasHypothesisArtifacts || HYPOTHESIS_KEYWORDS.test(ctx.userMessage)) {
    activeGroups.add('hypothesis')
  }

  // Structure + compute are often used together
  if (activeGroups.has('structure')) activeGroups.add('compute')

  return allTools.filter((t) => activeGroups.has(getToolGroup(t)))
}
