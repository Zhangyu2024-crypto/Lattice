import { FolderOpen } from 'lucide-react'

interface Props {
  onOpen: () => void
  disabled?: boolean
  hint?: string
  error?: string | null
}

export default function EmptyState({ onOpen, disabled, hint, error }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 10,
        padding: '16px 14px',
        color: 'var(--fg-muted, #888)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FolderOpen size={16} strokeWidth={1.75} />
        <strong style={{ color: 'var(--fg, #ddd)' }}>Explorer</strong>
      </div>
      <p style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
        {hint ?? 'Pick a local folder to use as your workspace. Spectra, chats, analyses, notes and scripts all live as files under this root.'}
      </p>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        style={{
          padding: '6px 10px',
          fontSize: "var(--text-sm)",
          background: disabled ? 'transparent' : 'var(--accent, #0a84ff)',
          color: disabled ? 'var(--fg-muted, #888)' : '#fff',
          border: disabled ? '1px solid var(--border, #333)' : '1px solid transparent',
          borderRadius: 4,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {disabled ? 'Open Folder (Electron only)' : 'Open Folder…'}
      </button>
      {error ? (
        <div style={{ fontSize: "var(--text-xs)", color: 'var(--danger, #e5484d)' }}>{error}</div>
      ) : null}
    </div>
  )
}
