import { useMemo, useState } from 'react'
import { FileType } from 'lucide-react'
import type { Extension } from '@codemirror/state'
import { useEditableText } from './useEditableText'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import EditorToolbar from './EditorToolbar'
import CodeMirrorEditor from './CodeMirrorEditor'

interface Props {
  relPath: string
}

let langPromise: Promise<Extension> | null = null
function loadLatexLang(): Promise<Extension> {
  if (!langPromise) {
    langPromise = import('codemirror-lang-latex').then((m) => m.latex())
  }
  return langPromise
}

export default function TexFileEditor({ relPath }: Props) {
  const { text, status, error, dirty, setText, save } = useEditableText(relPath)
  const [lang, setLang] = useState<Extension | undefined>(undefined)

  useMemo(() => {
    loadLatexLang().then(setLang)
  }, [])

  if (status === 'loading' || text == null) {
    return <EditorLoading relPath={relPath} />
  }
  if (status === 'error') {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load TeX file'}
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
        icon={FileType}
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
