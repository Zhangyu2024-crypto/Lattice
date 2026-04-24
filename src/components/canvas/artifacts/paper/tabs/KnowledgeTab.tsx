import { Loader2, Sparkles } from 'lucide-react'
import type { KnowledgeChain } from '../../../../../types/library-api'
import ChainCard from '../../../../common/ChainCard'
import { Button, EmptyState } from '../../../../ui'

export type WholeExtractPhase = 'reading' | 'extracting' | 'saving'

export type WholeExtractProgress = {
  phase: WholeExtractPhase
  total: number
  done: number
  succeeded: number
  failed: number
  chainCount: number
}

export default function KnowledgeTab({
  chains,
  loading,
  onRefresh,
  onExtractWhole,
  canExtractWhole,
  wholeExtracting,
  wholeExtractProgress,
}: {
  chains: KnowledgeChain[]
  loading: boolean
  onRefresh: () => void
  onExtractWhole: () => void
  canExtractWhole: boolean
  wholeExtracting: boolean
  wholeExtractProgress: WholeExtractProgress | null
}) {
  if (loading && !wholeExtracting) {
    return (
      <EmptyState
        compact
        icon={<Loader2 size={16} className="spin" />}
        title="Loading chains..."
      />
    )
  }
  const progress = wholeExtractProgress
  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : progress?.phase === 'saving'
        ? 100
        : 0
  return (
    <div className="card-paper-scroll-col">
      <Button
        variant="primary"
        size="sm"
        block
        onClick={onExtractWhole}
        disabled={!canExtractWhole || wholeExtracting}
        title={
          canExtractWhole
            ? 'Run extraction across the whole paper'
            : 'Backend needed for whole-paper extraction'
        }
        leading={
          wholeExtracting ? (
            <Loader2 size={12} className="spin" />
          ) : (
            <Sparkles size={12} />
          )
        }
      >
        Extract whole paper
      </Button>
      {progress && (
        <div className="card-paper-kb-progress-box">
          <div className="card-paper-kb-progress-head">
            <span className="card-paper-kb-progress-phase">
              {progress.phase === 'reading' && 'Reading paper...'}
              {progress.phase === 'extracting' &&
                `Extracting ${progress.done}/${progress.total}`}
              {progress.phase === 'saving' && 'Saving chains...'}
            </span>
            <span className="card-paper-kb-progress-stats">
              {progress.succeeded > 0 && (
                <span>ok {progress.succeeded}</span>
              )}
              {progress.failed > 0 && (
                <span className="card-paper-kb-progress-failed">
                  fail {progress.failed}
                </span>
              )}
              {progress.chainCount > 0 && (
                <span>{progress.chainCount} chains</span>
              )}
            </span>
          </div>
          <div className="card-paper-kb-progress-track">
            <div
              className="card-paper-kb-progress-fill"
              style={{ '--progress': `${progressPct}%` } as React.CSSProperties}
            />
          </div>
        </div>
      )}
      <div className="card-paper-kb-header">
        <span className="card-paper-kb-label">
          <Sparkles size={10} /> {chains.length} chains
        </span>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      {chains.length === 0 && !wholeExtracting && (
        <EmptyState
          compact
          title="No knowledge chains"
          hint="Select text in the PDF and click Extract."
        />
      )}
      {chains.map((c) => (
        <ChainCard key={c.id} chain={c} />
      ))}
    </div>
  )
}
