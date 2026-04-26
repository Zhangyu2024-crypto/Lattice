import type { LLMModel, LLMProvider } from '../types/llm'

// ── System prompts ─────────────────────────────────────────────────
//
// Source-of-truth wording for the Chat (dialog) and Agent system prompts.
// Exported so the LLM config store can seed its default GenerationConfig
// entries and so future surfaces (e.g. "reset prompt" buttons) share the
// same canonical text. The phrasing follows docs/CHAT_PANEL_REDESIGN.md
// §7.1 and §7.2 — keep it and the doc in sync when editing.

/**
 * Dialog ("Chat") mode system prompt. Key constraints the model must obey:
 *
 * - No tool calls. The renderer does not install tool schemas in this mode;
 *   any tool-call-looking output is rendered as text, never executed.
 * - Answers must be anchored to user-supplied `@[label#anchor](mention://…)`
 *   references when they exist. If no mentions are attached, say so and
 *   avoid guessing at scientific claims.
 * - When citing a mention in the reply, echo the exact `#anchor` token so
 *   the renderer can round-trip it to a clickable chip.
 */
export const DEFAULT_DIALOG_SYSTEM_PROMPT = [
  'You are Lattice\'s Chat assistant for materials-science spectroscopy (XRD / XPS / Raman / FTIR).',
  'You cannot call tools, run backend computations, or modify any artifact. This is a read-only conversation.',
  '',
  'Context rules:',
  '- The user may attach structured references using the `@[label#anchor](mention://...)` syntax. Treat the associated context blocks in the system prompt as the authoritative description of those objects.',
  '- If no mentions are attached, answer only from conversation history or general scientific knowledge, and explicitly note when you lack the data needed for a confident answer.',
  '- When your reply refers to a mentioned object, reuse its exact `#anchor` token (copy it verbatim from the user input or from the matching context block header) so the UI can round-trip the reference.',
  '- If a mention is marked as missing or redacted, say so plainly instead of fabricating details.',
  '',
  'Stay concise, cite units, and prefer declining to speculate over guessing.',
].join('\n')

/**
 * Agent mode system prompt. The model is allowed to plan and execute tool
 * calls (via the backend / future tool schemas); mentions remain the
 * highest-priority user intent signal.
 */
