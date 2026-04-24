// Declarative schema for the Raman/FTIR module's Vars tab. Kept pure-data
// so UI-only changes stay out of the main module file and don't churn the
// handler surface.

import type { RamanSubState } from '@/types/artifact'
import type { VarsSchema } from '@/components/canvas/artifacts/pro/primitives/ProVarsTab'

export const RAMAN_VARS_SCHEMA: VarsSchema<RamanSubState> = {
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
          unit: 'cm⁻¹',
          value: (c) => {
            const x = c.payload.spectrum?.x
            if (!x || x.length === 0) return null
            return `${x[0].toFixed(1)} – ${x[x.length - 1].toFixed(1)}`
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
        {
          key: 'mode',
          label: 'Mode',
          value: (c) => (c.sub.params.mode === 'ftir' ? 'FTIR' : 'Raman'),
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
      title: 'Peaks',
      rows: [
        { key: 'count', label: 'Count', value: (c) => c.sub.peaks.length },
      ],
    },
    {
      title: 'Matches',
      rows: [
        { key: 'count', label: 'Count', value: (c) => c.sub.matches.length },
        {
          key: 'top',
          label: 'Top match',
          value: (c) => {
            const m = c.sub.matches[0]
            if (!m) return null
            const score = m.score != null ? ` (${m.score.toFixed(2)})` : ''
            return `${m.name}${score}`
          },
          mono: false,
        },
      ],
    },
  ],
}
