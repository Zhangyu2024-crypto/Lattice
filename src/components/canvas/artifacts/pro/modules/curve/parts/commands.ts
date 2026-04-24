// Command-palette entries exposed by the Curve module. Each command is a
// thin wrapper around a handler on the actions bag, so wiring is uniform
// regardless of whether the command takes arguments.

import type { CurveSubState } from '@/types/artifact'
import type { CommandDef } from '@/components/canvas/artifacts/pro/commandRegistry'
import type { ModuleCtx } from '../../types'
import type { CurveActions } from './actions'

export function buildCurveCommands(
  _ctx: ModuleCtx<CurveSubState>,
  actions: CurveActions,
): CommandDef[] {
  return [
    {
      name: 'run assess-quality',
      description: 'Grade the curve (SNR, issues).',
      technique: ['curve'],
      execute: () => actions.handleAssessQuality(),
    },
    {
      name: 'run smooth',
      description: 'Apply current smoothing settings.',
      technique: ['curve'],
      execute: () => actions.handleSmooth(),
    },
    {
      name: 'run baseline',
      description: 'Apply current baseline correction.',
      technique: ['curve'],
      execute: () => actions.handleBaseline(),
    },
    {
      name: 'run detect-peaks',
      description: 'Detect peaks / features on the current curve.',
      technique: ['curve'],
      execute: () => actions.handleDetectPeaks(),
    },
  ]
}
