import { Info } from 'lucide-react'
import type { ParsedSpectrum } from '../../../../lib/parsers/types'

/**
 * Compact pill-bar summarising a parsed spectrum (technique, format, sample,
 * instrument, date, point count). Pure presentation.
 */
export function MetadataBar({ spectrum }: { spectrum: ParsedSpectrum }) {
  const { technique, metadata } = spectrum
  const pills: string[] = [
    technique,
    metadata.format,
    ...(metadata.sampleName ? [metadata.sampleName] : []),
    ...(metadata.instrument ? [metadata.instrument] : []),
    ...(metadata.date ? [metadata.date] : []),
    `${spectrum.x.length} pts`,
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 14px',
        borderBottom: '1px solid var(--color-border)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        overflow: 'hidden',
      }}
    >
      <Info size={11} strokeWidth={1.6} style={{ flexShrink: 0, opacity: 0.6 }} />
      {pills.map((p, i) => (
        <span
          key={`${i}-${p}`}
          style={{
            padding: '1px 6px',
            borderRadius: 3,
            background: 'rgba(0, 0, 0, 0.25)',
            whiteSpace: 'nowrap',
          }}
        >
          {p}
        </span>
      ))}
    </div>
  )
}
