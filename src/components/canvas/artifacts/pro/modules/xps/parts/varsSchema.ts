// Declarative schema for the XPS module's Vars tab. Kept pure-data so
// UI-only changes stay out of the main module file and don't churn the
// handler surface.

import type { XpsSubState } from '@/types/artifact'
import type { VarsSchema } from '@/components/canvas/artifacts/pro/primitives/ProVarsTab'

export const XPS_VARS_SCHEMA: VarsSchema<XpsSubState> = {
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
          key: 'be-range',
          label: 'BE range',
          unit: 'eV',
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
      ],
    },
    {
      title: 'Peaks',
      rows: [
        { key: 'detected', label: 'Detected', value: (c) => c.sub.detectedPeaks.length },
        { key: 'defs', label: 'Definitions', value: (c) => c.sub.peakDefinitions.length },
      ],
    },
    {
      title: 'Charge correction',
      rows: [
        {
          key: 'shift',
          label: 'Shift',
          unit: 'eV',
          value: (c) => c.sub.chargeCorrection?.shiftEV ?? null,
        },
        {
          key: 'c1s',
          label: 'C 1s found',
          unit: 'eV',
          value: (c) => c.sub.chargeCorrection?.c1sFoundEV ?? null,
        },
      ],
    },
    {
      title: 'Fit',
      rows: [
        {
          key: 'applied-shift',
          label: 'Shift applied',
          unit: 'eV',
          value: (c) => c.sub.fitResult?.appliedShiftEV ?? null,
        },
        {
          key: 'components',
          label: 'Components',
          value: (c) =>
            c.sub.fitResult?.curves
              ? Object.keys(c.sub.fitResult.curves.components).length
              : null,
        },
        {
          key: 'assignments',
          label: 'BE assignments',
          value: (c) => c.sub.fitResult?.lookupAssignments?.length ?? null,
        },
      ],
    },
    {
      title: 'Quantification',
      rows: [
        {
          key: 'quant-rows',
          label: 'Elements',
          value: (c) => c.sub.fitResult?.quantification?.length ?? null,
        },
        {
          key: 'dominant',
          label: 'Dominant',
          value: (c) => {
            const rows = c.sub.fitResult?.quantification ?? []
            if (rows.length === 0) return null
            const sorted = [...rows].sort(
              (a, b) => (b.atomic_percent ?? 0) - (a.atomic_percent ?? 0),
            )
            const top = sorted[0]
            return top && top.atomic_percent != null
              ? `${top.element} (${top.atomic_percent.toFixed(1)}%)`
              : (top?.element ?? null)
          },
          mono: false,
        },
      ],
    },
  ],
}
