// Data-tabs region beneath the main visualisation. Renders either the
// full panel (divider + header + body) or a single collapsed strip with
// an expand affordance. Collapse/expand state is owned by the parent
// shell so the button click can flow through a single setter.

import type { CSSProperties, ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { shellStyles as S } from './styles'

interface Props {
  dataTabs: ReactNode
  dataTabsHeight: number
  dataTabsCollapsed: boolean
  setDataTabsCollapsed: (next: boolean) => void
  onDataDown: (e: React.MouseEvent) => void
}

export default function DataTabsPanel({
  dataTabs,
  dataTabsHeight,
  dataTabsCollapsed,
  setDataTabsCollapsed,
  onDataDown,
}: Props) {
  if (!dataTabsCollapsed) {
    return (
      <>
        <div
          style={S.hDivider}
          onMouseDown={onDataDown}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize data tabs"
        />
        <div
          className="pro-shell-data-tabs"
          style={
            {
              '--data-tabs-height': `${dataTabsHeight}px`,
            } as CSSProperties
          }
        >
          <div style={S.panelHeader}>
            <button
              type="button"
              onClick={() => setDataTabsCollapsed(true)}
              title="Hide data tabs"
              style={S.collapseBtn}
            >
              <ChevronDown size={12} />
            </button>
          </div>
          <div style={S.panelBody}>{dataTabs}</div>
        </div>
      </>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setDataTabsCollapsed(false)}
      title="Show data tabs"
      style={S.collapsedStripBottom}
    >
      <ChevronUp size={12} />
      <span style={S.collapsedStripLabel}>Data</span>
    </button>
  )
}
