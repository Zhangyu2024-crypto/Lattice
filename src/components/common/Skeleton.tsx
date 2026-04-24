// Skeleton — shimmer placeholder rows. Used while module detail panes
// wait for async detail fetches (KnowledgeBrowserModal extraction detail,
// Library paper detail, etc.) so the UI doesn't flash the text "loading…".

interface Props {
  rows?: number
  width?: string | number
}

export default function Skeleton({ rows = 3, width }: Props) {
  const resolvedWidth =
    typeof width === 'number' ? `${width}px` : width ?? '100%'
  return (
    <div
      className="module-skeleton"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="module-skeleton__row"
          style={{ width: resolvedWidth }}
        />
      ))}
    </div>
  )
}
