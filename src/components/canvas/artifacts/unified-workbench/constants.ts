// Static constants shared by UnifiedProWorkbench and its helpers. Kept
// separate so the main component and the normalize / helper modules can
// import them without a circular dependency back onto the panel.
//
// Raman, FTIR, and Curve are excluded from `ALL_TECHNIQUES`: the
// backend only has real processing pipelines for XRD / XPS. Legacy
// artifacts with other technique cursors still render via the module
// registry (so user data is preserved), but the user cannot start new
// workflows from the switcher or launcher.

import type { SpectrumTechnique } from '@/types/artifact'

export const ALL_TECHNIQUES: readonly SpectrumTechnique[] = [
  'xrd',
  'xps',
] as const

export const SHARED_FIELDS = [
  'spectrum',
  'quality',
  'status',
  'lastError',
] as const

// ─── Keyboard shortcut plumbing ───────────────────────────────────
//
// Left-to-right order of `ProTechniqueSwitcher`: XRD / XPS.
// `TECHNIQUE_SHORTCUT_KEYS` lists the raw `KeyboardEvent.key` values we
// match against so both the digit row and numpad digits hit.
export const TECHNIQUE_SHORTCUT_ORDER: readonly SpectrumTechnique[] = [
  'xrd',
  'xps',
] as const

export const TECHNIQUE_SHORTCUT_KEYS: readonly string[] = ['1', '2'] as const
