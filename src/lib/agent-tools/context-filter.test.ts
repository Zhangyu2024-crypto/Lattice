import { describe, expect, it } from 'vitest'
import { LOCAL_TOOL_CATALOG, resolveToolsForContext } from './index'

function toolNamesFor(userMessage: string, overrides = {}) {
  return resolveToolsForContext(LOCAL_TOOL_CATALOG, {
    hasSpectrumArtifacts: false,
    hasStructureArtifacts: false,
    hasComputeArtifacts: false,
    hasResearchArtifacts: false,
    hasLatexArtifacts: false,
    hasPapers: false,
    hasWorkspaceFiles: true,
    hasHypothesisArtifacts: false,
    userMessage,
    ...overrides,
  }).map((tool) => tool.name)
}

describe('resolveToolsForContext', () => {
  it('exposes spectrum tools for XRD refinement requests', () => {
    const names = toolNamesFor('Run Rietveld refinement on this XRD pattern')

    expect(names).toContain('open_spectrum_workbench')
    expect(names).toContain('xrd_search_phases')
    expect(names).toContain('xrd_refine')
  })

  it('exposes spectrum tools for Chinese refinement requests', () => {
    const names = toolNamesFor('请对这个衍射谱做物相拟合和精修')

    expect(names).toContain('detect_peaks')
    expect(names).toContain('xrd_refine')
  })

  it('keeps compute tools out of spectrum-only refinement requests', () => {
    const names = toolNamesFor('Run Rietveld refinement on this XRD pattern')

    expect(names).not.toContain('compute_create_script')
    expect(names).not.toContain('compute_run')
  })

  it('does not let stale compute artifacts route XRD refinement through compute_run', () => {
    const names = toolNamesFor('Run Rietveld refinement on this XRD pattern', {
      hasComputeArtifacts: true,
    })

    expect(names).toContain('xrd_refine')
    expect(names).not.toContain('compute_run')
  })

  it('still exposes compute tools when the user explicitly asks for compute work', () => {
    const names = toolNamesFor('check the compute script status', {
      hasComputeArtifacts: true,
    })

    expect(names).toContain('compute_status')
    expect(names).toContain('compute_run')
  })
})
