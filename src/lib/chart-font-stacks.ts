/**
 * Literal font stacks for ECharts (canvas) and other renderers that do not
 * resolve `var(--font-*)`. **Must mirror** `tokens.css` `--font-sans` /
 * `--font-mono` verbatim — if the canvas falls through to a different
 * font than the surrounding HTML, charts and body copy render in two
 * different faces and the design-system "System UI first" rule breaks.
 *
 * Canonical order (extracted from tokens.css):
 *   sans: system-ui → -apple-system → Segoe UI Variable → CJK fallbacks
 *         → Inter Variable (bundled Latin fallback) → Roboto → Arial
 *   mono: ui-monospace → SF Mono / Cascadia / Segoe UI Mono → JetBrains
 *         Mono (bundled) → CJK mono fallbacks → Menlo → Consolas → …
 */
export const CHART_FONT_SANS =
  "system-ui, -apple-system, BlinkMacSystemFont, " +
  "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', " +
  "'PingFang SC', 'Hiragino Sans GB', " +
  "'Microsoft YaHei UI', 'Microsoft YaHei', " +
  "'Noto Sans SC', 'Noto Sans CJK SC', 'Source Han Sans SC', " +
  "'Inter Variable', Roboto, 'Helvetica Neue', Arial, sans-serif"

export const CHART_FONT_MONO =
  "ui-monospace, 'SF Mono', 'Cascadia Mono', 'Segoe UI Mono', " +
  "'JetBrains Mono', 'Noto Sans Mono CJK SC', 'Microsoft YaHei Mono', " +
  "'IBM Plex Mono', Menlo, Consolas, 'Liberation Mono', monospace"

/**
 * Serif stack — only used by `publication-style.ts` for the `minimal`
 * journal preset (mirrors matplotlib's default serif). Not in tokens.css
 * because the in-app design system is sans-only; serif exists for export
 * fidelity where some journals (Nature, RSC) expect classic typography.
 */
export const CHART_FONT_SERIF =
  "'Times New Roman', Times, 'STIX Two Text', 'Noto Serif CJK SC', " +
  "'Source Han Serif SC', Georgia, 'Liberation Serif', serif"
