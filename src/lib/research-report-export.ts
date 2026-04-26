import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { RefObject } from 'react'
import {
  buildCitationIndexByFirstUse,
  buildFullMarkdown,
  slugify,
} from '@/components/canvas/artifacts/research-report/helpers'
import type { ResearchReportPayload } from '@/components/canvas/artifacts/research-report/types'
import { downloadTextFile } from '@/lib/pro-export'

export type ResearchPdfPageSize = 'A4' | 'Letter'

export type ResearchPdfExportResult =
  | {
      ok: true
      pageSize: ResearchPdfPageSize
      filePath: string | null
      viaPrintDialog: boolean
    }
  | { ok: false; canceled?: boolean; error: string }

export function researchReportBaseName(
  payload: ResearchReportPayload | null | undefined,
): string {
  const raw = slugify(payload?.topic ?? 'report').trim()
  return raw.length > 0 ? raw : 'report'
}

export function downloadResearchReportMarkdown(
  payload: ResearchReportPayload,
): string {
  const citationIndex = buildCitationIndexByFirstUse(payload)
  const filename = `${researchReportBaseName(payload)}.md`
  const md = buildFullMarkdown(payload, citationIndex)
  downloadTextFile(filename, md, 'text/markdown;charset=utf-8')
  return filename
}

export async function exportResearchReportPdf(args: {
  payload: ResearchReportPayload
  bodyScrollRef?: RefObject<HTMLDivElement | null>
  pageSize?: ResearchPdfPageSize
}): Promise<ResearchPdfExportResult> {
  const { payload, pageSize = 'Letter' } = args

  const directPdf =
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.researchExportPdf === 'function'

  const citationIndex = buildCitationIndexByFirstUse(payload)
  const md = buildFullMarkdown(payload, citationIndex)
  const html = markdownToHtml(md)
  const container = buildPrintContainer(html)

  document.body.appendChild(container)
  document.body.setAttribute('data-printing', 'research-report')
  container.setAttribute('data-print-scope', 'research-report')

  try {
    await waitForPrintLayout()

    if (directPdf) {
      const result = await window.electronAPI!.researchExportPdf({
        defaultFileName: `${researchReportBaseName(payload)}.pdf`,
        pageSize,
      })
      if (!result.ok) {
        if ('canceled' in result && result.canceled) {
          return { ok: false, canceled: true, error: 'Export canceled' }
        }
        return {
          ok: false,
          error:
            ('error' in result ? result.error : undefined) ??
            'Failed to export PDF',
        }
      }
      return {
        ok: true,
        filePath: result.filePath,
        pageSize: result.pageSize,
        viaPrintDialog: false,
      }
    }

    await printViaBrowser()
    return {
      ok: true,
      filePath: null,
      pageSize,
      viaPrintDialog: true,
    }
  } finally {
    document.body.removeAttribute('data-printing')
    container.remove()
  }
}

function markdownToHtml(md: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md),
  )
}

function buildPrintContainer(bodyHtml: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'research-print-root'
  el.innerHTML = `<style>${PRINT_CSS}</style>${bodyHtml}`
  return el
}

async function waitForPrintLayout(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (typeof document.fonts?.ready?.then === 'function') {
    try {
      await document.fonts.ready
    } catch {
      // Best-effort only.
    }
  }
}

function printViaBrowser(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const cleanup = () => {
      if (settled) return
      settled = true
      window.removeEventListener('afterprint', cleanup)
      resolve()
    }
    window.addEventListener('afterprint', cleanup)
    window.setTimeout(cleanup, 3000)
    window.print()
  })
}

const PRINT_CSS = /* css */ `
.research-print-root {
  font-family: Georgia, 'Times New Roman', 'Noto Serif SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif;
  font-size: 11pt;
  line-height: 1.65;
  color: #000;
  background: #fff;
}

.research-print-root h1 {
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 18pt;
  font-weight: 700;
  text-align: center;
  margin: 0 0 6pt;
  line-height: 1.3;
  letter-spacing: -0.01em;
}

.research-print-root h2 {
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 13pt;
  font-weight: 700;
  margin: 18pt 0 6pt;
  line-height: 1.35;
  page-break-after: avoid;
}

.research-print-root h3,
.research-print-root h4 {
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 11pt;
  font-weight: 700;
  margin: 14pt 0 4pt;
  line-height: 1.4;
  page-break-after: avoid;
}

.research-print-root p {
  margin: 6pt 0;
  text-align: justify;
  orphans: 3;
  widows: 3;
}

.research-print-root ul,
.research-print-root ol {
  margin: 6pt 0;
  padding-left: 20pt;
}

.research-print-root li {
  margin: 3pt 0;
}

.research-print-root blockquote {
  margin: 8pt 0 8pt 16pt;
  padding-left: 10pt;
  border-left: 2pt solid #999;
  color: #333;
}

.research-print-root table {
  border-collapse: collapse;
  width: 100%;
  margin: 10pt 0;
  font-size: 9.5pt;
  page-break-inside: avoid;
}

.research-print-root th,
.research-print-root td {
  border: 0.5pt solid #666;
  padding: 4pt 6pt;
  text-align: left;
}

.research-print-root th {
  font-weight: 700;
  background: #f0f0f0;
}

.research-print-root pre {
  background: #f5f5f5;
  border: 0.5pt solid #ccc;
  padding: 8pt;
  font-size: 8.5pt;
  overflow-x: auto;
  page-break-inside: avoid;
  margin: 8pt 0;
}

.research-print-root code {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 9pt;
}

.research-print-root pre code {
  font-size: 8.5pt;
}

.research-print-root a {
  color: #333;
  text-decoration: underline;
}

.research-print-root hr {
  border: none;
  border-top: 0.5pt solid #999;
  margin: 14pt 0;
}

/* Metadata line directly after the title */
.research-print-root h1 + p {
  text-align: center;
  font-size: 9pt;
  color: #555;
  font-style: italic;
  margin-bottom: 14pt;
  page-break-after: avoid;
}

/* References section — last h2 "References" */
.research-print-root p:last-of-type {
  orphans: 2;
  widows: 2;
}
`
