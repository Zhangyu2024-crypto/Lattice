// DOI lookup, bibliographic import (BibTeX / RIS), BibTeX export, disk
// scans, and single-PDF uploads. These methods historically lived in the
// backend REST API; they are implemented here as a combination of
// worker calls (`callWorker`) for network lookups and IPC wrappers for
// local file handling.

import { callWorker } from '../worker-client'
import { entryToPaperDraft, parseBibTeX } from '../bibtex-parser'
import { writeBibTeX } from '../bibtex-writer'
import { parseRIS, recordToPaperDraft } from '../ris-parser'
import type {
  AddByDoiRequest,
  AddByDoiResponse,
  ImportBibtexResponse,
  ImportRisResponse,
  ScanDirectoryRequest,
  ScanDirectoryResponse,
  UploadPdfRequest,
  UploadPdfResponse,
} from '../../types/library-api'
import { electron, IPC_UNAVAILABLE } from './helpers'
import { listPapers } from './papers'

export async function addPaperByDoi(
  req: AddByDoiRequest,
): Promise<AddByDoiResponse> {
  const doi = req?.doi?.trim()
  if (!doi) {
    return { success: false, error: 'doi is required' }
  }
  // Resolve metadata via the Python worker (Crossref) FIRST. We
  // intentionally don't write a placeholder row when the lookup
  // fails — the user expects "DOI import" to either land a fully-
  // populated paper or fail loudly without polluting the library.
  // Manual entry stays available via the regular Add Paper path.
  // library.fetch_doi now returns a `{success: true | false}` dict
  // rather than raising on failure (worker hardening pass). Both the
  // transport-level `lookup.ok` AND the tool-level `metadata.success`
  // have to be checked — otherwise a Crossref 404 / bad DOI silently
  // creates a paper with the placeholder title `DOI: <doi>`.
  const lookup = await callWorker<
    | {
        success: true
        doi: string
        title: string
        authors: string
        year: string
        journal?: string | null
        url?: string | null
        abstract?: string | null
      }
    | { success: false; error: string }
  >('library.fetch_doi', { doi }, { timeoutMs: 15_000 })

  if (!lookup.ok) {
    return {
      success: false,
      error: `DOI lookup failed: ${lookup.error}`,
    }
  }

  const metadata = lookup.value
  if (metadata.success === false) {
    return {
      success: false,
      error: `DOI lookup failed: ${metadata.error}`,
    }
  }
  const adder = electron()?.libraryAddPaper
  if (!adder) {
    return { success: false, error: IPC_UNAVAILABLE }
  }
  const stored = await adder({
    title: metadata.title?.trim() || `DOI: ${doi}`,
    authors: metadata.authors?.trim() || 'Unknown',
    year: metadata.year ?? '',
    doi: metadata.doi ?? doi,
    url: metadata.url ?? `https://doi.org/${doi}`,
    journal: metadata.journal ?? undefined,
    abstract: metadata.abstract ?? undefined,
    tags: ['doi'],
  })
  if (!stored.success) {
    return { success: false, error: stored.error }
  }
  // We have a row in our local library; the AddByDoiResponse shape
  // wants the full `LibraryPaperRow`. Re-fetch via list+id-filter
  // rather than maintaining a parallel "get one" IPC just for this.
  const lister = electron()?.libraryListPapers
  if (!lister) {
    return {
      success: false,
      error: 'DOI metadata fetched but read-back IPC unavailable.',
    }
  }
  const list = await lister({ q: doi, limit: 5 })
  const row = list.papers.find((p) => p.id === stored.id)
  if (!row) {
    return {
      success: false,
      error: 'Saved paper but could not locate it in the library.',
    }
  }
  return {
    success: true,
    paper: {
      ...row,
      tags: row.tags ?? [],
      collections: row.collections ?? [],
    },
  }
}

