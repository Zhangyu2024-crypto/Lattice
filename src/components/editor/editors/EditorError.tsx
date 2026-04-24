import { AlertTriangle } from 'lucide-react'

interface Props {
  relPath: string
  message: string
}

export default function EditorError({ relPath, message }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: '100%',
        padding: 32,
        color: 'var(--danger, #e5484d)',
        fontSize: "var(--text-sm)",
      }}
    >
      <AlertTriangle size={24} strokeWidth={1.4} />
      <div>Failed to open file</div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: "var(--text-xs)",
          color: 'var(--color-text-muted)',
        }}
        title={relPath}
      >
        {relPath}
      </div>
      <div
        style={{
          maxWidth: 480,
          textAlign: 'center',
          color: 'var(--color-text-muted)',
        }}
      >
        {message}
      </div>
    </div>
  )
}
