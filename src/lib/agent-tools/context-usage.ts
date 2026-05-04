import { useLLMConfigStore } from '../../stores/llm-config-store'
import { useRuntimeStore } from '../../stores/runtime-store'
import type { LocalTool } from '../../types/agent-tool'
import { transcriptToLlmMessages } from '../llm-chat/messages'
import { buildContextUsageReport } from '../context-management/report'

type Output = ReturnType<typeof buildContextUsageReport>

export function createContextUsageTool(
  getTools: (ctx: { sessionId: string; userMessage: string }) => ReadonlyArray<LocalTool>,
): LocalTool<Record<string, never>, Output> {
  return {
    name: 'context_usage',
    description:
      'Report the estimated token composition for the next Agent LLM request: system prompt, tool schemas, mention context, included history, safety margin, and dropped messages. Use this to diagnose context pressure or unexpectedly large prompts.',
    cardMode: 'info',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute(_input, ctx) {
      const session = useRuntimeStore.getState().sessions[ctx.sessionId]
      if (!session) throw new Error(`Session not found: ${ctx.sessionId}`)
      const lastUserMessage = [...session.transcript]
        .reverse()
        .find((message) => message.role === 'user')?.content ?? ''

      const llm = useLLMConfigStore.getState()
      const agentCfg = llm.agent
      const provider = llm.providers.find((p) => p.id === agentCfg.providerId)
      const model = provider?.models.find((m) => m.id === agentCfg.modelId)
      const requestCeiling = Math.min(
        llm.budget.perRequest.maxInputTokens,
        model?.contextWindow ?? llm.budget.perRequest.maxInputTokens,
      )

      return buildContextUsageReport({
        mode: 'agent',
        systemPrompt: agentCfg.systemPrompt ?? '',
        contextBlocks: [],
        sourceMessages: transcriptToLlmMessages(session.transcript),
        tools: getTools({ sessionId: ctx.sessionId, userMessage: lastUserMessage }),
        requestCeiling,
      })
    },
  }
}
