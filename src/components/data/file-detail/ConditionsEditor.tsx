import { useMemo, useState } from 'react'
import { useDataIndexStore } from '@/stores/data-index-store'
import { TECHNIQUE_PRESETS } from './styles'

export default function ConditionsEditor({ relPath, technique }: { relPath: string; technique?: string }) {
  const conditions = useDataIndexStore((s) => s.index.fileMeta[relPath]?.experimentConditions)
  const setConditions = useDataIndexStore((s) => s.setExperimentConditions)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const presetKeys: string[] = technique && TECHNIQUE_PRESETS[technique]
    ? TECHNIQUE_PRESETS[technique] as string[]
    : ['instrument', 'temperature', 'atmosphere']

  const allKeys = useMemo(() => {
    const keys = new Set<string>(presetKeys)
    if (conditions) {
      for (const k of Object.keys(conditions)) {
        if (conditions[k]) keys.add(k)
      }
    }
    return [...keys]
  }, [presetKeys, conditions])

  const startEdit = (key: string) => {
    setDraft(conditions?.[key] ?? '')
    setEditing(key)
  }

  const commit = (key: string) => {
    setEditing(null)
    setConditions(relPath, { [key]: draft.trim() || undefined })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {allKeys.map((key) => {
        const val = conditions?.[key]
        const isEditing = editing === key
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: "var(--text-xxs)", color: '#888', width: 90, textAlign: 'right', flexShrink: 0 }}>{key}</span>
            {isEditing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit(key)
                  if (e.key === 'Escape') setEditing(null)
                }}
                style={{
                  flex: 1,
                  fontSize: "var(--text-xs)",
                  color: '#ccc',
                  background: '#2a2a2a',
                  border: '1px solid #444',
                  borderRadius: 3,
                  padding: '1px 4px',
                  outline: 'none',
                }}
              />
            ) : (
              <span
                onClick={() => startEdit(key)}
                style={{
                  flex: 1,
                  fontSize: "var(--text-xs)",
                  color: val ? '#ccc' : '#555',
                  fontStyle: val ? 'normal' : 'italic',
                  cursor: 'pointer',
                  padding: '1px 4px',
                  borderRadius: 3,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.background = '#2a2a2a' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.background = 'transparent' }}
              >
                {val || 'Set...'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
