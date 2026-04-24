import { useCallback, useEffect, useState } from 'react'
import { Clipboard, FileText, FolderOpen, X } from 'lucide-react'
import PdfContinuousViewer from '../library/PdfContinuousViewer'
import type { SelectionInfo } from '../library/PdfContinuousViewer'
import PdfSelectionToolbar from '../library/PdfSelectionToolbar'
import type { SelectionAction } from '../library/PdfSelectionToolbar'
import { toast } from '../../stores/toast-store'
import { dispatchMentionAdd } from '../../lib/composer-bus'
import type { MentionRef } from '../../types/mention'
import type { PaperAnnotation } from '../../types/library-api'

interface Props {
  relPath: string
  onCloseWindow: () => void
}

interface PdfMeta {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
  pageCount?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

export default function PdfReaderStandaloneView({ relPath, onCloseWindow }: Props) {
  const [data, setData] = useState<Uint8Array | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [aiQuotes, setAiQuotes] = useState<PaperAnnotation[]>([])
  const [fileStat, setFileStat] = useState<{ size: number; mtime: number } | null>(null)
  const [pdfMeta, setPdfMeta] = useState<PdfMeta | null>(null)

  const basename = relPath.split('/').pop() ?? relPath

  useEffect(() => {
    document.title = `Lattice — ${basename}`
  }, [basename])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    setData(null)

    const api = (window as unknown as { electronAPI?: Record<string, (...args: unknown[]) => Promise<unknown>> }).electronAPI

    if (!api?.workspaceReadBinary) {
      setStatus('error')
      setError('PDF reader requires the Electron shell.')
      return
    }

    const readBinary = api.workspaceReadBinary as (rel: string) => Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }>
    const readStat = api.workspaceStat as ((rel: string) => Promise<{ ok: boolean; stat?: { size: number; mtime: number } }>) | undefined

    readBinary(relPath).then((res) => {
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

    readStat?.(relPath).then((res) => {
      if (cancelled || !res?.ok || !res.stat) return
      setFileStat(res.stat)
    }).catch(() => {})

    return () => { cancelled = true }
  }, [relPath])

  const handlePdfLoad = useCallback((meta: PdfMeta) => {
    setPdfMeta(meta)
  }, [])

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
      const hash = Math.abs(
        [...`${relPath}:${selection.page}:${excerpt}`].reduce(
          (h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0,
        ),
      ).toString(36).slice(0, 12)
      const ref: MentionRef = {
        type: 'pdf-quote',
        paperId: relPath,
        page: selection.page,
        quoteHash: hash,
        excerpt,
      }
      const shortName = relPath.split('/').pop() ?? relPath
      dispatchMentionAdd({ ref, label: `${shortName} · p.${selection.page}` })
      setAiQuotes((prev) => [
        ...prev,
        {
          id: -(prev.length + 1),
          paper_id: 0,
          page: selection.page,
          type: 'highlight',
          color: '#818cf8',
          content: `AI: ${excerpt.slice(0, 60)}…`,
          rects: selection.rects,
          label: 'AI quote',
          linkedMentionRef: hash,
        },
      ])
    }
    setSelection(null)
  }, [selection])

  const handleCopyPath = useCallback(() => {
    void navigator.clipboard.writeText(relPath)
    toast.info('Path copied')
  }, [relPath])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: 'var(--bg, #1e1e1e)',
      color: 'var(--fg, #ccc)',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      fontSize: "var(--text-base)",
    }}>
      {/* Toolbar */}
      <div
        className="pdf-reader-titlebar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border, #333)',
          minHeight: 36,
        }}
      >
        <FileText size={16} style={{ flexShrink: 0, opacity: 0.6 }} />
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {basename}
        </span>
        <span style={{ fontSize: "var(--text-xs)", opacity: 0.5, flexShrink: 0 }}>{relPath}</span>
        <button
          type="button"
          onClick={onCloseWindow}
          className="pdf-reader-close-btn"
          style={{
            background: 'none', border: 'none', color: 'var(--fg, #ccc)', cursor: 'pointer',
            padding: 4, borderRadius: 4, flexShrink: 0,
          }}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* PDF Viewer */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {status === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
              Loading PDF...
            </div>
          )}
          {status === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: '#e5484d' }}>
              <FileText size={32} />
              <div>Failed to load PDF</div>
              <div style={{ fontSize: "var(--text-xs)", opacity: 0.7, maxWidth: 400, textAlign: 'center' }}>{error}</div>
            </div>
          )}
          {status === 'ready' && data && (
            <>
              <PdfContinuousViewer
                data={data}
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
            </>
          )}
        </div>

        {/* Info Sidebar */}
        <div style={{
          width: 280,
          flexShrink: 0,
          borderLeft: '1px solid var(--border, #333)',
          overflow: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          {/* File Info */}
          <section>
            <h3 style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: 'uppercase', opacity: 0.5, margin: '0 0 8px' }}>File Info</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: "var(--text-sm)" }}>
              <InfoRow label="Name" value={basename} />
              <InfoRow label="Path" value={relPath} />
              {fileStat && (
                <>
                  <InfoRow label="Size" value={formatBytes(fileStat.size)} />
                  <InfoRow label="Modified" value={formatDate(fileStat.mtime)} />
                </>
              )}
            </div>
          </section>

          {/* PDF Metadata */}
          {pdfMeta && (
            <section>
              <h3 style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: 'uppercase', opacity: 0.5, margin: '0 0 8px' }}>PDF Metadata</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: "var(--text-sm)" }}>
                {pdfMeta.title && <InfoRow label="Title" value={pdfMeta.title} />}
                {pdfMeta.author && <InfoRow label="Author" value={pdfMeta.author} />}
                {pdfMeta.subject && <InfoRow label="Subject" value={pdfMeta.subject} />}
                {pdfMeta.keywords && <InfoRow label="Keywords" value={pdfMeta.keywords} />}
                {pdfMeta.creator && <InfoRow label="Creator" value={pdfMeta.creator} />}
                {pdfMeta.producer && <InfoRow label="Producer" value={pdfMeta.producer} />}
                {pdfMeta.creationDate && <InfoRow label="Created" value={pdfMeta.creationDate} />}
                {pdfMeta.pageCount != null && <InfoRow label="Pages" value={String(pdfMeta.pageCount)} />}
              </div>
            </section>
          )}

          {/* Actions */}
          <section>
            <h3 style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: 'uppercase', opacity: 0.5, margin: '0 0 8px' }}>Actions</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <ActionBtn icon={<Clipboard size={13} />} label="Copy Path" onClick={handleCopyPath} />
              <ActionBtn
                icon={<FolderOpen size={13} />}
                label="Reveal in Explorer"
                onClick={() => toast.info('Reveal in OS — coming soon')}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ opacity: 0.5, minWidth: 72, flexShrink: 0 }}>{label}</span>
      <span style={{ wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: 'var(--bg-hover, #2a2a2a)',
        border: '1px solid var(--border, #333)',
        borderRadius: 4,
        color: 'var(--fg, #ccc)',
        cursor: 'pointer',
        fontSize: "var(--text-sm)",
      }}
    >
      {icon}
      {label}
    </button>
  )
}
