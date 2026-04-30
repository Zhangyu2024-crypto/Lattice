// Command-palette entries exposed by the XRD module. Each command is a
// thin wrapper around a handler on the actions bag, so wiring is uniform
// regardless of whether the command takes arguments.

import type { XrdSubState } from '@/types/artifact'
import type { CommandDef } from '@/components/canvas/artifacts/pro/commandRegistry'
import type { ModuleCtx } from '../../types'
import type { XrdActions } from './actions'

export function buildXrdCommands(
  _ctx: ModuleCtx<XrdSubState>,
  actions: XrdActions,
): CommandDef[] {
  return [
    {
      name: 'run refine',
      description: 'Run BGMN-backed XRD refinement for the selected phases.',
      technique: ['xrd'],
      execute: () => actions.handleRefine(),
    },
    {
      name: 'export csv',
      description: 'Export peaks, refinement summary, and fitted curves as CSV.',
      technique: ['xrd'],
      execute: () => actions.handleExportCsv(),
    },
    {
      name: 'export cif',
      description: 'Export refined phase lattice parameters as CIF.',
      technique: ['xrd'],
      execute: () => actions.handleExportCif(),
    },
    {
      name: 'snapshot',
      description: 'Save the current state as an XRD Analysis snapshot.',
      technique: ['xrd'],
      execute: () => actions.handleSnapshot(),
    },
  ]
}
