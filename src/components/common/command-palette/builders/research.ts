import type { Command } from '../types'

export interface ResearchLauncherDeps {
  onClose: () => void
  onStartResearch: () => void
}

/**
 * "Start Research" — single entry. The planner chooses Brief vs Survey
 * from the topic itself when `research_plan_outline` runs, so the palette
 * no longer exposes a depth choice up front.
 */
export function buildResearchCommands({
  onClose,
  onStartResearch,
}: ResearchLauncherDeps): Command[] {
  return [
    {
      id: 'start-research',
      label: 'Start Research',
      action: () => {
        onStartResearch()
        onClose()
      },
    },
  ]
}
