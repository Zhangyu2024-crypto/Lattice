// Preview resolver for `plot_spectrum` / `compare_spectra`.
//
// The tools write the rendered PNG/SVG to the workspace and return just
// the path + metadata. Without a preview, the card would only show the
// JSON summary — the user has to go find the file to see what was
// generated. This resolver reads the file back through the workspace
// IPC, converts PNG bytes to a data URL (or SVG text to `data:image/svg+xml`),
// and renders the image inline so the user sees the result immediately.
//
// The fetch is lazy (per-card `useEffect`) and the data URL is cached
// on the component, so the IPC round-trip happens once per card mount.

import { useEffect, useState } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import type { TaskStep } from '../../../../types/session'

interface PlotOutput {
  /** v2 shape: the tool now produces a PlotArtifact on the canvas and
   *  returns its id. `outputRelPath` / `bytes` are only present when
   *  the caller also asked for a PNG side-write (LaTeX use case). */
  artifactId?: string
  mode?: string
  files?: string[]
  outputRelPath?: string
  format?: 'png' | 'svg'
  bytes?: number
  width?: number
  height?: number
  points?: number
  summary?: string
}

function narrow(value: unknown): PlotOutput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as PlotOutput
  // Either path — on-canvas artifact OR workspace PNG — counts as a
  // valid plot result worth previewing.
  if (
    (typeof v.artifactId !== 'string' || v.artifactId.length === 0) &&
    (typeof v.outputRelPath !== 'string' || v.outputRelPath.length === 0)
  ) {
    return null
  }
  return v
}

function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KB`
  const mib = kib / 1024
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`
}

function basename(relPath: string): string {
  const segs = relPath.split(/[\\/]/)
  return segs[segs.length - 1] || relPath
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // Avoid pulling Buffer / atob quirks: encode in chunks so we don't
  // stringify a 195KB array in one shot (Chromium chokes on very long
  // argument lists to String.fromCharCode).
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)),
    )
  }
  return btoa(binary)
}

interface RootFsBinOk {
  ok: true
  data: ArrayBuffer
}
interface RootFsTextOk {
  ok: true
  content: string
}
interface RootFsErr {
  ok: false
  error: string
}

interface ElectronWorkspaceApi {
  workspaceReadBinary: (rel: string) => Promise<RootFsBinOk | RootFsErr>
  workspaceRead: (rel: string) => Promise<RootFsTextOk | RootFsErr>
}

function tryApi(): ElectronWorkspaceApi | null {
  const api = (window as unknown as { electronAPI?: unknown }).electronAPI
  if (!api) return null
  const a = api as Record<string, unknown>
  if (
    typeof a.workspaceReadBinary !== 'function' ||
    typeof a.workspaceRead !== 'function'
  ) {
    return null
  }
  return api as unknown as ElectronWorkspaceApi
}

async function loadPreviewSrc(
  relPath: string,
  format: 'png' | 'svg',
): Promise<string> {
  const api = tryApi()
  if (!api) {
    throw new Error('Electron workspace IPC unavailable — open in your file browser.')
  }
  if (format === 'png') {
    const res = await api.workspaceReadBinary(relPath)
    if (!res.ok) throw new Error(res.error)
    return `data:image/png;base64,${arrayBufferToBase64(res.data)}`
  }
  const res = await api.workspaceRead(relPath)
  if (!res.ok) throw new Error(res.error)
  return `data:image/svg+xml;utf8,${encodeURIComponent(res.content)}`
}

function InlineImage({
  relPath,
  format,
  width,
  height,
  maxHeight,
}: {
  relPath: string
  format: 'png' | 'svg'
  width?: number
  height?: number
  maxHeight: number
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setError(null)
    loadPreviewSrc(relPath, format)
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [relPath, format])

  if (error) {
    return (
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          fontStyle: 'italic',
          padding: '6px 0',
        }}
      >
        Could not load preview: {error}
      </div>
    )
  }
  if (!src) {
    return (
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          padding: '6px 0',
        }}
      >
        Loading preview…
      </div>
    )
  }

  const aspect = width && height && height > 0 ? width / height : 16 / 9
  return (
    <div
      style={{
        width: '100%',
        maxHeight,
        aspectRatio: aspect,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FFFFFF',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <img
        src={src}
        alt={basename(relPath)}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'block',
          objectFit: 'contain',
        }}
      />
    </div>
  )
}

