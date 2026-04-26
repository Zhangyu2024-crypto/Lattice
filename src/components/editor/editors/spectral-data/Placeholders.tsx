import { Activity, FileWarning } from 'lucide-react'

/**
 * Fallback placeholders shown when a spectrum format lacks a local parser or
 * when local parsing fails. Pure presentation.
 */

export function LocalParserUnsupported({ ext }: { ext: string }) {
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
      <FileWarning size={28} strokeWidth={1.2} style={{ opacity: 0.4 }} />
      <div>{ext} preview is not supported by the local parser yet</div>
      <div style={{ fontSize: 'var(--text-xs)', opacity: 0.7 }}>
        Open the source view or convert the file to a supported spectrum format
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
