import type { ComponentType, ReactNode } from 'react'
import { FileText, Save } from 'lucide-react'

interface Props {
  relPath: string
  dirty: boolean
  onSave: () => void
  icon?: ComponentType<{ size: number; strokeWidth: number }>
  actions?: ReactNode
}

function basenameOf(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

export default function EditorToolbar({
  relPath,
  dirty,
  onSave,
  icon: Icon = FileText,
  actions,
}: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        borderBottom: '1px solid var(--color-border)',
        fontSize: "var(--text-sm)",
        color: 'var(--color-text-muted)',
        flexShrink: 0,
      }}
    >
      <Icon size={14} strokeWidth={1.6} />
      <strong
        style={{
          color: 'var(--color-text-primary)',
          fontSize: "var(--text-base)",
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: 420,
        }}
        title={relPath}
      >
        {basenameOf(relPath)}
      </strong>
      {dirty ? (
        <span
          aria-label="Unsaved changes"
          title="Unsaved changes"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--color-text-primary)',
            display: 'inline-block',
          }}
        />
      ) : null}
      <span style={{ flex: 1 }} />
      {actions}
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty}
        title="Save (Ctrl+S)"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          background: dirty ? 'var(--accent, #0e7490)' : 'transparent',
          color: dirty ? '#fff' : 'var(--color-text-muted)',
          fontSize: "var(--text-xs)",
          fontWeight: 500,
          cursor: dirty ? 'pointer' : 'default',
          opacity: dirty ? 1 : 0.65,
        }}
      >
        <Save size={12} strokeWidth={1.8} />
        Save
        <span
          style={{
            fontSize: "var(--text-xxs)",
            opacity: 0.75,
            fontFamily: 'var(--font-mono)',
          }}
        >
          Ctrl+S
        </span>
      </button>
    </div>
  )
}
