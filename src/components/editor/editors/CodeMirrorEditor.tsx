import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'

interface Props {
  value: string
  onChange?: (next: string) => void
  onSave?: () => void
  language?: Extension
  readOnly?: boolean
}

export default function CodeMirrorEditor({
  value,
  onChange,
  onSave,
  language,
  readOnly,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const extensions: Extension[] = [
      lineNumbers(),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRef.current?.()
            return true
          },
        },
        ...defaultKeymap,
        indentWithTab,
      ]),
      oneDark,
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { height: '100%', fontSize: 'var(--text-base)' },
        '.cm-scroller': {
          fontFamily: 'var(--font-mono)',
        },
      }),
    ]
    if (language) extensions.push(language)
    if (!readOnly && onChange) {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString())
          }
        }),
      )
    }
    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true))
    }
    const state = EditorState.create({ doc: value, extensions })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  return (
    <div
      ref={hostRef}
      style={{ height: '100%', width: '100%', overflow: 'hidden' }}
    />
  )
}
