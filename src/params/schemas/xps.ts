import type { KindSchema } from './types'

export const xpsAnalysisSchema: KindSchema = {
  kind: 'xps-analysis',
  groups: [
    {
      title: 'Background',
      params: [
        {
          key: 'background_method',
          type: 'select',
          label: 'Background',
          default: 'shirley',
          options: ['shirley', 'linear', 'tougaard'],
        },
      ],
    },
    {
      title: 'Fit',
      params: [
        {
          key: 'fit_model',
          type: 'select',
          label: 'Peak model',
          default: 'pseudo-voigt',
          options: ['gaussian', 'lorentzian', 'pseudo-voigt', 'voigt'],
        },
        {
          key: 'max_iterations',
          type: 'number',
          label: 'Max iterations',
          default: 200,
          min: 10,
          max: 2000,
          step: 10,
        },
        {
          key: 'fwhm_upper_bound',
          type: 'number',
          label: 'FWHM upper bound (eV)',
          default: 3.0,
          min: 0.1,
          max: 10,
          step: 0.1,
        },
      ],
    },
    {
      title: 'Charge correction',
      params: [
        {
          key: 'charge_correction_element',
          type: 'select',
          label: 'Reference element',
          default: 'C',
          options: ['C', 'Au', 'none'],
        },
        {
          key: 'charge_correction_be',
          type: 'number',
          label: 'Reference BE (eV)',
          default: 284.8,
          min: 0,
          max: 1500,
          step: 0.1,
        },
      ],
    },
  ],
}
