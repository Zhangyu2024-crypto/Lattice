// "Recent transforms" pill row shown beneath the three-pane shell when
// at least one transform has been applied to this structure. Each pill
// shows the kind glyph + kind label + optional note + a time stamp. The
// row is purely presentational — the card owns the sort + state.

import type { StructureTransform } from '../../../../types/artifact'
import { GLYPHS } from './constants'
import { formatClock } from './helpers'

interface Props {
  transforms: StructureTransform[]
}

export default function TransformsRow({ transforms }: Props) {
  if (transforms.length === 0) return null
  return (
    <div className="card-structure-transforms-row">
      <span className="card-structure-transforms-label">
        Recent transforms ({transforms.length})
      </span>
      <div className="card-structure-transforms-list">
        {transforms.map((t) => (
          <div
            key={t.id}
            className="card-structure-transform-pill"
            title={t.note ?? ''}
          >
            <span className="card-structure-glyph">{GLYPHS[t.kind]}</span>
            <span className="card-structure-t-kind">{t.kind}</span>
            {t.note && <span className="card-structure-t-note">{t.note}</span>}
            <span className="card-structure-t-time">
              {formatClock(t.appliedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
