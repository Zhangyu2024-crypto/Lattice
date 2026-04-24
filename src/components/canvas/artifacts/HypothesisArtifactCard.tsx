import { memo, useCallback, useMemo, useState } from 'react'
import { Beaker, CheckCircle2, Circle, CircleDashed, HelpCircle, Plus, Tag, XCircle } from 'lucide-react'
import type { Artifact } from '../../../types/artifact'
import { toast } from '../../../stores/toast-store'
import { Badge, Button, EmptyState } from '../../ui'
import { asyncPrompt } from '../../../lib/prompt-dialog'

type HypothesisStatus = 'open' | 'supported' | 'refuted' | 'inconclusive'
type EvidenceStrength = 'strong' | 'moderate' | 'weak'
type FilterKey = 'all' | 'open' | 'supported' | 'refuted'

interface HypEvidence {
  id: string; artifactId?: string; note: string
  strength: EvidenceStrength
  direction: 'supports' | 'refutes'
  createdAt: number
}
interface Hypothesis {
  id: string; statement: string; status: HypothesisStatus; confidence: number
  createdAt: number; updatedAt: number
  evidence: HypEvidence[]; nextTests: string[]; tags: string[]
}
interface HypothesisPayload { topic: string; hypotheses: Hypothesis[] }
interface Props {
  artifact: Artifact
  /** Persist an in-place payload patch (e.g. after marking status). */
  onPatchPayload?: (nextPayload: HypothesisPayload) => void
  /** Navigate to the artifact referenced by an evidence item. */
  onFocusEvidenceArtifact?: (artifactId: string) => void
  className?: string
}

const STATUS_LABEL: Record<HypothesisStatus, string> = {
  open: 'Open', supported: 'Supported', refuted: 'Refuted', inconclusive: 'Inconclusive',
}
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'supported', label: 'Supported' },
  { key: 'refuted', label: 'Refuted' },
]

const statusColor = (s: HypothesisStatus): string =>
  s === 'supported' ? 'var(--color-green)'
    : s === 'refuted' ? 'var(--color-red)'
      : s === 'inconclusive' ? 'var(--color-text-muted)'
        : 'var(--color-accent)'

function StatusGlyph({ status, size = 14 }: { status: HypothesisStatus; size?: number }) {
  const cls = `card-hypothesis-status-glyph is-${status}`
  if (status === 'supported') return <CheckCircle2 size={size} className={cls} />
  if (status === 'refuted') return <XCircle size={size} className={cls} />
  if (status === 'inconclusive') return <HelpCircle size={size} className={cls} />
  return <CircleDashed size={size} className={cls} />
}

