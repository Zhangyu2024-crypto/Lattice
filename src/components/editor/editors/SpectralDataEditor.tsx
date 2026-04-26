import { useEffect, useMemo, useState } from 'react'
import { Activity, Code2, LineChart as LineChartIcon } from 'lucide-react'
import type { Extension } from '@codemirror/state'
import type { LatticeFileKind } from '../../../lib/workspace/fs/types'
import type { ParsedSpectrum } from '../../../lib/parsers/types'
import {
  needsBinaryRead,
  needsLocalParserSupport,
} from '../../../lib/parsers/parse-spectrum-file'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useEditableText } from './useEditableText'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import EditorToolbar from './EditorToolbar'
import CodeMirrorEditor from './CodeMirrorEditor'
import {
  extensionOf,
  toArrayBuffer,
} from './spectral-data/helpers'
import { ModeButton } from './spectral-data/ModeButton'
import { MetadataBar } from './spectral-data/MetadataBar'
import {
  LocalParserUnsupported,
  ParseFailure,
} from './spectral-data/Placeholders'
import { SpectrumPlot } from './spectral-data/SpectrumPlot'
import EditorSplitPane from './EditorSplitPane'

interface Props {
  relPath: string
  kind: LatticeFileKind
}

type ViewMode = 'chart' | 'source' | 'split'

export default function SpectralDataEditor({ relPath, kind }: Props) {
  const ext = useMemo(
    () => extensionOf(relPath.split('/').pop() ?? relPath),
    [relPath],
  )

  if (needsLocalParserSupport(relPath)) {
    return <UnsupportedSpectralEditor relPath={relPath} ext={ext} />
  }

  const isBinary = needsBinaryRead(relPath)
  if (isBinary) {
    return <BinarySpectralEditor relPath={relPath} ext={ext} />
  }
  return <TextSpectralEditor relPath={relPath} ext={ext} kind={kind} />
}

// ── Binary editor (for .raw) ────────────────────────────────────

function BinarySpectralEditor({
  relPath,
  ext,
}: {
  relPath: string
  ext: string
}) {
  const readBinary = useWorkspaceStore((s) => s.readBinary)
  const readFile = useWorkspaceStore((s) => s.readFile)
  const [spectrum, setSpectrum] = useState<ParsedSpectrum | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSpectrum(null)

    ;(async () => {
      try {
        let result: ParsedSpectrum | null = null

        const raw = await readBinary(relPath)
        if (cancelled) return
        if (raw) {
          const ab = toArrayBuffer(raw)
          if (ab) {
            const { parseSpectrumBinary } = await import(
              '../../../lib/parsers/parse-spectrum-file'
            )
            result = await parseSpectrumBinary(ab, relPath)
          }
        }

        if (!result) {
          const text = await readFile(relPath)
          if (cancelled) return
          if (text) {
            const { parseSpectrumText } = await import(
              '../../../lib/parsers/parse-spectrum-file'
            )
            result = await parseSpectrumText(text, relPath)
          }
        }

        if (cancelled) return
        setSpectrum(result)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [readBinary, readFile, relPath])

  if (loading) return <EditorLoading relPath={relPath} />
  if (error) return <EditorError relPath={relPath} message={error} />

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
        dirty={false}
        onSave={() => {}}
        icon={Activity}
      />
      {spectrum && <MetadataBar spectrum={spectrum} />}
      <div style={{ flex: 1, minHeight: 0 }}>
        {spectrum ? (
          <SpectrumPlot spectrum={spectrum} />
        ) : (
          <ParseFailure ext={ext} />
        )}
      </div>
    </div>
  )
}

// ── Text editor (for .jdx, .xrdml, .csv, .xy, etc.) ────────────

function TextSpectralEditor({
  relPath,
  ext,
}: {
  relPath: string
  ext: string
  kind: LatticeFileKind
}) {
  const { text, status, error, dirty, setText, save } = useEditableText(relPath)
  const [viewMode, setViewMode] = useState<ViewMode>('chart')
  const [lang, setLang] = useState<Extension | undefined>(undefined)

  useMemo(() => {
    if (ext === '.xrdml') {
      import('@codemirror/lang-html').then((m) => setLang(m.html()))
    }
  }, [ext])

  const [spectrum, setSpectrum] = useState<ParsedSpectrum | null>(null)

  // Debounce the local parse chain. On a 10 MB CSV each cycle can be
  // ~100ms of main-thread work, so 250 ms keeps the preview feeling live
  // while coalescing typing bursts. The `cancelled` flag also drops
  // late-arriving parse results when the text has since advanced.
  useEffect(() => {
    if (!text) {
      setSpectrum(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void import('../../../lib/parsers/parse-spectrum-file').then(
        ({ parseSpectrumText }) =>
          parseSpectrumText(text, relPath).then((result) => {
            if (cancelled) return
            setSpectrum(result)
          }),
      )
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, relPath])

  if (status === 'loading' || text == null) {
    return <EditorLoading relPath={relPath} />
  }
  if (status === 'error') {
    return (
      <EditorError relPath={relPath} message={error ?? 'Failed to load file'} />
    )
  }

  const handleSave = () => void save()

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
        icon={Activity}
        actions={
          <div style={{ display: 'flex', gap: 2 }}>
            <ModeButton
              active={viewMode === 'chart'}
              onClick={() => setViewMode('chart')}
              title="Chart view"
            >
              <LineChartIcon size={12} strokeWidth={1.8} />
              Chart
            </ModeButton>
            <ModeButton
              active={viewMode === 'split'}
              onClick={() => setViewMode('split')}
              title="Split view"
            >
              Split
            </ModeButton>
            <ModeButton
              active={viewMode === 'source'}
              onClick={() => setViewMode('source')}
              title="Source view"
            >
              <Code2 size={12} strokeWidth={1.8} />
              Source
            </ModeButton>
          </div>
        }
      />

      {spectrum && <MetadataBar spectrum={spectrum} />}

      {viewMode === 'split' ? (
        <EditorSplitPane
          storageKey="lattice.editor.spectral.split"
          defaultLeftWidth={520}
          minLeftWidth={280}
          minRightWidth={280}
          label="Resize spectrum chart and source"
          left={
            spectrum ? (
              <SpectrumPlot spectrum={spectrum} />
            ) : (
              <ParseFailure ext={ext} />
            )
          }
          right={
            <CodeMirrorEditor
              value={text}
              onChange={setText}
              onSave={handleSave}
              language={lang}
            />
          }
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {viewMode === 'chart' ? (
            spectrum ? (
              <SpectrumPlot spectrum={spectrum} />
            ) : (
              <ParseFailure ext={ext} />
            )
          ) : (
            <CodeMirrorEditor
              value={text}
              onChange={setText}
              onSave={handleSave}
              language={lang}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Unsupported local parser editor ─────────────────────────────────

function UnsupportedSpectralEditor({
  relPath,
  ext,
}: {
  relPath: string
  ext: string
}) {
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
        dirty={false}
        onSave={() => {}}
        icon={Activity}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        <LocalParserUnsupported ext={ext} />
      </div>
    </div>
  )
}
