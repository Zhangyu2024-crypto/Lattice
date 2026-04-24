// Semantic annotation palette. Chosen desaturated so highlights read clearly
// on white PDF pages without fighting the rest of the app's muted grayscale
// chrome. Each color maps to an intent the user can apply to a highlight:
//
//   amber    — "marking" — generic important text (default)
//   sage     — "concept" — core concept / definition
//   lavender — "todo"    — follow up, re-read, verify
//   rose     — "question" — unclear / disagree / needs more context
//
// The palette is consumed by:
//   - PdfSelectionToolbar color swatch row (new highlight)
//   - PaperArtifactCard edit drawer (change an existing highlight's color)
//   - PdfContinuousViewer annotation-rect renderer (rect tint + outline)
// Keep all three in sync by importing from here instead of redefining.

export interface AnnotationColorSpec {
  /** Token key used in data (stored in `library.json` unchanged). */
  id: 'amber' | 'sage' | 'lavender' | 'rose'
  /** Hex color (6-digit, no alpha). Rendered with per-type alpha at paint time. */
  hex: string
  /** Short label for tooltips. */
  label: string
  /** Longer semantic hint — shown inside the swatch menu on hover. */
  hint: string
}

export const ANNOTATION_COLORS: readonly AnnotationColorSpec[] = [
  { id: 'amber', hex: '#D9C7A7', label: 'Marking', hint: 'Important text' },
  { id: 'sage', hex: '#B6CEB4', label: 'Concept', hint: 'Core concept' },
  {
    id: 'lavender',
    hex: '#C3BEE0',
    label: 'Todo',
    hint: 'Follow up / verify',
  },
  { id: 'rose', hex: '#D9B4B4', label: 'Question', hint: 'Unclear or disputed' },
]

export const DEFAULT_HIGHLIGHT_COLOR = ANNOTATION_COLORS[0].hex
export const DEFAULT_TODO_COLOR = ANNOTATION_COLORS[2].hex
export const DEFAULT_UNDERLINE_COLOR = '#9E9E9E'
export const DEFAULT_STRIKE_COLOR = '#7E7E7E'

/** Map the annotation `type` to the default palette color. Used by the
 *  main-process `add-annotation` IPC handler when the renderer doesn't
 *  supply one explicitly, and by the edit drawer when switching types. */
export function defaultColorForType(type: string): string {
  switch (type) {
    case 'highlight':
    case 'note':
      return DEFAULT_HIGHLIGHT_COLOR
    case 'todo':
      return DEFAULT_TODO_COLOR
    case 'underline':
      return DEFAULT_UNDERLINE_COLOR
    case 'strike':
      return DEFAULT_STRIKE_COLOR
    default:
      return DEFAULT_HIGHLIGHT_COLOR
  }
}
