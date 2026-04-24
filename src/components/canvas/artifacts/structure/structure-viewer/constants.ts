// Shared constants for the StructureViewer 3Dmol renderer. Split out so
// the main file can stay under the size budget — nothing here carries
// state, it's all lookup tables and style literals.

/** 3Dmol style configurations keyed by the StructureStyleMode union. */
export const STYLE_CONFIGS: Record<string, Record<string, unknown>> = {
  stick: { stick: { radius: 0.14 } },
  'ball-stick': { stick: { radius: 0.12 }, sphere: { scale: 0.28 } },
  sphere: { sphere: { scale: 0.45 } },
}

/** Host div style. 3Dmol creates its own canvas inside; the host must
 *  be `position: relative` so the canvas fills it correctly. */
export const HOST_STYLE: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  width: '100%',
  overflow: 'hidden',
}

/** Shared label style applied to every overlay label (element symbols,
 *  measurement values). Matches VESTA's dark-background-pill look. */
export const OVERLAY_LABEL_STYLE = {
  fontSize: 10,
  fontColor: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0.6,
  borderThickness: 0,
  inFront: true,
} as const

/** Axis arrow definitions: [direction, color, label]. Grayscale ramp
 *  so the indicator reads against dark and light backgrounds without
 *  pulling attention from the model. */
export const AXIS_ARROWS: Array<[[number, number, number], string, string]> = [
  [[1, 0, 0], '#E8E8E8', 'x'],
  [[0, 1, 0], '#989898', 'y'],
  [[0, 0, 1], '#585858', 'z'],
]
