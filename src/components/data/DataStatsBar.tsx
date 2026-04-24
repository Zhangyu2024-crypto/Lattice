import { useMemo } from 'react'
import { ChevronDown, ChevronRight, BarChart3 } from 'lucide-react'
import type { DataStats } from '@/stores/data-index-store'

interface Props {
  stats: DataStats
  expanded: boolean
  onToggle: () => void
}

function StatCell({ label, value, sub }: { label: string; value: number; sub?: string }) {
  if (value === 0 && !sub) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 80 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: '#ccc' }}>{value}</span>
        <span style={{ fontSize: "var(--text-xs)", color: '#888' }}>{label}</span>
      </div>
      {sub && (
        <span style={{ fontSize: "var(--text-xxs)", color: '#666', paddingLeft: 2 }}>{sub}</span>
      )}
    </div>
  )
}

function TechBar({ distribution }: { distribution: Record<string, number> }) {
  const entries = Object.entries(distribution).sort(([, a], [, b]) => b - a)
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (total === 0) return null

  const colors: Record<string, string> = {
    XRD: '#4fc3f7', XPS: '#81c784', Raman: '#ffb74d', FTIR: '#ce93d8',
    SEM: '#90a4ae', TEM: '#a1887f', EDS: '#80cbc4', AFM: '#ef9a9a',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
      <span style={{ fontSize: "var(--text-xxs)", color: '#888' }}>Technique distribution</span>
      {entries.map(([tech, count]) => {
        const pct = Math.round((count / total) * 100)
        return (
          <div key={tech} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: "var(--text-xxs)" }}>
            <span style={{ width: 40, color: '#888', textAlign: 'right', flexShrink: 0 }}>{tech}</span>
            <div style={{ flex: 1, height: 6, background: '#2a2a2a', borderRadius: 3, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: colors[tech] ?? '#60a5fa',
                  borderRadius: 3,
                  minWidth: 2,
                }}
              />
            </div>
            <span style={{ width: 30, color: '#666', flexShrink: 0 }}>{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

export default function DataStatsBar({ stats, expanded, onToggle }: Props) {
  const techSummary = useMemo(() => {
    return Object.entries(stats.spectraByTechnique)
      .sort(([, a], [, b]) => b - a)
      .map(([t, n]) => `${t}: ${n}`)
      .join(', ')
  }, [stats.spectraByTechnique])

  const assignedPct = stats.totalFiles > 0
    ? Math.round((stats.assigned / stats.totalFiles) * 100)
    : 0

  return (
    <div style={{ borderBottom: '1px solid #333', flexShrink: 0 }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          cursor: 'pointer',
          userSelect: 'none',
          fontSize: "var(--text-xs)",
          color: '#888',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#2a2a2a' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <BarChart3 size={12} />
        <span>Statistics</span>
        {!expanded && (
          <span style={{ color: '#666', marginLeft: 4 }}>
            {stats.totalFiles} files | {stats.samples} samples
          </span>
        )}
      </div>
      {expanded && (
        <div style={{ padding: '4px 12px 10px 28px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 6 }}>
            <StatCell label="spectra" value={stats.spectra} sub={techSummary || undefined} />
            <StatCell label="analyses" value={stats.analyses} />
            <StatCell label="images" value={stats.images} />
            <StatCell label="papers" value={stats.papers} />
            <StatCell label="structures" value={stats.structures} />
            <StatCell label="compute" value={stats.compute} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 4 }}>
            <StatCell label="samples" value={stats.samples} />
            <StatCell label="tags" value={stats.tags} />
            <StatCell
              label="rated"
              value={stats.rated}
              sub={stats.totalFiles > 0 ? `of ${stats.totalFiles}` : undefined}
            />
            <StatCell
              label="assigned"
              value={stats.assigned}
              sub={stats.totalFiles > 0 ? `${assignedPct}%` : undefined}
            />
          </div>
          <TechBar distribution={stats.spectraByTechnique} />
        </div>
      )}
    </div>
  )
}
