import { FileQuestion } from 'lucide-react'

interface Props {
  relPath: string
  reason?: string
}

function extensionOf(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath
  const lower = base.toLowerCase()
  const knownDouble = [
    '.spectrum.json',
    '.chat.json',
    '.peakfit.json',
    '.xrd.json',
    '.xps.json',
    '.raman.json',
    '.curve.json',
    '.workbench.json',
    '.job.json',
  ]
  for (const ext of knownDouble) {
    if (lower.endsWith(ext)) return ext
  }
  const idx = lower.lastIndexOf('.')
  return idx >= 0 ? lower.slice(idx) : ''
}

export default function UnsupportedFileEditor({ relPath, reason }: Props) {
  const ext = extensionOf(relPath) || '(unknown)'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        height: '100%',
        padding: 32,
        color: 'var(--color-text-muted)',
        fontSize: "var(--text-sm)",
      }}
    >
      <FileQuestion size={28} strokeWidth={1.3} />
      <div style={{ fontSize: "var(--text-base)", color: 'var(--color-text-primary)' }}>
        Preview not available for {ext} yet
      </div>
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
      {reason ? (
        <div
          style={{
            maxWidth: 420,
            textAlign: 'center',
            fontSize: "var(--text-xs)",
            color: 'var(--color-text-muted)',
          }}
        >
          {reason}
        </div>
      ) : null}
    </div>
  )
}
