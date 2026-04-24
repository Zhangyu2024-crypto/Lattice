import { Loader2, FileWarning } from 'lucide-react'
import PdfContinuousViewer from '../../../library/PdfContinuousViewer'
import type { LatexCompileStatus } from '../../../../types/latex'

interface Props {
  pdf: Uint8Array | null
  status: LatexCompileStatus
  errorCount: number
  /** Stable string used as `paperId` so PdfContinuousViewer's internal caches
   *  (annotation store, layout memo) key off the artifact, not the PDF bytes. */
  artifactKey: string
  /** Last log excerpt shown under the "compile failed" state. */
  logTail?: string
}

export default function LatexPreviewPane({
  pdf,
  status,
  errorCount,
  artifactKey,
  logTail,
}: Props) {
  if (status === 'compiling') {
    return (
      <div className="latex-preview-state latex-preview-state--compiling">
        <div className="latex-preview-state-icon" aria-hidden="true">
          <Loader2 size={22} className="spin" />
        </div>
        <div className="latex-preview-state-title">Building PDF</div>
        <div className="latex-preview-state-hint">
          First compile loads the TeX engine into memory (~5-10s). Subsequent compiles are faster.
        </div>
      </div>
    )
  }

  if (!pdf) {
    if (status === 'failed') {
      return (
        <div className="latex-preview-state is-error">
          <div className="latex-preview-state-icon" aria-hidden="true">
            <FileWarning size={22} />
          </div>
          <div className="latex-preview-state-title">Compile failed</div>
          <div className="latex-preview-state-hint">
            {errorCount > 0
              ? `${errorCount} error${errorCount === 1 ? '' : 's'} — open the Errors tab for details.`
              : 'See the Errors tab for the raw log.'}
          </div>
          {logTail ? (
            <pre className="latex-preview-state-log">
              {logTail.split('\n').slice(-8).join('\n')}
            </pre>
          ) : null}
        </div>
      )
    }
    return (
      <div className="latex-preview-state">
        <div className="latex-preview-state-title">No preview yet</div>
        <div className="latex-preview-state-hint">
          Press <strong>Compile</strong> in the header (or turn on auto-compile)
          to render the PDF.
        </div>
      </div>
    )
  }

  return (
    <div className="latex-preview-viewer">
      <PdfContinuousViewer data={pdf} paperId={artifactKey} />
    </div>
  )
}
