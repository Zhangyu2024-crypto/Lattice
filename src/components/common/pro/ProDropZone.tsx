import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  icon?: ReactNode
  label: string
  hint?: string
}

export default function ProDropZone({
  onFiles,
  accept,
  multiple = true,
  icon,
  label,
  hint,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return
    const arr: File[] = []
    for (let i = 0; i < list.length; i++) {
      const f = list.item(i)
      if (f) arr.push(f)
    }
    if (arr.length > 0) onFiles(arr)
  }

  return (
    <div
      className={'pro-dropzone-zone' + (dragOver ? ' is-drag' : '')}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer?.files ?? null)
      }}
    >
      {icon && <div className="pro-dropzone-icon">{icon}</div>}
      <div className="pro-dropzone-label">{label}</div>
      {hint && <div className="pro-dropzone-hint">{hint}</div>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="pro-dropzone-input"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  )
}
