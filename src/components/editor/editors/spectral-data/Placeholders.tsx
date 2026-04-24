import { Activity, Server } from 'lucide-react'

/**
 * Fallback placeholders shown when a backend-only format is requested without
 * a running backend, or when local parsing fails. Pure presentation.
 */

export function BackendRequired({ ext }: { ext: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 8,
        color: 'var(--color-text-muted)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <Server size={28} strokeWidth={1.2} style={{ opacity: 0.4 }} />
      <div>{ext} files require the lattice-cli backend to preview</div>
      <div style={{ fontSize: 'var(--text-xs)', opacity: 0.7 }}>
        Start the backend or use Electron mode to enable spectrum parsing
      </div>
    </div>
  )
}

export function ParseFailure({ ext }: { ext: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 8,
        color: 'var(--color-text-muted)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <Activity size={28} strokeWidth={1.2} style={{ opacity: 0.4 }} />
      <div>Could not parse spectrum data from {ext} file</div>
      <div style={{ fontSize: 'var(--text-xs)', opacity: 0.7 }}>
        The file format may not be supported or the data structure is unexpected
      </div>
    </div>
  )
}
