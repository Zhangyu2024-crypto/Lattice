// Phase 3a · workspace_grep preview — footer + malformed states.
//
// Leaf components: the success footer (match/file count + truncation badge)
// and the placeholder shown when the tool output doesn't narrow.

export function Footer({
  matches,
  fileCount,
  truncated,
}: {
  matches: number
  fileCount: number
  truncated: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
      }}
    >
      <span>
        {matches} match{matches === 1 ? '' : 'es'} in {fileCount} file
        {fileCount === 1 ? '' : 's'}
      </span>
      {truncated ? (
        <span
          style={{
            padding: '1px 5px',
            borderRadius: 3,
            border: '1px solid var(--color-border)',
            background: 'rgba(255, 100, 100, 0.12)',
            color: 'var(--color-text-primary)',
          }}
        >
          truncated
        </span>
      ) : null}
    </div>
  )
}

export function Malformed() {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        fontStyle: 'italic',
      }}
    >
      malformed output
    </div>
  )
}
