import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useEditorStore } from '@/stores/editor-store'

export type EditableTextStatus = 'loading' | 'ready' | 'error'

export interface EditableTextState {
  text: string | null
  status: EditableTextStatus
  error: string | null
  dirty: boolean
  setText: (next: string) => void
  save: () => Promise<void>
  reload: () => Promise<void>
}

/**
 * Load / edit / save a plain-text workspace file under a single relPath.
 *
 * Reads go through `workspaceStore.readFile`; writes go through
 * `workspaceStore.writeFile` (which refreshes the parent directory index).
 * The dirty flag is mirrored into `editorStore.openFiles[relPath].dirty` so
 * tabs and the global Ctrl+S dispatcher can observe unsaved state without
 * coupling to any particular editor component.
 *
 * A `save` closure is published into `editorStore.savers` for the lifetime
 * of the hook, giving `EditorArea`'s keyboard handler a stable entry point
 * regardless of which concrete editor is mounted.
 */
export function useEditableText(relPath: string): EditableTextState {
  const readFile = useWorkspaceStore((s) => s.readFile)
  const writeFile = useWorkspaceStore((s) => s.writeFile)
  const markDirty = useEditorStore((s) => s.markDirty)
  const registerSaver = useEditorStore((s) => s.registerSaver)
  const unregisterSaver = useEditorStore((s) => s.unregisterSaver)

  const [text, setTextState] = useState<string | null>(null)
  const [status, setStatus] = useState<EditableTextStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // Mutable refs keep the save closure stable so the registry slot points
  // at one function for the hook's lifetime — otherwise each keystroke
  // would replace the registered saver and race the Ctrl+S handler.
  const textRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const cancelledRef = useRef(false)
  // Guards against double-dispatch between CodeMirror's Mod-s binding and
  // the window-level Ctrl+S fallback in EditorArea: both fire for a single
  // key press while the first writeFile is still awaiting.
  const savingRef = useRef(false)
  // Holds the latest save implementation so the registered trampoline can
  // forward to the up-to-date closure without re-registering on every render.
  const saveImplRef = useRef<() => Promise<void>>(async () => {})

  textRef.current = text
  dirtyRef.current = dirty

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const content = await readFile(relPath)
      if (cancelledRef.current) return
      if (content == null) {
        setTextState('')
        textRef.current = ''
        setStatus('error')
        setError('File not found or empty')
        return
      }
      setTextState(content)
      textRef.current = content
      setStatus('ready')
      setDirty(false)
      dirtyRef.current = false
      markDirty(relPath, false)
    } catch (err) {
      if (cancelledRef.current) return
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [readFile, relPath, markDirty])

  useEffect(() => {
    cancelledRef.current = false
    void load()
    return () => {
      cancelledRef.current = true
    }
  }, [load])

  const setText = useCallback(
    (next: string) => {
      setTextState(next)
      textRef.current = next
      if (!dirtyRef.current) {
        setDirty(true)
        dirtyRef.current = true
        markDirty(relPath, true)
      }
    },
    [markDirty, relPath],
  )

  const save = useCallback(async () => {
    const current = textRef.current
    if (current == null) return
    if (!dirtyRef.current) return
    if (savingRef.current) return
    savingRef.current = true
    try {
      await writeFile(relPath, current)
      setDirty(false)
      dirtyRef.current = false
      markDirty(relPath, false)
    } finally {
      savingRef.current = false
    }
  }, [markDirty, relPath, writeFile])

  saveImplRef.current = save

  // Register a stable trampoline keyed only on relPath. The registry slot
  // keeps pointing at one function for the lifetime of an open file, while
  // `saveImplRef` is refreshed on every render so the trampoline always
  // invokes the latest closure. This eliminates the unregister → re-register
  // window where a concurrent Ctrl+S used to be dropped on the floor.
  useEffect(() => {
    const trampoline = () => saveImplRef.current()
    registerSaver(relPath, trampoline)
    return () => {
      unregisterSaver(relPath, trampoline)
    }
  }, [relPath, registerSaver, unregisterSaver])

  const reload = useCallback(async () => {
    await load()
  }, [load])

  return { text, status, error, dirty, setText, save, reload }
}
