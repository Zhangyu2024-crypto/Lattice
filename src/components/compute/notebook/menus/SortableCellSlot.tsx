// Sortable wrapper around a single cell's JSX. Uses `useSortable` from
// @dnd-kit/sortable to hand the caller (a render prop) the drag-handle
// listeners + current `isDragging` flag. We don't paint DnD styles on
// the wrapper directly — only position transform — so the cell's own
// visuals (focused ring, accent bar, inline dock) stay intact during a
// drag. The transform is applied to the wrapping div; ComputeCellView
// receives handle listeners it binds to its grip button.

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export function SortableCellSlot({
  id,
  children,
}: {
  id: string
  children: (args: {
    dragHandleProps: React.HTMLAttributes<HTMLButtonElement>
    isDragging: boolean
  }) => React.ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children({
        dragHandleProps: {
          ...(attributes as React.HTMLAttributes<HTMLButtonElement>),
          ...(listeners as React.HTMLAttributes<HTMLButtonElement>),
        },
        isDragging,
      })}
    </div>
  )
}
