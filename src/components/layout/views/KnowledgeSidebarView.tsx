import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, PanelLeftClose, RefreshCw } from 'lucide-react'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../../stores/runtime-store'
import { localProKnowledge } from '../../../lib/local-pro-knowledge'
import {
  extractAllPapersToKnowledge,
  type BatchExtractProgress,
} from '../../../lib/knowledge/auto-extract'
import { toast } from '../../../stores/toast-store'
import { CollapsibleSidebarSpaceSection } from './CollapsibleSidebarBlocks'
import type { KnowledgeStats } from '../../../types/knowledge-api'

interface Props {
  onCollapseSidebar?: () => void
  onOpenKnowledgeWindow?: () => void
}

export default function KnowledgeSidebarView({
  onCollapseSidebar,
  onOpenKnowledgeWindow,
}: Props) {
  const session = useRuntimeStore(selectActiveSession)
  const focusArtifact = useRuntimeStore((s) => s.focusArtifact)
  const [stats, setStats] = useState<KnowledgeStats | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<BatchExtractProgress | null>(null)

  useEffect(() => {
    localProKnowledge.stats().then(setStats).catch(() => {})
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setProgress(null)
    try {
      const result = await extractAllPapersToKnowledge((p) => setProgress(p))
      const total = result.results.reduce((s, r) => s + r.chainCount, 0)
      if (total > 0) {
        toast.success(`Extracted ${total} chains from ${result.done} papers`)
      } else if (result.total === 0) {
        toast.info('No papers with PDFs found in library')
      } else {
        toast.info('No new chains extracted')
      }
      localProKnowledge.stats().then(setStats).catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
      setProgress(null)
    }
  }, [])

  const knowledgeArtifacts = useMemo(() => {
    if (!session) return []
    return session.artifactOrder
      .map((id) => session.artifacts[id])
      .filter(
        (artifact) =>
          artifact?.kind === 'knowledge-graph' ||
          artifact?.kind === 'material-comparison',
      )
      .slice()
      .reverse()
      .slice(0, 8)
  }, [session])

  return (
    <div className="sidebar-space-view">
      <div className="sidebar-header is-split">
        <span>Knowledge</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            title="Extract knowledge from all library papers"
            aria-label="Sync library to knowledge"
            className="session-mini-btn"
          >
            <RefreshCw
              size={14}
              className={syncing ? 'spin-slow' : undefined}
            />
          </button>
          {onOpenKnowledgeWindow ? (
            <button
              type="button"
              onClick={onOpenKnowledgeWindow}
              title="Open full knowledge window"
              aria-label="Open full knowledge window"
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
        {syncing && progress && (
          <div className="knowledge-sync-progress">
            Extracting {progress.done} / {progress.total}…
          </div>
        )}

        {stats && (
          <CollapsibleSidebarSpaceSection
            title={`Stats`}
            empty="No knowledge data yet — import papers and click sync"
          >
            <div className="knowledge-stats-grid">
              <span className="knowledge-stats-label">Extractions</span>
              <span className="knowledge-stats-value">{stats.total_extractions}</span>
              <span className="knowledge-stats-label">Chains</span>
              <span className="knowledge-stats-value">{stats.total_chains}</span>
              <span className="knowledge-stats-label">Nodes</span>
              <span className="knowledge-stats-value">{stats.total_nodes}</span>
            </div>
            {stats.top_materials.length > 0 && (
              <div className="knowledge-stats-top">
                {stats.top_materials.slice(0, 5).map((m) => (
                  <span key={m.name} className="knowledge-stats-tag">
                    {m.name} ({m.count})
                  </span>
                ))}
              </div>
            )}
          </CollapsibleSidebarSpaceSection>
        )}

        <CollapsibleSidebarSpaceSection
          title={`Artifacts (${knowledgeArtifacts.length})`}
          empty="No knowledge artifacts in this session"
        >
          {knowledgeArtifacts.map((artifact) => {
            const tooltip = `${artifact.title}\n${
              artifact.kind === 'knowledge-graph'
                ? 'Knowledge graph'
                : 'Material comparison'
            }`
            return (
              <button
                key={artifact.id}
                className="sidebar-space-row"
                onClick={() => session && focusArtifact(session.id, artifact.id)}
                title={tooltip}
              >
                <span className="sidebar-space-row-main">
                  <span className="sidebar-space-row-title">
                    {artifact.title}
                  </span>
                </span>
              </button>
            )
          })}
        </CollapsibleSidebarSpaceSection>
      </div>
    </div>
  )
}
