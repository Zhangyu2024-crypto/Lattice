// Pro workbench layout tokens.
//
// Keeping these as typed module-level constants (rather than CSS custom
// properties) avoids a flash of unstyled layout during hydration and
// keeps the inline style objects in ProRibbon / ProDataTabs in exact
// lockstep with the shell's grid rows.

/** Height of the top ribbon strip and the data-tabs bar, in pixels. */
export const PRO_TOOLBAR_HEIGHT = 32 as const
