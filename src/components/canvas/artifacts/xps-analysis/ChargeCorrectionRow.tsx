// Footer row summarising the charge-correction reference line and the
// resulting binding-energy shift. The shift chip glows yellow on a
// non-zero correction (user should acknowledge it before citing BEs)
// and reverts to muted when the spectrum is already aligned. The
// trailing status icon shares that green/yellow semantic via the
// `is-ok` / `is-warn` variants on `.card-xps-cc-status`.

import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2 } from 'lucide-react'
import type { XpsAnalysisPayload } from './types'

interface Props {
  cc: NonNullable<XpsAnalysisPayload['chargeCorrection']>
}

export function ChargeCorrectionRow({ cc }: Props) {
  const isZero = Math.abs(cc.shift) < 1e-3
  const ArrowIcon = cc.shift >= 0 ? ArrowUp : ArrowDown
  const StatusIcon = isZero ? CheckCircle2 : AlertCircle
  const shiftClass = `card-xps-cc-shift${isZero ? '' : ' is-warn'}`
  const statusClass = `card-xps-cc-status${isZero ? ' is-ok' : ' is-warn'}`

  return (
    <div className="card-xps-cc-row">
      <span className="card-xps-ref-badge">ref: {cc.refElement} {cc.refLine}</span>
      <span className="card-xps-cc-label">
        observed <span className="card-xps-cc-value">{cc.observedBE.toFixed(2)} eV</span>
      </span>
      <span className="card-xps-cc-muted">vs</span>
      <span className="card-xps-cc-label">
        expected <span className="card-xps-cc-value">{cc.refBE.toFixed(2)} eV</span>
      </span>
      <span className={shiftClass}>
        {!isZero && <ArrowIcon size={11} />}
        shift {cc.shift >= 0 ? '+' : ''}{cc.shift.toFixed(2)} eV
      </span>
      <span className="card-xps-cc-spacer" />
      <StatusIcon size={13} className={statusClass} />
    </div>
  )
}
