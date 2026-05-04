// Context management subsystem — re-exports.
//
// Provides auto-compaction, tool-result clearing, and conversation
// summarisation for the agent orchestrator. Import from this barrel
// module rather than reaching into individual files.

export {
  clearOldToolResults,
  CLEARED_TOOL_RESULT_SENTINEL,
  type ClearResult,
} from './tool-result-clearing'

export {
  getCompactionPrompt,
  formatCompactionSummary,
  getCompactionUserMessage,
} from './compaction-prompt'

export {
  compactConversation,
  type CompactionResult,
} from './compaction'

export {
  assembleLlmContext,
  type ContextAssemblyInput,
  type ContextAssemblyResult,
  type ContextBudgetBreakdown,
} from './assembler'

export {
  buildContextUsageReport,
  type ContextUsageCategory,
  type ContextUsageReport,
} from './report'

export {
  shouldAutoCompact,
  getContextUsage,
  estimateMessagesTokens,
  DEFAULT_CONTEXT_WINDOW,
  AUTO_COMPACT_THRESHOLD,
  type ContextUsage,
} from './auto-compact'