export async function importBibtex(
  file: File,
): Promise<ImportBibtexResponse> {
  let text: string
  try {
    text = await file.text()
  } catch (err) {
    return {
      success: false,
      error: `Could not read ${file.name}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }
  const parsed = parseBibTeX(text)
  if (parsed.entries.length === 0) {
    return {
      success: false,
      error:
        parsed.errors.length > 0
          ? `No entries parsed from ${file.name}: ${parsed.errors[0].message}`
          : `No entries found in ${file.name}`,
    }
  }
  const adder = electron()?.libraryAddPaper
  if (!adder) {
    return { success: false, error: IPC_UNAVAILABLE }
  }
  // Sequential rather than Promise.all because libraryAddPaper goes
  // through a write-mutex — parallel calls would queue anyway, and
  // sequential yields predictable "row N failed" errors.
  let imported = 0
  for (const entry of parsed.entries) {
    const draft = entryToPaperDraft(entry)
    if (!draft) continue
    const result = await adder({
      title: draft.title,
      authors: draft.authors || 'Unknown',
      year: draft.year,
      doi: draft.doi,
      url: draft.url,
      journal: draft.journal,
      abstract: draft.abstract,
      notes: draft.notes,
      tags: ['bibtex'],
    })
    if (result.success) imported += 1
  }
  if (imported === 0) {
    return {
      success: false,
      error: `Found ${parsed.entries.length} entries but none had a title — check the file format.`,
    }
  }
  return { success: true, imported }
}

export async function importRis(
  file: File,
  collection?: string,
): Promise<ImportRisResponse> {
  let text: string
  try {
    text = await file.text()
  } catch (err) {
    return {
      success: false,
      error: `Could not read ${file.name}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }
  const parsed = parseRIS(text)
  if (parsed.records.length === 0) {
    return {
      success: false,
      error:
        parsed.errors.length > 0
          ? `No records parsed from ${file.name}: ${parsed.errors[0].message}`
          : `No records found in ${file.name}`,
    }
  }
  const adder = electron()?.libraryAddPaper
  if (!adder) {
    return { success: false, error: IPC_UNAVAILABLE }
  }
  let imported = 0
  for (const record of parsed.records) {
    const draft = recordToPaperDraft(record)
    if (!draft) continue
    const result = await adder({
      title: draft.title,
      authors: draft.authors || 'Unknown',
      year: draft.year,
      doi: draft.doi,
      url: draft.url,
      journal: draft.journal,
      abstract: draft.abstract,
      tags: ['ris'],
      collection,
    })
    if (result.success) imported += 1
  }
  if (imported === 0) {
    return {
      success: false,
      error: `Found ${parsed.records.length} records but none had a title — check the file format.`,
    }
  }
  return { success: true, imported }
}

export async function exportBibtex(opts?: {
  tag?: string
  collection?: string
}): Promise<string> {
  // Pull the filtered set through `listPapers` so tag / collection
  // filtering lives in one place (the IPC handler) rather than being
  // duplicated here. `limit: 500` matches the IPC's upper bound.
  const { papers } = await listPapers({
    tag: opts?.tag,
    collection: opts?.collection,
    page: 1,
    limit: 500,
  })
  if (papers.length === 0) {
    // Empty filter — return a single comment explaining why the file
    // is blank rather than an error, so the download button still works.
    return `% No papers matched the current filter.\n`
  }
  return writeBibTeX(papers)
}

export async function scan(
  req: ScanDirectoryRequest,
): Promise<ScanDirectoryResponse> {
  const fn = electron()?.libraryScanDirectory
  if (!fn) {
    return { success: false, error: IPC_UNAVAILABLE }
  }
  const directory = req?.directory?.trim()
  if (!directory) {
    return { success: false, error: 'directory is required' }
  }
  const result = await fn({ directory, tags: ['scan'] })
  if (!result.success) return { success: false, error: result.error }
  return {
    success: true,
    scanned: result.scanned,
    added: result.added,
    // `extracted` stays undefined — this MVP copies PDFs but doesn't
    // run full-text extraction during scan. Users trigger extraction
    // on-demand by opening the paper (via `readPaper`).
    errors: result.errors,
  }
}

export async function uploadPdf(
  req: UploadPdfRequest,
): Promise<UploadPdfResponse> {
  const fn = electron()?.libraryImportPdf
  if (!fn) {
    return { success: false, error: IPC_UNAVAILABLE }
  }
  const sourcePath = req?.sourcePath?.trim()
  if (!sourcePath) {
    return { success: false, error: 'sourcePath is required' }
  }
  const result = await fn({
    sourcePath,
    collection: req.collection,
    tags: req.tags,
  })
  if (!result.success) return { success: false, error: result.error }
  return { success: true, id: result.id, deduped: result.deduped }
}
