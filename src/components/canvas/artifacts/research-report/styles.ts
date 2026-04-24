// Markdown styling for the research-report body pane. Scoped via the
// `.research-report-md` class so it cannot bleed into other markdown
// surfaces on the canvas (paper card, latex preview, chat messages).

export const MD_STYLE = `
@keyframes lattice-research-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50%      { opacity: 1;    transform: scale(1); }
}
.research-report-md {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--color-text-primary);
}
.research-report-md h1,
.research-report-md h2,
.research-report-md h3,
.research-report-md h4 {
  margin: 20px 0 8px;
  font-family: var(--font-sans);
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.35;
}
.research-report-md h1 { font-size: var(--text-xl); letter-spacing: -0.015em; }
.research-report-md h2 { font-size: var(--text-lg); letter-spacing: -0.01em; }
.research-report-md h3,
.research-report-md h4 { font-size: var(--text-md); }
.research-report-md p { line-height: 1.68; color: var(--color-text-primary); font-size: var(--text-base); margin: 10px 0; }
.research-report-md ul, .research-report-md ol { color: var(--color-text-primary); font-size: var(--text-base); line-height: 1.68; padding-left: 22px; margin: 10px 0; }
.research-report-md li { margin: 4px 0; }
.research-report-md li > p { margin: 0; }
.research-report-md strong { color: var(--color-text-primary); font-weight: 600; }
.research-report-md code { background: var(--color-bg-input); font-family: var(--font-mono); font-size: var(--text-xs); padding: 1px 4px; border-radius: 3px; color: var(--color-text-primary); }
.research-report-md pre { background: var(--color-bg-input); padding: 12px; border-radius: var(--radius-sm); overflow-x: auto; margin: 12px 0; border: 1px solid var(--color-border); }
.research-report-md pre code { background: transparent; padding: 0; color: var(--color-text-primary); font-size: var(--text-xs); }
.research-report-md blockquote { border-left: 2px solid color-mix(in srgb, var(--color-border-strong) 85%, transparent); padding-left: 12px; color: var(--color-text-secondary); margin: 12px 0; }
.research-report-md a { color: var(--color-text-primary); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--color-text-muted) 60%, transparent); text-underline-offset: 2px; }
.research-report-md a:hover { text-decoration-color: var(--color-text-secondary); }
.research-report-md table { border-collapse: collapse; margin: 14px 0; font-size: var(--text-sm); width: 100%; }
.research-report-md th, .research-report-md td { border: 1px solid var(--color-border); padding: 6px 9px; text-align: left; color: var(--color-text-primary); }
.research-report-md th { background: var(--color-bg-input); font-weight: 600; color: var(--color-text-secondary); }
.research-report-md hr { border: none; border-top: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent); margin: 18px 0; }
`