function MetaRow({
  relPath,
  bytes,
  width,
  height,
  format,
  points,
}: {
  relPath: string
  bytes?: number
  width?: number
  height?: number
  format?: 'png' | 'svg'
  points?: number
}) {
  const chips: Array<{ k: string; v: string }> = []
  chips.push({ k: 'path', v: relPath })
  if (format) chips.push({ k: 'fmt', v: format.toUpperCase() })
  if (width && height) chips.push({ k: 'dim', v: `${width}×${height}` })
  if (points) chips.push({ k: 'pts', v: points.toLocaleString() })
  if (bytes != null) chips.push({ k: 'size', v: formatBytes(bytes) })

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-xxs)',
        color: 'var(--color-text-muted)',
      }}
    >
      {chips.map((c, i) => (
        <span
          key={`${c.k}-${i}`}
          style={{
            padding: '1px 6px',
            borderRadius: 3,
            border: '1px solid var(--color-border)',
          }}
          title={c.v}
        >
          <span style={{ opacity: 0.6 }}>{c.k}</span>{' '}
          <span style={{ color: 'var(--color-text-primary)' }}>{c.v}</span>
        </span>
      ))}
    </div>
  )
}

export const PlotSpectrumPreview: ToolPreviewResolver = (step: TaskStep) => {
  const out = narrow(step.output)
  if (!out) {
    return { oneLiner: 'plot_spectrum' }
  }

  // v2 primary path: plot artifact on the canvas. One-liner says so; the
  // user should glance at the canvas (already focused by the tool) and
  // tweak from there. If a side-PNG was also written we surface that in
  // the compact / expanded slots with the legacy inline image flow.
  const canvasHint = out.artifactId
    ? `on canvas${out.mode ? ` · ${out.mode}` : ''}${out.points ? ` · ${out.points} pts` : ''}`
    : null
  const fileHint = out.outputRelPath
    ? `${basename(out.outputRelPath)} · ${(out.format ?? 'png').toUpperCase()}${
        out.width && out.height ? ` · ${out.width}×${out.height}` : ''
      } · ${formatBytes(out.bytes)}`
    : null
  const oneLiner =
    [canvasHint, fileHint].filter(Boolean).join(' · ') || 'plotted'

  // If the tool wrote a workspace file, reuse the original inline image
  // preview. Otherwise show a compact chip explaining the artifact
  // landed on the canvas — the actual interactive view lives there.
  if (out.outputRelPath) {
    const relPath = out.outputRelPath
    const fmt: 'png' | 'svg' = out.format === 'svg' ? 'svg' : 'png'
    return {
      oneLiner,
      compact: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <InlineImage
            relPath={relPath}
            format={fmt}
            width={out.width}
            height={out.height}
            maxHeight={240}
          />
          <MetaRow
            relPath={relPath}
            bytes={out.bytes}
            width={out.width}
            height={out.height}
            format={fmt}
            points={out.points}
          />
          {out.artifactId && (
            <div
              style={{
                fontSize: 'var(--text-xxs)',
                color: 'var(--color-text-muted)',
              }}
            >
              Tune title / log-Y / peaks from the plot artifact on the canvas.
            </div>
          )}
        </div>
      ),
      expanded: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <InlineImage
            relPath={relPath}
            format={fmt}
            width={out.width}
            height={out.height}
            maxHeight={520}
          />
          <MetaRow
            relPath={relPath}
            bytes={out.bytes}
            width={out.width}
            height={out.height}
            format={fmt}
            points={out.points}
          />
        </div>
      ),
    }
  }

  // Artifact-only path — no PNG was written. Show a short hint; the
  // canvas already rendered the interactive version.
  return {
    oneLiner,
    compact: (
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.45,
        }}
      >
        Opened on the canvas as an interactive plot. Tweak title, log-Y,
        peaks, and journal style from the right-side drawer; use Export
        PNG on the card header for a static image.
      </div>
    ),
  }
}
