import { Plus, Trash2 } from 'lucide-react'
import { useComputeConfigStore } from '../../../stores/compute-config-store'
import { S, SECTION_ICONS } from './styles'

export default function EnvVarsSection() {
  const envVars = useComputeConfigStore((s) => s.envVars)
  const addEnvVar = useComputeConfigStore((s) => s.addEnvVar)
  const updateEnvVar = useComputeConfigStore((s) => s.updateEnvVar)
  const removeEnvVar = useComputeConfigStore((s) => s.removeEnvVar)

  const Icon = SECTION_ICONS.env
  return (
    <div style={S.section}>
      <div style={S.sectionHeader}>
        <Icon size={11} />
        <span>Environment variables</span>
        <span style={S.hintInline}>(injected into compute processes)</span>
      </div>

      <div style={S.table}>
        <div style={S.tableHead}>
          <span>KEY</span>
          <span>value</span>
          <span />
          <span />
        </div>
        {envVars.length === 0 ? (
          <div style={S.emptyLine}>
            PYTHONUSERBASE, OMP_NUM_THREADS etc. are set automatically.
          </div>
        ) : (
          envVars.map((e) => (
            <div key={e.id} style={S.tableRow}>
              <input
                type="text"
                value={e.key}
                onChange={(ev) =>
                  updateEnvVar(e.id, { key: ev.target.value.toUpperCase() })
                }
                placeholder="MY_VAR"
                style={S.textInput}
                className="compute-resources-envkey-input"
              />
              <input
                type="text"
                value={e.value}
                onChange={(ev) =>
                  updateEnvVar(e.id, { value: ev.target.value })
                }
                placeholder="value"
                style={S.textInput}
              />
              <span />
              <button
                type="button"
                onClick={() => removeEnvVar(e.id)}
                style={S.iconBtn}
                title="Remove"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))
        )}
        <button type="button" onClick={addEnvVar} style={S.addBtn}>
          <Plus size={11} /> Add variable
        </button>
      </div>
    </div>
  )
}
