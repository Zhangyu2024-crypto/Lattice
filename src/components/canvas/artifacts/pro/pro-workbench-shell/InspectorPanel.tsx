// Right-hand inspector region of the Pro Workbench shell. Renders
// either the full draggable panel (vertical divider + header + scroll
// body) or a collapsed strip that re-expands on click. Width + collapse
// state are owned by the parent shell.

import type { CSSProperties, ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { shellStyles as S } from './styles'

interface Props {
  inspector: ReactNode
  inspectorWidth: number
  inspectorCollapsed: boolean
  setInspectorCollapsed: (next: boolean) => void
  onInspectorDown: (e: React.MouseEvent) => void
}

export default function InspectorPanel({
  inspector,
  inspectorWidth,
  inspectorCollapsed,
  setInspectorCollapsed,
  onInspectorDown,
}: Props) {
  if (!inspectorCollapsed) {
    return (
      <>
        <div
          style={S.vDivider}
          onMouseDown={onInspectorDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector"
        />
        <div
          className="pro-shell-inspector"
          style={
            {
              '--inspector-width': `${inspectorWidth}px`,
            } as CSSProperties
          }
        >
          <div style={S.panelHeader}>
            <button
              type="button"
              onClick={() => setInspectorCollapsed(true)}
              title="Hide inspector"
              style={S.collapseBtn}
            >
              <ChevronRight size={12} />
            </button>
          </div>
          <div style={S.inspectorScroll}>{inspector}</div>
        </div>
      </>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setInspectorCollapsed(false)}
      title="Show inspector"
      style={S.collapsedStripRight}
    >
      <ChevronLeft size={12} />
    </button>
  )
}
