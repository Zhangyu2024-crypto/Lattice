import type { KindSchema } from './types'

export const xrdAnalysisSchema: KindSchema = {
  kind: 'xrd-analysis',
  groups: [
    {
      title: 'Search',
      params: [
        {
          key: 'search_range',
          type: 'range',
          label: '2θ range (°)',
          default: [10, 80],
          min: 5,
          max: 120,
          step: 0.5,
        },
        {
          key: 'method',
          type: 'select',
          label: 'Method',
          default: 'approximate-fit',
          options: ['peak-match', 'rietveld', 'approximate-fit'],
        },
        {
          key: 'tolerance',
          type: 'number',
          label: 'Peak tolerance (°)',
          default: 0.2,
          min: 0.01,
          max: 1,
          step: 0.01,
        },
        {
          key: 'max_phases',
          type: 'number',
          label: 'Max phases',
          default: 4,
          min: 1,
          max: 10,
          step: 1,
        },
      ],
    },
    {
      title: 'Refinement',
      params: [
        {
          key: 'refinement_cycles',
          type: 'number',
          label: 'Refinement cycles',
          default: 20,
          min: 1,
          max: 200,
          step: 1,
        },
        {
          key: 'background_order',
          type: 'number',
          label: 'Background poly order',
          default: 5,
          min: 0,
          max: 12,
          step: 1,
        },
      ],
    },
  ],
}
