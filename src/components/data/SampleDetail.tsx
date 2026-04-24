import { useState, useCallback } from 'react'
import { FlaskConical, Trash2 } from 'lucide-react'
import { useDataIndexStore } from '@/stores/data-index-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import TagChipBar from './TagChipBar'

const labelCss: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  color: '#888',
  minWidth: 80,
  flexShrink: 0,
}

const valueCss: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: '#ccc',
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  padding: '2px 4px',
  borderRadius: 3,
  border: '1px solid transparent',
}

const inputCss: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  color: '#ccc',
  flex: 1,
  background: '#2a2a2a',
  border: '1px solid #444',
  borderRadius: 3,
  padding: '2px 4px',
  outline: 'none',
}

interface Props {
  sampleId: string
}

type EditableField = 'name' | 'formula' | 'preparation' | 'substrate' | 'morphology' | 'notes'

function InlineField({
  label,
  value,
  field,
  sampleId,
  multiline,
}: {
  label: string
  value: string | undefined
  field: EditableField
  sampleId: string
  multiline?: boolean
}) {
  const updateSample = useDataIndexStore((s) => s.updateSample)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEdit = () => {
    setDraft(value ?? '')
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== (value ?? '')) {
      updateSample(sampleId, { [field]: trimmed || undefined })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) commit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: multiline ? 'flex-start' : 'center', gap: 8, marginBottom: 4 }}>
      <span style={labelCss}>{label}</span>
      {editing ? (
        multiline ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
            rows={3}
            style={{ ...inputCss, resize: 'vertical' }}
          />
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            style={inputCss}
          />
        )
      ) : (
        <span
          onClick={startEdit}
          style={{
            ...valueCss,
            color: value ? '#ccc' : '#555',
            fontStyle: value ? 'normal' : 'italic',
          }}
          title="Click to edit"
        >
          {value || `Set ${label.toLowerCase()}...`}
        </span>
      )}
    </div>
  )
}

export default function SampleDetail({ sampleId }: Props) {
  const sample = useDataIndexStore((s) => s.index.samples[sampleId])
  const allTags = useDataIndexStore((s) => s.index.tags)
  const tagSample = useDataIndexStore((s) => s.tagSample)
  const untagSample = useDataIndexStore((s) => s.untagSample)
  const deleteSample = useDataIndexStore((s) => s.deleteSample)
  const setSelectedFile = useDataIndexStore((s) => s.setSelectedFile)
  const fileIndex = useWorkspaceStore((s) => s.fileIndex)

  const handleDelete = useCallback(() => {
    if (window.confirm(`Delete sample "${sample?.name}"? Files will not be removed.`)) {
      deleteSample(sampleId)
    }
  }, [deleteSample, sampleId, sample?.name])

  if (!sample) {
    return (
      <div style={{ padding: 14, fontSize: "var(--text-sm)", color: '#888' }}>Sample not found.</div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'auto', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid #333',
          fontWeight: 500,
          fontSize: "var(--text-base)",
          color: '#ddd',
        }}
      >
        <FlaskConical size={15} strokeWidth={1.6} style={{ color: '#58a6ff' }} />
        Sample Detail
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <InlineField label="Name" value={sample.name} field="name" sampleId={sampleId} />
        <InlineField label="Formula" value={sample.formula} field="formula" sampleId={sampleId} />
        <InlineField label="Preparation" value={sample.preparation} field="preparation" sampleId={sampleId} />
        <InlineField label="Substrate" value={sample.substrate} field="substrate" sampleId={sampleId} />
        <InlineField label="Morphology" value={sample.morphology} field="morphology" sampleId={sampleId} />
        <InlineField label="Notes" value={sample.notes || undefined} field="notes" sampleId={sampleId} multiline />
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <div style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: '#888', marginBottom: 4 }}>Tags</div>
        <TagChipBar
          tags={sample.tags}
          allTags={allTags}
          onAdd={(tag) => tagSample(sampleId, tag)}
          onRemove={(tag) => untagSample(sampleId, tag)}
        />
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <div style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: '#888', marginBottom: 4 }}>
          Files ({sample.files.length})
        </div>
        {sample.files.length === 0 ? (
          <div style={{ fontSize: "var(--text-xs)", color: '#555', fontStyle: 'italic' }}>No files assigned.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
            {sample.files.map((rel) => {
              const entry = fileIndex[rel]
              return (
                <div
                  key={rel}
                  onClick={() => setSelectedFile(rel)}
                  style={{
                    fontSize: "var(--text-xs)",
                    color: '#ccc',
                    padding: '2px 4px',
                    borderRadius: 3,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#2a2d2e' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                  title={rel}
                >
                  {entry?.name ?? rel}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 4, fontSize: "var(--text-xs)", color: '#888' }}>
        <span>Created: {new Date(sample.createdAt).toLocaleDateString('en-CA')}</span>
      </div>

      <div style={{ padding: '8px 12px', marginTop: 'auto' }}>
        <button
          type="button"
          onClick={handleDelete}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: '1px solid #553333',
            color: '#e5484d',
            fontSize: "var(--text-xs)",
            padding: '4px 10px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={12} /> Delete Sample
        </button>
      </div>
    </div>
  )
}
