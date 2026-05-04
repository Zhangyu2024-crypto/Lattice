// Data model for the `latex-document` artifact kind. Multi-file from the
// first version so the schema doesn't need to migrate once Phase B / C land
// real user data. See docs/plans/temporal-honking-hanrahan.md (architecture notes).

import type { LatexCollaborationMetadata } from './collaboration'

export type LatexCompileStatus =
  | 'idle'
  | 'compiling'
  | 'succeeded'
  | 'failed'

export type LatexMentionMode = 'selection' | 'outline' | 'full'

export interface LatexCompileError {
  file: string | null
  line: number | null
  severity: 'error' | 'warning' | 'badbox'
  message: string
  excerpt?: string
}

export type LatexFileKind = 'tex' | 'bib' | 'asset'

export interface LatexFile {
  /** POSIX relative path inside the project, e.g. 'main.tex',
   *  'chapters/intro.tex', 'refs.bib'. Used as a stable id. */
  path: string
  kind: LatexFileKind
  /** Plain text for tex/bib; asset files store base64 until Phase C adds an
   *  IndexedDB blob store. */
  content: string
}

export interface LatexOutlineEntry {
  file: string
  level: number
  title: string
  offset: number
}

export interface LatexEditorState {
  cursor: number
  scrollTop?: number
}

export interface LatexDocumentPayload {
  files: LatexFile[]
  /** Must equal one of `files[].path`. Default 'main.tex'. */
  rootFile: string
  /** Which file the user is currently editing. */
  activeFile: string
  engine: 'pdftex'
  status: LatexCompileStatus
  lastCompileAt?: number
  durationMs?: number
  errors: LatexCompileError[]
  warnings: LatexCompileError[]
  /** Truncated to last 16KB before persist. */
  logTail: string
  /** Per-file cursor + scroll, keyed by `files[].path`. */
  editorState?: Record<string, LatexEditorState>
  mentionMode: LatexMentionMode
  outline: LatexOutlineEntry[]
  ghostEnabled: boolean
  autoCompile: boolean
  autoFixSuggest: boolean
  /** Optional real-time collaboration metadata. Source text remains in
   *  `files[]`; this block describes the shared room and local identity. */
  collaboration?: LatexCollaborationMetadata
  /** Hash of last auto-fix attempt — used to break suggestion loops when the
   *  LLM keeps proposing the same patch for the same error. */
  lastAutoFixSig?: string
}
