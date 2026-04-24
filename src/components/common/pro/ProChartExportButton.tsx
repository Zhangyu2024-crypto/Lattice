import { useEffect, useRef, useState } from 'react'
import { FileDown } from 'lucide-react'
import type { ChartExportFormat } from '@/hooks/useChartExporter'
import { TYPO } from '@/lib/typography-inline'
import type { CSSProperties } from 'react'

interface Props {
  onExport: (format: ChartExportFormat) => void
}

const FORMATS: { key: ChartExportFormat; label: string }[] = [
  { key: 'png', label: 'PNG' },
  { key: 'jpeg', label: 'JPG' },
  { key: 'pdf', label: 'PDF' },
]

export default function ProChartExportButton({ onExport }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={wrapStyle}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Export chart image"
        style={btnStyle}
      >
        <FileDown size={11} />
        Image ▾
      </button>
      {open && (
        <div style={menuStyle}>
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              style={itemStyle}
              onClick={() => {
                onExport(f.key)
                setOpen(false)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const wrapStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
}

const btnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '6px 12px',
  fontSize: TYPO.xs,
  fontWeight: 600,
  fontFamily: 'inherit',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
}

const menuStyle: CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  marginBottom: 4,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-bg-elevated, #252525)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  padding: 2,
  minWidth: 72,
  zIndex: 50,
}

const itemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '5px 10px',
  fontSize: TYPO.xs,
  fontWeight: 500,
  fontFamily: 'inherit',
  textAlign: 'left',
  background: 'transparent',
  color: 'var(--color-text-primary)',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
  letterSpacing: '0.02em',
}
