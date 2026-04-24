import type {
  ComputeCell,
  ComputeCellKind,
  ComputeProLanguage,
  ComputeProRun,
} from '../../types/artifact'

export interface UseComputeRunnerOptions {
  onFinished?: (cellId: string, run: ComputeProRun, success: boolean) => void
  onError?: (cellId: string, message: string) => void
}

export interface UseComputeRunnerResult {
  /**
   * Execute the cell identified by `cellId`. `codeOverride` replaces the
   * cell's stored `code` for this one run (used by Cmd+K "apply + run"
   * shortcuts); the stored code is unchanged.
   */
  run: (cellId: string, codeOverride?: string) => Promise<ComputeProRun | null>
  /** True while any cell is running on this artifact. */
  isRunning: boolean
  /** The id of the currently-running cell, if any. */
  runningCellId: string | null
}

export interface RunContainerArgs {
  code: string
  language: ComputeProLanguage
  timeoutS: number
  runId: string
  startedAt: number
}

export interface RunStructureArgs {
  description: string
  sessionId: string
  artifactTitle: string
  runId: string
  startedAt: number
  /** Container-exec timeout for the LLM-emitted Python. The LLM call
   *  itself is capped independently inside `invokeLlmForStructureCode`. */
  timeoutS: number
}

// Re-export for consumers that want to check language support without
// importing from the type module directly.
export type { ComputeProLanguage, ComputeCell, ComputeCellKind }
