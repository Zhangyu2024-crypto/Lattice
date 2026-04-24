interface Props {
  relPath: string
}

export default function EditorLoading({ relPath }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontSize: "var(--text-sm)",
        color: 'var(--color-text-muted)',
      }}
    >
      Loading {relPath.split('/').pop() ?? relPath}…
    </div>
  )
}
