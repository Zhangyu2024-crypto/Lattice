type BatchFileStatus = 'pending' | 'running' | 'succeeded' | 'failed'

interface BatchFile {
  relPath: string
  status: BatchFileStatus
  durationMs?: number
  errorMessage?: string
  artifactIds?: string[]
}

interface BatchSummary {
  total: number
  ok: number
  failed: number
  jsonlUrl?: string
  startedAt: number
  endedAt?: number
}

interface BatchWorkflowPayload {
  sourceDir: string
  pattern: string
  pipeline: string[]
  concurrency: number
  status: 'idle' | 'running' | 'succeeded' | 'failed'
  files: BatchFile[]
  summary?: BatchSummary
}

const STARTED_AT = Date.now() - 120_000

export const DEMO_BATCH_WORKFLOW: BatchWorkflowPayload = {
  sourceDir: '/data/experiments/2026-04/xrd_series',
  pattern: '*.xy',
  pipeline: ['detect_peaks', 'fit_peaks', 'xrd_search'],
  concurrency: 4,
  status: 'running',
  files: [
    {
      relPath: 'sample_001_batio3.xy',
      status: 'succeeded',
      durationMs: 1820,
      artifactIds: [
        'art_batch_001_peaks',
        'art_batch_001_fit',
        'art_batch_001_xrd',
      ],
    },
    {
      relPath: 'sample_002_batio3_Fe5.xy',
      status: 'succeeded',
      durationMs: 2140,
      artifactIds: [
        'art_batch_002_peaks',
        'art_batch_002_fit',
        'art_batch_002_xrd',
      ],
    },
    {
      relPath: 'sample_003_batio3_Fe10.xy',
      status: 'succeeded',
      durationMs: 1560,
      artifactIds: [
        'art_batch_003_peaks',
        'art_batch_003_fit',
        'art_batch_003_xrd',
      ],
    },
    {
      relPath: 'sample_004_batio3_Fe15.xy',
      status: 'succeeded',
      durationMs: 2985,
      artifactIds: [
        'art_batch_004_peaks',
        'art_batch_004_fit',
        'art_batch_004_xrd',
      ],
    },
    {
      relPath: 'sample_005_batio3_Ni5.xy',
      status: 'succeeded',
      durationMs: 1240,
      artifactIds: [
        'art_batch_005_peaks',
        'art_batch_005_fit',
        'art_batch_005_xrd',
      ],
    },
    {
      relPath: 'sample_006_batio3_Ni10.xy',
      status: 'succeeded',
      durationMs: 3410,
      artifactIds: [
        'art_batch_006_peaks',
        'art_batch_006_fit',
        'art_batch_006_xrd',
      ],
    },
    { relPath: 'sample_007_batio3_Co5.xy', status: 'running' },
    { relPath: 'sample_008_batio3_Co10.xy', status: 'running' },
    { relPath: 'sample_009_batio3_Mn5.xy', status: 'running' },
    { relPath: 'sample_010_batio3_Mn10.xy', status: 'pending' },
    { relPath: 'sample_011_batio3_annealed_900c.xy', status: 'pending' },
    {
      relPath: 'sample_012_batio3_quenched.xy',
      status: 'failed',
      errorMessage: 'Peak detection SNR below threshold',
    },
  ],
  summary: {
    total: 12,
    ok: 6,
    failed: 1,
    startedAt: STARTED_AT,
    endedAt: undefined,
    jsonlUrl: undefined,
  },
}
