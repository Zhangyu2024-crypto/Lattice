import type { ReactNode } from 'react'

export type CardRightTab = 'preview' | 'errors' | 'details'

// Right column of the card variant: tablist header + body slot. The body
// is rendered by the parent so compile state + pane props stay in the
// parent's closure.
export function CardRightPane({
  rightTab,
  setRightTab,
  issueCount,
  children,
}: {
  rightTab: CardRightTab
  setRightTab: (t: CardRightTab) => void
  issueCount: number
  children: ReactNode
}) {
  return (
    <div className="latex-card-right">
      <div className="latex-card-right-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={rightTab === 'preview'}
          className={
            'latex-card-right-tab' +
            (rightTab === 'preview' ? ' is-active' : '')
          }
          onClick={() => setRightTab('preview')}
        >
          Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rightTab === 'errors'}
          className={
            'latex-card-right-tab' +
            (rightTab === 'errors' ? ' is-active' : '')
          }
          onClick={() => setRightTab('errors')}
        >
          Errors
          {issueCount > 0 ? (
            <span className="latex-card-right-tab-count">{issueCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rightTab === 'details'}
          className={
            'latex-card-right-tab' +
            (rightTab === 'details' ? ' is-active' : '')
          }
          onClick={() => setRightTab('details')}
        >
          Details
        </button>
      </div>
      <div className="latex-card-right-body">{children}</div>
    </div>
  )
}
