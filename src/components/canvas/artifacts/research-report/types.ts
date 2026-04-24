// Shared types for the research-report artifact card and its sub-panes.
// Extracted verbatim from the original ResearchReportArtifactCard so tab
// files can consume them without importing the card itself.

export interface Citation {
  id: string
  doi?: string | null
  title: string
  authors: string[]
  year: number
  venue?: string | null
  url?: string | null
  /** LLM-drafted, not library-verified. Drives the header warning banner
   *  and a per-citation "unverified" chip in the references pane. */
  unverified?: boolean
}

export interface ReportSection {
  id: string
  heading: string
  level: 1 | 2 | 3
  markdown: string
  citationIds: string[]
  status?: 'empty' | 'drafting' | 'done'
}

export interface ResearchReportPayload {
  topic: string
  mode: 'research' | 'survey'
  style: 'concise' | 'comprehensive'
  sections: ReportSection[]
  citations: Citation[]
  generatedAt: number
  status?: 'planning' | 'drafting' | 'complete'
  currentSectionId?: string | null
}

export type ReportStatus = 'planning' | 'drafting' | 'complete'
export type SectionStatus = 'empty' | 'drafting' | 'done'

/** Matches `[@cite:abc-123]` tokens embedded in section markdown. */
export const CITE_TOKEN_RE = /\[@cite:([a-zA-Z0-9_-]+)\]/g
