// Command-palette entries exposed by the XPS module. Each command is a
// thin wrapper around a handler on the actions bag, so wiring is uniform
// regardless of whether the command takes arguments.

import type { XpsSubState } from '@/types/artifact'
import type { CommandDef } from '@/components/canvas/artifacts/pro/commandRegistry'
import type { ModuleCtx } from '../../types'
import type { XpsActions } from './actions'

export function buildXpsCommands(
  _ctx: ModuleCtx<XpsSubState>,
  actions: XpsActions,
): CommandDef[] {
  return [
    {
      name: 'run assess-quality',
      description: 'Grade the XPS survey / region.',
      technique: ['xps'],
      execute: () => actions.handleAssessQuality(),
    },
    {
      name: 'run charge-correct',
      description: 'Shift the spectrum so C 1s lands on the reference BE.',
      technique: ['xps'],
      execute: () => actions.handleChargeCorrect(),
    },
    {
      name: 'run detect-peaks',
      description: 'Detect peaks with current prominence / top-K settings.',
      technique: ['xps'],
      execute: () => actions.handleDetectPeaks(),
    },
    {
      name: 'add peak',
      description: 'Append a peak definition; type `single` or `doublet`.',
      technique: ['xps'],
      argsSchema: [
        {
          name: 'type',
          type: 'string',
          required: true,
          choices: ['single', 'doublet'],
          default: 'single',
        },
      ],
      execute: (_c, args) => {
        const t = args.type === 'doublet' ? 'doublet' : 'single'
        actions.handleAddPeakDef(t)
      },
    },
    {
      name: 'run fit',
      description: 'Fit the defined peaks against the current spectrum.',
      technique: ['xps'],
      execute: () => actions.handleFit(),
    },
    {
      name: 'run quantify',
      description: 'Estimate atomic percentages from the latest fit.',
      technique: ['xps'],
      execute: () => actions.handleQuantify(),
    },
    {
      name: 'run lookup',
      description: 'Query BE database for the detected peak positions.',
      technique: ['xps'],
      execute: () => actions.handleLookup(),
    },
    {
      name: 'reset energy-window',
      description: 'Clear the min/max energy window (use full range).',
      technique: ['xps'],
      execute: () => actions.handleResetEnergyWindow(),
    },
    {
      name: 'export report',
      description: 'Download a markdown summary of the current fit.',
      technique: ['xps'],
      execute: () => actions.handleExport(),
    },
    {
      name: 'clear pattern overlays',
      description: 'Remove all loaded secondary patterns from the chart.',
      technique: ['xps'],
      execute: () => actions.handleClearPatternOverlays(),
    },
  ]
}