function HypothesisArtifactCardImpl({
  artifact: _artifact,
  onPatchPayload,
  onFocusEvidenceArtifact,
  className,
}: Props) {
  const payload = _artifact.payload as unknown as HypothesisPayload
  const hypotheses = payload?.hypotheses ?? []
  const topic = payload?.topic ?? 'Hypotheses'

  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedId, setSelectedId] = useState<string | null>(hypotheses[0]?.id ?? null)

  const filtered = useMemo(() => (filter === 'all' ? hypotheses : hypotheses.filter((h) => h.status === filter)), [hypotheses, filter])
  const selected = useMemo(() => hypotheses.find((h) => h.id === selectedId) ?? null, [hypotheses, selectedId])

  const updateHypotheses = useCallback((nextHypotheses: Hypothesis[]) => {
    onPatchPayload?.({ ...payload, hypotheses: nextHypotheses })
  }, [onPatchPayload, payload])

  const handleNew = useCallback(async () => {
    const statement = await asyncPrompt('Hypothesis statement')
    const trimmed = statement?.trim()
    if (!trimmed) return
    const now = Date.now()
    const next: Hypothesis = {
      id: `hyp_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      statement: trimmed,
      status: 'open',
      confidence: 0.5,
      createdAt: now,
      updatedAt: now,
      evidence: [],
      nextTests: [],
      tags: [],
    }
    updateHypotheses([next, ...hypotheses])
    setSelectedId(next.id)
    setFilter('all')
    toast.success('Hypothesis added')
  }, [hypotheses, updateHypotheses])

  const handleMark = useCallback((status: HypothesisStatus) => {
    if (!selected) {
      toast.warn('Select a hypothesis first')
      return
    }
    const now = Date.now()
    const nextHypotheses = hypotheses.map((hypothesis) => {
      if (hypothesis.id !== selected.id) return hypothesis
      return {
        ...hypothesis,
        status,
        confidence: nextConfidence(hypothesis.confidence, status),
        updatedAt: now,
      }
    })
    updateHypotheses(nextHypotheses)
    toast.success(`Marked as ${STATUS_LABEL[status].toLowerCase()}`)
  }, [selected, hypotheses, updateHypotheses])

  const handleJump = useCallback((artifactId?: string) => {
    if (!artifactId) {
      toast.warn('This evidence item has no linked artifact')
      return
    }
    onFocusEvidenceArtifact?.(artifactId)
  }, [onFocusEvidenceArtifact])

  const rootClassName = className
    ? `card-hypothesis-root ${className}`
    : 'card-hypothesis-root'

  return (
    <div className={rootClassName}>
      <div className="card-hypothesis-top-bar">
        <Beaker size={14} className="card-hypothesis-beaker" />
        <strong className="card-hypothesis-topic" title={topic}>{topic}</strong>
        <Badge variant="neutral">{hypotheses.length} total</Badge>
        <span className="card-hypothesis-spacer" />
        <div className="card-hypothesis-filter-row">
          {FILTERS.map((opt) => {
            const active = filter === opt.key
            return (
              <Button
                key={opt.key}
                variant={active ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFilter(opt.key)}
                className={active ? 'card-hypothesis-filter-btn is-active' : 'card-hypothesis-filter-btn'}
              >
                {opt.label}
              </Button>
            )
          })}
        </div>
        <Button variant="primary" size="sm" onClick={handleNew} leading={<Plus size={12} />}>
          New Hypothesis
        </Button>
      </div>

      <div className="card-hypothesis-main">
        <div className="card-hypothesis-left-pane">
          {filtered.length === 0 ? (
            <EmptyState compact title="No hypotheses match this filter" />
          ) : (
            filtered.map((h) => (
              <HypothesisRow
                key={h.id}
                hypothesis={h}
                selected={h.id === selectedId}
                onSelect={() => setSelectedId(h.id)}
              />
            ))
          )}
        </div>
        <div className="card-hypothesis-right-pane">
          {selected ? (
            <DetailPane hypothesis={selected} onMark={handleMark} onJumpArtifact={handleJump} />
          ) : (
            <EmptyState title="Select a hypothesis to view details" />
          )}
        </div>
      </div>
    </div>
  )
}

function HypothesisRow({
  hypothesis, selected, onSelect,
}: { hypothesis: Hypothesis; selected: boolean; onSelect: () => void }) {
  const supports = hypothesis.evidence.filter((e) => e.direction === 'supports').length
  const refutes = hypothesis.evidence.length - supports
  return (
    <button
      type="button"
      onClick={onSelect}
      className={selected ? 'card-hypothesis-row is-selected' : 'card-hypothesis-row'}
    >
      <div className="card-hypothesis-row-head">
        <StatusGlyph status={hypothesis.status} />
        <span className="card-hypothesis-row-statement" title={hypothesis.statement}>{hypothesis.statement}</span>
      </div>
      <ConfidenceBar value={hypothesis.confidence} status={hypothesis.status} />
      <div className="card-hypothesis-row-meta">
        <span className="card-hypothesis-meta-item">
          <Circle size={8} className="card-hypothesis-circle--support" /> {supports} support
        </span>
        <span className="card-hypothesis-meta-item">
          <Circle size={8} className="card-hypothesis-circle--refute" /> {refutes} refute
        </span>
        <span className="card-hypothesis-muted">·</span>
        <span className="card-hypothesis-muted">{hypothesis.nextTests.length} next tests</span>
      </div>
      {hypothesis.tags.length > 0 && (
        <div className="card-hypothesis-tag-row">
          {hypothesis.tags.map((tag) => (
            <Badge key={tag} variant="neutral">{tag}</Badge>
          ))}
        </div>
      )}
    </button>
  )
}

function ConfidenceBar({ value, status }: { value: number; status: HypothesisStatus }) {
  const pct = Math.max(0, Math.min(1, value))
  // `--val` + `--status-color` drive the fill; the surrounding track owns
  // the layout chrome in CSS. We can't use a class variant here because the
  // status can change on the fly and there are four.
  const fillStyle = {
    '--val': `${pct * 100}%`,
    '--status-color': statusColor(status),
  } as React.CSSProperties
  return (
    <div className="card-hypothesis-conf-wrap">
      <div className="card-hypothesis-conf-track">
        <div className="card-hypothesis-conf-fill" style={fillStyle} />
      </div>
      <span className="card-hypothesis-conf-pct">{(pct * 100).toFixed(0)}%</span>
    </div>
  )
}

function DetailPane({
  hypothesis, onMark, onJumpArtifact,
}: {
  hypothesis: Hypothesis
  onMark: (status: HypothesisStatus) => void
  onJumpArtifact: (artifactId?: string) => void
}) {
  // `--status-color` only needs to propagate to the chip — the rest of the
  // detail head inherits from the app text tokens. Keeping it on a scoped
  // wrapper span lets the chip border + color read from one source of truth.
  const chipStyle = {
    '--status-color': statusColor(hypothesis.status),
  } as React.CSSProperties
  return (
    <div className="card-hypothesis-detail-root">
      <div className="card-hypothesis-detail-scroll">
        <div className="card-hypothesis-detail-head">
          <span className="card-hypothesis-status-chip" style={chipStyle}>
            <StatusGlyph status={hypothesis.status} size={12} />
            {STATUS_LABEL[hypothesis.status]}
          </span>
          <div className="card-hypothesis-head-conf">
            <ConfidenceBar value={hypothesis.confidence} status={hypothesis.status} />
          </div>
          <span className="card-hypothesis-timestamp" title={new Date(hypothesis.updatedAt).toLocaleString()}>
            Updated {formatRelativeTime(hypothesis.updatedAt)}
          </span>
        </div>

        <h2 className="card-hypothesis-detail-statement">{hypothesis.statement}</h2>

        <div className="card-hypothesis-section">
          <div className="card-hypothesis-section-title">Evidence ({hypothesis.evidence.length})</div>
          {hypothesis.evidence.length === 0 ? (
            <EmptyState compact title="No evidence recorded" />
          ) : (
            <div className="card-hypothesis-ev-list">
              {hypothesis.evidence.map((ev) => (
                <EvidenceCard key={ev.id} evidence={ev} onJumpArtifact={onJumpArtifact} />
              ))}
            </div>
          )}
        </div>

        <div className="card-hypothesis-section">
          <div className="card-hypothesis-section-title">Proposed next tests ({hypothesis.nextTests.length})</div>
          {hypothesis.nextTests.length === 0 ? (
            <EmptyState compact title="No tests proposed" />
          ) : (
            <ol className="card-hypothesis-test-list">
              {hypothesis.nextTests.map((test, i) => (
                <li key={i} className="card-hypothesis-test-item">
                  <span className="card-hypothesis-test-num">{i + 1}.</span>
                  <span>{test}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {hypothesis.tags.length > 0 && (
          <div className="card-hypothesis-section">
            <div className="card-hypothesis-section-title">Tags</div>
            <div className="card-hypothesis-tag-row">
              {hypothesis.tags.map((tag) => (
                <Badge key={tag} variant="neutral" leading={<Tag size={10} />}>
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card-hypothesis-detail-actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onMark('supported')}
          leading={<CheckCircle2 size={12} />}
          className="card-hypothesis-action-btn is-support"
        >
          Mark as supported
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onMark('refuted')}
          leading={<XCircle size={12} />}
          className="card-hypothesis-action-btn is-refute"
        >
          Mark as refuted
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onMark('inconclusive')}
          leading={<HelpCircle size={12} />}
          className="card-hypothesis-action-btn is-inconclusive"
        >
          Mark as inconclusive
        </Button>
      </div>
    </div>
  )
}

function EvidenceCard({
  evidence, onJumpArtifact,
}: { evidence: HypEvidence; onJumpArtifact: (artifactId?: string) => void }) {
  const isSupport = evidence.direction === 'supports'
  return (
    <div className="card-hypothesis-ev-card">
      <div className="card-hypothesis-ev-head">
        <Badge variant={isSupport ? 'success' : 'danger'}>
          {isSupport ? 'supports' : 'refutes'}
        </Badge>
        <Badge variant={evidence.strength === 'weak' ? 'neutral' : 'info'}>
          {evidence.strength}
        </Badge>
        {evidence.artifactId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onJumpArtifact(evidence.artifactId)}
            title={`Jump to ${evidence.artifactId}`}
            leading={<Beaker size={10} />}
            className="card-hypothesis-ev-link"
          >
            {evidence.artifactId}
          </Button>
        )}
        <span className="card-hypothesis-spacer" />
        <span className="card-hypothesis-ev-ts">{formatRelativeTime(evidence.createdAt)}</span>
      </div>
      <div className="card-hypothesis-ev-note">{evidence.note}</div>
    </div>
  )
}

function nextConfidence(current: number, status: HypothesisStatus): number {
  if (status === 'supported') return Math.max(current, 0.75)
  if (status === 'refuted') return Math.min(current, 0.25)
  if (status === 'inconclusive') return 0.5
  return current
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts
  if (delta < 60_000) return 'just now'
  const mins = Math.floor(delta / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString()
}

export default memo(HypothesisArtifactCardImpl)
