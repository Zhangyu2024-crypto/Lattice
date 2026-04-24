import { useCallback } from 'react'
import { Plus } from 'lucide-react'
import { useDataIndexStore } from '@/stores/data-index-store'
import type { DataStats } from '@/stores/data-index-store'
import { asyncPrompt } from '@/lib/prompt-dialog'

interface Props {
  stats: DataStats
}

const btnCss: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #333',
  color: '#ccc',
  fontSize: "var(--text-xs)",
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}

export default function DataFooter({ stats }: Props) {
  const createSample = useDataIndexStore((s) => s.createSample)
  const setSelectedSample = useDataIndexStore((s) => s.setSelectedSample)

  const handleNewSample = useCallback(async () => {
    const name = await asyncPrompt('Sample name:')
    if (!name?.trim()) return
    const formula = (await asyncPrompt('Chemical formula (optional):')) ?? undefined
    const id = createSample(name.trim(), formula?.trim() || undefined)
    setSelectedSample(id)
  }, [createSample, setSelectedSample])

  const handleImport = useCallback(() => {
    const el = (
      window as unknown as {
        electronAPI?: {
          openFile: (opts?: Record<string, unknown>) => Promise<string[] | null>
        }
      }
    ).electronAPI
    if (el?.openFile) {
      void el.openFile({ title: 'Import files to workspace' })
    }
  }, [])

  const parts: string[] = []
  if (stats.spectra > 0) parts.push(`${stats.spectra} spectra`)
  if (stats.analyses > 0) parts.push(`${stats.analyses} analyses`)
  if (stats.images > 0) parts.push(`${stats.images} images`)
  if (stats.papers > 0) parts.push(`${stats.papers} papers`)
  if (stats.samples > 0) parts.push(`${stats.samples} samples`)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderTop: '1px solid #333',
        flexShrink: 0,
        background: '#1e1e1e',
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: "var(--text-xs)",
          color: '#666',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {parts.join(' | ') || 'No data'}
      </span>
      <button type="button" onClick={handleNewSample} style={btnCss}>
        <Plus size={12} /> New Sample
      </button>
      <button type="button" onClick={handleImport} style={btnCss}>
        Import Files...
      </button>
    </div>
  )
}
