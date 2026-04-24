// Declarative schema for the Curve module's Vars tab. Kept pure-data so
// UI-only changes stay out of the main module file and don't churn the
// handler surface.

import type { CurveSubState } from '@/types/artifact'
import type { VarsSchema } from '@/components/canvas/artifacts/pro/primitives/ProVarsTab'

export const CURVE_VARS_SCHEMA: VarsSchema<CurveSubState> = {
  sections: [
    {
      title: 'Spectrum',
      rows: [
        {
          key: 'points',
          label: 'Points',
          value: (c) => c.payload.spectrum?.x?.length ?? null,
        },
        {
          key: 'x-range',
          label: 'X range',
          value: (c) => {
            const x = c.payload.spectrum?.x
            if (!x || x.length === 0) return null
            return `${x[0].toFixed(3)} – ${x[x.length - 1].toFixed(3)}`
          },
          mono: false,
        },
        {
          key: 'y-range',
          label: 'Y range',
          value: (c) => {
            const y = c.payload.spectrum?.y
            if (!y || y.length === 0) return null
            let lo = Infinity
            let hi = -Infinity
            for (const v of y) {
              if (v < lo) lo = v
              if (v > hi) hi = v
            }
            return `${lo.toFixed(3)} – ${hi.toFixed(3)}`
          },
          mono: false,
        },
        {
          key: 'source',
          label: 'Source file',
          value: (c) => c.payload.spectrum?.sourceFile ?? null,
          copyable: true,
          mono: false,
        },
      ],
    },
    {
      title: 'Quality',
      rows: [
        { key: 'grade', label: 'Grade', value: (c) => c.payload.quality?.grade ?? null },
        { key: 'snr', label: 'SNR', value: (c) => c.payload.quality?.snr ?? null },
      ],
    },
    {
      title: 'Features',
      rows: [
        { key: 'count', label: 'Count', value: (c) => c.sub.peaks.length },
      ],
    },
  ],
}
