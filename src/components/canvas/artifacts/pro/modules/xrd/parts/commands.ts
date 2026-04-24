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
      name: 'snapshot',
      description: 'Save the current state as an XRD Analysis snapshot.',
      technique: ['xrd'],
      execute: () => actions.handleSnapshot(),
    },
  ]
}
