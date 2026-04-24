import type { Command } from '../types'

/**
 * All "Load Demo *" entries. Each demo handler is wrapped to always
 * dismiss the palette after dispatching — the demos mutate the store and
 * swap the active editor tab, so leaving the overlay up would cover the
 * thing the user just loaded.
 *
 * `onLoadLatexDemo` / `onMockAgentStream` are optional: the former is
 * gated on a feature flag upstream, the latter only surfaces in dev
 * builds. Both are appended as zero-or-one entries so the id ordering
 * stays stable when the options are absent.
 */
export interface DemoDeps {
  onClose: () => void
  onLoadDemo: () => void
  onLoadXrdDemo: () => void
  onLoadXpsDemo: () => void
  onLoadRamanDemo: () => void
  onLoadJobDemo: () => void
  onLoadComputeDemo: () => void
  onLoadStructureDemo: () => void
  onLoadResearchDemo: () => void
  onLoadBatchDemo: () => void
  onLoadKnowledgeDemo: () => void
  onLoadMaterialCompareDemo: () => void
  onLoadSimilarityDemo: () => void
  onLoadOptimizationDemo: () => void
  onLoadHypothesisDemo: () => void
  onLoadLatexDemo?: () => void
  onMockAgentStream?: () => void
}

export function buildDemoCommands(deps: DemoDeps): Command[] {
  const {
    onClose,
    onLoadDemo,
    onLoadXrdDemo,
    onLoadXpsDemo,
    onLoadRamanDemo,
    onLoadJobDemo,
    onLoadComputeDemo,
    onLoadStructureDemo,
    onLoadResearchDemo,
    onLoadBatchDemo,
    onLoadKnowledgeDemo,
    onLoadMaterialCompareDemo,
    onLoadSimilarityDemo,
    onLoadOptimizationDemo,
    onLoadHypothesisDemo,
    onLoadLatexDemo,
    onMockAgentStream,
  } = deps

  return [
    {
      id: 'demo',
      label: 'Load Demo Spectrum (BaTiO3 XRD)',
      action: () => {
        onLoadDemo()
        onClose()
      },
    },
    {
      id: 'demo-xrd',
      label: 'Load Demo: XRD Phase Analysis (BaTiO3 + TiO2)',
      action: () => {
        onLoadXrdDemo()
        onClose()
      },
    },
    {
      id: 'demo-xps',
      label: 'Load Demo: XPS Analysis (Fe/O/C quantification)',
      action: () => {
        onLoadXpsDemo()
        onClose()
      },
    },
    {
      id: 'demo-raman',
      label: 'Load Demo: Raman ID (calcite vs aragonite)',
      action: () => {
        onLoadRamanDemo()
        onClose()
      },
    },
    {
      id: 'demo-job',
      label: 'Load Demo: Job Monitor (CP2K DFT running)',
      action: () => {
        onLoadJobDemo()
        onClose()
      },
    },
    {
      id: 'demo-compute',
      label: 'Load Demo: Compute (crystal analysis)',
      action: () => {
        onLoadComputeDemo()
        onClose()
      },
    },
    {
      id: 'demo-structure',
      label: 'Load Demo: Structure (BaTiO3 3D)',
      action: () => {
        onLoadStructureDemo()
        onClose()
      },
    },
    {
      id: 'demo-research',
      label: 'Load Demo: Research Report (perovskite — sample output)',
      action: () => {
        onLoadResearchDemo()
        onClose()
      },
    },
    {
      id: 'demo-batch',
      label: 'Load Demo: Batch Workflow (12 XRD files)',
      action: () => {
        onLoadBatchDemo()
        onClose()
      },
    },
    {
      id: 'demo-knowledge',
      label: 'Load Demo: Knowledge Graph (perovskites)',
      action: () => {
        onLoadKnowledgeDemo()
        onClose()
      },
    },
    {
      id: 'demo-compare',
      label: 'Load Demo: Material Comparison (6 perovskites)',
      action: () => {
        onLoadMaterialCompareDemo()
        onClose()
      },
    },
    {
      id: 'demo-similarity',
      label: 'Load Demo: Similarity Matrix (6 XRD patterns)',
      action: () => {
        onLoadSimilarityDemo()
        onClose()
      },
    },
    {
      id: 'demo-optimization',
      label: 'Load Demo: Optimization (Bayesian BaTiO3 band gap)',
      action: () => {
        onLoadOptimizationDemo()
        onClose()
      },
    },
    {
      id: 'demo-hypothesis',
      label: 'Load Demo: Hypothesis management (Fe:BaTiO3)',
      action: () => {
        onLoadHypothesisDemo()
        onClose()
      },
    },
    ...(onLoadLatexDemo
      ? [
          {
            id: 'demo-latex',
            label: 'Load Demo: LaTeX writing (XRD note)',
            action: () => {
              onLoadLatexDemo()
              onClose()
            },
          },
        ]
      : []),
    ...(import.meta.env.DEV && onMockAgentStream
      ? [
          {
            id: 'dev-mock-agent-stream',
            label: 'DEV: Emit mock agent stream',
            action: () => {
              onMockAgentStream()
              onClose()
            },
          },
        ]
      : []),
  ]
}
