// Phase 3a · workspace_read_file preview card.
//
// Surfaces the file's contents with line numbers, a kind badge next to the
// path, and quick Copy / Download actions. Guards against malformed
// step.input / step.output shapes so a stray run from the LLM never crashes
// the AgentCard body — we fall back to a "malformed output" placeholder in
// that case.

import { useMemo, useState } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import { fileKindFromName } from '@/lib/workspace/file-kind'

// ─── Input / output shape narrowing ───────────────────────────────────

interface ReadFileInput {
  relPath: string
}

interface ReadFileOutput {
  content: string
  sizeBytes: number
}

function narrowInput(value: unknown): ReadFileInput | null {
  if (!value || typeof value !== 'object') return null
  const rel = (value as { relPath?: unknown }).relPath
  if (typeof rel !== 'string' || rel.length === 0) return null
  return { relPath: rel }
}

function narrowOutput(value: unknown): ReadFileOutput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { content?: unknown; sizeBytes?: unknown }
  if (typeof v.content !== 'string') return null
  const size =
    typeof v.sizeBytes === 'number' && Number.isFinite(v.sizeBytes)
      ? v.sizeBytes
      : // Fall back to a byte estimate when the tool omitted sizeBytes —
        // cheap, lets the footer chip stay informative.
        new Blob([v.content]).size
  return { content: v.content, sizeBytes: size }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KB`
  const mib = kib / 1024
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`
}

function basename(relPath: string): string {
  const segs = relPath.split('/')
  return segs[segs.length - 1] || relPath
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Rendering ────────────────────────────────────────────────────────

function LineNumberedPre({
  content,
  maxHeight,
}: {
  content: string
  maxHeight: number
}) {
  const lines = useMemo(() => content.split('\n'), [content])
  const gutterWidth = String(lines.length).length
  return (
    <pre
      className="agent-card-code-block workspace-read-file-pre"
      style={{
        maxHeight,
        overflow: 'auto',
        margin: 0,
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-xs)',
      }}
    >
      {lines.map((line, idx) => {
        const n = (idx + 1).toString().padStart(gutterWidth, ' ')
        return (
          <span key={idx} style={{ display: 'block' }}>
            <span
              style={{
                color: 'var(--color-text-muted)',
                userSelect: 'none',
                marginRight: 8,
              }}
            >
              {n}
            </span>
            {line || '\u00A0'}
          </span>
        )
      })}
    </pre>
  )
}

function PathHeader({ relPath }: { relPath: string }) {
  const name = basename(relPath)
  const kind = fileKindFromName(name)
  return (
    <div
      className="workspace-preview-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-primary)',
      }}
    >
      <span
        className="workspace-preview-kind-badge"
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: "var(--text-xxs)",
          padding: '1px 6px',
          borderRadius: 3,
          background: 'rgba(110, 168, 254, 0.12)',
          color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)',
          textTransform: 'lowercase',
        }}
      >
        {kind}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={relPath}
      >
        {relPath}
      </span>
    </div>
  )
}

function Footer({
  sizeBytes,
  content,
  filename,
}: {
  sizeBytes: number
  content: string
  filename: string
}) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard can fail under non-https contexts or when the document
      // is not focused. Silent fall-through matches how other cards treat
      // optional user actions.
    }
  }
  return (
    <div
      className="workspace-preview-footer"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 6,
        fontSize: 'var(--text-xs)',
      }}
    >
      <span
        className="workspace-preview-chip"
        style={{
          fontFamily: 'var(--font-sans)',
          color: 'var(--color-text-muted)',
          padding: '1px 6px',
          borderRadius: 3,
          border: '1px solid var(--color-border)',
        }}
      >
        {formatBytes(sizeBytes)}
      </span>
      <button
        type="button"
        className="agent-card-btn"
        onClick={handleCopy}
        style={{ fontSize: 'var(--text-xs)' }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        className="agent-card-btn"
        onClick={() => downloadText(filename, content)}
        style={{ fontSize: 'var(--text-xs)' }}
      >
        Download
      </button>
    </div>
  )
}

function Malformed() {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        fontStyle: 'italic',
      }}
    >
      malformed output
    </div>
  )
}

// ─── Resolver ─────────────────────────────────────────────────────────

export const WorkspaceReadFilePreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  if (!output) {
    if (!input) return { oneLiner: 'workspace_read_file' }
    return {
      oneLiner: `workspace_read_file · ${basename(input.relPath)}`,
      compact: <Malformed />,
    }
  }

  const relPath = input?.relPath ?? '(unknown)'
  const filename = basename(relPath)
  const sizeLabel = formatBytes(output.sizeBytes)
  const fname = filename.endsWith('.txt') ? filename : `${filename || 'file'}.txt`

  return {
    oneLiner: `${filename} · ${sizeLabel}`,
    compact: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <PathHeader relPath={relPath} />
        <LineNumberedPre content={output.content} maxHeight={160} />
        <Footer
          sizeBytes={output.sizeBytes}
          content={output.content}
          filename={fname}
        />
      </div>
    ),
    expanded: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <PathHeader relPath={relPath} />
        <LineNumberedPre content={output.content} maxHeight={400} />
        <Footer
          sizeBytes={output.sizeBytes}
          content={output.content}
          filename={fname}
        />
      </div>
    ),
  }
}
