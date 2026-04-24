import type { ViewMode } from './types'

const MODES: ViewMode[] = ['table', 'chart', 'raw']

interface ViewModeSwitchProps {
  view: ViewMode
  onChange: (mode: ViewMode) => void
}

export default function ViewModeSwitch({ view, onChange }: ViewModeSwitchProps) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {MODES.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          style={{
            padding: '3px 9px',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            background:
              view === v ? 'var(--accent, #0e7490)' : 'transparent',
            color: view === v ? '#fff' : 'var(--color-text-muted)',
            fontSize: 'var(--text-xxs)',
            fontWeight: 500,
            cursor: 'pointer',
            textTransform: 'capitalize',
          }}
        >
          {v}
        </button>
      ))}
    </div>
  )
}
