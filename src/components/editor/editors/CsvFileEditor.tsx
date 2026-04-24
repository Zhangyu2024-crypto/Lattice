import { useMemo, useState } from 'react'
import { Table2 } from 'lucide-react'
import { useEditableText } from './useEditableText'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import EditorToolbar from './EditorToolbar'
import CodeMirrorEditor from './CodeMirrorEditor'
import {
  detectDelimiter,
  findNumericColumns,
  parseCsv,
} from './csv-editor/helpers'
import DataTable from './csv-editor/DataTable'
import ChartView from './csv-editor/ChartView'
import ViewModeSwitch from './csv-editor/ViewModeSwitch'
import type { ViewMode } from './csv-editor/types'

interface Props {
  relPath: string
}

export default function CsvFileEditor({ relPath }: Props) {
  const { text, status, error, dirty, setText, save } = useEditableText(relPath)
  const [view, setView] = useState<ViewMode>('table')
  const [xCol, setXCol] = useState<number | null>(null)
  const [yCol, setYCol] = useState<number | null>(null)

  const ext = useMemo(() => {
    const name = relPath.split('/').pop() ?? relPath
    const dot = name.lastIndexOf('.')
    return dot >= 0 ? name.slice(dot).toLowerCase() : ''
  }, [relPath])

  const parsed = useMemo(() => {
    if (!text) return null
    const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
    const delimiter = ext === '.tsv' ? '\t' : detectDelimiter(firstLine)
    return parseCsv(text, delimiter)
  }, [text, ext])

  const numCols = useMemo(() => {
    if (!parsed) return []
    return findNumericColumns(parsed.headers, parsed.rows)
  }, [parsed])

  const effectiveX = xCol ?? numCols[0] ?? 0
  const effectiveY =
    yCol ?? numCols[1] ?? (numCols[0] !== undefined ? numCols[0] : 1)

  if (status === 'loading' || text == null) {
    return <EditorLoading relPath={relPath} />
  }
  if (status === 'error') {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load CSV file'}
      />
    )
  }

  const handleSave = () => {
    void save()
  }

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
        icon={Table2}
        actions={<ViewModeSwitch view={view} onChange={setView} />}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {view === 'raw' && (
          <CodeMirrorEditor
            value={text}
            onChange={setText}
            onSave={handleSave}
          />
        )}
        {view === 'table' && parsed && (
          <DataTable
            headers={parsed.headers}
            rows={parsed.rows}
            totalLines={parsed.totalLines}
            truncated={parsed.truncated}
          />
        )}
        {view === 'chart' && parsed && (
          <ChartView
            headers={parsed.headers}
            rows={parsed.rows}
            xCol={effectiveX}
            yCol={effectiveY}
            onXCol={setXCol}
            onYCol={setYCol}
          />
        )}
      </div>
    </div>
  )
}
