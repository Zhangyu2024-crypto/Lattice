// Shared compute-runner constants. Pulled out so main-process IPC + the
// preload bridge + the renderer client all reference the same channel
// names — otherwise renaming means grepping across three layers and
// hoping you caught them.

/** Streaming channels from `compute-runner.ts` to the renderer for
 *  one-off script executions (`compute:run`). */
export const COMPUTE_RUN_CHANNELS = {
  STDOUT: 'compute:stdout',
  STDERR: 'compute:stderr',
  EXIT: 'compute:exit',
} as const
