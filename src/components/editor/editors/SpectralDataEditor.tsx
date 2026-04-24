import { useEffect, useMemo, useState } from 'react'
import { Activity, Code2, LineChart as LineChartIcon } from 'lucide-react'
import type { Extension } from '@codemirror/state'
import type { LatticeFileKind } from '../../../lib/workspace/fs/types'
import type { ParsedSpectrum } from '../../../lib/parsers/types'
import {
  needsBinaryRead,
  needsBackendParse,
} from '../../../lib/parsers/parse-spectrum-file'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useAppStore } from '../../../stores/app-store'
import { useApi } from '../../../hooks/useApi'
import { useEditableText } from './useEditableText'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import EditorToolbar from './EditorToolbar'
import CodeMirrorEditor from './CodeMirrorEditor'
import {
  backendResponseToSpectrum,
  extensionOf,
  toArrayBuffer,
} from './spectral-data/helpers'
import { ModeButton } from './spectral-data/ModeButton'
import { MetadataBar } from './spectral-data/MetadataBar'
import { BackendRequired, ParseFailure } from './spectral-data/Placeholders'
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

  if (needsBackendParse(relPath)) {
    return <BackendSpectralEditor relPath={relPath} ext={ext} />
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
  const backendReady = useAppStore((s) => s.backend.ready)
  const { previewSpectrumFile } = useApi()
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

        if (!result && backendReady) {
          const data = await previewSpectrumFile(relPath)
          if (cancelled) return
          result = backendResponseToSpectrum(data, relPath)
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
  }, [readBinary, readFile, relPath, backendReady, previewSpectrumFile])

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
  const backendReady = useAppStore((s) => s.backend.ready)
  const { previewSpectrumFile } = useApi()
  const [viewMode, setViewMode] = useState<ViewMode>('chart')
  const [lang, setLang] = useState<Extension | undefined>(undefined)

  useMemo(() => {
    if (ext === '.xrdml') {
      import('@codemirror/lang-html').then((m) => setLang(m.html()))
    }
  }, [ext])

  const [spectrum, setSpectrum] = useState<ParsedSpectrum | null>(null)
  const [localParseDone, setLocalParseDone] = useState(false)

  // Debounce the parse chain. Without this every keystroke re-enters
  // the async parse → backend-fallback pipeline; on a 10 MB CSV each
  // cycle is ~100ms of main-thread work and still fires an abortable
  // HTTP request. 250 ms keeps the preview feeling live while coalescing
  // typing bursts. The `cancelled` flag also drops late-arriving parse
  // results when the text has since advanced — otherwise a slow parse
  // of an older string can stomp a newer successful parse.
  useEffect(() => {
    if (!text) {
      setSpectrum(null)
      setLocalParseDone(false)
      return
    }
    setLocalParseDone(false)
    let cancelled = false
    const timer = setTimeout(() => {
      void import('../../../lib/parsers/parse-spectrum-file').then(
        ({ parseSpectrumText }) =>
          parseSpectrumText(text, relPath).then((result) => {
            if (cancelled) return
            setSpectrum(result)
            setLocalParseDone(true)
          }),
      )
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, relPath])

  useEffect(() => {
    if (!localParseDone || spectrum || !backendReady) return
    let cancelled = false
    previewSpectrumFile(relPath)
      .then((data) => {
        if (cancelled) return
        const parsed = backendResponseToSpectrum(data, relPath)
        if (parsed) setSpectrum(parsed)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [localParseDone, spectrum, backendReady, relPath, previewSpectrumFile])

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

// ── Backend-delegated editor (for formats without a frontend parser) ─

function BackendSpectralEditor({
  relPath,
  ext,
}: {
  relPath: string
  ext: string
}) {
  const backendReady = useAppStore((s) => s.backend.ready)
  const { previewSpectrumFile } = useApi()
  const [spectrum, setSpectrum] = useState<ParsedSpectrum | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!backendReady) {
      setLoading(false)
      setError(null)
      setSpectrum(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setSpectrum(null)

    previewSpectrumFile(relPath)
      .then((data) => {
        if (cancelled) return
        const parsed = backendResponseToSpectrum(data, relPath)
        if (parsed) {
          setSpectrum(parsed)
        } else {
          setError('Backend returned empty data')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [relPath, backendReady, previewSpectrumFile])

  if (!backendReady) {
    return <BackendRequired ext={ext} />
  }
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
