import { FileCode } from 'lucide-react'
import { python } from '@codemirror/lang-python'
import { useEditableText } from './useEditableText'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import EditorToolbar from './EditorToolbar'
import CodeMirrorEditor from './CodeMirrorEditor'

interface Props {
  relPath: string
}

const lang = python()

export default function ScriptFileEditor({ relPath }: Props) {
  const { text, status, error, dirty, setText, save } = useEditableText(relPath)

  if (status === 'loading' || text == null) {
    return <EditorLoading relPath={relPath} />
  }
  if (status === 'error') {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load script file'}
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
        icon={FileCode}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <CodeMirrorEditor
          value={text}
          onChange={setText}
          onSave={handleSave}
          language={lang}
        />
      </div>
    </div>
  )
}
