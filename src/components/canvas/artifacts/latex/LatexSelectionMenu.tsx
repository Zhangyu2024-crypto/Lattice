import { showTooltip, type Tooltip, EditorView } from '@codemirror/view'
import { StateField, type Extension } from '@codemirror/state'
import type { SelectionVerb } from '../../../../lib/latex/ai-actions'

// Pure CM6 extension — no React. The floating toolbar is built from plain
// DOM inside `showTooltip` so the card's React tree doesn't have to mirror
// selection state. Clicks are forwarded through the `onCommand` callback
// captured at extension-creation time.

export interface SelectionMenuCommandCtx {
  verb: SelectionVerb
  selection: string
  from: number
  to: number
  view: EditorView
}

export interface LatexSelectionMenuOptions {
  onCommand: (ctx: SelectionMenuCommandCtx) => void
  /** Disable individual buttons (e.g. while a request is running). If
   *  omitted the toolbar stays interactive. */
  disabled?: () => boolean
}

const VERBS: Array<{
  id: SelectionVerb
  label: string
  title: string
}> = [
  { id: 'rewrite', label: 'Rewrite', title: 'Rewrite more clearly (same meaning)' },
  { id: 'continue', label: 'Continue', title: 'Continue from here' },
  { id: 'fix', label: 'Fix', title: 'Fix LaTeX syntax / typos' },
  { id: 'polish', label: 'Polish', title: 'Academic polish (preserve meaning)' },
  { id: 'expand', label: 'Expand', title: 'Expand into more detail' },
  { id: 'shorten', label: 'Shorten', title: 'Condense to half length' },
  { id: 'formalize', label: 'Formal', title: 'Make more formal/academic' },
  { id: 'translate-en', label: 'EN', title: 'Translate to English' },
  { id: 'translate-zh', label: 'ZH', title: 'Translate to Chinese' },
]

function buildToolbarDom(
  options: LatexSelectionMenuOptions,
  view: EditorView,
  from: number,
  to: number,
  selection: string,
): HTMLElement {
  const root = document.createElement('div')
  root.className = 'latex-sel-menu'
  root.setAttribute('role', 'toolbar')
  for (const v of VERBS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'latex-sel-menu-btn'
    btn.textContent = v.label
    btn.title = v.title
    btn.disabled = Boolean(options.disabled?.())
    btn.onmousedown = (e) => {
      // Prevent CM6 from clearing the selection before the command runs.
      e.preventDefault()
    }
    btn.onclick = () => {
      options.onCommand({ verb: v.id, selection, from, to, view })
    }
    root.appendChild(btn)
  }
  return root
}

export function latexSelectionMenu(
  options: LatexSelectionMenuOptions,
): Extension {
  const field = StateField.define<readonly Tooltip[]>({
    create: (state) => computeTooltips(state, options),
    update: (tooltips, tr) => {
      if (!tr.docChanged && !tr.selection) return tooltips
      return computeTooltips(tr.state, options)
    },
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
  })
  return [field]
}

function computeTooltips(
  state: import('@codemirror/state').EditorState,
  options: LatexSelectionMenuOptions,
): readonly Tooltip[] {
  const sel = state.selection.main
  if (sel.empty) return []
  const selected = state.sliceDoc(sel.from, sel.to)
  return [
    {
      pos: sel.head,
      above: sel.head < sel.anchor,
      strictSide: false,
      arrow: false,
      create: (view) => {
        const dom = buildToolbarDom(options, view, sel.from, sel.to, selected)
        return { dom }
      },
    },
  ]
}
