import type { KindSchema } from './types'

export const researchReportSchema: KindSchema = {
  kind: 'research-report',
  groups: [
    {
      title: 'Style',
      params: [
        {
          key: 'style',
          type: 'select',
          label: 'Report style',
          default: 'comprehensive',
          options: ['concise', 'comprehensive'],
          description: 'Length and depth of the generated report',
        },
        {
          key: 'citation_format',
          type: 'select',
          label: 'Citation format',
          default: 'numeric',
          options: ['numeric', 'author-year', 'footnote'],
        },
        {
          key: 'max_sources',
          type: 'number',
          label: 'Max sources',
          default: 20,
          min: 3,
          max: 100,
          step: 1,
        },
        {
          key: 'time_range',
          type: 'range',
          label: 'Publication year range',
          default: [2018, 2025],
          min: 1990,
          max: 2030,
          step: 1,
        },
      ],
    },
  ],
}

export const optimizationSchema: KindSchema = {
  kind: 'optimization',
  groups: [
    {
      title: 'Strategy',
      params: [
        {
          key: 'strategy',
          type: 'select',
          label: 'Strategy',
          default: 'bayesian',
          options: ['bayesian', 'grid', 'random'],
        },
        {
          key: 'n_initial',
          type: 'number',
          label: 'Initial random samples',
          default: 8,
          min: 1,
          max: 100,
          step: 1,
        },
        {
          key: 'max_iters',
          type: 'number',
          label: 'Max iterations',
          default: 50,
          min: 1,
          max: 500,
          step: 1,
        },
        {
          key: 'acquisition',
          type: 'select',
          label: 'Acquisition function',
          default: 'ei',
          options: ['ei', 'ucb', 'poi'],
        },
      ],
    },
  ],
}
