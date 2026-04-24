// Shared prompt scaffolds for the unified Research flow.
//
// Research is a single entry point now — no Brief / Survey split in the UI.
// The LLM decides between `mode='research'` (focused) and `mode='survey'`
// (broad) based on the topic itself when it calls `research_plan_outline`.
//
// Consumers:
//   - AgentComposer's `@research <topic>` inline command
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
    `Then call these tools in order:\n` +
    `  1. research_plan_outline(topic=<above>, mode=<your choice>, style=<matching>, focus=<if any>)\n` +
    `  2. research_draft_section(artifactId, sectionId) — once per section id returned above, in order\n` +
    `  3. research_finalize_report(artifactId)\n` +
    `Let research_plan_outline choose the actual outline; do not force a canned Snapshot/Methods/Follow-up frame.\n` +
    `Before step 1, write one short sentence explaining which mode you picked and why. Between later calls, write one short human sentence about progress. ` +
    `NEVER paste tool result JSON in your reply — the UI shows each call as an inline expandable card.`
  )
}

/**
 * Inline research kickoff — used by the `@research <topic>` composer
 * command. The topic is baked into the prompt so the agent starts work on
 * the next tick without a manual send.
 */
export function buildInlineResearchScaffold(topic: string): string {
  const clean = topic.trim()
  const quoted = clean || '<topic unspecified>'
  return (
    `Produce a research artifact on: "${quoted}".\n\n` +
    `First decide the shape based on the topic:\n` +
    `  • mode='research' (style='concise') for a specific compound, mechanism, or decision question.\n` +
    `  • mode='survey' (style='comprehensive') for a field or landscape.\n` +
    `Then call these tools in order:\n` +
    `  1. research_plan_outline(topic="${quoted}", mode=<your choice>, style=<matching>, focus=<if any>)\n` +
    `  2. research_draft_section(artifactId, sectionId) — once per section id returned above, in order\n` +
    `  3. research_finalize_report(artifactId)\n` +
    `Let research_plan_outline design a topic-specific outline; do not impose a fixed frame unless the topic truly calls for it.\n` +
    `Before step 1, write one short sentence explaining the mode you picked and why. Between later calls, write one short human sentence about progress. ` +
    `NEVER paste tool result JSON in your reply — the UI shows each call as an inline expandable card.`
  )
}

/**
 * Parse a composer draft for the inline `@research <topic>` command.
 * Returns `{ topic }` when the input begins with `@research` followed by a
 * topic; otherwise null. Case-insensitive, tolerates leading whitespace.
 */
export function parseResearchCommand(
  text: string,
): { topic: string } | null {
  const m = text.match(/^\s*@research(?:\s+([\s\S]+))?$/i)
  if (!m) return null
  const topic = (m[1] ?? '').trim()
  if (topic.length === 0) return null
  return { topic }
}
