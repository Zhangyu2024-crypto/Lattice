// Extract plain text from a PDF loaded via pdfjs-dist. Used by the paper
// AI Ask feature to feed the full document into the LLM context window
// without depending on the Python worker (which runs TF-IDF retrieval but
// is absent in self-contained mode).
//
// For a typical 20-page paper this produces ~15-30 K characters — well
// within modern LLM context limits (100 K+ tokens). A per-page cache
// avoids re-extracting on every question; callers can pass an already-
// loaded PDFDocumentProxy or raw bytes/URL.

import {
  GlobalWorkerOptions,
  getDocument,
} from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type {
  PDFDocumentProxy,
} from 'pdfjs-dist/types/src/display/api'
import { POLYFILL_SOURCE } from './polyfills/uint8array-tohex'

let workerReady = false

function ensureWorker(): void {
  if (workerReady) return
  const resolved = new URL(pdfWorkerUrl, window.location.href).href
  const source = `${POLYFILL_SOURCE}\nimport ${JSON.stringify(resolved)};\n`
  const blobUrl = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' }),
  )
  if (GlobalWorkerOptions.workerSrc !== blobUrl) {
    GlobalWorkerOptions.workerSrc = blobUrl
  }
  workerReady = true
}

/** Extract all text from a PDF, returning one string per page joined by
 *  `\n\n--- Page N ---\n\n` delimiters so the LLM can reference pages. */
export async function extractFullText(
  source: { data: Uint8Array } | { url: string },
): Promise<{ text: string; pageCount: number }> {
  ensureWorker()
  const loadArg = 'data' in source
    ? { data: source.data.slice(0) }
    : { url: source.url }
  const pdf: PDFDocumentProxy = await getDocument(loadArg).promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const text = content.items
        .filter((item): item is typeof item & { str: string } => 'str' in item && typeof (item as Record<string, unknown>).str === 'string')
        .map((item) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      pages.push(`--- Page ${i} ---\n${text}`)
      page.cleanup()
    }
    return { text: pages.join('\n\n'), pageCount: pdf.numPages }
  } finally {
    await pdf.destroy()
  }
}
