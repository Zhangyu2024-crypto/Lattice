import type {
  ComputeCell,
  ComputeCellKind,
  ComputeProRun,
} from '../../types/artifact'

export function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/** Cast a finished container-script run into a different cell kind. Used
 *  by structure-code cells so the UI sees `cellKind: 'structure-code'`
 *  even though the container received `language: 'python'`. */
export function withCellKind(
  run: ComputeProRun,
  kind: ComputeCellKind,
): ComputeProRun {
  return { ...run, cellKind: kind }
}

/**
 * Expand `@struct-<key>` and `@cell-<id>` tokens in cell source.
 *
 * Every matching token is replaced with a plain-text context block:
 *
 *     [Referenced structure '<key>']
 *     <full CIF text>
 *
 * so both the LLM (Structure-AI) and Python (Structure-Code / script)
 * receive self-contained input. Unknown keys are left as-is so they stay
 * visible rather than silently disappearing.
 */
export function expandCellReferences(
  source: string,
  cells: ReadonlyArray<ComputeCell>,
): string {
  if (!source.includes('@')) return source
  const byId = new Map<string, ComputeCell>()
  for (const c of cells) byId.set(c.id, c)
  return source.replace(
    /@(struct|cell)-([a-zA-Z0-9_-]+)/g,
    (full, _kind: string, key: string) => {
      const cell = byId.get(key)
      const cif = cell?.lastRun?.stdout
      if (!cif || !cif.trim().startsWith('data_')) return full
      return `\n[Referenced structure '${key}']\n${cif}\n`
    },
  )
}
