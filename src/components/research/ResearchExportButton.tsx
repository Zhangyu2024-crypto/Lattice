import { useCallback, useRef, useState, type RefObject } from 'react'
import {
  ChevronDown,
  FileDown,
  FileText,
  Loader2,
  Printer,
} from 'lucide-react'
import { useOutsideClickDismiss } from '@/hooks/useOutsideClickDismiss'
import {
  downloadResearchReportMarkdown,
  exportResearchReportPdf,
  type ResearchPdfPageSize,
} from '@/lib/research-report-export'
import { toast } from '@/stores/toast-store'
import { Button } from '@/components/ui'
import type { ResearchReportPayload } from '@/components/canvas/artifacts/research-report/types'

interface Props {
  payload: ResearchReportPayload
  bodyScrollRef?: RefObject<HTMLDivElement | null>
  align?: 'left' | 'right'
}

type BusyKey = 'markdown' | 'pdf-letter' | 'pdf-a4' | 'pdf-print' | null

export default function ResearchExportButton({
  payload,
  bodyScrollRef,
  align = 'right',
}: Props) {
  const [open, setOpen] = useState(false)
  const [busyKey, setBusyKey] = useState<BusyKey>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClickDismiss(wrapRef, open, () => setOpen(false))

  const canDirectPdf =
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.researchExportPdf === 'function'

  const handleMarkdown = useCallback(() => {
    setOpen(false)
    setBusyKey('markdown')
    try {
      downloadResearchReportMarkdown(payload)
      toast.success('Markdown exported')
    } catch (err) {
      toast.error(
        `Markdown export failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      )
    } finally {
      setBusyKey(null)
    }
  }, [payload])

  const handlePdf = useCallback(
    async (pageSize: ResearchPdfPageSize) => {
      setOpen(false)
      setBusyKey(pageSize === 'Letter' ? 'pdf-letter' : 'pdf-a4')
      try {
        const result = await exportResearchReportPdf({
          payload,
          bodyScrollRef,
          pageSize,
        })
        if (!result.ok) {
          if (!result.canceled) toast.error(result.error)
          return
        }
        toast.success(
          result.viaPrintDialog
            ? 'Print dialog opened'
            : `PDF exported (${result.pageSize})`,
        )
      } finally {
        setBusyKey(null)
      }
    },
    [bodyScrollRef, payload],
  )

  const handlePrintFallback = useCallback(async () => {
    setOpen(false)
    setBusyKey('pdf-print')
    try {
      const result = await exportResearchReportPdf({
        payload,
        bodyScrollRef,
        pageSize: 'Letter',
      })
      if (!result.ok) {
        if (!result.canceled) toast.error(result.error)
        return
      }
      toast.success('Print dialog opened')
    } finally {
      setBusyKey(null)
    }
  }, [bodyScrollRef, payload])

  const busy = busyKey !== null

  return (
    <div
      ref={wrapRef}
      className="research-export-wrap"
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        leading={
          busy ? <Loader2 size={13} className="spin" /> : <FileDown size={13} />
        }
        trailing={<ChevronDown size={12} />}
      >
        {busy ? 'Exporting…' : 'Export'}
      </Button>
      {open && (
        <div
          className={
            'research-export-menu' + (align === 'right' ? ' is-right' : '')
          }
          role="menu"
        >
          {canDirectPdf ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="research-export-item"
                onClick={() => void handlePdf('Letter')}
              >
                <FileDown size={13} className="research-export-item-icon" />
                <span className="research-export-item-copy">
                  <span className="research-export-item-label">
                    PDF · Letter
                  </span>
                  <span className="research-export-item-detail">
                    Direct file export, no print dialog
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="research-export-item"
                onClick={() => void handlePdf('A4')}
              >
                <FileDown size={13} className="research-export-item-icon" />
                <span className="research-export-item-copy">
                  <span className="research-export-item-label">PDF · A4</span>
                  <span className="research-export-item-detail">
                    Better for paper-style report sharing
                  </span>
                </span>
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="research-export-item"
              onClick={() => void handlePrintFallback()}
            >
              <Printer size={13} className="research-export-item-icon" />
              <span className="research-export-item-copy">
                <span className="research-export-item-label">
                  Print / Save PDF…
                </span>
                <span className="research-export-item-detail">
                  Browser fallback when native PDF export is unavailable
                </span>
              </span>
            </button>
          )}
          <div className="research-export-divider" />
          <button
            type="button"
            role="menuitem"
            className="research-export-item"
            onClick={handleMarkdown}
          >
            <FileText size={13} className="research-export-item-icon" />
            <span className="research-export-item-copy">
              <span className="research-export-item-label">Markdown</span>
              <span className="research-export-item-detail">
                Editable source with citations preserved
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
