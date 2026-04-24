import { useMemo, useCallback } from 'react'
import { FileText, ExternalLink, Copy, Trash2, Unlink } from 'lucide-react'
import { useDataIndexStore } from '@/stores/data-index-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import TagChipBar from './TagChipBar'
import StarRating from './StarRating'
import Row from './file-detail/Row'
import ActionBtn from './file-detail/ActionBtn'
import ConditionsEditor from './file-detail/ConditionsEditor'
import FilePreview from './file-detail/FilePreview'
import { labelCss, selectCss, sectionHeader, TECHNIQUE_OPTIONS } from './file-detail/styles'
import { formatSize } from './file-detail/helpers'
import { asyncPrompt } from '@/lib/prompt-dialog'

interface Props {
  relPath: string
}

export default function FileDetail({ relPath }: Props) {
  const entry = useWorkspaceStore((s) => s.fileIndex[relPath])
  const index = useDataIndexStore((s) => s.index)
  const setFileMeta = useDataIndexStore((s) => s.setFileMeta)
  const setRating = useDataIndexStore((s) => s.setRating)
  const tagFile = useDataIndexStore((s) => s.tagFile)
  const untagFile = useDataIndexStore((s) => s.untagFile)
  const assignFileToSample = useDataIndexStore((s) => s.assignFileToSample)
  const removeFileFromSample = useDataIndexStore((s) => s.removeFileFromSample)
  const unlinkFiles = useDataIndexStore((s) => s.unlinkFiles)
  const linkFiles = useDataIndexStore((s) => s.linkFiles)
  const setSelectedFile = useDataIndexStore((s) => s.setSelectedFile)

  const handleOpen = useCallback(() => {
    const name = relPath.split('/').pop()?.toLowerCase() ?? ''
    const api = (window as unknown as { electronAPI?: Record<string, (...a: unknown[]) => Promise<unknown>> }).electronAPI
    if (name.endsWith('.pdf') && api?.openPdfReaderWindow) {
      void (api.openPdfReaderWindow as (r: string) => Promise<unknown>)(relPath)
    }
  }, [relPath])

  const fm = index.fileMeta[relPath]
  const allTags = index.tags
  const fileTags = fm?.tags ?? []
  const sampleOptions = useMemo(() => Object.values(index.samples), [index.samples])

  const handleSampleChange = useCallback(
    (newSampleId: string) => {
      const currentId = fm?.sampleId
      if (currentId) removeFileFromSample(relPath, currentId)
      if (newSampleId) assignFileToSample(relPath, newSampleId)
    },
    [fm?.sampleId, relPath, removeFileFromSample, assignFileToSample],
  )

  const handleTechniqueChange = useCallback(
    (technique: string) => {
      setFileMeta(relPath, { technique: technique || undefined })
    },
    [relPath, setFileMeta],
  )

  const handleRatingChange = useCallback(
    (rating: number | undefined) => {
      setRating(relPath, rating as 1 | 2 | 3 | 4 | 5 | undefined)
    },
    [relPath, setRating],
  )

  const handleCopyPath = useCallback(() => {
    void navigator.clipboard.writeText(relPath)
  }, [relPath])

  const handleLinkFile = useCallback(async () => {
    const target = await asyncPrompt('Enter relative path of file to link:')
    if (target?.trim()) linkFiles(relPath, target.trim())
  }, [relPath, linkFiles])

  if (!entry) {
    return <div style={{ padding: 14, fontSize: "var(--text-sm)", color: '#888' }}>File not found.</div>
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
        <FileText size={15} strokeWidth={1.6} />
        File Detail
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <Row label="Name" value={entry.name} />
        <Row label="Path" value={relPath} />
        <Row label="Size" value={formatSize(entry.size)} />
        <Row label="Modified" value={new Date(entry.mtime).toLocaleDateString('en-CA')} />
        {fm?.dataType && <Row label="Type" value={fm.dataType} />}
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={labelCss}>Sample</span>
          <select
            value={fm?.sampleId ?? ''}
            onChange={(e) => handleSampleChange(e.target.value)}
            style={selectCss}
          >
            <option value="">None</option>
            {sampleOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={labelCss}>Technique</span>
          <select
            value={fm?.technique ?? ''}
            onChange={(e) => handleTechniqueChange(e.target.value)}
            style={selectCss}
          >
            {TECHNIQUE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o || 'None'}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={labelCss}>Rating</span>
          <StarRating value={fm?.rating} onChange={handleRatingChange} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ ...labelCss, paddingTop: 2 }}>Tags</span>
          <div style={{ flex: 1 }}>
            <TagChipBar
              tags={fileTags}
              allTags={allTags}
              onAdd={(tag) => tagFile(relPath, tag)}
              onRemove={(tag) => untagFile(relPath, tag)}
            />
          </div>
        </div>
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <div style={sectionHeader}>Experiment Conditions</div>
        <ConditionsEditor relPath={relPath} technique={fm?.technique} />
      </div>

      {fm?.dataType === 'image' && fm.imageInfo && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
          <div style={sectionHeader}>Image Info</div>
          {fm.imageInfo.magnification && <Row label="Magnification" value={fm.imageInfo.magnification} />}
          {fm.imageInfo.acceleratingVoltage && <Row label="Voltage" value={fm.imageInfo.acceleratingVoltage} />}
          {fm.imageInfo.detector && <Row label="Detector" value={fm.imageInfo.detector} />}
          {fm.imageInfo.scalebar && <Row label="Scale bar" value={fm.imageInfo.scalebar} />}
        </div>
      )}

      {fm?.dataType === 'paper' && fm.paperInfo && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
          <div style={sectionHeader}>Paper Info</div>
          {fm.paperInfo.title && <Row label="Title" value={fm.paperInfo.title} />}
          {fm.paperInfo.authors && <Row label="Authors" value={fm.paperInfo.authors} />}
          {fm.paperInfo.journal && <Row label="Journal" value={fm.paperInfo.journal} />}
          {fm.paperInfo.year && <Row label="Year" value={String(fm.paperInfo.year)} />}
          {fm.paperInfo.doi && <Row label="DOI" value={fm.paperInfo.doi} />}
        </div>
      )}

      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <div style={{ ...sectionHeader, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Linked Files ({fm?.linkedFiles?.length ?? 0})</span>
          <button
            type="button"
            onClick={handleLinkFile}
            style={{
              background: 'transparent',
              border: '1px solid #444',
              color: '#888',
              fontSize: "var(--text-xxs)",
              padding: '1px 6px',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            + Link
          </button>
        </div>
        {(fm?.linkedFiles ?? []).length === 0 ? (
          <div style={{ fontSize: "var(--text-xs)", color: '#555', fontStyle: 'italic' }}>None</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {fm!.linkedFiles.map((linked) => (
              <div
                key={linked}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: "var(--text-xs)",
                  color: '#ccc',
                }}
              >
                <span
                  onClick={() => setSelectedFile(linked)}
                  style={{
                    flex: 1,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    padding: '1px 4px',
                    borderRadius: 3,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.background = '#2a2d2e' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.background = 'transparent' }}
                >
                  {linked.split('/').pop()}
                </span>
                <button
                  type="button"
                  onClick={() => unlinkFiles(relPath, linked)}
                  title="Unlink"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    cursor: 'pointer',
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Unlink size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <FilePreview relPath={relPath} dataType={fm?.dataType} />

      <div style={{ padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <ActionBtn icon={<ExternalLink size={11} />} label="Open" onClick={handleOpen} />
        <ActionBtn icon={<Copy size={11} />} label="Copy Path" onClick={handleCopyPath} />
        {fm?.sampleId && (
          <ActionBtn
            icon={<Trash2 size={11} />}
            label="Remove from Sample"
            onClick={() => removeFileFromSample(relPath, fm.sampleId!)}
          />
        )}
      </div>
    </div>
  )
}
