import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileUp, PanelLeftClose, RefreshCw } from 'lucide-react'
import { CollapsibleSidebarSpaceSection } from './CollapsibleSidebarBlocks'
import { localProLibrary } from '../../../lib/local-pro-library'
import { localProKnowledge } from '../../../lib/local-pro-knowledge'
import {
  extractPaperToKnowledge,
  extractAllPapersToKnowledge,
  type BatchExtractProgress,
} from '../../../lib/knowledge/auto-extract'
import { DEMO_LIBRARY } from '../../../stores/demo-library'
import { toast } from '../../../stores/toast-store'
import type { LibraryPaperRow, LibraryStats } from '../../../types/library-api'
import type { KnowledgeStats } from '../../../types/knowledge-api'
import { TableActions } from '../../common/TableActions'

interface Props {
  onCollapseSidebar?: () => void
  onOpenLibraryWindow?: () => void
  onOpenPaper: (
    paperId: string,
    metadata: {
      title: string
      authors: string[]
      year: number
      venue: string
      doi?: string
    },
    abstract: string,
  ) => void
}

interface LibrarySnapshot {
  papers: LibraryPaperRow[]
  stats: LibraryStats
  source: 'local' | 'demo'
}

const DEMO_STATS: LibraryStats = {
  total_papers: DEMO_LIBRARY.papers.length,
  total_tags: DEMO_LIBRARY.tags.length,
  tag_count: DEMO_LIBRARY.tags.length,
  collection_count: DEMO_LIBRARY.collections.length,
  by_source: { demo: DEMO_LIBRARY.papers.length },
  by_year: Object.fromEntries(
    DEMO_LIBRARY.papers.reduce<Map<string, number>>((acc, paper) => {
      acc.set(String(paper.year), (acc.get(String(paper.year)) ?? 0) + 1)
      return acc
    }, new Map()),
  ),
}

