// Shared types for the XPS analysis artifact card and its helpers.
// Extracted verbatim from the original XpsAnalysisCard so sub-components
// and helpers can consume them without importing the card itself.

import type { Artifact } from '../../../../types/artifact'
import type { MentionAddRequest } from '../../../../lib/composer-bus'

export interface XpsPeak {
  label: string
  binding: number
  fwhm: number
  area: number
  assignment: string
}

export interface XpsFit {
  element: string
  line: string
  bindingRange: [number, number]
  experimentalPattern: { x: number[]; y: number[] }
  modelPattern: { x: number[]; y: number[] }
  residuals: number[]
  peaks: XpsPeak[]
  background: 'shirley' | 'linear' | 'tougaard'
}

export interface XpsQuantRow {
  element: string
  atomicPercent: number
  relativeSensitivity: number
}

export interface XpsAnalysisPayload {
  fits: XpsFit[]
  quantification: XpsQuantRow[]
  chargeCorrection: {
    refElement: string
    refLine: string
    refBE: number
    observedBE: number
    shift: number
  } | null
  validation?: { flags: string[] }
}

export interface XpsAnalysisCardProps {
  artifact: Artifact
  /** Context-menu "Mention in chat" action on a quantification row. */
  onMentionQuantRow?: (req: MentionAddRequest) => void
  /** "Open in XPS Lab" — host materialises the pro-workbench artifact. */
  onOpenInProWorkbench?: (args: {
    experimentalPattern: XpsFit['experimentalPattern'] | null
    peaks: XpsPeak[]
    bindingRange: [number, number]
  }) => void
  className?: string
}
