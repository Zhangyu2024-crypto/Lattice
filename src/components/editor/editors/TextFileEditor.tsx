import { useCallback, useMemo, useState } from 'react'
import { FileText, LineChart as LineChartIcon } from 'lucide-react'
import type { Extension } from '@codemirror/state'
import type { LatticeFileKind } from '../../../lib/workspace/fs/types'
import { useEditableText } from './useEditableText'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import EditorToolbar from './EditorToolbar'
import CodeMirrorEditor from './CodeMirrorEditor'
import EditorSplitPane from './EditorSplitPane'

interface Props {
  relPath: string
  kind: LatticeFileKind
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function isBinaryContent(text: string): boolean {
  const sample = text.slice(0, 8192)
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) return true
  }
  return false
}

function parseNumericColumns(text: string): { x: number[]; y: number[] } | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
  const x: number[] = []
  const y: number[] = []
  for (const line of lines) {
    const parts = line.trim().split(/[\s,;]+/)
    if (parts.length < 2) continue
    const a = Number(parts[0])
    const b = Number(parts[1])
    if (Number.isFinite(a) && Number.isFinite(b)) {
      x.push(a)
      y.push(b)
    }
  }
  return x.length >= 3 ? { x, y } : null
}

let langJsonPromise: Promise<Extension> | null = null
function loadJsonLang(): Promise<Extension> {
  if (!langJsonPromise) {
    langJsonPromise = import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ jsx: false }),
    )
  }
  return langJsonPromise
}

let langHtmlPromise: Promise<Extension> | null = null
function loadHtmlLang(): Promise<Extension> {
  if (!langHtmlPromise) {
    langHtmlPromise = import('@codemirror/lang-html').then((m) => m.html())
  }
  return langHtmlPromise
}

export default function TextFileEditor({ relPath, kind }: Props) {
  const { text, status, error, dirty, setText, save } = useEditableText(relPath)
  const [showPlot, setShowPlot] = useState(false)
  const [lang, setLang] = useState<Extension | undefined>(undefined)

  const ext = useMemo(() => extensionOf(relPath.split('/').pop() ?? relPath), [relPath])

  useMemo(() => {
    if (kind === 'json') {
      loadJsonLang().then(setLang)
    } else if (ext === '.xrdml' || ext === '.xml') {
      loadHtmlLang().then(setLang)
    }
  }, [kind, ext])

  const numericData = useMemo(() => {
    if (!text || kind === 'json') return null
    return parseNumericColumns(text)
  }, [text, kind])

  if (status === 'loading' || text == null) {
    return <EditorLoading relPath={relPath} />
  }
  if (status === 'error') {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load file'}
      />
    )
  }

  if (isBinaryContent(text)) {
    return <BinaryFileView relPath={relPath} text={text} />
  }

  const handleSave = () => {
    void save()
  }

  const canPlot = numericData != null

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
        icon={FileText}
        actions={
          canPlot ? (
            <button
              type="button"
              onClick={() => setShowPlot((v) => !v)}
              title="Toggle quick plot"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                background: showPlot ? 'var(--accent, #0e7490)' : 'transparent',
                color: showPlot ? '#fff' : 'var(--color-text-muted)',
                fontSize: "var(--text-xs)",
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <LineChartIcon size={12} strokeWidth={1.8} />
              Plot
            </button>
          ) : null
        }
      />
      {showPlot && numericData ? (
        <EditorSplitPane
          storageKey="lattice.editor.text.plot.split"
          defaultLeftWidth={500}
          minLeftWidth={260}
          minRightWidth={260}
          label="Resize text editor and quick plot"
          left={
            <CodeMirrorEditor
              value={text}
              onChange={setText}
              onSave={handleSave}
              language={lang}
            />
          }
          right={<QuickPlot data={numericData} />}
        />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <CodeMirrorEditor
            value={text}
            onChange={setText}
            onSave={handleSave}
            language={lang}
          />
        </div>
      )}
    </div>
  )
}

function BinaryFileView({ relPath, text }: { relPath: string; text: string }) {
  const hexLines = useMemo(() => {
    const lines: string[] = []
    const limit = Math.min(text.length, 256)
    for (let i = 0; i < limit; i += 16) {
      const hex: string[] = []
      const ascii: string[] = []
      for (let j = 0; j < 16 && i + j < limit; j++) {
        const code = text.charCodeAt(i + j)
        hex.push(code.toString(16).padStart(2, '0'))
        ascii.push(code >= 32 && code < 127 ? text[i + j] : '.')
      }
      lines.push(
        `${i.toString(16).padStart(8, '0')}  ${hex.join(' ').padEnd(48)}  ${ascii.join('')}`,
      )
    }
    return lines
  }, [text])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        height: '100%',
        padding: 32,
        color: 'var(--color-text-muted)',
        fontSize: "var(--text-sm)",
      }}
    >
      <div style={{ fontSize: "var(--text-base)", color: 'var(--color-text-primary)' }}>
        Binary file — text preview not available
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: "var(--text-xs)",
          color: 'var(--color-text-muted)',
        }}
        title={relPath}
      >
        {relPath}
      </div>
      {hexLines.length > 0 && (
        <pre
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: "var(--text-xxs)",
            lineHeight: 1.6,
            background: 'var(--color-bg-panel)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: '10px 14px',
            overflow: 'auto',
            maxWidth: 640,
            maxHeight: 320,
            color: 'var(--color-text-muted)',
            margin: 0,
          }}
        >
          {hexLines.join('\n')}
        </pre>
      )}
    </div>
  )
}

function QuickPlot({ data }: { data: { x: number[]; y: number[] } }) {
  const [ReactECharts, setReactECharts] = useState<typeof import('echarts-for-react').default | null>(null)

  useMemo(() => {
    import('echarts-for-react').then((m) => setReactECharts(() => m.default))
  }, [])

  if (!ReactECharts) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-muted)',
          fontSize: "var(--text-sm)",
        }}
      >
        Loading chart…
      </div>
    )
  }

  const option = {
    animation: false,
    grid: { top: 24, right: 24, bottom: 40, left: 56 },
    xAxis: {
      type: 'value' as const,
      axisLabel: { fontSize: "var(--text-xxs)", color: '#999' },
      splitLine: { lineStyle: { color: '#2a2a2a' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { fontSize: "var(--text-xxs)", color: '#999' },
      splitLine: { lineStyle: { color: '#2a2a2a' } },
    },
    series: [
      {
        type: 'line' as const,
        data: data.x.map((x, i) => [x, data.y[i]]),
        showSymbol: data.x.length < 500,
        symbolSize: 3,
        lineStyle: { width: 1.5, color: '#0e7490' },
        itemStyle: { color: '#0e7490' },
      },
    ],
  }

  return (
    <div style={{ minHeight: 0, overflow: 'hidden' }}>
      <ReactECharts
        option={option}
        style={{ width: '100%', height: '100%' }}
        theme="dark"
        opts={{ renderer: 'canvas' }}
      />
    </div>
  )
}