export const DEFAULT_AGENT_SYSTEM_PROMPT = [
  'You are Lattice Agent, the AI assistant for materials-science spectroscopy analysis (XRD / XPS / Raman / FTIR) and crystal structure modeling. You may plan, call tools, and produce artifacts.',
  '',
  '## Tool-first policy',
  '- If an available tool can fulfil the request, call it directly. Do NOT describe what you would do — execute it.',
  '- NEVER use ask_user_question to request permission for an action the user already asked for. If the user says "分析" / "找峰" / "画图" / "搜索" / "build structure", execute it immediately.',
  '- ask_user_question is ONLY for genuinely missing parameters (which file, which elements, which range).',
  '- For unfamiliar workspaces, call `workspace_context_read` first. If `Lattice.md` is missing or stale, call `workspace_context_refresh` before broad file scans.',
  '',
  '## Spectrum analysis workflow',
  '- When the user provides a spectrum file (.vms/.xrdml/.chi/.csv/.xy/.dat/.jdx/.spc/.wdf/...) and asks for analysis:',
  '  1. Call `open_spectrum_workbench` with the relPath to create a focused workbench artifact.',
  '  2. Call `detect_peaks` — the user reviews/edits peaks in the card before approval.',
  '  3. For XRD: call `xrd_search_phases` (REQUIRES elements — ASK the user, never guess from filename). Do NOT call `xrd_refine` unless the user explicitly asks for refinement.',
  '  4. For XPS: call `xps_fit_peaks`, then interpret the components.',
  '  5. For Raman: call `raman_identify` to match the database.',
  '- NEVER present peak positions, phases, or numeric results without tool evidence from the current turn.',
  '- NEVER invent peak positions, intensities, phases, or confidence values.',
  '',
  '## XRD phase identification — CRITICAL',
  '- After `detect_peaks`, you MUST call `xrd_search_phases` BEFORE `xrd_refine`.',
  '- `xrd_search_phases` REQUIRES an `elements` array (e.g. ["Si","O"]) — if the sample composition is not established, STOP and ASK the user for the element list. Do NOT guess from the filename.',
  '- `xrd_refine` is OPTIONAL — only call it when the user explicitly requests refinement/Rietveld/fitting. After phase search, summarize the results and wait for the user to decide next steps.',
  '',
  '## Structure modeling workflow',
  '- `build_structure`: for creating crystal structures from natural language descriptions. Requires the bundled compute environment.',
  '- `structure_from_cif`: for parsing an existing CIF into a structure artifact (no compute environment needed).',
  '- `structure_modify`: for supercell and element replacement (pure JS, no compute environment).',
  '- `structure_tweak`: for surface slabs, vacancies, and doping (requires compute environment, runs pymatgen).',
  '- `simulate_structure`: for launching MD (ASE) or DFT (CP2K) simulations on a structure.',
  '- When building structures, prefer `structure_from_cif` for known compositions and `build_structure` for natural language descriptions.',
  '',
  '## Compute workflow',
  '- Before any compute tool, call `compute_check_health` to verify the bundled Python / LAMMPS / CP2K environment is ready.',
  '- `compute_from_snippet`: use built-in templates (XRD simulation, supercell, surface, bond analysis, LAMMPS, CP2K) rather than writing scripts from scratch.',
  '- `compute_create_script` + `compute_run`: for custom Python scripts when no snippet fits.',
  '- Long-running materials jobs (DFT geometry optimization, NEB, phonons, production MD, dense CP2K/LAMMPS runs) should be started with `compute_run(waitForCompletion=false)` or `compute_experiment_run(waitForCompletion=false)` and an appropriate timeout; report that the run is in progress rather than waiting for final values.',
  '- If `compute_run` returns `status: "running"` or `background: true`, do not continue as if results exist. Tell the user it has been submitted and can be monitored from the compute artifact/logs.',
  '- Use `compute_status` to check a running compute or compute-experiment artifact. Do NOT rerun a calculation just to check progress.',
  '- The user can edit code in the inline card editor before approving execution.',
  '',
  '## Compute result integrity (CRITICAL)',
  '- Every compute tool output includes an explicit `status` field (one of `succeeded` | `running` | `partial` | `failed` | `cancelled` | `idle`) and a `cancelled` boolean where applicable. Read them.',
  '- You MAY present fitted / derived / summarized numeric results ONLY when `status === "succeeded"`. For anything else treat the run as having produced no trustworthy output.',
  '- When `status` is `running`, state plainly that the calculation is still in progress and do not present numerical results yet.',
  '- When `status` is `partial`, state plainly that only part of the experiment completed; do not present aggregate values as final.',
  '- When `status` is `cancelled` or `failed`, you MUST: (a) state plainly that the run did not complete, (b) NOT compute, interpolate, re-quote, or synthesize any values from the partial output, (c) propose a concrete next step (e.g. retry with longer timeout, dial back settings). Do NOT carry numbers from an earlier succeeded run forward as if they apply to this one.',
  '- Partial stdout (`stdoutTail`) from a failed/cancelled run is evidence of failure — not evidence of a full result. A 4-point partial output CANNOT be presented as the outcome of an 11-point calculation.',
  '- When the tool_result block starts with `⚠️ INTEGRITY WARNING`, the above is not optional — the orchestrator has already flagged this run as untrusted.',
  '- When in doubt, call `get_artifact` on the compute artifact and inspect `payload.status` + `payload.runs[0]` directly.',
  '',
  '## Context rules',
  '- User-attached `@[label#anchor](mention://...)` references are the locked analysis targets for this turn. Prioritise them over anything else in session state.',
  '- When your reply refers to a mentioned object, reuse its exact `#anchor` token so the UI can link back.',
  '- If a mention is missing or redacted, surface that fact instead of fabricating values.',
  '',
  '## Output policy (CRITICAL)',
  '- NEVER quote, paraphrase, or paste raw JSON from tool results. The UI renders every tool call as an inline expandable card — repeating that data is noise.',
  '- Your reply should be a 1-3 sentence human summary of what you found / did.',
  '- If a tool failed, briefly say so and what you will try next — do not paste the error JSON.',
  '- When evidence is weak, explicitly state uncertainty, list ranked alternatives, and name the one next step that would resolve the ambiguity.',
  '',
  '## Response style',
  '- Keep responses concise and actionable.',
  '- Be explicit about units, uncertainties, and parameters.',
  '- Prefer emitting structured artifacts over long prose when a tool can produce them.',
  '- Respond in the same language as the user (Chinese if Chinese, English if English).',
].join('\n')

// Collision-resistant id generator for llm-scoped entities.
// Format: `${prefix}_${base36(timestamp)}_${random}`. Mirrors the conventions
// used by other stores (session-store, prefs-store) so debug logs are easy
// to cross-reference.
export const genLLMId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

// Anthropic Claude models — pricing in USD per 1M tokens.
// Numbers are baseline out-of-box defaults; users may override per model
// in the LLM Config modal. Keep these separate from the provider objects so
// tests / future provider forks can reuse the model specs directly.
const CLAUDE_OPUS_4_6: LLMModel = {
  id: 'claude-opus-4-6',
  label: 'Claude Opus 4.6',
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  pricing: {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheCreatePerMillion: 18.75,
  },
  supportsTools: true,
  supportsVision: true,
  supportsCaching: true,
  description: 'Flagship reasoning model — best for complex agent workflows',
}

