// Compute resources UI — CPU / OMP threads + free-form environment
// variables for Native-mode code execution. Docker networking / volume
// provisioning were removed along with Local/Remote modes in v5.
//
// Values feed `compute-config-store.setResources / addEnvVar / ...`
// which the main process reads when spawning Python/LAMMPS/CP2K.

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import EnvVarsSection from './compute-resources/EnvVarsSection'
import ResourcesSection from './compute-resources/ResourcesSection'
import { S } from './compute-resources/styles'

export default function ComputeResources() {
  const [open, setOpen] = useState(true)

  return (
    <div style={S.wrap}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={S.headerBtn}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={S.headerTitle}>Performance</span>
      </button>

      {open && (
        <div style={S.body}>
          <ResourcesSection />
          <EnvVarsSection />
        </div>
      )}
    </div>
  )
}
