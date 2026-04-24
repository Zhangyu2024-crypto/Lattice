import type { LocalTool } from '../../types/agent-tool'
import { localProCompute } from '../local-pro-compute'

interface Output {
  /** Legacy field name — means "compute environment ready" now that Docker
   *  modes are gone. Preserved as `containerUp` for payload compatibility
   *  with ComputeArtifact / ComputeNotebook readers. */
  containerUp: boolean
  pythonVersion: string | null
  lammpsAvailable: boolean
  cp2kAvailable: boolean
  summary: string
}

export const computeCheckHealthTool: LocalTool<Record<string, never>, Output> = {
  name: 'compute_check_health',
  description:
    'Check whether the compute environment is ready and which engines (Python, LAMMPS, CP2K) are available. Runs against the bundled conda env. Call this before any compute tool when unsure about environment readiness.',
  trustLevel: 'safe',
  cardMode: 'silent',
  inputSchema: { type: 'object', properties: {} },

  async execute() {
    const h = await localProCompute.computeHealth()
    const parts: string[] = []
    if (h.container_up) {
      parts.push('Environment ready')
      if (h.python_version) parts.push(`Python ${h.python_version}`)
      if (h.lammps_available) parts.push('LAMMPS available')
      if (h.cp2k_available) parts.push('CP2K available')
    } else {
      parts.push(`Environment NOT ready${h.error ? `: ${h.error}` : ''}`)
    }
    return {
      containerUp: h.container_up,
      pythonVersion: h.python_version ?? null,
      lammpsAvailable: !!h.lammps_available,
      cp2kAvailable: !!h.cp2k_available,
      summary: parts.join(' · '),
    }
  },
}
