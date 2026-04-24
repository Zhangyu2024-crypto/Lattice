import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, Loader2, MessageSquare, X } from 'lucide-react'
import { localProLibrary } from '../../lib/local-pro-library'
import { toast } from '../../stores/toast-store'
import type { AskMultiResponse } from '../../types/library-api'

export type PaperOption = {
  id: number
  title: string
  authors: string[]
  year: string
  venue: string
}

interface Props {
  open: boolean
  papers: PaperOption[]
  onClose: () => void
  onOpenPaper?: (paperId: number) => void
}

const MAX_MULTI_QA_PAPERS = 8

export default function MultiPaperQAModal({
  open,
  papers,
  onClose,
  onOpenPaper,
}: Props) {
  const api = localProLibrary
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AskMultiResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const openRef = useRef(open)
  const askReqId = useRef(0)

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (!open) {
      askReqId.current += 1
      setSelectedIds([])
      setQuestion('')
      setRunning(false)
      setResult(null)
      setErrorMsg(null)
      return
    }
    setSelectedIds(papers.slice(0, MAX_MULTI_QA_PAPERS).map((p) => p.id))
  }, [open, papers])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const togglePaper = useCallback((paperId: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(paperId)) return prev.filter((id) => id !== paperId)
      if (prev.length >= MAX_MULTI_QA_PAPERS) return prev
      return [...prev, paperId]
    })
  }, [])

  const handleAsk = useCallback(async () => {
    const q = question.trim()
    if (!q) {
      toast.warn('Enter a question')
      return
    }
    if (selectedIds.length < 2) {
      toast.warn('Select at least 2 papers')
      return
    }
    const reqId = ++askReqId.current
    setRunning(true)
    setResult(null)
    setErrorMsg(null)
    try {
      const res = await api.askMulti({ paper_ids: selectedIds, question: q })
      if (!openRef.current || reqId !== askReqId.current) return
      setResult(res)
      if (!res.success) {
        setErrorMsg(res.error)
        toast.error(`Ask across failed: ${res.error}`)
      }
    } catch (err) {
      if (!openRef.current || reqId !== askReqId.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      toast.error(`Ask across failed: ${msg}`)
    } finally {
      if (openRef.current && reqId === askReqId.current) setRunning(false)
    }
  }, [api, question, selectedIds])

  const perPaper: string[] = result?.success ? result.per_paper : []
  const selectedPapers = papers.filter((p) => selectedIds.includes(p.id))
  const canAsk =
    api.ready && !running && selectedIds.length >= 2 && question.trim().length > 0

  if (!open) return null

  return (
    <div className="multipaper-qa-backdrop" onClick={onClose}>
      <div
        className="multipaper-qa-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="multipaper-qa-header">
          <MessageSquare
            size={14}
            className="multipaper-qa-accent-icon"
          />
          <strong className="multipaper-qa-title">Ask Across Papers</strong>
          <span className="multipaper-qa-subtitle">
            {selectedIds.length}/{MAX_MULTI_QA_PAPERS} selected
          </span>
          <span className="multipaper-qa-header-spacer" />
          <button
            type="button"
            onClick={onClose}
            className="multipaper-qa-icon-btn"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="multipaper-qa-body">
          <div className="multipaper-qa-left">
            <div className="multipaper-qa-pane-label">Papers</div>
            <div className="multipaper-qa-list">
              {papers.length === 0 ? (
                <div className="multipaper-qa-empty-hint">
                  No backend papers in the current filter.
                </div>
              ) : (
                papers.map((paper) => {
                  const checked = selectedIds.includes(paper.id)
                  const disabled =
                    !checked && selectedIds.length >= MAX_MULTI_QA_PAPERS
                  const rowClass = [
                    'multipaper-qa-paper-row',
                    checked ? 'is-selected' : '',
                    disabled ? 'is-disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <label key={paper.id} className={rowClass}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => togglePaper(paper.id)}
                        className="multipaper-qa-checkbox"
                      />
                      <div className="multipaper-qa-paper-main">
                        <div
                          className="multipaper-qa-paper-title"
                          title={paper.title}
                        >
                          {paper.title}
                        </div>
                        <div className="multipaper-qa-paper-meta">
                          {[
                            paper.authors.slice(0, 3).join(', '),
                            paper.year,
                            paper.venue,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          <div className="multipaper-qa-right">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question across the selected papers..."
              rows={4}
              className="multipaper-qa-textarea"
              disabled={running}
            />
            <div className="multipaper-qa-ask-row">
              <button
                type="button"
                onClick={handleAsk}
                disabled={!canAsk}
                className={[
                  'multipaper-qa-primary-btn',
                  canAsk ? '' : 'is-disabled',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {running ? (
                  <Loader2 size={12} className="spin" />
                ) : (
                  <MessageSquare size={12} />
                )}
                {running ? 'Asking...' : 'Ask'}
              </button>
              {!api.ready && (
                <span className="multipaper-qa-help-text">
                  Backend required
                </span>
              )}
              {api.ready && selectedIds.length < 2 && (
                <span className="multipaper-qa-help-text">
                  Select at least 2 papers
                </span>
              )}
            </div>

            {errorMsg && <div className="multipaper-qa-error">{errorMsg}</div>}

            {result?.success && (
              <div className="multipaper-qa-answer-wrap">
                <div className="multipaper-qa-answer-header">
                  <span className="multipaper-qa-answer-label">Answer</span>
                  <span className="multipaper-qa-answer-meta">
                    {result.paper_count} paper
                    {result.paper_count === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="multipaper-qa-answer-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {result.answer || '_(empty answer)_'}
                  </ReactMarkdown>
                </div>
                {perPaper.length > 0 && (
                  <details className="multipaper-qa-fallback-box">
                    <summary className="multipaper-qa-fallback-summary">
                      Per-paper answers ({perPaper.length})
                    </summary>
                    <div className="multipaper-qa-per-paper-list">
                      {perPaper.map((chunk, idx) => {
                        const paper = selectedPapers[idx]
                        return (
                          <div
                            key={idx}
                            className="multipaper-qa-per-paper-card"
                          >
                            <div className="multipaper-qa-per-paper-header">
                              <span className="multipaper-qa-per-paper-title">
                                {paper?.title ?? `Paper ${idx + 1}`}
                              </span>
                              {paper && onOpenPaper && (
                                <button
                                  type="button"
                                  onClick={() => onOpenPaper(paper.id)}
                                  className="multipaper-qa-link-btn"
                                  title="Open this paper"
                                >
                                  <ExternalLink size={11} />
                                  Open
                                </button>
                              )}
                            </div>
                            <div className="multipaper-qa-per-paper-body">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {chunk}
                              </ReactMarkdown>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

