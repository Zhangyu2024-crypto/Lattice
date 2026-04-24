import {
  useComputeConfigStore,
} from '../../../stores/compute-config-store'
import SliderField from './SliderField'
import { S, SECTION_ICONS } from './styles'

const MAX_CPUS = typeof navigator !== 'undefined'
  ? navigator.hardwareConcurrency || 4
  : 4

export default function ResourcesSection() {
  const resources = useComputeConfigStore((s) => s.resources)
  const setResources = useComputeConfigStore((s) => s.setResources)

  const Icon = SECTION_ICONS.resources
  return (
    <div style={S.section}>
      <div style={S.sectionHeader}>
        <Icon size={11} />
        <span>Performance</span>
        <span style={S.hintInline}>({MAX_CPUS} cores available)</span>
      </div>

      <SliderField
        label="CPU cores"
        unit=""
        min={1}
        max={MAX_CPUS}
        step={1}
        value={Math.min(resources.cpuCores, MAX_CPUS)}
        onChange={(v) => setResources({ cpuCores: v })}
      />
      <div style={S.row}>
        <span style={S.rowLabel}>OMP threads</span>
        <label style={S.toggleLabel}>
          <input
            type="checkbox"
            checked={resources.ompThreads === 'auto'}
            onChange={(e) =>
              setResources({
                ompThreads: e.target.checked ? 'auto' : resources.cpuCores,
              })
            }
          />
          <span className="compute-resources-toggle-label">auto (= CPU cores)</span>
        </label>
        {resources.ompThreads !== 'auto' && (
          <input
            type="number"
            min={1}
            max={MAX_CPUS}
            value={resources.ompThreads}
            onChange={(e) =>
              setResources({ ompThreads: Number(e.target.value) })
            }
            style={S.numInput}
          />
        )}
      </div>
    </div>
  )
}
