import type { KindSchema } from './types'

export const spectrumSchema: KindSchema = {
  kind: 'spectrum',
  groups: [
    {
      title: 'Baseline',
      params: [
        {
          key: 'baseline_method',
          type: 'select',
          label: 'Method',
          default: 'none',
          options: ['none', 'linear', 'shirley', 'polynomial'],
          description: 'Baseline correction algorithm',
        },
        {
          key: 'baseline_poly_order',
          type: 'number',
          label: 'Polynomial order',
          default: 3,
          min: 1,
          max: 8,
          step: 1,
          description: 'Only used when method = polynomial',
        },
      ],
    },
    {
      title: 'Smoothing',
      params: [
        {
          key: 'smooth_window',
          type: 'number',
          label: 'Window (points)',
          default: 5,
          min: 1,
          max: 51,
          step: 2,
        },
        {
          key: 'smooth_method',
          type: 'select',
          label: 'Method',
          default: 'savitzky-golay',
          options: ['none', 'moving-average', 'savitzky-golay', 'median'],
        },
      ],
    },
    {
      title: 'Range',
      params: [
        {
          key: 'trim_range',
          type: 'range',
          label: 'Trim to range',
          default: [0, 0],
          min: -10000,
          max: 10000,
          description: '0,0 = no trim',
        },
      ],
    },
  ],
}

export const peakFitSchema: KindSchema = {
  kind: 'peak-fit',
  groups: [
    {
      title: 'Detection',
      params: [
        {
          key: 'algorithm',
          type: 'select',
          label: 'Algorithm',
          default: 'auto',
          // Values stay as the internal routing keys the worker /
          // backend dispatcher recognises; the UI-facing strings in
          // `optionLabels` deliberately avoid naming the Python
          // package or scipy function under each one.
          options: ['auto', 'find_peaks', 'lmfit', 'dara'],
          optionLabels: {
            auto: 'Auto',
            find_peaks: 'Quick peak find',
            lmfit: 'Curve fit',
            dara: 'BGMN Rietveld',
          },
        },
        {
          key: 'min_prominence',
          type: 'number',
          label: 'Min prominence',
          default: 0.05,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          key: 'min_fwhm',
          type: 'number',
          label: 'Min FWHM',
          default: 0.1,
          min: 0,
          max: 10,
          step: 0.05,
        },
      ],
    },
    {
      title: 'Fit model',
      params: [
        {
          key: 'profile',
          type: 'select',
          label: 'Peak profile',
          default: 'pseudo-voigt',
          options: ['lorentzian', 'gaussian', 'pseudo-voigt', 'voigt'],
        },
        {
          key: 'max_iterations',
          type: 'number',
          label: 'Max iterations',
          default: 200,
          min: 10,
          max: 5000,
          step: 10,
        },
      ],
    },
  ],
}
