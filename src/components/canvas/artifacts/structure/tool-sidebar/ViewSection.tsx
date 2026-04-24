// Camera + stage controls: background swatch, projection mode, axes /
// auto-spin toggles, reset view, and screenshot. The Palette icon is
// imported intentionally for the next pass (per-element colour
// overrides) — it renders as a 1px hidden slot so the import stays
// wired in.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Camera,
  Download,
  Grid3x3,
  Move3d,
  Palette,
  Radius,
  RotateCcw,
} from 'lucide-react'
import type { ProjectionMode } from '../StructureViewer'
import { Section, SubLabel, ToggleRow } from './primitives'
import { BACKGROUND_SWATCHES, PROJECTION_OPTIONS } from './constants'
import { S } from './styles'

type ExportFormat = 'png' | 'jpeg' | 'pdf' | 'cif'

interface Props {
  backgroundColor: string
  onBackgroundChange: (color: string) => void
  projection: ProjectionMode
  onProjectionChange: (p: ProjectionMode) => void
  showAxes: boolean
  onToggleAxes: () => void
  autoSpin: boolean
  onToggleAutoSpin: () => void
  onResetView: () => void
  onExport: (format: ExportFormat) => void
}

const EXPORT_FORMATS: { key: ExportFormat; label: string }[] = [
  { key: 'png', label: 'PNG' },
  { key: 'jpeg', label: 'JPG' },
  { key: 'pdf', label: 'PDF' },
  { key: 'cif', label: 'CIF' },
]

export default function ViewSection({
  backgroundColor,
  onBackgroundChange,
  projection,
  onProjectionChange,
  showAxes,
  onToggleAxes,
  autoSpin,
  onToggleAutoSpin,
  onResetView,
  onExport,
}: Props) {
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    const handler = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [exportOpen])
  return (
    <Section title="View" icon={<Move3d size={11} />} defaultOpen>
      <SubLabel>Background</SubLabel>
      <div style={S.swatches}>
        {BACKGROUND_SWATCHES.map((s) => {
          const selected = s.color === backgroundColor
          return (
            <button
              key={s.color}
              type="button"
              title={s.label}
              onClick={() => onBackgroundChange(s.color)}
              className={`structure-tool-swatch${selected ? ' is-selected' : ''}`}
              style={{ '--swatch-bg': s.color } as CSSProperties}
              aria-label={`Background ${s.label}`}
            />
          )
        })}
      </div>

      <SubLabel>Projection</SubLabel>
      <div style={S.optionGroup} role="radiogroup">
        {PROJECTION_OPTIONS.map((opt) => {
          const active = opt.value === projection
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onProjectionChange(opt.value)}
              className={`structure-tool-option${active ? ' is-active' : ''}`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      <ToggleRow
        label={
          <span style={S.iconLabel}>
            <Grid3x3 size={11} />
            XYZ axes
          </span>
        }
        active={showAxes}
        onToggle={onToggleAxes}
      />
      <ToggleRow
        label={
          <span style={S.iconLabel}>
            <Radius size={11} />
            Auto-spin
          </span>
        }
        active={autoSpin}
        onToggle={onToggleAutoSpin}
      />

      <button
        type="button"
        className="structure-tool-link"
        onClick={onResetView}
      >
        <RotateCcw size={11} />
        Reset view
      </button>
      <div ref={exportRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className="structure-tool-link"
          onClick={() => setExportOpen((v) => !v)}
        >
          <Download size={11} />
          Export ▾
        </button>
        {exportOpen && (
          <div style={exportMenuStyle}>
            {EXPORT_FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                style={exportItemStyle}
                onClick={() => {
                  onExport(f.key)
                  setExportOpen(false)
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <Palette size={1} className="structure-tool-hidden-icon" aria-hidden />
    </Section>
  )
}

const exportMenuStyle: CSSProperties = {
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

const exportItemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '5px 10px',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  fontFamily: 'var(--font-sans)',
  textAlign: 'left',
  background: 'transparent',
  color: 'var(--color-text-primary)',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
}
