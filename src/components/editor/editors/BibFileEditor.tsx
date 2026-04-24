import { useMemo } from 'react'
import { AlertTriangle, BookOpen, ExternalLink } from 'lucide-react'
import {
  parseBibTeX,
  entryToPaperDraft,
  type BibTeXEntry,
  type BibTeXPaperDraft,
} from '../../../lib/bibtex-parser'
import { useEditableText } from './useEditableText'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import EditorToolbar from './EditorToolbar'
import CodeMirrorEditor from './CodeMirrorEditor'
import EditorSplitPane from './EditorSplitPane'

interface Props {
  relPath: string
}

export default function BibFileEditor({ relPath }: Props) {
  const { text, status, error, dirty, setText, save } = useEditableText(relPath)

  const parsed = useMemo(() => {
    if (!text) return null
    return parseBibTeX(text)
  }, [text])

  if (status === 'loading' || text == null) {
    return <EditorLoading relPath={relPath} />
  }
  if (status === 'error') {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load BibTeX file'}
      />
    )
  }

  const handleSave = () => {
    void save()
  }

  const entries = parsed?.entries ?? []
  const errors = parsed?.errors ?? []

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--color-bg-panel)',
        color: 'var(--color-text-primary)',
      }}
    >
      <EditorToolbar
        relPath={relPath}
        dirty={dirty}
        onSave={handleSave}
        icon={BookOpen}
      />
      <EditorSplitPane
        storageKey="lattice.editor.bib.split"
        defaultLeftWidth={500}
        minLeftWidth={260}
        minRightWidth={260}
        label="Resize BibTeX editor and preview"
        left={
          <CodeMirrorEditor
            value={text}
            onChange={setText}
            onSave={handleSave}
          />
        }
        right={
          <div style={{ minHeight: 0, height: '100%', overflow: 'auto', padding: '10px 14px' }}>
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: 'var(--color-text-muted)',
                marginBottom: 8,
              }}
            >
              {entries.length} reference{entries.length !== 1 ? 's' : ''}
              {errors.length > 0 && (
                <span style={{ color: '#e5a024', marginLeft: 8 }}>
                  {errors.length} error{errors.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {errors.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {errors.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      fontSize: "var(--text-xs)",
                      color: '#e5a024',
                      marginBottom: 4,
                    }}
                  >
                    <AlertTriangle
                      size={12}
                      strokeWidth={2}
                      style={{ marginTop: 1, flexShrink: 0 }}
                    />
                    <span>
                      Line {e.line}: {e.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {entries.map((entry) => (
              <ReferenceCard key={entry.citationKey} entry={entry} />
            ))}
            {entries.length === 0 && errors.length === 0 && (
              <div
                style={{
                  color: 'var(--color-text-muted)',
                  fontSize: "var(--text-sm)",
                  textAlign: 'center',
                  padding: 24,
                }}
              >
                No entries found
              </div>
            )}
          </div>
        }
      />
    </div>
  )
}

function ReferenceCard({ entry }: { entry: BibTeXEntry }) {
  const draft: BibTeXPaperDraft | null = useMemo(
    () => entryToPaperDraft(entry),
    [entry],
  )

  return (
    <div
      style={{
        padding: '10px 12px',
        marginBottom: 8,
        borderRadius: 4,
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-panel)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: "var(--text-xxs)",
          color: 'var(--accent, #0e7490)',
          marginBottom: 4,
        }}
      >
        @{entry.entryType}
        {'{'}
        {entry.citationKey}
        {'}'}
      </div>
      {draft ? (
        <>
          <div
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: 3,
              lineHeight: 1.4,
            }}
          >
            {draft.title}
          </div>
          {draft.authors && (
            <div style={{ fontSize: "var(--text-xs)", color: 'var(--color-text-muted)', marginBottom: 2 }}>
              {draft.authors}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: "var(--text-xxs)",
              color: 'var(--color-text-muted)',
              marginTop: 4,
            }}
          >
            {draft.year && <span>{draft.year}</span>}
            {draft.journal && <span>{draft.journal}</span>}
            {draft.doi && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  color: 'var(--accent, #0e7490)',
                }}
              >
                <ExternalLink size={9} strokeWidth={2} />
                {draft.doi}
              </span>
            )}
          </div>
        </>
      ) : (
        <div style={{ fontSize: "var(--text-xs)", color: 'var(--color-text-muted)' }}>
          (no title)
        </div>
      )}
    </div>
  )
}
