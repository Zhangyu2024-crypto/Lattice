import { useMemo, useState } from 'react'
import { RotateCcw, Save, Sliders, X } from 'lucide-react'
import {
  getSchemaForKind,
  type ParamSchema,
} from '../../params/schemas'
import { useRuntimeStore } from '../../stores/runtime-store'
import { toast } from '../../stores/toast-store'
import type { Artifact } from '../../types/artifact'

interface Props {
  open: boolean
  onClose: () => void
  artifact: Artifact | null
  sessionId: string | null
  sessionDefaults: Record<string, unknown>
}

export default function ParametersDrawer({
  open,
  onClose,
  artifact,
  sessionId,
  sessionDefaults,
}: Props) {
  const setArtifactParam = useRuntimeStore((s) => s.setArtifactParam)
  const setSessionParam = useRuntimeStore((s) => s.setSessionParam)
  const resetArtifactParams = useRuntimeStore((s) => s.resetArtifactParams)

  const schema = useMemo(
    () => (artifact ? getSchemaForKind(artifact.kind) : null),
    [artifact],
  )

  // Local draft state: key → value. Initialized from current resolved values.
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [draftKey, setDraftKey] = useState<string | null>(null)

  // Reset draft when drawer opens or artifact changes
  if (open && artifact && draftKey !== artifact.id) {
    const resolved: Record<string, unknown> = {}
    if (schema) {
      for (const group of schema.groups) {
        for (const p of group.params) {
          resolved[p.key] = resolveValue(p, artifact.params, sessionDefaults)
        }
      }
    }
    setDraft(resolved)
    setDraftKey(artifact.id)
  }

  if (!open) return null

  if (!artifact || !sessionId) {
    return null
  }

  if (!schema) {
    return (
      <DrawerShell onClose={onClose}>
        <EmptyBody>No parameter schema registered for "{artifact.kind}".</EmptyBody>
      </DrawerShell>
    )
  }

  if (schema.groups.length === 0) {
    return (
      <DrawerShell onClose={onClose}>
        <div className="artifact-params-header">
          <Sliders size={14} className="artifact-params-title-icon" />
          <strong className="artifact-params-title">Parameters</strong>
          <span className="artifact-params-kind">{artifact.kind}</span>
          <span className="artifact-params-spacer" />
          <button
            onClick={onClose}
            className="artifact-params-close-btn"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <EmptyBody>
          This artifact type is read-only. No parameters to configure.
        </EmptyBody>
      </DrawerShell>
    )
  }

  const applyAll = () => {
    for (const [key, value] of Object.entries(draft)) {
      setArtifactParam(sessionId, artifact.id, key, value)
    }
    toast.success('Parameters applied to artifact')
  }

  const saveAsSessionDefault = () => {
    for (const [key, value] of Object.entries(draft)) {
      setSessionParam(sessionId, key, value)
      setArtifactParam(sessionId, artifact.id, key, value)
    }
    toast.success('Saved as session default')
  }

  const resetToDefaults = () => {
    resetArtifactParams(sessionId, artifact.id)
    const resolved: Record<string, unknown> = {}
    for (const group of schema.groups) {
      for (const p of group.params) {
        resolved[p.key] = resolveValue(p, undefined, sessionDefaults)
      }
    }
    setDraft(resolved)
    toast.info('Parameters reset')
  }

  return (
    <DrawerShell onClose={onClose}>
      <div className="artifact-params-header">
        <Sliders size={14} className="artifact-params-title-icon" />
        <strong className="artifact-params-title">Parameters</strong>
        <span className="artifact-params-kind">{artifact.kind}</span>
        <span className="artifact-params-spacer" />
        <button
          onClick={onClose}
          className="artifact-params-close-btn"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="artifact-params-body">
        {schema.groups.map((group) => (
          <div key={group.title} className="artifact-params-group">
            <div className="artifact-params-group-title">{group.title}</div>
            <div className="artifact-params-group-rows">
              {group.params.map((p) => (
                <ParamRow
                  key={p.key}
                  param={p}
                  value={draft[p.key]}
                  onChange={(v) =>
                    setDraft((prev) => ({ ...prev, [p.key]: v }))
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="artifact-params-footer">
        <button onClick={applyAll} className="artifact-params-btn-primary">
          Apply
        </button>
        <button
          onClick={saveAsSessionDefault}
          className="artifact-params-btn-secondary"
        >
          <Save size={12} /> Save as session default
        </button>
        <button
          onClick={resetToDefaults}
          className="artifact-params-btn-secondary"
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>
    </DrawerShell>
  )
}

function DrawerShell({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <>
      <div onClick={onClose} className="artifact-params-backdrop" />
      <div className="artifact-params-panel">{children}</div>
    </>
  )
}

function EmptyBody({ children }: { children: React.ReactNode }) {
  return <div className="artifact-params-empty">{children}</div>
}

function ParamRow({
  param,
  value,
  onChange,
}: {
  param: ParamSchema
  value: unknown
  onChange: (v: unknown) => void
}) {
  return (
    <label className="artifact-params-row">
      <span className="artifact-params-row-label">{param.label}</span>
      {renderControl(param, value, onChange)}
      {param.description && (
        <span className="artifact-params-row-desc">{param.description}</span>
      )}
    </label>
  )
}

function renderControl(
  param: ParamSchema,
  value: unknown,
  onChange: (v: unknown) => void,
): React.ReactNode {
  if (param.type === 'number') {
    return (
      <input
        type="number"
        value={(value as number) ?? param.default}
        min={param.min}
        max={param.max}
        step={param.step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="artifact-params-input"
      />
    )
  }
  if (param.type === 'bool') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    )
  }
  if (param.type === 'select') {
    return (
      <select
        value={(value as string) ?? param.default}
        onChange={(e) => onChange(e.target.value)}
        className="artifact-params-input"
      >
        {param.options.map((opt) => (
          <option key={opt} value={opt}>
            {param.optionLabels?.[opt] ?? opt}
          </option>
        ))}
      </select>
    )
  }
  if (param.type === 'text') {
    return (
      <input
        type="text"
        value={(value as string) ?? param.default}
        placeholder={param.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="artifact-params-input"
      />
    )
  }
  if (param.type === 'range') {
    const [lo, hi] = (value as [number, number] | undefined) ?? param.default
    return (
      <div className="artifact-params-range">
        <input
          type="number"
          value={lo}
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          onChange={(e) => onChange([Number(e.target.value), hi])}
          className="artifact-params-input artifact-params-range-input"
        />
        <span className="artifact-params-range-sep">–</span>
        <input
          type="number"
          value={hi}
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          onChange={(e) => onChange([lo, Number(e.target.value)])}
          className="artifact-params-input artifact-params-range-input"
        />
      </div>
    )
  }
  return null
}

function resolveValue(
  p: ParamSchema,
  artifactParams: Record<string, unknown> | undefined,
  sessionDefaults: Record<string, unknown>,
): unknown {
  if (artifactParams && p.key in artifactParams) return artifactParams[p.key]
  if (p.key in sessionDefaults) return sessionDefaults[p.key]
  return p.default
}

