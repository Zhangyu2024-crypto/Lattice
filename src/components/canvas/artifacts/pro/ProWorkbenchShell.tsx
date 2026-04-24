// Pro Workbench v2 shell (W1) — replaces the legacy left/right ProLayout
// for the three spectrum-oriented Pro workbenches (XRD, XPS, Raman).
// Compute workbench keeps its own notebook-ish shell; the Pro mental model
// here is a power-user console:
//
//   ┌ topRibbon (32px) — workbench chip + title + ⌘K ─────────────┐
//   ├─ history ─ mainViz (flex) ──────── inspector (280px) ──────┤
//   │   rail   ├──── data tabs (≥ 180px) ────┤                   │
//   ├─────────────────── footer (ProActionBar) ──────────────────┤
//   └────────────────────────────────────────────────────────────┘
//
// Slots are passed in as ReactNodes so workbench files control exactly
// what lands in each region. History rail + Inspector ship with
// placeholder content in this phase and get filled by W4 (history) and
// W4's selection-driven inspector. Data tabs is a new region for peak
// tables, fit stats, etc., and gets content via ProDataTabs rendered
// inside `dataTabs`.
//
// Layout markup lives here; sub-pieces (hover rail, collapsible
// inspector / data-tabs) and the mouse-drag plumbing are extracted into
// `./pro-workbench-shell/*` to keep this file focused on composition.

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePersistedPanelSize } from '../../../../hooks/usePersistedPanelSize'
import {
  DEFAULT_DATA_TABS_HEIGHT,
  DEFAULT_DATA_TABS_MAX,
  DEFAULT_DATA_TABS_MIN,
  DEFAULT_INSPECTOR_MAX,
  DEFAULT_INSPECTOR_MIN,
  DEFAULT_INSPECTOR_WIDTH,
} from './pro-workbench-shell/constants'
import { shellStyles as S } from './pro-workbench-shell/styles'
import { useResizeHandlers } from './pro-workbench-shell/useResizeHandlers'
import DataTabsPanel from './pro-workbench-shell/DataTabsPanel'
import InspectorPanel from './pro-workbench-shell/InspectorPanel'

interface Props {
  /** Slot: top strip. Usually rendered as <ProRibbon />. */
  topRibbon?: ReactNode
  /** Slot: the main visualisation — chart, code editor, etc. Flex. */
  mainViz: ReactNode
  /** Slot: tabular detail area beneath `mainViz`. Usually rendered as
   *  <ProDataTabs />. Can be collapsed by the user. Pass `null` to hide
   *  the divider entirely. */
  dataTabs?: ReactNode
  /** Slot: right rail. Width draggable. */
  inspector?: ReactNode
  /** Slot: bottom bar spanning shell width; usually <ProActionBar />. */
  footer?: ReactNode

  /** Inspector initial width (px). Persisted by the caller. */
  initialInspectorWidth?: number
  minInspectorWidth?: number
  maxInspectorWidth?: number

  /** Data-tabs initial height (px). */
  initialDataTabsHeight?: number
  minDataTabsHeight?: number
  maxDataTabsHeight?: number
}

export default function ProWorkbenchShell({
  topRibbon,
  mainViz,
  dataTabs,
  inspector,
  footer,
  initialInspectorWidth = DEFAULT_INSPECTOR_WIDTH,
  minInspectorWidth = DEFAULT_INSPECTOR_MIN,
  maxInspectorWidth = DEFAULT_INSPECTOR_MAX,
  initialDataTabsHeight = DEFAULT_DATA_TABS_HEIGHT,
  minDataTabsHeight = DEFAULT_DATA_TABS_MIN,
  maxDataTabsHeight = DEFAULT_DATA_TABS_MAX,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [shellSize, setShellSize] = useState({ width: 0, height: 0 })
  const compactStandaloneDefault =
    typeof window !== 'undefined' &&
    /^#\/?workbench(?:\?|$)/.test(window.location.hash)
  // Inspector / data-tabs split pull from the persisted prefs store so
  // users carry their preferred layout across sessions; local state is
  // managed inside `usePersistedPanelSize` and written back (150ms
  // debounce) so drag events stay smooth.
  const [inspectorWidth, setInspectorWidth] = usePersistedPanelSize(
    'proWorkbench.inspectorWidth',
    initialInspectorWidth,
  )
  const [dataTabsHeight, setDataTabsHeight] = usePersistedPanelSize(
    'proWorkbench.dataTabsHeight',
    initialDataTabsHeight,
  )
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    compactStandaloneDefault,
  )
  const [dataTabsCollapsed, setDataTabsCollapsed] = useState(
    compactStandaloneDefault,
  )

  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const measure = (width: number, height: number) => {
      setShellSize({
        width: Math.round(width),
        height: Math.round(height),
      })
    }
    measure(node.clientWidth, node.clientHeight)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      measure(entry.contentRect.width, entry.contentRect.height)
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const { onInspectorDown, onDataDown } = useResizeHandlers({
    inspectorWidth,
    setInspectorWidth,
    minInspectorWidth,
    maxInspectorWidth,
    dataTabsHeight,
    setDataTabsHeight,
    minDataTabsHeight,
    maxDataTabsHeight,
  })

  const showInspector = inspector != null
  const showDataTabs = dataTabs != null
  // Persisted sizes are global across workbench windows. Clamp the
  // rendered panel sizes against the live shell so a value dragged on a
  // large monitor cannot keep shrinking the chart in a smaller Lab window.
  const responsiveInspectorMax =
    shellSize.width > 0
      ? Math.max(minInspectorWidth, Math.floor(shellSize.width * 0.34))
      : maxInspectorWidth
  const responsiveDataTabsMax =
    shellSize.height > 0
      ? Math.max(minDataTabsHeight, Math.floor(shellSize.height * 0.32))
      : maxDataTabsHeight
  const effectiveInspectorWidth = Math.min(
    inspectorWidth,
    maxInspectorWidth,
    responsiveInspectorMax,
  )
  const effectiveDataTabsHeight = Math.min(
    dataTabsHeight,
    maxDataTabsHeight,
    responsiveDataTabsMax,
  )

  return (
    <div ref={rootRef} style={S.root}>
      {topRibbon && <div style={S.ribbon}>{topRibbon}</div>}

      <div style={S.middle}>
        {/* Main column: mainViz + optional data tabs beneath. */}
        <div style={S.mainColumn}>
          <div style={S.mainViz}>{mainViz}</div>
          {showDataTabs && (
            <DataTabsPanel
              dataTabs={dataTabs}
              dataTabsHeight={effectiveDataTabsHeight}
              dataTabsCollapsed={dataTabsCollapsed}
              setDataTabsCollapsed={setDataTabsCollapsed}
              onDataDown={onDataDown}
            />
          )}
        </div>

        {showInspector && (
          <InspectorPanel
            inspector={inspector}
            inspectorWidth={effectiveInspectorWidth}
            inspectorCollapsed={inspectorCollapsed}
            setInspectorCollapsed={setInspectorCollapsed}
            onInspectorDown={onInspectorDown}
          />
        )}
      </div>

      {footer && <div style={S.footer}>{footer}</div>}
    </div>
  )
}
