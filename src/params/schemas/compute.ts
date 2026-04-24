import type { KindSchema } from './types'

export const computeSchema: KindSchema = {
  kind: 'compute',
  groups: [
    {
      title: 'Runtime',
      params: [
        {
          key: 'timeout',
          type: 'number',
          label: 'Timeout (s)',
          default: 60,
          min: 1,
          max: 1800,
          step: 1,
          description: 'Max wall-clock time before the sandbox kills the job',
        },
        {
          key: 'max_memory_gb',
          type: 'number',
          label: 'Max memory (GB)',
          default: 2,
          min: 0.25,
          max: 32,
          step: 0.25,
        },
      ],
    },
    {
      title: 'Environment',
      params: [
        {
          key: 'python_version',
          type: 'select',
          label: 'Python version',
          default: '3.11',
          options: ['3.10', '3.11', '3.12'],
        },
      ],
    },
  ],
}
