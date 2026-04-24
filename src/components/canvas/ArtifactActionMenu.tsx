import { useEffect, useRef, useState } from 'react'
import {
  Bookmark,
  Code2,
  Copy,
  Download,
  Image as ImageIcon,
  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import type { Artifact } from '../../types/artifact'
import {
  isPeakFitArtifact,
  isSpectrumArtifact,
} from '../../types/artifact'
import { useRuntimeStore } from '../../stores/runtime-store'
import { toast } from '../../stores/toast-store'
import { useArtifactDbStore } from '../../stores/artifact-db-store'
import { isCodeTemplateSupported } from '../../lib/code-template'
import { openInCode } from '../../lib/open-in-code'
import { downloadBinary, downloadTextFile } from '../../lib/pro-export'
import { chartImageToPdf, dataUrlToBytes } from '../../lib/chart-pdf'

interface Props {
  artifact: Artifact
  sessionId: string
  isPinned: boolean
}

export default function ArtifactActionMenu({ artifact, sessionId, isPinned }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const togglePin = useRuntimeStore((s) => s.togglePinArtifact)
  const duplicate = useRuntimeStore((s) => s.duplicateArtifact)
  const remove = useRuntimeStore((s) => s.removeArtifact)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const close = () => setOpen(false)

  const handlePin = () => {
    togglePin(sessionId, artifact.id)
    toast.info(isPinned ? 'Artifact unpinned' : 'Artifact pinned')
    close()
  }

  const handleDuplicate = () => {
    const newId = duplicate(sessionId, artifact.id)
    if (newId) toast.success(`Duplicated "${artifact.title}"`)
    close()
  }

  const handleOpenInCode = () => {
    openInCode(sessionId, artifact)
    close()
  }

  const codeSupported = isCodeTemplateSupported(artifact.kind)

  const handleExportJson = () => {
    downloadTextFile(
      `${safeName(artifact.title)}.json`,
      JSON.stringify(artifact, null, 2),
      'application/json',
    )
    toast.success('Exported as JSON')
    close()
  }

  const handleExportCsv = () => {
    const csv = toCsv(artifact)
    if (csv === null) {
      toast.warn('CSV export only supported for spectrum / peak-fit')
      close()
      return
    }
    downloadTextFile(`${safeName(artifact.title)}.csv`, csv, 'text/csv')
    toast.success('Exported as CSV')
    close()
  }

  const exportCanvasImage = (format: 'png' | 'jpeg' | 'pdf') => {
    const container = document.querySelector(
      '[data-artifact-body="true"]',
    ) as HTMLElement | null
    const canvas = container?.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) {
      toast.warn('Image export not available for this artifact kind')
      close()
      return
    }
    try {
      const name = safeName(artifact.title)
      if (format === 'pdf') {
        const url = canvas.toDataURL('image/jpeg', 0.92)
        const jpegBytes = dataUrlToBytes(url)
        const blob = chartImageToPdf(
          jpegBytes,
          canvas.width,
          canvas.height,
          canvas.width / 2,
          canvas.height / 2,
        )
        downloadBinary(`${name}.pdf`, blob)
      } else {
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
        const ext = format === 'jpeg' ? '.jpg' : '.png'
        const url = canvas.toDataURL(mime, 0.92)
        const a = document.createElement('a')
        a.href = url
        a.download = `${name}${ext}`
        a.click()
      }
      toast.success(`Exported as ${format.toUpperCase()}`)
    } catch (err) {
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : 'unknown'}`,
      )
    }
    close()
  }

  const handleBookmarkToDb = () => {
    const session = useRuntimeStore.getState().sessions[sessionId]
    void useArtifactDbStore
      .getState()
      .bookmarkArtifact(artifact, sessionId, session?.title ?? '')
      .then(() => toast.success('Bookmarked to database'))
      .catch(() => toast.error('Failed to bookmark'))
    close()
  }

  const handleDelete = () => {
    remove(sessionId, artifact.id)
    toast.info(`Deleted "${artifact.title}"`)
    close()
  }

  return (
    <div ref={ref} className="artifact-action-menu">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Artifact actions"
        className="artifact-action-menu-trigger"
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div className="artifact-action-menu-list">
          <MenuItem onClick={handlePin} icon={isPinned ? PinOff : Pin}>
            {isPinned ? 'Unpin' : 'Pin'}
          </MenuItem>
          <MenuItem onClick={handleDuplicate} icon={Copy}>
            Duplicate
          </MenuItem>
          <MenuItem onClick={handleBookmarkToDb} icon={Bookmark}>
            Bookmark to DB
          </MenuItem>
          <MenuItem
            onClick={handleOpenInCode}
            icon={Code2}
            disabled={!codeSupported}
            title={
              codeSupported
                ? 'Spawn a linked Compute artifact with this artifact\'s data pre-loaded'
                : 'No code template for this artifact kind'
            }
          >
            Open in Code
          </MenuItem>
          <MenuDivider />
          <MenuItem onClick={handleExportJson} icon={Download}>
            Export as JSON
          </MenuItem>
          <MenuItem onClick={handleExportCsv} icon={Download}>
            Export as CSV
          </MenuItem>
          <MenuItem onClick={() => exportCanvasImage('png')} icon={ImageIcon}>
            Export as PNG
          </MenuItem>
          <MenuItem onClick={() => exportCanvasImage('jpeg')} icon={ImageIcon}>
            Export as JPG
          </MenuItem>
          <MenuItem onClick={() => exportCanvasImage('pdf')} icon={ImageIcon}>
            Export as PDF
          </MenuItem>
          <MenuDivider />
          <MenuItem onClick={handleDelete} icon={Trash2} danger>
            Delete
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  icon: Icon,
  danger,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  icon: React.ComponentType<{ size?: number }>
  danger?: boolean
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  const classes = [
    'artifact-action-menu-item',
    danger ? 'is-danger' : '',
    disabled ? 'is-disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={classes}
    >
      <Icon size={12} />
      {children}
    </button>
  )
}

function MenuDivider() {
  return <div className="artifact-action-menu-divider" />
}

function safeName(s: string): string {
  return s.replace(/[^\w\-]+/g, '_')
}

function toCsv(artifact: Artifact): string | null {
  if (isSpectrumArtifact(artifact)) {
    const { x, y, xLabel, yLabel } = artifact.payload
    const header = `${csvCell(xLabel)},${csvCell(yLabel)}\n`
    const rows = x
      .map((xi, i) => `${xi},${y[i] ?? ''}`)
      .join('\n')
    return header + rows
  }
  if (isPeakFitArtifact(artifact)) {
    const header = 'index,position,intensity,fwhm,area,snr,label\n'
    const rows = artifact.payload.peaks
      .map(
        (p) =>
          `${p.index},${p.position},${p.intensity},${p.fwhm ?? ''},${
            p.area ?? ''
          },${p.snr ?? ''},${csvCell(p.label)}`,
      )
      .join('\n')
    return header + rows
  }
  return null
}

function csvCell(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

