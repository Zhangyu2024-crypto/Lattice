// Shared prompt scaffolds for the unified Research flow.
//
// Research is a single entry point now — no Brief / Survey split in the UI.
// The LLM decides between `mode='research'` (focused) and `mode='survey'`
// (broad) based on the topic itself when it calls `research_plan_outline`.
//
// Consumers:
//   - `/research <topic>` slash command
//   - CommandPalette "Start Research"
//   - The `research_plan_outline` local agent tool (mode hint)
//
// Keep this file dependency-free so any layer can import it.

/**
 * Backend-facing mode — kept because tools, artifacts, and existing payloads
 * still carry this field. It is no longer exposed as a UI choice.
 */
export type ResearchMode = 'research' | 'survey'

/**
 * Composer prefill that lets the planner choose mode based on the topic.
 *
 * The LLM picks between 'research' and 'survey' from topic breadth (one
 * compound or mechanism → research; a field / class of materials →
 * survey), then calls `research_plan_outline` with that choice.
 */
export function buildAutoResearchScaffold(): string {
  return (
    `Produce a research artifact on: \n\n` +
    `---\n` +
    `First decide the shape of the report based on the topic above:\n` +
    `  • Use mode='research' (style='concise') when the topic is a specific compound, mechanism, or decision-oriented question.\n` +
    `  • Use mode='survey' (style='comprehensive') when the topic is a field, a class of materials, or a landscape question.\n` +
    `Then follow the lattice-cli research pipeline phases:\n` +
    `  0. Pre-interview: if the topic is broad or ambiguous, call ask_user_question once to clarify scope, audience, and must-include sources; pass the answer as focus into research_plan_outline.\n` +
    `  1. Retrieval + Outline: call research_plan_outline(topic=<above>, mode=<your choice>, style=<matching>, focus=<if any>). This records interview assumptions, searches online + local Library literature, and creates a subsection-capable outline artifact.\n` +
    `  2. Writing workflow: call research_continue_report(artifactId) once. It drafts remaining sections in order, then refines and finalizes the report. Use research_draft_section only when the user explicitly wants manual section-by-section control.\n` +
    `  3. Refinement + Assembly are normally handled inside research_continue_report; only call research_refine_report or research_finalize_report separately when continuing a partially completed artifact.\n` +
    `Let research_plan_outline choose the actual outline; do not force a canned Snapshot/Methods/Follow-up frame.\n` +
    `Before step 1, write one short sentence explaining which mode you picked and why. Between later calls, write one short human sentence about progress. ` +
    `NEVER paste tool result JSON in your reply — the UI shows each call as an inline expandable card.`
  )
}

/**
 * Slash-command research kickoff. The topic is baked into the prompt so
 * the agent starts work on the next tick.
 */
export function buildResearchScaffold(topic: string): string {
  const clean = topic.trim()
  const quoted = clean || '<topic unspecified>'
  return (
    `Produce a research artifact on: "${quoted}".\n\n` +
    `First decide the shape based on the topic:\n` +
    `  • mode='research' (style='concise') for a specific compound, mechanism, or decision question.\n` +
    `  • mode='survey' (style='comprehensive') for a field or landscape.\n` +
    `Then follow the lattice-cli research pipeline phases:\n` +
    `  0. Pre-interview: if the topic is broad or ambiguous, call ask_user_question once to clarify scope, audience, and must-include sources; pass the answer as focus into research_plan_outline.\n` +
    `  1. Retrieval + Outline: call research_plan_outline(topic="${quoted}", mode=<your choice>, style=<matching>, focus=<if any>). This records interview assumptions, searches online + local Library literature, and creates a subsection-capable outline artifact.\n` +
    `  2. Writing workflow: call research_continue_report(artifactId) once. It drafts remaining sections in order, then refines and finalizes the report. Use research_draft_section only when the user explicitly wants manual section-by-section control.\n` +
    `  3. Refinement + Assembly are normally handled inside research_continue_report; only call research_refine_report or research_finalize_report separately when continuing a partially completed artifact.\n` +
    `Let research_plan_outline design a topic-specific outline; do not impose a fixed frame unless the topic truly calls for it.\n` +
    `Before step 1, write one short sentence explaining the mode you picked and why. Between later calls, write one short human sentence about progress. ` +
    `NEVER paste tool result JSON in your reply — the UI shows each call as an inline expandable card.`
  )
}
