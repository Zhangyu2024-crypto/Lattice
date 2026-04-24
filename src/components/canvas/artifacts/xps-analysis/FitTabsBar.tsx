// Horizontal tab strip for switching between fits in an XPS analysis
// card. More than ~4 fits quickly runs out of header budget, so it
// lives as a body-local horizontally-scrollable row instead of being
// squeezed into the CardHeader actions.

import type { XpsFit } from './types'

interface Props {
  fits: XpsFit[]
  safeIdx: number
  background: XpsFit['background']
  onSelect: (idx: number) => void
}

export function FitTabsBar({ fits, safeIdx, background, onSelect }: Props) {
  return (
    <div className="card-xps-tabs-bar">
      {fits.map((f, i) => {
        const active = i === safeIdx
        return (
          <button
            key={`${f.element}-${f.line}-${i}`}
            onClick={() => onSelect(i)}
            className={`card-xps-tab-btn${active ? ' is-active' : ''}`}
          >
            {f.element} {f.line}
          </button>
        )
      })}
      <span className="card-xps-bg-badge">bg: {background}</span>
    </div>
  )
}
