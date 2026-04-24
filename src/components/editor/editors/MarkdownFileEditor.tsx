import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText } from 'lucide-react'
import { markdown } from '@codemirror/lang-markdown'
import { useEditableText } from './useEditableText'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import EditorToolbar from './EditorToolbar'
import CodeMirrorEditor from './CodeMirrorEditor'
import EditorSplitPane from './EditorSplitPane'

interface Props {
  relPath: string
}

const lang = markdown()

export default function MarkdownFileEditor({ relPath }: Props) {
  const { text, status, error, dirty, setText, save } = useEditableText(relPath)

  if (status === 'loading' || text == null) {
    return <EditorLoading relPath={relPath} />
  }
  if (status === 'error') {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load markdown file'}
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
        icon={FileText}
      />
      <EditorSplitPane
        storageKey="lattice.editor.markdown.split"
        defaultLeftWidth={520}
        minLeftWidth={260}
        minRightWidth={260}
        label="Resize markdown editor and preview"
        left={
          <CodeMirrorEditor
            value={text}
            onChange={setText}
            onSave={handleSave}
            language={lang}
          />
        }
        right={
          <div
            style={{
              minHeight: 0,
              height: '100%',
              overflow: 'auto',
              padding: '14px 18px',
            }}
          >
            <div className="markdown-editor-preview">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
            <style>{PREVIEW_STYLE}</style>
          </div>
        }
      />
    </div>
  )
}

const PREVIEW_STYLE = `
.markdown-editor-preview {
  font-size: var(--text-base);
  font-family: var(--font-sans);
  line-height: 1.6;
  color: var(--color-text-primary);
  word-break: break-word;
}
.markdown-editor-preview p { margin: 6px 0; }
.markdown-editor-preview ul, .markdown-editor-preview ol { padding-left: 22px; margin: 6px 0; }
.markdown-editor-preview li { margin: 3px 0; }
.markdown-editor-preview code { background: rgba(0, 0, 0, 0.25); font-family: var(--font-mono); font-size: var(--text-sm); padding: 1px 5px; border-radius: 3px; }
.markdown-editor-preview pre { background: rgba(0, 0, 0, 0.25); padding: 10px 12px; border-radius: 4px; overflow-x: auto; margin: 8px 0; border: 1px solid var(--color-border); }
.markdown-editor-preview pre code { background: transparent; padding: 0; font-size: var(--text-sm); }
.markdown-editor-preview blockquote { border-left: 3px solid var(--color-border); padding-left: 10px; color: var(--color-text-muted); margin: 8px 0; }
.markdown-editor-preview a { color: var(--color-text-primary); text-decoration: underline; text-underline-offset: 2px; }
.markdown-editor-preview a:hover { color: var(--color-text-emphasis); }
.markdown-editor-preview table { border-collapse: collapse; margin: 8px 0; font-size: var(--text-sm); }
.markdown-editor-preview th, .markdown-editor-preview td { border: 1px solid var(--color-border); padding: 5px 9px; text-align: left; }
.markdown-editor-preview th { background: rgba(0, 0, 0, 0.25); font-weight: 600; }
.markdown-editor-preview h1, .markdown-editor-preview h2, .markdown-editor-preview h3, .markdown-editor-preview h4 { margin: 12px 0 6px 0; }
.markdown-editor-preview h1 { font-size: var(--text-xl); }
.markdown-editor-preview h2 { font-size: var(--text-lg); }
.markdown-editor-preview h3 { font-size: var(--text-md); }
.markdown-editor-preview hr { border: none; border-top: 1px solid var(--color-border); margin: 12px 0; }
`
