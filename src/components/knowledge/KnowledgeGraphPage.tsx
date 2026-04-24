import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, Loader2, Network } from 'lucide-react'
import KnowledgeChainGraph from '../common/KnowledgeChainGraph'
import { localProKnowledge } from '../../lib/local-pro-knowledge'
import type { KnowledgeChainMatch } from '../../types/knowledge-api'
import { EmptyState } from '../ui'

interface Props {
  visible: boolean
}

export default function KnowledgeGraphPage({ visible }: Props) {
  const [chains, setChains] = useState<KnowledgeChainMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDiagnostic, setShowDiagnostic] = useState(false)
  const [showLegacy, setShowLegacy] = useState(false)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoading(true)
    setError(null)
    // Always fetch the full pool; filtering happens client-side so toggles
    // don't cost a roundtrip. Server-side filtering would also work but
    // the result sets here stay small.
    localProKnowledge
      .search({
        limit: 2000,
        min_confidence: 0,
        include_diagnostic: true,
        include_legacy: true,
      })
      .then((res) => {
        if (cancelled) return
        if ('results' in res) {
          setChains(res.results)
        } else {
          setChains(res.data.results ?? res.data.params ?? [])
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible])

  const { accepted, diagnostic, legacy, visibleChains } = useMemo(() => {
    const acc = chains.filter((c) => c.quality === 'accepted')
    const diag = chains.filter((c) => c.quality === 'diagnostic')
    const leg = chains.filter((c) => c.quality === 'legacy' || c.quality == null)
    const vis = [
      ...acc,
      ...(showDiagnostic ? diag : []),
      ...(showLegacy ? leg : []),
    ]
    return {
      accepted: acc.length,
      diagnostic: diag.length,
      legacy: leg.length,
      visibleChains: vis,
    }
  }, [chains, showDiagnostic, showLegacy])

  if (!visible) return null

  return (
    <div className="knowledge-graph-page">
      <div className="knowledge-graph-page-head">
        <div>
          <div className="knowledge-graph-page-kicker">
            <Network size={13} /> Knowledge Graph
            <span
              className="chain-card-badge"
              title="Graph quality depends heavily on extractor output. Treat as a diagnostic tool, not a finished visualization."
              style={{ marginLeft: 8 }}
            >
              <FlaskConical size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />
              Experimental
            </span>
          </div>
          <h3>Entity relationship map</h3>
          <p>
            Aggregates LLM chains into material, process, structure/state, and
            measurement nodes. Click nodes or edges to inspect evidence.
          </p>
        </div>
        <div className="knowledge-graph-page-stats">
          <span>accepted {accepted}</span>
          <span>diagnostic {diagnostic}</span>
          <span>legacy {legacy}</span>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 8,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showDiagnostic}
              onChange={(e) => setShowDiagnostic(e.target.checked)}
            />
            diagnostic
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showLegacy}
              onChange={(e) => setShowLegacy(e.target.checked)}
            />
            legacy (v1)
          </label>
        </div>
      </div>
      {loading ? (
        <EmptyState
          compact
          icon={<Loader2 size={16} className="spin" />}
          title="Loading graph..."
        />
      ) : error ? (
        <EmptyState compact title="Graph failed to load" hint={error} />
      ) : (
        <KnowledgeChainGraph
          chains={visibleChains}
          height={620}
          emptyTitle="No accepted chains — toggle diagnostic or legacy to inspect older data"
        />
      )}
    </div>
  )
}
