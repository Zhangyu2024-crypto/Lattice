import { useCallback, useEffect, useRef, useState } from 'react'
import PdfContinuousViewer from '../../library/PdfContinuousViewer'
import type { SelectionInfo } from '../../library/PdfContinuousViewer'
import PdfSelectionToolbar from '../../library/PdfSelectionToolbar'
import type { SelectionAction } from '../../library/PdfSelectionToolbar'
import { toast } from '../../../stores/toast-store'
import { dispatchMentionAdd } from '../../../lib/composer-bus'
import type { MentionRef } from '../../../types/mention'
import type { PaperAnnotation } from '../../../types/library-api'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'

function simpleHash(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36).slice(0, 12)
}

interface Props {
  relPath: string
}

// Distinct color for "sent to AI" highlights — indigo so it doesn't
// clash with user's manual highlight swatches (yellow/green/pink/blue).
const AI_QUOTE_COLOR = '#818cf8'

let aiQuoteSeq = 0

export default function PdfFileEditor({ relPath }: Props) {
  const [data, setData] = useState<Uint8Array | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  // Session-local annotations for passages the user sent to AI via "Ask AI".
  // Not persisted — they're visual feedback, not library annotations.
  const [aiQuotes, setAiQuotes] = useState<PaperAnnotation[]>([])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    setData(null)

    const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI as
      | { workspaceReadBinary?: (rel: string) => Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }> }
      | undefined

    if (!api?.workspaceReadBinary) {
      setStatus('error')
      setError('PDF preview requires the Electron shell (npm run electron:dev).')
      return
    }

    api.workspaceReadBinary(relPath).then((res) => {
      if (cancelled) return
      if (!res.ok || !res.data) {
        setStatus('error')
        setError(res.error || 'Failed to read PDF')
        return
      }
      setData(new Uint8Array(res.data))
      setStatus('ready')
    }).catch((err) => {
      if (cancelled) return
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    })

    return () => { cancelled = true }
  }, [relPath])

  const handleTextSelect = useCallback((info: SelectionInfo) => {
    setSelection(info)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelection(null)
  }, [])

  const handleSelectionAction = useCallback((action: SelectionAction) => {
    if (action.type === 'copy' && selection?.text) {
      void navigator.clipboard.writeText(selection.text)
      toast.info('Copied to clipboard')
    }
    if (action.type === 'ask' && selection?.text) {
      const excerpt = selection.text.slice(0, 200)
      const quoteHash = simpleHash(`${relPath}:${selection.page}:${excerpt}`)
      const ref: MentionRef = {
        type: 'pdf-quote',
        paperId: relPath,
        page: selection.page,
        quoteHash,
        excerpt,
      }
      const shortName = relPath.split('/').pop() ?? relPath
      const chipLabel = `${shortName} · p.${selection.page}`
      dispatchMentionAdd({ ref, label: chipLabel })

      // Leave a visible highlight on the PDF so the user sees which
      // passage was sent to AI. Uses the same annotation rect format
      // as PdfContinuousViewer's annotation layer.
      const ann: PaperAnnotation = {
        id: -(++aiQuoteSeq),
        paper_id: typeof relPath === 'string' ? 0 : Number(relPath),
        page: selection.page,
        type: 'highlight',
        color: AI_QUOTE_COLOR,
        content: `AI quote: ${excerpt.slice(0, 60)}…`,
        rects: selection.rects,
        label: 'AI quote',
        linkedMentionRef: quoteHash,
      }
      setAiQuotes((prev) => [...prev, ann])
    }
    setSelection(null)
  }, [selection])

  if (status === 'loading') return <EditorLoading relPath={relPath} />
  if (status === 'error') return <EditorError relPath={relPath} message={error ?? 'Unknown error'} />

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <PdfContinuousViewer
        data={data ?? undefined}
        paperId={relPath}
        annotations={aiQuotes}
        onTextSelect={handleTextSelect}
        onClearSelection={handleClearSelection}
      />
      <PdfSelectionToolbar
        anchorRect={selection?.anchorRect ?? null}
        onAction={handleSelectionAction}
        onDismiss={handleClearSelection}
      />
    </div>
  )
}
