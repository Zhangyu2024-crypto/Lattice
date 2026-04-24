import type { SelectionRect } from './helpers'

export interface SelectionInfo {
  text: string
  page: number
  rects: SelectionRect[]
  menuTop?: number
  menuLeft?: number
  /** Viewport-relative position of the first selection rect's top edge,
   *  used by the new PdfSelectionToolbar to anchor against the user's
   *  gesture instead of the bounding box center. Missing on legacy paths
   *  that haven't been updated; callers should fall back to menuTop/Left. */
  anchorRect?: {
    top: number
    bottom: number
    left: number
    right: number
  }
}
