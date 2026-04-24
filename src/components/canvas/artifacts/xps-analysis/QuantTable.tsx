// Sorted quantification table (Element · At% · RSF) rendered in the
// XPS analysis card body. The `At%` column uses a horizontal bar cell
// driven by a CSS variable so the fill tracks the number without JS
// measuring DOM width. Right-clicking a row opens the "Mention in
// chat" context menu via the parent-provided handler.

import { clamp } from './helpers'
import type { XpsQuantRow } from './types'

interface Props {
  rows: XpsQuantRow[]
  hasMention: boolean
  onContextMenu: (row: XpsQuantRow, e: React.MouseEvent) => void
}

export function QuantTable({ rows, hasMention, onContextMenu }: Props) {
  return (
    <div className="card-xps-quant-scroll">
      <table className="card-xps-table">
        <thead>
          <tr className="card-xps-thead-row">
            <th className="card-xps-th">Element</th>
            <th className="card-xps-th card-xps-th--atpct">At%</th>
            <th className="card-xps-th">RSF</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.element}
              onContextMenu={(e) => onContextMenu(row, e)}
              className={`card-xps-row${hasMention ? ' is-clickable' : ''}`}
            >
              <td className="card-xps-td card-xps-td--element">{row.element}</td>
              <td className="card-xps-td">
                <div className="card-xps-bar-cell">
                  <div className="card-xps-bar-track">
                    <div
                      className="card-xps-bar-fill"
                      style={{ '--atpct': `${clamp(row.atomicPercent, 0, 100)}%` } as React.CSSProperties}
                    />
                  </div>
                  <span className="card-xps-bar-label">{row.atomicPercent.toFixed(1)}%</span>
                </div>
              </td>
              <td className="card-xps-td">{row.relativeSensitivity.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