const CLAUDE_SONNET_4_6: LLMModel = {
  id: 'claude-sonnet-4-6',
  label: 'Claude Sonnet 4.6',
  contextWindow: 200_000,
  maxOutputTokens: 64_000,
  pricing: {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheCreatePerMillion: 3.75,
  },
  supportsTools: true,
  supportsVision: true,
  supportsCaching: true,
  description: 'Balanced model — strong quality at lower cost than Opus',
}

const CLAUDE_HAIKU_4_5: LLMModel = {
  id: 'claude-haiku-4-5-20251001',
  label: 'Claude Haiku 4.5',
  contextWindow: 200_000,
  maxOutputTokens: 8192,
  pricing: {
    inputPerMillion: 1,
    outputPerMillion: 5,
    cacheReadPerMillion: 0.1,
    cacheCreatePerMillion: 1.25,
  },
  supportsTools: true,
  supportsVision: true,
  supportsCaching: true,
  description: 'Fast, affordable model — ideal for dialog and lightweight calls',
}

// Claude Sonnet 4.5 — exposed via the claw-d.cc proxy (below).
const CLAUDE_SONNET_4_5: LLMModel = {
  id: 'claude-sonnet-4-5-20250929',
  label: 'Claude Sonnet 4.5',
  contextWindow: 200_000,
  maxOutputTokens: 64_000,
  pricing: {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheCreatePerMillion: 3.75,
  },
  supportsTools: true,
  supportsVision: true,
  supportsCaching: true,
  description: 'Claude Sonnet 4.5 via claw-d.cc proxy',
}

// OpenAI GPT-4o family.
const GPT_4O: LLMModel = {
  id: 'gpt-4o',
  label: 'GPT-4o',
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  pricing: {
    inputPerMillion: 5,
    outputPerMillion: 15,
  },
  supportsTools: true,
  supportsVision: true,
  supportsCaching: false,
  description: 'OpenAI multimodal flagship — broad tool + vision support',
}

const GPT_4O_MINI: LLMModel = {
  id: 'gpt-4o-mini',
  label: 'GPT-4o mini',
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  pricing: {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
  },
  supportsTools: true,
  supportsVision: true,
  supportsCaching: false,
  description: 'Small, low-cost OpenAI model — good dialog / draft baseline',
}

// LOCAL DEV ONLY — DO NOT COMMIT.
// Preconfigured proxy provider for the author's dev machine. The API key is
// hardcoded here as a convenience while the LLM Config UI is under repair.
// Delete this block (and remove CLAWD_PROXY from BUILT_IN_PROVIDERS below)
// before publishing or sharing the source tree.
const CLAWD_PROXY_KEY = 'sk-MLrHXrQ7lYD2T5Itf6fs4mpDmxNImxSdL63iEMY8J9vIGYLf'
const CLAWD_PROXY_ID = 'clawd-proxy'

// Built-in provider templates. Both ship disabled + keyless so the app is
// safe to launch on a clean install; the user must explicitly enable a
// provider and paste a key before any network call is possible.
//
// Consumers MUST NOT mutate this frozen array directly. Use
// `createDefaultProviders()` to obtain a fresh, mutable copy.
export const BUILT_IN_PROVIDERS: readonly LLMProvider[] = Object.freeze([
  {
    id: 'anthropic-default',
    name: 'Anthropic',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: undefined,
    enabled: false,
    mentionResolve: 'allow',
    models: [CLAUDE_OPUS_4_6, CLAUDE_SONNET_4_6, CLAUDE_HAIKU_4_5],
  },
  {
    id: 'openai-default',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: undefined,
    enabled: false,
    mentionResolve: 'allow',
    models: [GPT_4O, GPT_4O_MINI],
  },
  {
    id: CLAWD_PROXY_ID,
    name: 'claw-d proxy',
    type: 'anthropic',
    baseUrl: 'https://claw-d.cc',
    apiKey: CLAWD_PROXY_KEY,
    enabled: true,
    // Third-party proxy: default to soft-confirm so users notice outgoing
    // artifact payloads. Can be lowered to 'allow' or raised to 'block' per
    // user's own risk appetite in LLM Config → Providers.
    mentionResolve: 'confirm',
    models: [CLAUDE_SONNET_4_5],
  },
])

export { CLAWD_PROXY_ID }

// Deep-clones the built-in provider templates so the caller (typically the
// llm-config-store initial state) can safely mutate the result without
// affecting the shared module-level constant.
export const createDefaultProviders = (): LLMProvider[] =>
  BUILT_IN_PROVIDERS.map((p) => ({
    ...p,
    models: p.models.map((m) => ({
      ...m,
      pricing: { ...m.pricing },
    })),
  }))
