import type { KindSchema } from './types'

export const ramanIdSchema: KindSchema = {
  kind: 'raman-id',
  groups: [
    {
      title: 'Database',
      params: [
        {
          key: 'database',
          type: 'select',
          label: 'Reference database',
          default: 'RRUFF',
          options: ['RRUFF', 'user-db'],
        },
        {
          key: 'mineral_hint',
          type: 'text',
          label: 'Mineral hint',
          default: '',
          placeholder: 'e.g. carbonate',
        },
      ],
    },
    {
      title: 'Matching',
      params: [
        {
          key: 'top_n',
          type: 'number',
          label: 'Top-N results',
          default: 5,
          min: 1,
          max: 20,
          step: 1,
        },
        {
          key: 'score_threshold',
          type: 'number',
          label: 'Minimum score',
          default: 0.6,
          min: 0,
          max: 1,
          step: 0.05,
        },
      ],
    },
  ],
}
