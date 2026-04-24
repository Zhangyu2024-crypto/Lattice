// stdout / stderr / error / figures panel for plain script cells.
//
// Every stream is rendered inside an <OutputSection> so the visual
// rhythm matches StructureOutput. Console height is draggable — the
// draft value lives locally while the user is pointer-down, and the
// commit callback hoists the final height into cell.paneHeights.

import { useState } from 'react'
import { FileImage } from 'lucide-react'

import { ResizeHandle } from '../../ResizeHandle'
import type { ComputeProRun } from '../../../../../types/artifact'
import { OutputSection } from './OutputSection'
import { StderrWithTraceback } from './StderrWithTraceback'

export function ScriptOutput({
  run,
  consoleHeight,
  onConsoleHeightChange,
}: {
  run: ComputeProRun
  consoleHeight?: number
  onConsoleHeightChange?: (h: number) => void
}) {
  const hasStdout = run.stdout.trim().length > 0
  const hasStderr = run.stderr.trim().length > 0
  const hasError = !!run.error
  const hasFigures = run.figures.length > 0
  const empty = !hasStdout && !hasStderr && !hasError && !hasFigures

  const [draftConsoleH, setDraftConsoleH] = useState<number | null>(null)
  const consoleMax = draftConsoleH ?? consoleHeight ?? 360
  const consoleStyle = { maxHeight: consoleMax }

  return (
    <div className="compute-nb-cell-output">
      {hasStdout && (
        <OutputSection label="stdout">
          <pre className="compute-nb-console" style={consoleStyle}>
            {run.stdout}
          </pre>
          {onConsoleHeightChange && (
            <ResizeHandle
              height={consoleMax}
              min={100}
              max={600}
              onDraft={setDraftConsoleH}
              onCommit={(f) => {
                setDraftConsoleH(null)
                onConsoleHeightChange(f)
              }}
              label="Resize console"
            />
          )}
        </OutputSection>
      )}
      {hasStderr && (
        <OutputSection label="stderr">
          <pre className="compute-nb-console is-err" style={consoleStyle}>
            <StderrWithTraceback text={run.stderr} />
          </pre>
        </OutputSection>
      )}
      {hasError && (
        <OutputSection label="error">
          <pre className="compute-nb-console is-err" style={consoleStyle}>
            {run.error}
          </pre>
        </OutputSection>
      )}
      {hasFigures && (
        <OutputSection label={`figures (${run.figures.length})`}>
          <div className="compute-nb-figures">
            {run.figures.map((f, i) => (
              <figure key={`${run.id}-${i}`} className="compute-nb-figure">
                <img
                  src={`data:image/${f.format};base64,${f.base64}`}
                  alt={f.caption ?? ''}
                />
                {f.caption && (
                  <figcaption className="compute-nb-figure-caption">
                    {f.caption}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </OutputSection>
      )}
      {empty && (
        <div className="compute-nb-output-empty">
          <FileImage size={14} strokeWidth={1.2} aria-hidden />
          <span>No captured output.</span>
        </div>
      )}
    </div>
  )
}