export default function LibrarySidebarView({
  onCollapseSidebar,
  onOpenLibraryWindow,
  onOpenPaper,
}: Props) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>({
    papers: demoRows(),
    stats: DEMO_STATS,
    source: 'demo',
  })
  const [error, setError] = useState<string | null>(null)
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<BatchExtractProgress | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!localProLibrary.ready) {
      setSnapshot({
        papers: demoRows(),
        stats: DEMO_STATS,
        source: 'demo',
      })
      setError(null)
      return
    }

    void Promise.all([
      localProLibrary.listPapers({
        limit: 6,
        sort: 'updated_at',
        order: 'desc',
      }),
      localProLibrary.stats(),
    ])
      .then(([papersRes, stats]) => {
        if (cancelled) return
        setSnapshot({
          papers: papersRes.papers,
          stats,
          source: 'local',
        })
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setSnapshot({
          papers: demoRows(),
          stats: DEMO_STATS,
          source: 'demo',
        })
        setError(err instanceof Error ? err.message : 'Failed to load library')
      })

    localProKnowledge.stats().then(setKnowledgeStats).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  const recentPapers = useMemo(
    () => snapshot.papers.slice(0, 5),
    [snapshot.papers],
  )

  const handleImportPdf = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.openFile || !localProLibrary.ready) {
      toast.warn('PDF import requires the Electron desktop shell')
      return
    }
    try {
      const sourcePath = await (api.openFile as (opts: unknown) => Promise<string | null>)({
        properties: ['openFile'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (!sourcePath) return
      const result = await localProLibrary.uploadPdf({ sourcePath })
      if (result.success) {
        toast.success(result.deduped ? 'Attached PDF to existing paper' : 'PDF imported')
        try {
          const [papersRes, stats] = await Promise.all([
            localProLibrary.listPapers({ limit: 6, sort: 'updated_at', order: 'desc' }),
            localProLibrary.stats(),
          ])
          setSnapshot({ papers: papersRes.papers, stats, source: 'local' })
        } catch { /* non-critical refresh failure */ }
        if (result.id != null) {
          extractPaperToKnowledge(result.id).then((r) => {
            if (r.chainCount > 0) {
              toast.info(`Extracted ${r.chainCount} chains`)
              localProKnowledge.stats().then(setKnowledgeStats).catch(() => {})
            }
          }).catch(() => { /* non-critical */ })
        }
      } else {
        toast.error(result.error ?? 'Import failed')
      }
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const handleSyncKnowledge = useCallback(async () => {
    setSyncing(true)
    setSyncProgress(null)
    try {
      const result = await extractAllPapersToKnowledge((p) => setSyncProgress(p))
      const total = result.results.reduce((s, r) => s + r.chainCount, 0)
      if (total > 0) {
        toast.success(`Extracted ${total} chains from ${result.done} papers`)
      } else if (result.total === 0) {
        toast.info('No papers with PDFs found in library')
      } else {
        toast.info('No new chains extracted')
      }
      localProKnowledge.stats().then(setKnowledgeStats).catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }, [])

  return (
    <div className="sidebar-space-view sidebar-space-view--library">
      <div className="sidebar-header is-split">
        <span>Library</span>
        <div className="sidebar-header-actions">
          <TableActions
            variant="compact"
            spec={{
              filename: 'library-papers',
              columns: [
                { key: 'title', header: 'Title' },
                { key: 'authors', header: 'Authors' },
                { key: 'year', header: 'Year' },
                { key: 'journal', header: 'Venue' },
                {
                  key: 'doi',
                  header: 'DOI',
                  format: (v: string | undefined) => v ?? '',
                },
                {
                  key: 'tags',
                  header: 'Tags',
                  format: (v: string[] | undefined) => (v ?? []).join('; '),
                },
              ],
              rows: snapshot.papers,
            }}
          />
          <button
            type="button"
            onClick={handleImportPdf}
            title="Import a PDF from disk"
            aria-label="Import PDF"
            className="session-mini-btn"
          >
            <FileUp size={14} />
          </button>
          {onOpenLibraryWindow ? (
            <button
              type="button"
              onClick={onOpenLibraryWindow}
              title="Open full library window"
              aria-label="Open full library window"
              className="session-mini-btn"
            >
              <ExternalLink size={14} />
            </button>
          ) : null}
          {onCollapseSidebar ? (
            <button
              type="button"
              onClick={onCollapseSidebar}
              title="Hide sidebar"
              aria-label="Hide sidebar"
              className="session-mini-btn"
            >
              <PanelLeftClose size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="sidebar-space-scroll">
        <CollapsibleSidebarSpaceSection
          title={`Papers (${snapshot.stats.total_papers})`}
          empty={
            error
              ? 'Library unavailable — showing demo'
              : 'No papers yet — click ↑ to import a PDF'
          }
        >
          {recentPapers.map((paper) => (
            <button
              key={paper.id}
              className="sidebar-space-row"
              onClick={() =>
                onOpenPaper(
                  String(paper.id),
                  {
                    title: paper.title,
                    authors: splitAuthors(paper.authors),
                    year: parseYear(paper.year),
                    venue: paper.journal?.trim() || 'Library paper',
                    doi: paper.doi,
                  },
                  paper.abstract?.trim() || '',
                )
              }
              title={compactRowTooltip(paper)}
            >
              <span className="sidebar-space-row-main">
                <span className="sidebar-space-row-title">{paper.title}</span>
              </span>
            </button>
          ))}
        </CollapsibleSidebarSpaceSection>

        <CollapsibleSidebarSpaceSection
          title="Chains"
          empty="No chains extracted yet"
          end={
            <button
              type="button"
              onClick={handleSyncKnowledge}
              disabled={syncing}
              title="Extract chains from all library papers"
              aria-label="Sync chains"
              className="session-mini-btn"
            >
              <RefreshCw
                size={12}
                className={syncing ? 'spin-slow' : undefined}
              />
            </button>
          }
        >
          {syncing && syncProgress && (
            <div className="knowledge-sync-progress">
              Extracting {syncProgress.done} / {syncProgress.total}…
            </div>
          )}
          {knowledgeStats && knowledgeStats.total_chains > 0 ? (
            <>
              <div className="knowledge-stats-grid">
                <span className="knowledge-stats-label">Extractions</span>
                <span className="knowledge-stats-value">{knowledgeStats.total_extractions}</span>
                <span className="knowledge-stats-label">Chains</span>
                <span className="knowledge-stats-value">{knowledgeStats.total_chains}</span>
                <span className="knowledge-stats-label">Nodes</span>
                <span className="knowledge-stats-value">{knowledgeStats.total_nodes}</span>
              </div>
              {knowledgeStats.top_materials.length > 0 && (
                <div className="knowledge-stats-top">
                  {knowledgeStats.top_materials.slice(0, 5).map((m) => (
                    <span key={m.name} className="knowledge-stats-tag">
                      {m.name} ({m.count})
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : !syncing ? (
            <div className="knowledge-sync-progress">
              Click sync to extract chains from papers
            </div>
          ) : null}
        </CollapsibleSidebarSpaceSection>
      </div>
    </div>
  )
}

function demoRows(): LibraryPaperRow[] {
  return [...DEMO_LIBRARY.papers]
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((paper, index) => ({
      id: index + 1,
      title: paper.title,
      authors: paper.authors.join('; '),
      year: String(paper.year),
      doi: paper.doi,
      journal: paper.venue,
      abstract: paper.abstract,
      tags: paper.tags,
      collections: paper.collectionId ? [paper.collectionId] : [],
    }))
}

function splitAuthors(authors: string): string[] {
  return authors
    .split(';')
    .map((author) => author.trim())
    .filter(Boolean)
}

function parseYear(year?: string): number {
  const parsed = Number(year)
  return Number.isFinite(parsed) ? parsed : new Date().getFullYear()
}

function compactRowTooltip(paper: LibraryPaperRow): string {
  const authors = splitAuthors(paper.authors)
  const who =
    authors.length === 0
      ? ''
      : authors.length <= 2
        ? authors.join(', ')
        : `${authors[0]}, ${authors[1]} +${authors.length - 2}`
  const when = paper.year || 'n.d.'
  const meta = who ? `${who} · ${when}` : when
  return `${paper.title}\n${meta}`
}
