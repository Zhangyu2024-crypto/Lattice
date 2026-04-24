// Command-palette entries exposed by the Raman/FTIR module. Each command
// is a thin wrapper around a handler on the actions bag, so wiring is
// uniform regardless of whether the command takes arguments. The identify
// command is conditionally included based on the FTIR-identify capability
// gate — hidden from the palette when unavailable so the user doesn't
// discover a command that can't run.

import type { RamanSubState } from '@/types/artifact'
import { getCapability } from '@/lib/pro-capabilities'
import type { CommandDef } from '@/components/canvas/artifacts/pro/commandRegistry'
import type { ModuleCtx } from '../../types'
import type { RamanActions } from './actions'

export function buildRamanCommands(
  _ctx: ModuleCtx<RamanSubState>,
  actions: RamanActions,
): CommandDef[] {
  const { isFtir } = actions
  const identifyAvailable = !isFtir || getCapability('ftir-identify').available
  return [
    {
      name: 'run assess-quality',
      description: `Grade the loaded ${isFtir ? 'FTIR' : 'Raman'} spectrum.`,
      technique: ['raman', 'ftir'],
      execute: () => actions.handleAssessQuality(),
    },
    {
      name: 'run smooth',
      description: 'Apply Savitzky-Golay smoothing with current params.',
      technique: ['raman', 'ftir'],
      execute: () => actions.handleSmooth(),
    },
    {
      name: 'run baseline',
      description: 'Subtract baseline with current method + order.',
      technique: ['raman', 'ftir'],
      execute: () => actions.handleBaseline(),
    },
    {
      name: 'run detect-peaks',
      description: 'Detect peaks with current prominence / min-spacing.',
      technique: ['raman', 'ftir'],
      execute: () => actions.handleDetectPeaks(),
    },
    ...(identifyAvailable
      ? [
          {
            name: 'run identify',
            description: 'Match peaks against the Raman database.',
            technique: ['raman', 'ftir'] as const,
            execute: () => actions.handleIdentify(),
          },
        ]
      : []),
    {
      name: 'export peaks',
      description: 'Download peaks as CSV.',
      technique: ['raman', 'ftir'],
      execute: () => actions.handleExport(),
    },
  ]
}
