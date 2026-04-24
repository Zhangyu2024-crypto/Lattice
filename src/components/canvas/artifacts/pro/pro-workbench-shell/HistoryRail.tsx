// Narrow hover-to-expand rail on the left edge of the Pro Workbench
// shell. The shell intentionally holds no state about the rail's
// expanded width — it's driven purely by hover — so this component is a
// thin wrapper that tracks hover locally and feeds a CSS variable the
// stylesheet reads to animate the width.

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { RAIL_COLLAPSED_WIDTH, RAIL_EXPANDED_WIDTH } from './constants'
import { shellStyles as S } from './styles'

interface Props {
  /** Caller-supplied rail content. When omitted a small placeholder
   *  ("HISTORY" + hint on hover) is rendered — preserved from the
   *  pre-extract shell so early-phase workbenches render something. */
  historyRail?: ReactNode
}

export default function HistoryRail({ historyRail }: Props) {
  const [railHover, setRailHover] = useState(false)

  return (
    <div
      className="pro-shell-rail"
      style={
        {
          '--rail-width': `${
            railHover ? RAIL_EXPANDED_WIDTH : RAIL_COLLAPSED_WIDTH
          }px`,
        } as CSSProperties
      }
      onMouseEnter={() => setRailHover(true)}
      onMouseLeave={() => setRailHover(false)}
    >
      {historyRail ?? (
        <div style={S.railPlaceholder}>
          <span style={S.railLabel}>HISTORY</span>
          {railHover && (
            <div style={S.railHint}>
              Run history lands here in a later phase.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
