import { useState, useEffect, useRef } from 'react'
import { Upload } from 'lucide-react'

interface DroppedFile {
  name: string
  path: string
}

interface Props {
  onFileDrop: (path: string) => void
  /** Optional hook to inspect the dropped file before the default handler fires.
   *  Return `true` to indicate the caller has handled the drop and the default
   *  `onFileDrop` should NOT be called. */
  onIntercept?: (file: DroppedFile) => boolean
}

export default function DragOverlay({ onFileDrop, onIntercept }: Props) {
  const [dragging, setDragging] = useState(false)
  // Keep latest handlers in a ref so the document listeners (bound once)
  // always call the current callbacks without re-binding and losing dragCount.
  const handlersRef = useRef({ onFileDrop, onIntercept })
  handlersRef.current = { onFileDrop, onIntercept }

  useEffect(() => {
    let dragCount = 0

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      dragCount++
      if (e.dataTransfer?.types.includes('Files')) {
        setDragging(true)
      }
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      dragCount--
      if (dragCount === 0) setDragging(false)
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      dragCount = 0
      setDragging(false)

      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        // In Electron, file.path gives the full path
        const file = files[0] as unknown as { path?: string; name: string }
        const filePath = file.path || file.name
        const { onFileDrop: fd, onIntercept: intercept } = handlersRef.current
        const handled = intercept?.({ name: file.name, path: filePath })
        if (!handled) fd(filePath)
      }
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])

  if (!dragging) return null

  return (
    <div className="drag-overlay-backdrop">
      <div className="drag-overlay-card">
        <Upload size={48} className="drag-overlay-icon" />
        <div className="drag-overlay-title">Drop spectrum file to open</div>
        <div className="drag-overlay-hint">
          Supports XRD, Raman, XPS, UV-Vis, and 15+ formats
        </div>
      </div>
    </div>
  )
}
