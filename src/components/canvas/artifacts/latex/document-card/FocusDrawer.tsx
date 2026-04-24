import { type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'

export type FocusDrawerTab = 'preview' | 'errors' | 'details'

// Right-hand slide-in drawer for focus variant. Owns the splitter, tab
// header and body; the body slot is rendered by the parent so it can keep
// closure over compile state + pane props without a heavy prop pass-through.
export function FocusDrawer({
  drawerTab,
  setDrawerTab,
  drawerWidth,
  issueCount,
  onSplitterPointerDown,
  onSplitterPointerMove,
  onSplitterPointerUp,
  onSplitterDoubleClick,
  children,
}: {
  drawerTab: FocusDrawerTab
  setDrawerTab: (t: FocusDrawerTab | null) => void
  drawerWidth: number
  issueCount: number
  onSplitterPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onSplitterPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onSplitterPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
  onSplitterDoubleClick: () => void
  children: ReactNode
}) {
  return (
    <>
      <div
        className="latex-focus-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize drawer"
        onPointerDown={onSplitterPointerDown}
        onPointerMove={onSplitterPointerMove}
        onPointerUp={onSplitterPointerUp}
        onPointerCancel={onSplitterPointerUp}
        onDoubleClick={onSplitterDoubleClick}
        title="Drag to resize · double-click to reset"
      />
      <aside
        className="latex-focus-drawer"
        style={{ width: drawerWidth }}
        role="complementary"
        aria-label={`${drawerTab} panel`}
      >
        <div className="latex-focus-drawer-head">
          <nav className="latex-focus-drawer-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={drawerTab === 'preview'}
              className={
                'latex-focus-drawer-tab' +
                (drawerTab === 'preview' ? ' is-active' : '')
              }
              onClick={() => setDrawerTab('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={drawerTab === 'errors'}
              className={
                'latex-focus-drawer-tab' +
                (drawerTab === 'errors' ? ' is-active' : '')
              }
              onClick={() => setDrawerTab('errors')}
            >
              Errors
              {issueCount > 0 ? (
                <span className="latex-focus-drawer-tab-count">
                  {issueCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={drawerTab === 'details'}
              className={
                'latex-focus-drawer-tab' +
                (drawerTab === 'details' ? ' is-active' : '')
              }
              onClick={() => setDrawerTab('details')}
            >
              Details
            </button>
          </nav>
          <button
            type="button"
            className="latex-focus-drawer-close"
            onClick={() => setDrawerTab(null)}
            aria-label="Close drawer (Esc)"
            title="Close (Esc)"
          >
            <X size={13} aria-hidden />
          </button>
        </div>
        <div className="latex-focus-drawer-body">{children}</div>
      </aside>
    </>
  )
}
