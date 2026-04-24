import type { Command } from '../types'

export interface DomainAgentDeps {
  onClose: () => void
  onRunAgent: (prompt: string) => void
}

/**
 * Agent-prompt command bundle. Gated upstream by `canRunDomainCommand`
 * so the caller is responsible for only splicing these in when a
 * spectrum / session context makes the prompts meaningful.
 *
 * These complement — do not replace — the sync `domain-xrd-*` /
 * `domain-xps-*` entries produced by `buildCrossWorkbenchCommands`.
 * The LLM variant is the right pick when the user wants error
 * commentary, phase narrative, or a chained "detect → identify →
 * refine" sweep.
 */
export function buildDomainAgentCommands({
  onClose,
  onRunAgent,
}: DomainAgentDeps): Command[] {
  const run = (prompt: string) => () => {
    onRunAgent(prompt)
    onClose()
  }
  return [
    {
      id: 'domain-detect',
      label: 'Agent: auto-detect peaks on current spectrum',
      action: run(
        'Auto-detect peaks on the current spectrum artifact and create a peak-fit artifact.',
      ),
    },
    {
      id: 'domain-xrd',
      label: 'Agent: identify XRD phases',
      action: run(
        'Identify crystalline phases in the current XRD pattern and produce an XRD analysis artifact.',
      ),
    },
    {
      id: 'domain-xps-charge',
      label: 'Agent: charge-correct XPS (C1s @ 284.8 eV)',
      action: run(
        'Apply charge correction to the current XPS spectrum using C 1s at 284.8 eV.',
      ),
    },
    // Agent-tool bridges for the whole-pattern / multi-step operations
    // that benefit from LLM orchestration.
    {
      id: 'domain-agent-xrd-refine',
      label: 'Agent: run XRD whole-pattern refinement',
      action: run(
        'Run an XRD whole-pattern refinement (xrd_refine tool) on the current workbench and explain the phase breakdown.',
      ),
    },
    {
      id: 'domain-agent-xps-fit',
      label: 'Agent: fit XPS peaks (pseudo-Voigt)',
      action: run(
        'Run the xps_fit_peaks tool on the current XPS spectrum with the defined peaks, then comment on R² and any correlation warnings.',
      ),
    },
    {
      id: 'domain-raman',
      label: 'Agent: match Raman to RRUFF database',
      action: run(
        'Match the current Raman spectrum against the RRUFF mineral database and return the top matches.',
      ),
    },
    {
      id: 'domain-report',
      label: 'Agent: summarize current session into a report',
      action: run(
        'Generate a comprehensive research report summarizing all artifacts in the current session.',
      ),
    },
    {
      id: 'domain-compare',
      label: 'Agent: compare pinned artifacts',
      action: run(
        'Compare all pinned spectrum artifacts in the current session and compute a similarity matrix.',
      ),
    },
    {
      id: 'domain-synthesis',
      label: 'Agent: assess synthesis feasibility',
      action: run(
        'Assess the synthesis feasibility of the material(s) in the current session. Consider precursor availability, literature routes, typical reaction conditions, likely phase purity, and scale-up constraints. Return a structured feasibility report.',
      ),
    },
    {
      id: 'domain-hypothesize',
      label: 'Agent: generate hypotheses from session artifacts',
      action: run(
        'Based on all artifacts in the current session, generate 3-5 testable hypotheses about the material system, rank them by evidential support, and propose next experiments for each.',
      ),
    },
  ]
}
