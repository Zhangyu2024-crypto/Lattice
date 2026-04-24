import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Image as ImageIcon,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'

interface Props {
  relPath: string
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function mimeFor(ext: string): string {
  switch (ext) {
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

export default function ImageFileEditor({ relPath }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const translateStart = useRef({ x: 0, y: 0 })

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    setSrc(null)
    setScale(1)
    setTranslate({ x: 0, y: 0 })

    const api = (window as unknown as { electronAPI?: Record<string, unknown> })
      .electronAPI as
      | {
          workspaceReadBinary?: (
            rel: string,
          ) => Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }>
          workspaceRead?: (
            rel: string,
          ) => Promise<{ ok: boolean; content?: string; error?: string }>
        }
      | undefined

    const ext = extensionOf(relPath.split('/').pop() ?? relPath)
    const isSvg = ext === '.svg'

    if (isSvg && api?.workspaceRead) {
      api.workspaceRead(relPath).then((res) => {
        if (cancelled) return
        if (!res.ok || !res.content) {
          setStatus('error')
          setError(res.error || 'Failed to read SVG')
          return
        }
        const blob = new Blob([res.content], { type: 'image/svg+xml' })
        setSrc(URL.createObjectURL(blob))
        setStatus('ready')
      }).catch((err) => {
        if (cancelled) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })
    } else if (api?.workspaceReadBinary) {
      api.workspaceReadBinary(relPath).then((res) => {
        if (cancelled) return
        if (!res.ok || !res.data) {
          setStatus('error')
          setError(res.error || 'Failed to read image')
          return
        }
        const mime = mimeFor(ext)
        const blob = new Blob([res.data], { type: mime })
        setSrc(URL.createObjectURL(blob))
        setStatus('ready')
      }).catch((err) => {
        if (cancelled) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })
    } else {
      setStatus('error')
      setError('Image preview requires the Electron shell (npm run electron:dev).')
    }

    return () => {
      cancelled = true
    }
  }, [relPath])

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src)
    }
  }, [src])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale((s) => Math.min(10, Math.max(0.1, s * (e.deltaY < 0 ? 1.1 : 0.9))))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    translateStart.current = { ...translate }
  }, [translate])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return
    setTranslate({
      x: translateStart.current.x + e.clientX - dragStart.current.x,
      y: translateStart.current.y + e.clientY - dragStart.current.y,
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    dragging.current = false
  }, [])

  const resetView = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  if (status === 'loading') return <EditorLoading relPath={relPath} />
  if (status === 'error') return <EditorError relPath={relPath} message={error ?? 'Unknown error'} />

  const basename = relPath.split('/').pop() ?? relPath
  const dimStr = dims ? `${dims.w} × ${dims.h}` : ''

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg-panel)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          borderBottom: '1px solid var(--color-border)',
          fontSize: "var(--text-sm)",
          color: 'var(--color-text-muted)',
          flexShrink: 0,
        }}
      >
        <ImageIcon size={14} strokeWidth={1.6} />
        <strong
          style={{
            color: 'var(--color-text-primary)',
            fontSize: "var(--text-base)",
            fontWeight: 600,
            maxWidth: 420,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={relPath}
        >
          {basename}
        </strong>
        {dimStr && (
          <span style={{ fontSize: "var(--text-xs)", color: 'var(--color-text-muted)' }}>
            {dimStr}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "var(--text-xs)", fontFamily: 'var(--font-mono)' }}>
          {Math.round(scale * 100)}%
        </span>
        <ToolBtn title="Zoom out" onClick={() => setScale((s) => Math.max(0.1, s * 0.8))}>
          <Minus size={12} strokeWidth={2} />
        </ToolBtn>
        <ToolBtn title="Zoom in" onClick={() => setScale((s) => Math.min(10, s * 1.25))}>
          <Plus size={12} strokeWidth={2} />
        </ToolBtn>
        <ToolBtn title="Reset view" onClick={resetView}>
          <RotateCcw size={12} strokeWidth={2} />
        </ToolBtn>
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          cursor: dragging.current ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'repeating-conic-gradient(var(--color-border) 0% 25%, transparent 0% 50%) 50% / 16px 16px',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {src && (
          <img
            src={src}
            alt={basename}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              setDims({ w: img.naturalWidth, h: img.naturalHeight })
            }}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              userSelect: 'none',
              transition: dragging.current ? 'none' : 'transform 0.1s ease-out',
            }}
          />
        )}
      </div>
    </div>
  )
}

function ToolBtn({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        border: '1px solid var(--color-border)',
        borderRadius: 3,
        background: 'transparent',
        color: 'var(--color-text-muted)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {children}
    </button>
  )
}
