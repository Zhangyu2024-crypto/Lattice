// Numeric limits for GenericToolCard's shape renderers. Split out of
// GenericToolCard.tsx so the main file focuses on composition. No
// React imports here — these are plain integer thresholds consumed by
// both the helpers (shape detection / label building) and the renderer
// sub-components.

export const MAX_TABLE_ROWS = 50
export const MAX_KV_ENTRIES = 30
export const COMPACT_PREVIEW_ROWS = 3
export const COMPACT_PREVIEW_CHARS = 240
export const INPUT_VALUE_TRUNCATE = 80
