import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { sectionHeader } from './styles'
import { guessPreviewMode } from './helpers'

export default function FilePreview({ relPath, dataType }: { relPath: string; dataType?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const readFile = useWorkspaceStore((s) => s.readFile)

  const mode = guessPreviewMode(relPath, dataType)

  useEffect(() => {
    setBlobUrl(null)
    setTextContent(null)
    setLoading(true)

    if (mode === 'image') {
      const api = (window as unknown as { electronAPI?: { workspaceReadBinary?: (r: string) => Promise<{ ok: boolean; data?: ArrayBuffer }> } }).electronAPI
      if (api?.workspaceReadBinary) {
        void api.workspaceReadBinary(relPath).then((res) => {
          if (res.ok && res.data) {
            const ext = relPath.split('.').pop()?.toLowerCase() ?? 'png'
            const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
            setBlobUrl(URL.createObjectURL(new Blob([res.data], { type: mime })))
          }
          setLoading(false)
        }).catch(() => setLoading(false))
      } else {
        setLoading(false)
      }
      return
    }

    if (mode === 'pdf') {
      setLoading(false)
      return
    }

    if (mode === 'text') {
      void readFile(relPath).then((content) => {
        if (typeof content === 'string') setTextContent(content.slice(0, 3000))
        setLoading(false)
      }).catch(() => setLoading(false))
      return
    }

    setLoading(false)
  }, [relPath, mode, readFile])

  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [blobUrl])

  const header = (
    <div style={{ ...sectionHeader, display: 'flex', alignItems: 'center', gap: 4 }}>
      <Eye size={11} />Preview
    </div>
  )

  if (loading) {
    return (
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        {header}
        <div style={{ fontSize: "var(--text-xs)", color: '#555' }}>Loading...</div>
      </div>
    )
  }

  if (mode === 'image' && blobUrl) {
    return (
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        {header}
        <img
          src={blobUrl}
          alt={relPath.split('/').pop() ?? ''}
          style={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 4, background: '#111', display: 'block' }}
        />
      </div>
    )
  }

  if (mode === 'pdf') {
    return (
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        {header}
        <button
          type="button"
          onClick={() => {
            const api = (window as unknown as { electronAPI?: { openPdfReaderWindow?: (r: string) => Promise<unknown> } }).electronAPI
            void api?.openPdfReaderWindow?.(relPath)
          }}
          style={{ background: '#2a2a2a', border: '1px solid #444', color: '#60a5fa', fontSize: "var(--text-sm)", padding: '8px 14px', borderRadius: 4, cursor: 'pointer', width: '100%' }}
        >
          Open PDF Reader
        </button>
      </div>
    )
  }

  if (textContent) {
    return (
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        {header}
        <pre style={{ fontSize: "var(--text-xxs)", color: '#aaa', background: '#1a1a1a', padding: 8, borderRadius: 4, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, lineHeight: 1.4 }}>
          {textContent}
        </pre>
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
      {header}
      <div style={{ fontSize: "var(--text-xs)", color: '#555', fontStyle: 'italic' }}>No preview available</div>
    </div>
  )
}
