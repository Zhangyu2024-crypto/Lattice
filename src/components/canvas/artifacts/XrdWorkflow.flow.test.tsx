import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useRuntimeStore } from '../../../stores/runtime-store'
import type {
  XrdAnalysisArtifact,
  XrdProArtifact,
  XrdProCif,
} from '../../../types/artifact'
import { renderArtifactBody } from '../artifact-body'
import { fetchCifsForMaterialIds } from '../../../lib/xrd-cif-fetch'
import { localProXrd } from '../../../lib/local-pro-xrd'

vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid="echarts" />,
}))

vi.mock('../../../stores/toast-store', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../../lib/xrd-cif-fetch', () => ({
  fetchCifsForMaterialIds: vi.fn(),
}))

vi.mock('../../../lib/local-pro-xrd', () => ({
  localProXrd: {
    refineDara: vi.fn(),
  },
}))

function resetStore() {
  useRuntimeStore.setState({
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
  })
}

function makeXrdAnalysisArtifact(): XrdAnalysisArtifact {
  const now = Date.now()
  return {
    id: 'xrd-analysis-1',
    kind: 'xrd-analysis',
    title: 'XRD Analysis Snapshot',
    createdAt: now,
    updatedAt: now,
    sourceFile: 'workspace/sample.xy',
    payload: {
      query: {
        range: [10, 80],
        method: 'approximate-fit',
      },
      experimentalPattern: {
        x: [10, 20, 30, 40],
        y: [100, 80, 30, 10],
        xLabel: '2θ (°)',
        yLabel: 'Intensity',
      },
      phases: [
        {
          id: 'ph-1',
          name: 'Quartz',
          formula: 'SiO2',
          spaceGroup: 'P3121',
          cifRef: 'mp-7000',
          confidence: 0.93,
          weightFraction: 0.62,
          matchedPeaks: [],
        },
        {
          id: 'ph-2',
          name: 'Cristobalite',
          formula: 'SiO2',
          spaceGroup: 'Fd-3m',
          cifRef: 'mp-6945',
          confidence: 0.71,
          weightFraction: 0.38,
          matchedPeaks: [],
        },
      ],
      rietveld: {
        rwp: 8.4,
        gof: 1.7,
        converged: true,
      },
    },
  }
}

function ArtifactBodyHarness({
  sessionId,
  artifactId,
  embed = 'card',
}: {
  sessionId: string
  artifactId: string
  embed?: 'card' | 'full'
}) {
  const session = useRuntimeStore((s) => s.sessions[sessionId] ?? null)
  const artifact = useRuntimeStore(
    (s) => s.sessions[sessionId]?.artifacts[artifactId] ?? null,
  )
  if (!session || !artifact) return null
  return <>{renderArtifactBody(artifact, session, { embed })}</>
}

describe('XRD workflow', () => {
  beforeEach(() => {
    resetStore()
  })

  it('preserves selected phases when opening XRD Lab and can refine after auto-loading CIFs', async () => {
    const mockFetchCifs = vi.mocked(fetchCifsForMaterialIds)
    const mockRefineDara = vi.mocked(localProXrd.refineDara)

    const fetchedCifs: XrdProCif[] = [
      {
        id: 'mp_cif_mp-7000',
        filename: 'mp-7000.cif',
        content: 'data_mp_7000',
        size: 12,
        formula: 'SiO2',
        selected: true,
      },
      {
        id: 'mp_cif_mp-6945',
        filename: 'mp-6945.cif',
        content: 'data_mp_6945',
        size: 12,
        formula: 'SiO2',
        selected: true,
      },
    ]
    mockFetchCifs.mockResolvedValue(fetchedCifs)
    mockRefineDara.mockResolvedValue({
      success: true,
      data: {
        phases: [
          { phase_name: 'Quartz', formula: 'SiO2', weight_pct: 61.5 },
          { phase_name: 'Cristobalite', formula: 'SiO2', weight_pct: 38.5 },
        ],
        rwp: 7.2,
        gof: 1.4,
        converged: true,
        x: [10, 20, 30],
        y_obs: [100, 80, 60],
        y_calc: [98, 79, 61],
        y_diff: [2, 1, -1],
      },
    })

    const sessionId = useRuntimeStore
      .getState()
      .createSession({ title: 'XRD Flow' })
    const analysis = makeXrdAnalysisArtifact()
    useRuntimeStore.getState().upsertArtifact(sessionId, analysis)
    useRuntimeStore.getState().focusArtifact(sessionId, analysis.id)

    const firstView = render(
      <ArtifactBodyHarness
        sessionId={sessionId}
        artifactId={analysis.id}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Open in XRD Lab' }),
    )

    const workbench = Object.values(
      useRuntimeStore.getState().sessions[sessionId].artifacts,
    ).find((artifact): artifact is XrdProArtifact => artifact.kind === 'xrd-pro')

    expect(workbench).toBeTruthy()
    expect(workbench?.payload.params.refinement.twoThetaMin).toBe(10)
    expect(workbench?.payload.params.refinement.twoThetaMax).toBe(80)
    expect(workbench?.payload.candidates).toEqual([
      expect.objectContaining({
        material_id: 'mp-7000',
        name: 'Quartz',
        selected: true,
      }),
      expect.objectContaining({
        material_id: 'mp-6945',
        name: 'Cristobalite',
        selected: true,
      }),
    ])
    expect(workbench?.payload.refineResult).toEqual(
      expect.objectContaining({
        rwp: 8.4,
        gof: 1.7,
        converged: true,
      }),
    )

    firstView.unmount()

    render(
      <ArtifactBodyHarness
        sessionId={sessionId}
        artifactId={workbench!.id}
        embed="full"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Run Refine' }))

    await waitFor(() => {
      expect(mockFetchCifs).toHaveBeenCalledWith(['mp-7000', 'mp-6945'])
      expect(mockRefineDara).toHaveBeenCalled()
    })

    expect(mockRefineDara).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFile: 'workspace/sample.xy',
      }),
      expect.objectContaining({
        material_ids: ['mp-7000', 'mp-6945'],
        cif_texts: [
          { filename: 'mp-7000.cif', content: 'data_mp_7000' },
          { filename: 'mp-6945.cif', content: 'data_mp_6945' },
        ],
      }),
    )

    await waitFor(() => {
      const refreshed = useRuntimeStore.getState().sessions[sessionId]
        .artifacts[workbench!.id] as XrdProArtifact
      expect(refreshed.payload.uploadedCifs).toEqual(fetchedCifs)
      expect(refreshed.payload.refineResult).toEqual(
        expect.objectContaining({
          rwp: 7.2,
          gof: 1.4,
          converged: true,
        }),
      )
      expect(refreshed.payload.refineResult?.phases).toEqual([
        expect.objectContaining({ phase_name: 'Quartz' }),
        expect.objectContaining({ phase_name: 'Cristobalite' }),
      ])
    })
  })
})
