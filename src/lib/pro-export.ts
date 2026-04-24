// Shared download helpers for Pro Workbench exports.
//
// Phase 1 scope (this file): a tiny CSV utility + a browser download
// primitive. Each module composes these into its own typed `exportPeaks()`
// shaped for its peak type. A richer "JSON snapshot" / "PNG of chart"
// layer will land alongside Slice 3 of the UI-completeness sweep.
//
// Why not a one-size fits all `exportPeaks(peaks)`: every technique has
// different columns (XPS wants binding energy, XRD wants 2θ + d-spacing,
// Raman wants wavenumber, Curve wants position/intensity). The shared
// primitive is the CSV *serialisation* and the *download trigger*, not the
// row schema — passing the wrong schema silently wouldn't be caught by TS.

/** Escape a cell per RFC 4180: wrap in quotes if it contains comma / quote /
 *  newline, and double-up internal quotes. `null` and `undefined` become an
 *  empty cell so peak tables with optional FWHM / SNR stay aligned. */
function escapeCell(value: unknown): string {
  if (value == null) return ''
  const str = typeof value === 'string' ? value : String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Serialise a row collection as CSV. `columns` drives both the header row
 * and the cell order, so callers can present whichever subset of the row
 * type they want, in whichever order.
 */
export function rowsToCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: ReadonlyArray<{ key: keyof T & string; header: string }>,
): string {
  const head = columns.map((c) => escapeCell(c.header)).join(',')
  const body = rows
    .map((row) => columns.map((c) => escapeCell(row[c.key])).join(','))
    .join('\n')
  return body.length === 0 ? head + '\n' : head + '\n' + body + '\n'
}

/**
 * Trigger a browser download of a pre-built `Blob`. Used for images,
 * PDFs, JSON reports, and any other payload already shaped as a Blob
 * (e.g. ASE-written LAMMPS data, ECharts canvas snapshots).
 *
 * The Safari / old-Electron revoke race is papered over with a
 * `setTimeout(0)` so the anchor click resolves before the URL is
 * invalidated.
 */
export function downloadBinary(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Trigger a download for arbitrary text content. In Electron uses a native
 * Save-As dialog via IPC; in plain Vite falls back to blob anchor trick.
 */
export function downloadTextFile(
  filename: string,
  content: string,
  _mimeType = 'text/csv;charset=utf-8',
): void {
  const api = window.electronAPI
  if (api?.fileSaveDialog) {
    const ext = filename.split('.').pop() ?? '*'
    void api.fileSaveDialog({
      defaultFileName: filename,
      content,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    return
  }
  downloadBinary(filename, new Blob([content], { type: _mimeType }))
}

/**
 * Trigger a download of an already-encoded PNG data URL (as produced by
 * ECharts' `getDataURL()`). Splits out the base64 payload and wraps it in a
 * Blob so the download is stream-friendly. `filename` should include the
 * `.png` extension.
 */
export function downloadDataUrl(filename: string, dataUrl: string): void {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
  if (!match) {
    // Not a data URL — fall back to anchor navigation. Rarely triggered
    // since ECharts always returns base64, but keeps the helper robust.
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    return
  }
  const [, mimeType, b64] = match
  const bytes = atob(b64)
  const buf = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
  const blob = new Blob([buf], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Build a timestamped snapshot filename for a Pro artifact. */
export function snapshotFilename(
  artifact: { title?: string; kind: string },
  techniqueSlug: string,
): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const base = (artifact.title ?? artifact.kind)
    .toLowerCase()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'workbench'
  return `${techniqueSlug}-${base}-${iso}.json`
}

/** Schema label stamped into snapshots we emit. Imports refuse anything
 *  else so a stray random JSON file can't be misinterpreted as a snapshot. */
export const PRO_SNAPSHOT_SCHEMA = 'lattice.pro.snapshot.v1'

/** Snapshot document shape — mirrors what `exportArtifactSnapshot` writes
 *  and what `readSnapshotFile` validates. */
export interface ProSnapshotDocument {
  schema: typeof PRO_SNAPSHOT_SCHEMA
  exportedAt: number
  artifact: {
    id: string
    kind: string
    title: string | null
    payload: unknown
  }
}

/**
 * Serialise an artifact to a pretty-printed JSON snapshot, then prompt the
 * browser to save it. A timestamped wrapper carries schema metadata so the
 * matching `readSnapshotFile` / `ingestProSnapshot` path can validate on
 * import and refuse anything that isn't ours.
 */
export function exportArtifactSnapshot(
  artifact: { id: string; kind: string; title?: string; payload: unknown },
  filename: string,
): void {
  const snapshot: ProSnapshotDocument = {
    schema: PRO_SNAPSHOT_SCHEMA,
    exportedAt: Date.now(),
    artifact: {
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title ?? null,
      payload: artifact.payload,
    },
  }
  downloadTextFile(filename, JSON.stringify(snapshot, null, 2), 'application/json')
}

/** Parse + validate a snapshot file. Throws with a user-presentable
 *  message when the blob is missing, malformed, or emitted by a different
 *  schema. The kind check is deferred to the caller since which kinds are
 *  accepted depends on the active Pro-workbench surface. */
export async function readSnapshotFile(file: File): Promise<ProSnapshotDocument> {
  if (!file) throw new Error('No file selected')
  const text = await file.text()
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error(`${file.name}: not valid JSON`)
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error(`${file.name}: empty snapshot`)
  }
  const snap = doc as Partial<ProSnapshotDocument>
  if (snap.schema !== PRO_SNAPSHOT_SCHEMA) {
    throw new Error(
      `${file.name}: unrecognised schema "${String(snap.schema)}" (expected "${PRO_SNAPSHOT_SCHEMA}")`,
    )
  }
  if (!snap.artifact || typeof snap.artifact !== 'object') {
    throw new Error(`${file.name}: snapshot missing an artifact`)
  }
  const a = snap.artifact
  if (!a.kind || !a.payload) {
    throw new Error(`${file.name}: artifact missing kind or payload`)
  }
  return snap as ProSnapshotDocument
}

/** Trigger a transient <input type=file> and resolve the picked file.
 *  Returns null if the user dismisses the dialog (no file chosen).
 *  Needed because Electron doesn't expose a renderer-side file dialog for
 *  "import" flows outside of `window.electronAPI.openFile`, and the native
 *  dialog is the cleanest place to attach the .json filter. */
export function pickJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'
    let settled = false
    input.addEventListener('change', () => {
      if (settled) return
      settled = true
      const file = input.files?.[0] ?? null
      resolve(file)
      setTimeout(() => input.remove(), 0)
    })
    // Focus/blur fallback: if the user cancels without picking anything,
    // some browsers don't fire `change`. `cancel` is a newer event;
    // fall back to the window focus return path.
    input.addEventListener('cancel', () => {
      if (settled) return
      settled = true
      resolve(null)
      setTimeout(() => input.remove(), 0)
    })
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (settled) return
          settled = true
          resolve(input.files?.[0] ?? null)
          input.remove()
        }, 300)
      },
      { once: true },
    )
    document.body.appendChild(input)
    input.click()
  })
}
