// DetailsPane — right pane of the LibraryModal 3-pane layout.
//
// Card-based layout: metadata header, abstract, tags, collections, and a
// live preview of extracted knowledge chains from IndexedDB.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookText,
  Copy,
  FileText,
  Link as LinkIcon,
  Network,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { toast } from '../../../stores/toast-store'
import { copyText } from '../../../lib/clipboard-helper'
import { runAutoTag } from '../../../lib/agent-tools/auto-tag-paper'
import { localProKnowledge } from '../../../lib/local-pro-knowledge'
import { extractPaperToKnowledge } from '../../../lib/knowledge/auto-extract'
import { useLogStore } from '../../../stores/log-store'
import type { KnowledgeChainMatch } from '../../../types/knowledge-api'
import ChainCard from '../../common/ChainCard'
import EmptyState from '../../common/EmptyState'
import type { Collection, PaperCard } from './types'

interface DetailsPaneProps {
  paper: PaperCard | null
  canEdit: boolean
  collections: Collection[]
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  onAddToCollection: (name: string) => void
  onRemoveFromCollection: (name: string) => void
}

export default function DetailsPane({
  paper,
  canEdit,
  collections,
  onAddTag,
  onRemoveTag,
  onAddToCollection,
  onRemoveFromCollection,
}: DetailsPaneProps) {
  const [newTag, setNewTag] = useState('')
  const [selectedCollection, setSelectedCollection] = useState('')
  const [abstractOpen, setAbstractOpen] = useState(false)
  const [chains, setChains] = useState<KnowledgeChainMatch[]>([])
  const [chainsLoading, setChainsLoading] = useState(false)
  const [extractingChains, setExtractingChains] = useState(false)
  /** When true, load chains with includeDiagnostic + includeLegacy so the
   *  user can inspect everything stored for this paper. Default (false)
   *  applies the v2 quality gate — accepted-only. */
  const [showAllVersions, setShowAllVersions] = useState(false)
  const canEditCollections = canEdit && paper?.backendId != null

  // AI auto-tag state
  const [aiTagLoading, setAiTagLoading] = useState(false)
  const [aiSuggested, setAiSuggested] = useState<string[]>([])
  const [aiAccepted, setAiAccepted] = useState<Set<string>>(new Set())
  const [aiReasoning, setAiReasoning] = useState('')

  const availableCollections = useMemo(() => {
    const joined = new Set(paper?.collections ?? [])
    return collections.filter((c) => !joined.has(c.name))
  }, [collections, paper])

  useEffect(() => {
    if (!canEditCollections || availableCollections.length === 0) {
      setSelectedCollection('')
      return
    }
    if (!availableCollections.some((c) => c.name === selectedCollection)) {
      setSelectedCollection(availableCollections[0].name)
    }
  }, [availableCollections, canEditCollections, selectedCollection])

  // Load knowledge chains whenever the selected paper or quality toggle
  // changes. The accepted-only default is the v2 quality gate; the user
  // can flip "show all versions" to see diagnostic + legacy rows too.
  useEffect(() => {
    setAbstractOpen(false)
    setAiSuggested([])
    setAiAccepted(new Set())
    setAiReasoning('')
    if (!paper || paper.backendId == null) {
      setChains([])
      return
    }
    let cancelled = false
    setChainsLoading(true)
    localProKnowledge
      .chainsByPaper(paper.backendId, {
        includeDiagnostic: showAllVersions,
        includeLegacy: showAllVersions,
      })
      .then((result) => {
        if (!cancelled) setChains(result)
      })
      .catch(() => {
        if (!cancelled) setChains([])
      })
      .finally(() => {
        if (!cancelled) setChainsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [paper, showAllVersions])

  const copyDoi = useCallback(async () => {
    if (!paper?.doi) {
      toast.warn('No DOI for this paper')
      return
    }
    void copyText(paper.doi, `DOI copied: ${paper.doi}`)
  }, [paper])

  const extractChainsForPaper = useCallback(async () => {
    if (!paper?.backendId || extractingChains) return
    setExtractingChains(true)
    try {
      const result = await extractPaperToKnowledge(paper.backendId)
      if (!result.success) {
        toast.error(result.error ?? 'Extraction failed')
        // Open the log console so the user can see the stage that failed.
        const logs = useLogStore.getState()
        logs.resetFilters()
        logs.setOpen(true)
        return
      }
      const accepted = result.accepted ?? result.chainCount
      const diagnostic = result.diagnostic ?? 0
      const rejected = result.rejected ?? 0
      if (accepted === 0 && diagnostic === 0 && rejected === 0) {
        // True empty extraction — LLM returned nothing.
        toast.info(
          `No chains extracted (stage: ${result.stage ?? 'extract'}). Log console opened — check the last 'knowledge' entries for the LLM response.`,
        )
        const logs = useLogStore.getState()
        logs.resetFilters()
        logs.setOpen(true)
      } else if (accepted === 0) {
        // Weak extraction: everything was diagnostic/rejected. Open the
        // log so the user can see why and decide whether to retry.
        toast.info(
          `${diagnostic} diagnostic, ${rejected} rejected — LLM output didn't clear the quality gate. Log console opened.`,
        )
        const logs = useLogStore.getState()
        logs.resetFilters()
        logs.setOpen(true)
      } else {
        const tail =
          diagnostic > 0 || rejected > 0
            ? ` (${diagnostic} diagnostic, ${rejected} rejected)`
            : ''
        toast.success(`Extracted ${accepted} chains${tail}`)
      }
      // Refresh displayed chains, respecting current quality toggle.
      const refreshed = await localProKnowledge.chainsByPaper(paper.backendId, {
        includeDiagnostic: showAllVersions,
        includeLegacy: showAllVersions,
      })
      setChains(refreshed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
      const logs = useLogStore.getState()
      logs.resetFilters()
      logs.setOpen(true)
    } finally {
      setExtractingChains(false)
    }
  }, [paper, extractingChains, showAllVersions])

  const runAutoTagHandler = useCallback(async () => {
    if (!paper?.backendId) return
    setAiTagLoading(true)
    setAiSuggested([])
    setAiAccepted(new Set())
    setAiReasoning('')
    try {
      const result = await runAutoTag(paper.backendId, '')
      if (result.success) {
        setAiSuggested(result.suggestedTags)
        setAiAccepted(new Set(result.suggestedTags))
        setAiReasoning(result.reasoning)
      } else {
        toast.error(result.error)
      }
    } catch (err) {
      toast.error(`Auto-tag failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAiTagLoading(false)
    }
  }, [paper])

  const openKnowledgeWindow = useCallback(async () => {
    const res = await window.electronAPI?.openKnowledgeWindow?.()
    if (res && !res.success) toast.error(res.error ?? 'Failed to open Knowledge')
  }, [])

  if (!paper) {
    return (
      <div className="library-modal-right-pane">
        <EmptyState
          variant="no-data"
          size="sm"
          title="Select a paper"
          description="Pick a paper on the left to see its details."
        />
      </div>
    )
  }

  return (
    <div className="library-modal-right-pane library-details-pane">
      {/* ── Header ──────────────────────────────────────────────── */}
      <section className="library-details-header">
        <h2 className="library-details-title">{paper.title}</h2>
        <div className="library-details-meta">
          {paper.authors.length > 0 && (
            <span>{paper.authors.slice(0, 3).join(', ')}
              {paper.authors.length > 3 ? ` et al.` : ''}
            </span>
          )}
          {paper.year && (
            <>
              <span className="library-details-meta-sep">·</span>
              <span>{paper.year}</span>
            </>
          )}
          {paper.venue && (
            <>
              <span className="library-details-meta-sep">·</span>
              <em className="library-details-venue">{paper.venue}</em>
            </>
          )}
        </div>
        {paper.doi && (
          <button
            type="button"
            onClick={copyDoi}
            className="library-modal-doi-chip"
            title="Copy DOI"
          >
            <LinkIcon size={10} />
            <span className="library-modal-doi-text">{paper.doi}</span>
            <Copy size={10} />
          </button>
        )}
      </section>

      {/* ── Abstract ────────────────────────────────────────────── */}
      {paper.abstract && (
        <section className="library-details-card">
          <button
            type="button"
            className="library-details-card-head"
            onClick={() => setAbstractOpen((v) => !v)}
          >
            <BookText size={12} strokeWidth={1.75} />
            <span>Abstract</span>
            <span className="library-details-card-chev">
              {abstractOpen ? '▾' : '▸'}
            </span>
          </button>
          {abstractOpen && (
            <p className="library-details-abstract">{paper.abstract}</p>
          )}
        </section>
      )}

      {/* ── Tags ────────────────────────────────────────────────── */}
      <section className="library-details-card">
        <div className="library-details-card-head library-details-card-head--static">
          <span>Tags</span>
          <span className="library-details-card-count">{paper.tags.length}</span>
        </div>
        <div className="library-modal-chip-row-inline">
          {paper.tags.length === 0 ? (
            <span className="library-modal-empty-hint">none</span>
          ) : (
            paper.tags.map((t) => (
              <span key={t} className="library-paper-chip-removable">
                {t}
                {canEdit && paper.backendId != null && (
                  <button
                    onClick={() => onRemoveTag(t)}
                    className="library-paper-chip-del"
                    title="Remove tag"
                  >
                    <X size={8} />
                  </button>
                )}
              </span>
            ))
          )}
        </div>
        {canEdit && paper.backendId != null && (
          <div className="library-details-tag-field">
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTag.trim()) {
                  onAddTag(newTag.trim())
                  setNewTag('')
                }
              }}
              placeholder="Add a tag…"
              className="library-details-tag-input"
            />
            <div className="library-details-tag-actions">
              <button
                type="button"
                className="library-details-tag-iconbtn"
                disabled={!newTag.trim()}
                onClick={() => {
                  if (!newTag.trim()) return
                  onAddTag(newTag.trim())
                  setNewTag('')
                }}
                title="Add this tag"
                aria-label="Add tag"
              >
                <Plus size={12} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="library-details-tag-iconbtn"
                disabled={aiTagLoading}
                onClick={runAutoTagHandler}
                title="Let AI suggest tags"
                aria-label="Auto-suggest tags"
              >
                <Sparkles size={12} strokeWidth={1.75} className={aiTagLoading ? 'spin' : undefined} />
              </button>
            </div>
          </div>
        )}
        {aiSuggested.length > 0 && (
          <div className="library-modal-ai-tag-suggestions">
            <div className="library-modal-ai-tag-label">
              AI suggestions{aiReasoning ? ` — ${aiReasoning}` : ''}
            </div>
            <div className="library-modal-ai-tag-chips">
              {aiSuggested.map((tag) => {
                const accepted = aiAccepted.has(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`library-modal-ai-tag-chip ${accepted ? 'is-accepted' : 'is-rejected'}`}
                    onClick={() => {
                      setAiAccepted((prev) => {
                        const next = new Set(prev)
                        if (next.has(tag)) next.delete(tag)
                        else next.add(tag)
                        return next
                      })
                    }}
                  >
                    {tag} {accepted ? '✓' : '✗'}
                  </button>
                )
              })}
            </div>
            <div className="library-modal-ai-tag-actions">
              <button
                type="button"
                className="library-modal-ai-tag-apply"
                disabled={aiAccepted.size === 0}
                onClick={() => {
                  for (const tag of aiAccepted) onAddTag(tag)
                  toast.success(`${aiAccepted.size} tag${aiAccepted.size === 1 ? '' : 's'} added`)
                  setAiSuggested([])
                  setAiAccepted(new Set())
                  setAiReasoning('')
                }}
              >
                Apply {aiAccepted.size}
              </button>
              <button
                type="button"
                className="library-modal-ai-tag-dismiss"
                onClick={() => {
                  setAiSuggested([])
                  setAiAccepted(new Set())
                  setAiReasoning('')
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Collections ────────────────────────────────────────── */}
      {canEditCollections && (
        <section className="library-details-card">
          <div className="library-details-card-head library-details-card-head--static">
            <span>Collections</span>
            <span className="library-details-card-count">{paper.collections.length}</span>
          </div>
          <div className="library-modal-chip-row-inline">
            {paper.collections.length === 0 ? (
              <span className="library-modal-empty-hint">none</span>
            ) : (
              paper.collections.map((name) => (
                <span key={name} className="library-paper-chip-removable">
                  {name}
                  <button
                    onClick={() => onRemoveFromCollection(name)}
                    className="library-paper-chip-del"
                    title="Remove from collection"
                  >
                    <X size={8} />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="library-modal-tag-input-row">
            <div className="library-modal-collection-picker">
              <select
                value={selectedCollection}
                onChange={(e) => setSelectedCollection(e.target.value)}
                disabled={availableCollections.length === 0}
                className="library-modal-tag-input library-modal-collection-select"
              >
                {availableCollections.length === 0 ? (
                  <option value="">No remaining collections</option>
                ) : (
                  availableCollections.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!selectedCollection) return
                  onAddToCollection(selectedCollection)
                }}
                disabled={!selectedCollection}
                className={[
                  'library-modal-primary-btn',
                  'library-modal-primary-btn--compact',
                  !selectedCollection ? 'is-disabled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <Plus size={11} />
                Add
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Chains ─────────────────────────────────────────────── */}
      <section className="library-details-card">
        <div className="library-details-card-head library-details-card-head--static">
          <Network size={12} strokeWidth={1.75} />
          <span>Chains</span>
          <span className="library-details-card-count">
            {chainsLoading ? '…' : chains.length}
          </span>
          {canEdit && paper.backendId != null && (
            <button
              type="button"
              className="library-details-chain-extract-btn"
              disabled={extractingChains || chainsLoading}
              onClick={extractChainsForPaper}
              title={
                chains.length > 0
                  ? 'Re-extract chains for this paper'
                  : 'Extract chains from this paper'
              }
            >
              <Sparkles
                size={11}
                strokeWidth={1.75}
                className={extractingChains ? 'spin' : undefined}
              />
              <span>
                {extractingChains
                  ? 'Extracting…'
                  : chains.length > 0
                    ? 'Re-extract'
                    : 'Extract'}
              </span>
            </button>
          )}
          {chains.length > 0 && (
            <button
              type="button"
              className="library-details-chain-extract-btn"
              onClick={openKnowledgeWindow}
              title="Open dedicated Knowledge graph page"
            >
              <Network size={11} strokeWidth={1.75} />
              <span>Open Knowledge</span>
            </button>
          )}
          <button
            type="button"
            className="library-details-chain-extract-btn"
            onClick={() => setShowAllVersions((v) => !v)}
            title={
              showAllVersions
                ? 'Hide diagnostic + legacy chains'
                : 'Show diagnostic + legacy chains too'
            }
            style={{ marginLeft: 'auto' }}
          >
            <span>{showAllVersions ? 'Accepted only' : 'Show all versions'}</span>
          </button>
        </div>
        {chains.length === 0 && !chainsLoading && !extractingChains ? (
          <div className="library-modal-empty-hint library-details-chain-empty">
            No chains extracted yet. Click <strong>Extract</strong> to run
            LLM extraction on this paper, or use the toolbar to batch all.
          </div>
        ) : (
          <div className="library-details-chain-list">
            {chains.slice(0, 20).map((c) => (
              <ChainCard key={c.chain_id} chain={c} />
            ))}
            {chains.length > 20 && (
              <div className="library-modal-empty-hint">
                … and {chains.length - 20} more — open Knowledge for graph view
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── PDF path ───────────────────────────────────────────── */}
      {paper.pdfPath && (
        <section className="library-details-card library-details-card--footer">
          <div className="library-details-card-head library-details-card-head--static">
            <FileText size={12} strokeWidth={1.75} />
            <span>PDF</span>
          </div>
          <div
            className="library-details-pdf-path"
            title={paper.pdfPath}
          >
            {paper.pdfPath}
          </div>
        </section>
      )}
    </div>
  )
}
