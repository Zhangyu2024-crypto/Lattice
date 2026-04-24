// Declarative schema for the XRD module's Vars tab. Kept pure-data so
// UI-only changes stay out of the main module file and don't churn the
// handler surface.

import type { XrdSubState } from '@/types/artifact'
import type { VarsSchema } from '@/components/canvas/artifacts/pro/primitives/ProVarsTab'

export const XRD_VARS_SCHEMA: VarsSchema<XrdSubState> = {
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
          key: 'xrange',
          label: '2θ range',
          unit: '°',
          value: (c) => {
            const x = c.payload.spectrum?.x
            if (!x || x.length === 0) return null
            return `${x[0].toFixed(2)} – ${x[x.length - 1].toFixed(2)}`
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
        {
          key: 'issues',
          label: 'Issues',
          value: (c) => {
            const n = c.payload.quality?.issues?.length ?? 0
            return n === 0 ? 'none' : String(n)
          },
          mono: false,
        },
      ],
    },
    {
      title: 'Peaks',
      rows: [
        { key: 'detected', label: 'Detected', value: (c) => c.sub.peaks.length },
      ],
    },
    {
      title: 'Phase search',
      rows: [
        {
          key: 'candidates',
          label: 'Candidates',
          value: (c) => c.sub.candidates.length,
        },
        {
          key: 'selected',
          label: 'Selected',
          value: (c) => c.sub.candidates.filter((x) => x.selected).length,
        },
      ],
    },
    {
      title: 'Refinement',
      rows: [
        {
          key: 'rwp',
          label: 'Rwp',
          unit: '%',
          value: (c) => c.sub.refineResult?.rwp ?? null,
        },
        {
          key: 'gof',
          label: 'GoF',
          value: (c) => c.sub.refineResult?.gof ?? null,
        },
        {
          key: 'converged',
          label: 'Converged',
          value: (c) =>
            c.sub.refineResult == null
              ? null
              : c.sub.refineResult.converged
                ? 'yes'
                : 'no',
          mono: false,
        },
        {
          key: 'phases',
          label: 'Phases',
          value: (c) => c.sub.refineResult?.phases?.length ?? null,
        },
      ],
    },
  ],
}
