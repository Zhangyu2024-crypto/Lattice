// Pure helpers that format the compute-container health payload for
// the notebook topbar dot + tooltip.

import type { ComputeProArtifact } from '../../../../types/artifact'

export function healthDotColor(containerUp: boolean | undefined): string {
  if (containerUp == null) return 'var(--color-text-muted)'
  return containerUp ? 'var(--color-success)' : 'var(--color-danger)'
}

export function healthTooltip(
  health: ComputeProArtifact['payload']['health'],
): string {
  if (!health) return 'Probing container…'
  if (!health.containerUp) {
    return health.error || 'Container stopped'
  }
  const bits: string[] = []
  if (health.pythonVersion) bits.push(`py ${health.pythonVersion}`)
  if (health.lammpsAvailable) bits.push('lammps')
  if (health.cp2kAvailable) bits.push('cp2k')
  return `Online${bits.length ? ' · ' + bits.join(' · ') : ''}`
}
