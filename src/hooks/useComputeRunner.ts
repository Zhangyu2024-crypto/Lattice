import { useCallback, useEffect, useRef, useState } from 'react'
import { useRuntimeStore } from '../stores/runtime-store'
import type {
  ComputeCellProvenance,
  ComputeProArtifact,
  ComputeProLanguage,
  ComputeProRun,
} from '../types/artifact'
import { expandCellReferences, newRunId, withCellKind } from './compute-runner/helpers'
import { runContainerScript, runStructureBuild } from './compute-runner/execution'
import {
  clearCellStub,
  getFreshArtifact,
  writeCellRun,
} from './compute-runner/store-access'
import type {
  UseComputeRunnerOptions,
  UseComputeRunnerResult,
} from './compute-runner/types'

// Preserve the public surface of this module: the hook, its option /
// result types, and the convenience type re-exports that pre-split
// callers relied on via `import … from '.../useComputeRunner'`.
export type { UseComputeRunnerOptions, UseComputeRunnerResult } from './compute-runner/types'
export type {
  ComputeProLanguage,
  ComputeCell,
  ComputeCellKind,
} from './compute-runner/types'

/**
 * Owns the "stub run → await exec → finalise run" state machine for cells
 * inside a single compute-pro artifact. Each cell runs independently; the
 * hook tracks `runningCellId` so the UI can disable the right spinner.
 *
 * Cells that represent an LLM-to-CIF structure build short-circuit the
 * container and call `invokeLlmForCif` directly; every other cell kind
 * goes through `localProCompute.computeExec` with the right language.
 */
export function useComputeRunner(
  sessionId: string,
  artifact: ComputeProArtifact,
  opts: UseComputeRunnerOptions = {},
): UseComputeRunnerResult {
  const patchArtifact = useRuntimeStore((s) => s.patchArtifact)
  const [runningCellId, setRunningCellId] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = useCallback(
    async (
      cellId: string,
      codeOverride?: string,
    ): Promise<ComputeProRun | null> => {
      const freshArtifact = getFreshArtifact(sessionId, artifact.id)
      if (!freshArtifact) return null
      const cell = freshArtifact.payload.cells.find((c) => c.id === cellId)
      if (!cell) {
        opts.onError?.(cellId, `Cell not found: ${cellId}`)
        return null
      }

      // Markdown cells are pure documentation — they have no runner
      // path and "Run" is a silent no-op from keyboard shortcuts.
      if (cell.kind === 'markdown') {
        return null
      }

      const code = (codeOverride ?? cell.code).trim()
      if (!code) {
        opts.onError?.(
          cellId,
          cell.kind === 'structure-ai' ? 'Empty description' : 'Empty code',
        )
        return null
      }
      const kind = cell.kind
      const isStructureAi = kind === 'structure-ai'
      // Every path needs the container — structure-ai used to be a
      // pure LLM call, but now stage 2 runs the generated pymatgen
      // script in Python too, so the health gate applies uniformly.
      if (freshArtifact.payload.health?.containerUp === false) {
        opts.onError?.(
          cellId,
          freshArtifact.payload.health.error ?? 'Compute container is stopped',
        )
        return null
      }

      const timeoutS = freshArtifact.payload.timeoutS
      const runId = newRunId()
      const startedAt = Date.now()

      // Stub run so the UI can render a spinner immediately.
      const stubRun: ComputeProRun = {
        id: runId,
        cellKind: kind,
        startedAt,
        endedAt: null,
        exitCode: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        figures: [],
      }
      writeCellRun(sessionId, artifact.id, cellId, stubRun, 'loading')
      setRunningCellId(cellId)

      // Expand `@struct-<key>` / `@cell-<id>` tokens in the prompt / code
      // before sending. For AI cells the token becomes a full CIF context
      // block (so the LLM sees the prior structure). For code cells we
      // leave `load_structure(…)` calls intact because the Python prologue
      // resolves them against ACTIVE_CIFS at run time; @-tokens are a
      // prompt-only convention, so we still expand them here to avoid
      // accidental text-as-comment leakage.
      const expandedCode = expandCellReferences(code, freshArtifact.payload.cells)

      try {
        const finishedRun = isStructureAi
          ? await runStructureBuild({
              description: expandedCode,
              sessionId,
              artifactTitle: freshArtifact.title,
              runId,
              startedAt,
              timeoutS,
            })
          : kind === 'structure-code'
            ? withCellKind(
                await runContainerScript({
                  code: expandedCode,
                  language: 'python',
                  timeoutS,
                  runId,
                  startedAt,
                }),
                'structure-code',
              )
            : await runContainerScript({
                code: expandedCode,
                language: kind as ComputeProLanguage,
                timeoutS,
                runId,
                startedAt,
              })

        const success =
          finishedRun.exitCode === 0 &&
          !finishedRun.timedOut &&
          !finishedRun.error

        // If this is a fresh Structure-AI build success and the cell has no
        // provenance yet, backfill the prompt so the header chip shows
        // "prompt". The first 80 chars are enough for tooltip preview.
        const setProvenance: ComputeCellProvenance | undefined =
          success && isStructureAi && !cell.provenance
            ? { prompt: expandedCode.slice(0, 80) }
            : undefined
        writeCellRun(
          sessionId,
          artifact.id,
          cellId,
          finishedRun,
          success ? 'ready' : 'error',
          setProvenance,
          { success },
        )

        opts.onFinished?.(cellId, finishedRun, success)
        return finishedRun
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        opts.onError?.(cellId, msg)
        // Clear the stub so the UI stops showing "Executing…". We leave
        // the old `lastRun` as-is because the user's previous output is
        // more useful than a blank cell.
        clearCellStub(sessionId, artifact.id, cellId, runId, msg)
        return null
      } finally {
        if (mountedRef.current) setRunningCellId((cur) => (cur === cellId ? null : cur))
      }
    },
    // sessionId + artifact.id uniquely identify the artifact; cells are
    // looked up fresh from the store at exec time so the closure doesn't
    // restart on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, artifact.id, patchArtifact],
  )

  return {
    run,
    isRunning: runningCellId != null,
    runningCellId,
  }
}
