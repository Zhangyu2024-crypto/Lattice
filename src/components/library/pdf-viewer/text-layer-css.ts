// Transcribed from pdfjs-dist/web/pdf_viewer.css (v5.x) so our inline
// TextLayer CSS matches every CSS variable the TextLayer runtime expects.
// The old hand-rolled version omitted `--min-font-size` / `--text-scale-
// factor` (caused selection rects to drift) and `.endOfContent` / `.
// selecting` rules (caused the drag handle to stall when the pointer left
// the last glyph, which is why selection "skipped lines" or refused to
// extend to the right edge). Class prefix renamed `.textLayer` →
// `.lt-pdf-textLayer` so it doesn't collide with pdfjs's own stylesheet if
// ever imported. `::selection` color tuned for our dark chrome.
export const TEXT_LAYER_CSS = `
.lt-pdf-textLayer {
  color-scheme: only light;
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 2;
  cursor: text;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}

.lt-pdf-textLayer.highlighting {
  touch-action: none;
}

.lt-pdf-textLayer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}

.lt-pdf-textLayer > :not(.markedContent),
.lt-pdf-textLayer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}

.lt-pdf-textLayer .markedContent {
  display: contents;
}

.lt-pdf-textLayer span[role="img"] {
  user-select: none;
  cursor: default;
}

/* endOfContent is the invisible trailing node pdfjs injects so the
   browser range can keep extending past the last glyph when the user
   drags toward the page corner. Missing this rule = drags bounce back
   and selections feel sticky. .selecting is toggled by pdfjs during a
   drag; expanding endOfContent to the full page lets the pointer stay
   in a selectable zone. Load-bearing for the feel of mouse selection. */
.lt-pdf-textLayer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  user-select: none;
}

.lt-pdf-textLayer.selecting .endOfContent {
  top: 0;
}

.lt-pdf-textLayer ::selection {
  background: rgba(100, 170, 255, 0.42);
  color: transparent;
}

.lt-pdf-textLayer br::selection {
  background: transparent;
}
`
