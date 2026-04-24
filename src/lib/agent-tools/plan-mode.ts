import { useRuntimeStore } from '../../stores/runtime-store'
import type { LocalTool } from '../../types/agent-tool'

interface EnterPlanModeInput {
  reason: string
}

interface EnterPlanModeOutput {
  mode: 'plan'
  instructions: string
  existingPlan?: string
}

const PLAN_INSTRUCTIONS = [
  'You are now in PLAN MODE. Your goal is to explore the codebase, design an implementation approach, and present it for user approval.',
  '',
  '## Workflow',
  '1. Explore: use workspace_read_file / workspace_grep / workspace_glob to understand the relevant code',
  '2. Analyze: identify existing patterns, utilities, and architecture to reuse',
  '3. Design: formulate a step-by-step implementation plan',
  '4. Write: record your plan as the `plan` parameter',
  '5. Submit: call exit_plan_mode to present the plan for approval',
  '',
  '## Plan structure',
  '- Context: why this change is needed',
  '- Approach: step-by-step implementation with file paths',
  '- Files to modify/create',
  '- Verification: how to test the changes',
  '',
  '## Rules',
  '- Do NOT execute analysis or mutation tools (detect_peaks, xrd_refine, compute_run, etc.)',
  '- DO use read-only workspace tools (read, grep, glob) to explore',
  '- DO use ask_user_question if you need to clarify requirements or choose between approaches',
  '- Do NOT use ask_user_question to ask "is this plan okay?" — exit_plan_mode IS the approval request',
].join('\n')

export const enterPlanModeTool: LocalTool<
  EnterPlanModeInput,
  EnterPlanModeOutput
> = {
  name: 'enter_plan_mode',
  description:
    'Enter plan mode: pause tool execution and design an implementation plan for user approval. ' +
    'Use when ANY of these apply: ' +
    '(1) new feature implementation with multiple valid approaches, ' +
    '(2) architectural decisions (algorithm choice, library migration, data model changes), ' +
    '(3) multi-file modifications that affect existing behavior, ' +
    '(4) unclear requirements that need exploration first, ' +
    '(5) user preferences matter for the implementation approach. ' +
    'Do NOT use for: single-line fixes, obvious bugs, tasks with very specific instructions, or pure research/exploration.',
  trustLevel: 'safe',
  planModeAllowed: true,
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why plan mode is needed (one short sentence).',
      },
    },
    required: ['reason'],
  },
  async execute(input, ctx) {
    if (!input?.reason) throw new Error('reason is required')
    const store = useRuntimeStore.getState()
    store.enterPlanMode(ctx.sessionId, input.reason)

    const session = store.sessions[ctx.sessionId]
    const existingPlan = session?.planMode?.plan

    let instructions = PLAN_INSTRUCTIONS
    if (existingPlan) {
      instructions += `\n\n## Existing plan from previous session\n${existingPlan}`
    }

    return {
      mode: 'plan',
      instructions,
      ...(existingPlan ? { existingPlan } : {}),
    }
  },
}

interface ExitPlanModeInput {
  plan?: string
}

interface ExitPlanModeOutput {
  mode: 'execute'
  message: string
}

export const exitPlanModeTool: LocalTool<
  ExitPlanModeInput,
  ExitPlanModeOutput
> = {
  name: 'exit_plan_mode',
  description:
    'Leave plan mode and submit the plan for user approval. ' +
    'Pass the complete plan text in the `plan` parameter. ' +
    'IMPORTANT: this tool IS the approval request — do NOT use ask_user_question to ask "is this plan okay?" beforehand. ' +
    'Only use this tool for implementation tasks that require writing code. ' +
    'For pure research/exploration tasks, do NOT use this tool.',
  trustLevel: 'safe',
  planModeAllowed: true,
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        description:
          'Complete plan text. Should include: context, step-by-step approach, files to modify, and verification steps.',
      },
    },
  },
  async execute(input, ctx) {
    const store = useRuntimeStore.getState()
    if (input?.plan) {
      store.setPlanText(ctx.sessionId, input.plan)

      // Persist plan to workspace filesystem
      if (ctx.orchestrator?.fs) {
        const slug = ctx.sessionId.slice(0, 12).replace(/[^a-z0-9]/g, '')
        const path = `plans/${slug}.md`
        try {
          await ctx.orchestrator.fs.writeText(path, input.plan)
        } catch {
          // Best-effort — workspace may not support writes in Vite mode
        }
      }
    }
    store.exitPlanMode(ctx.sessionId)
    return {
      mode: 'execute',
      message: 'Plan accepted; resuming normal execution.',
    }
  },
}
