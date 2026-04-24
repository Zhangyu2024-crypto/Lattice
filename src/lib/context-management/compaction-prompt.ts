// Compaction prompt for context summarisation.
//
// Adapted from Claude Code's 9-section compaction prompt, reshaped for
// Lattice's materials-science domain. The model writes an `<analysis>`
// drafting scratchpad first (stripped before the summary enters context),
// then emits a structured `<summary>` with the sections below.
//
// The prompt explicitly forbids tool calls — the compaction LLM call runs
// in text-only mode and must not attempt any tool invocation.

/**
 * Build the full compaction system+user prompt that instructs the LLM to
 * produce a structured 9-section summary of the conversation.
 *
 * @param customInstructions  Optional per-session instructions appended to
 *   the prompt (e.g. "focus on XRD refinement parameters").
 */
export function getCompactionPrompt(customInstructions?: string): string {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACTION_PROMPT

  if (customInstructions && customInstructions.trim() !== '') {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`
  }

  prompt += NO_TOOLS_TRAILER
  return prompt
}

/**
 * Strip the `<analysis>` drafting scratchpad and unwrap `<summary>` tags,
 * producing a clean summary string suitable for injection as context.
 */
export function formatCompactionSummary(rawSummary: string): string {
  let formatted = rawSummary

  // Remove the analysis scratchpad — it improves summary quality during
  // generation but carries no informational value afterward.
  formatted = formatted.replace(/<analysis>[\s\S]*?<\/analysis>/, '')

  // Extract and unwrap the summary section.
  const match = formatted.match(/<summary>([\s\S]*?)<\/summary>/)
  if (match) {
    const content = match[1] || ''
    formatted = formatted.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${content.trim()}`,
    )
  }

  // Collapse excessive blank lines.
  formatted = formatted.replace(/\n\n+/g, '\n\n')

  return formatted.trim()
}

/**
 * Wrap a formatted summary into the user message that seeds the
 * post-compaction conversation. The preamble tells the model that prior
 * context was compacted and that the summary is authoritative.
 */
export function getCompactionUserMessage(summary: string): string {
  const formatted = formatCompactionSummary(summary)

  return `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${formatted}

Continue the conversation from where it left off. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`
}

// ── Internal constants ──────────────────────────────────────────────

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use any tool whatsoever.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`

const DETAILED_ANALYSIS_INSTRUCTION = `Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and scientific parameters
   - Specific details like:
     - file names and artifact names
     - spectrum analysis parameters (2-theta ranges, binding energies, Raman shifts)
     - crystal structures, space groups, lattice parameters
     - peak positions, phases identified, refinement results with exact values
     - code snippets and function signatures
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.`

const BASE_COMPACTION_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, scientific parameters, analysis results, and architectural decisions that would be essential for continuing the work without losing context.

${DETAILED_ANALYSIS_INSTRUCTION}

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail.
2. Key Technical Concepts: List all important scientific concepts, analysis techniques, and parameters discussed (crystal structures, space groups, spectroscopy methods, peak fitting models, refinement strategies).
3. Artifacts and Data: Enumerate specific artifacts created or modified, spectrum data loaded, structures built, and files examined. Include parameter values where applicable and a summary of why each artifact or file is important.
4. Analysis Results: Document peaks detected, phases identified, refinement results, fitting parameters — with exact numerical values. Include any computed metrics (R-factors, chi-squared, peak areas, FWHM values).
5. Errors and Fixes: List all errors encountered and how they were resolved. Pay special attention to specific user feedback, especially corrections to scientific parameters or analysis methodology.
6. All User Messages: List ALL user messages that are not tool results. These are critical for understanding the user's feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names, parameter values, and analysis state where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the user's request. Do not start on tangential requests or already-completed tasks without confirming with the user first.
   If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Artifacts and Data:
   - [Artifact / File Name 1]
      - [Summary of why this artifact is important]
      - [Summary of the changes made, if any]
      - [Key parameter values]
   - [...]

4. Analysis Results:
   - [Result 1 with exact numerical values]
   - [...]

5. Errors and Fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

6. All User Messages:
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional next step to take]

</summary>
</example>

Please provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response.

There may be additional summarization instructions provided in the included context. If so, remember to follow these instructions when creating the above summary.
`

const NO_TOOLS_TRAILER =
  '\n\nREMINDER: Do NOT call any tools. Respond with plain text only — ' +
  'an <analysis> block followed by a <summary> block. ' +
  'Tool calls will be rejected and you will fail the task.'
