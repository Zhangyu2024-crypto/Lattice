// ComputeAskDock — persistent bottom Ask-AI surface for the Compute
// notebook.
//
// Replaces the Cmd+K centered modal. Always visible at the bottom of
// the main column (above the overlay's own footer). One AI surface,
// one keyboard shortcut (⌘K focuses the textarea; does not open
// anything), and a "targeting" chip that always tells the user which
// cell their question will be scoped to.
//
// Submit path is unchanged from the old palette: `sendLlmChat` dialog
// mode → extract the first fenced code block → `onApply` tells the
// notebook to either replace the focused cell's code or spawn a new
// cell of the matching kind.
//
// IME safety: Enter-to-send checks `isComposingRef` (set in
// onCompositionStart/End), `e.nativeEvent.isComposing`, and the legacy
// `keyCode === 229` sentinel. Without all three, pressing Enter to
// accept a Pinyin candidate would fire submit and ship half-typed
// pinyin to the LLM.

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { ArrowUp, Loader2, Sparkles, X } from 'lucide-react'
import { sendLlmChat } from '../../../lib/llm-chat'
import { toast } from '../../../stores/toast-store'
import type { ComputeCell, ComputeCellKind } from '../../../types/artifact'

export interface CmdKApply {
  kind: 'replace-focused' | 'new-cell'
  cellKind: ComputeCellKind
  code: string
}

export interface ComputeAskDockHandle {
  /** Focus the textarea. Used by Cmd+K and per-cell Sparkles buttons. */
  focus(): void
}

export interface ComputeAskDockProps {
  sessionId: string
  /** Resolved from `payload.focusedCellId`. When non-null, the dock's
   *  "targeting" chip shows this cell and the submit message attaches its
   *  code + last stderr as context. */
  targetCell: ComputeCell | null
  /** Parent's sort-of-global "batch is running" gate. When true the send
   *  button is disabled (individual cells are already blocked elsewhere). */
  parentBusy: boolean
  /** Clear the targeting chip → parent sets `focusedCellId = null`. */
  onClearTarget: () => void
  /** Tell the parent to drop the AI's code into a cell. */
  onApply: (apply: CmdKApply) => void
  /** When true the dock renders inline inside the notebook stream
   *  (under the focused cell) instead of pinned to the overlay bottom.
   *  Adds the `is-inline` modifier for CSS; no behavioural change. */
  inline?: boolean
}

const FIRST_TURN_PRIMER = [
  'You are the Lattice Compute assistant. You help author, explain, and fix scripts for the Compute notebook — Python (numpy/scipy/pymatgen), LAMMPS input decks, CP2K input files, and CIF-producing Python.',
  '',
  'Rules:',
  '1. When you propose a runnable script, emit the FULL script inside a fenced block tagged with the language: ```python```, ```lammps```, ```cp2k```, or ```cif```. One block per reply. No diffs or `...` placeholders.',
  '2. Keep prose short — two or three sentences of context before and/or after the code block.',
  '3. When asked to fix a failure, read the stderr carefully and change the MINIMUM needed to make it run.',
  '4. For pure questions ("what does np.linalg.eig return?") answer in prose — do NOT emit a code block.',
].join('\n')

const CODE_CONTEXT_CLIP = 6000
const STDERR_CONTEXT_CLIP = 4000
const MAX_DOCK_HEIGHT_PX = 160
const MIN_DOCK_HEIGHT_PX = 44

const ComputeAskDock = forwardRef<ComputeAskDockHandle, ComputeAskDockProps>(
  function ComputeAskDock(
    { sessionId, targetCell, parentBusy, onClearTarget, onApply, inline },
    forwardedRef: Ref<ComputeAskDockHandle>,
  ) {
    const [input, setInput] = useState('')
    const [busy, setBusy] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    const isComposingRef = useRef(false)

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus: () => {
          textareaRef.current?.focus()
          textareaRef.current?.select()
        },
      }),
      [],
    )

    // Auto-grow — mirrors AgentComposer L356-364. Reset to min, measure
    // scrollHeight, clamp to MAX_DOCK_HEIGHT_PX. Called on every input
    // change + after a successful submit clears the textarea.
    const syncHeight = useCallback(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = `${MIN_DOCK_HEIGHT_PX}px`
      el.style.height = `${Math.min(el.scrollHeight, MAX_DOCK_HEIGHT_PX)}px`
    }, [])

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value)
      syncHeight()
    }

    const submit = useCallback(
      async (raw: string) => {
        const trimmed = raw.trim()
        if (!trimmed || busy || parentBusy) return
        setBusy(true)
        abortRef.current?.abort()
        abortRef.current = new AbortController()

        const userMessage = buildUserMessage(trimmed, targetCell)

        try {
          const result = await sendLlmChat({
            mode: 'dialog',
            userMessage,
            transcript: [],
            sessionId,
          })
          if (!result.success) {
            toast.error(result.error ?? 'Assistant call failed')
            return
          }
          const block = extractFirstCodeBlock(result.content)
          if (!block) {
            toast.warn('No code block in reply — nothing to apply.')
            return
          }
          const cellKind = resolveCellKind(block.language, targetCell?.kind)
          const applyKind: CmdKApply['kind'] = targetCell
            ? 'replace-focused'
            : 'new-cell'
          onApply({ kind: applyKind, cellKind, code: block.content })
          setInput('')
          // After the textarea empties the auto-grow has to re-measure,
          // otherwise the height stays at the previous multi-line value.
          window.setTimeout(syncHeight, 0)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      },
      [busy, parentBusy, sessionId, targetCell, onApply, syncHeight],
    )

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // Belt-and-suspenders IME check: `isComposingRef` (our own), the
      // spec-standard `e.nativeEvent.isComposing`, and the legacy Chromium
      // sentinel `keyCode === 229`. Missing any of these in the past led
      // to Enter-on-Pinyin-candidate shipping half-typed input to the LLM.
      const composing =
        e.nativeEvent.isComposing ||
        e.keyCode === 229 ||
        isComposingRef.current
      if (e.key === 'Escape') {
        textareaRef.current?.blur()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !composing) {
        e.preventDefault()
        void submit(input)
      }
    }

    const disabled = busy || parentBusy

    return (
      <div className={`compute-nb-dock${inline ? ' is-inline' : ''}`}>
        <div className="compute-nb-dock-head">
          <Sparkles size={12} aria-hidden />
          <span className="compute-nb-dock-title">Ask AI</span>
          {targetCell ? (
            <button
              type="button"
              className="compute-nb-dock-target"
              onClick={onClearTarget}
              title="Clear target (ask without cell context)"
            >
              <span className="compute-nb-dock-target-arrow">→</span>
              targeting {targetCellLabel(targetCell)}
              <X size={10} aria-hidden />
            </button>
          ) : (
            <span className="compute-nb-dock-hint">
              no cell targeted — reply becomes a new cell
            </span>
          )}
        </div>
        <div className="compute-nb-dock-row">
          <textarea
            ref={textareaRef}
            className="compute-nb-dock-input"
            placeholder={
              targetCell
                ? 'Ask about this cell, request a fix, or describe a new version…'
                : 'Ask AI to write a cell — Python, LAMMPS, CP2K or a structure…'
            }
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            disabled={disabled}
            rows={1}
          />
          <button
            type="button"
            className="compute-nb-send-btn"
            onClick={() => void submit(input)}
            disabled={disabled || !input.trim()}
            title="Send · Enter (Shift+Enter newline · ⌘K focus)"
          >
            {busy ? (
              <Loader2 size={12} className="spin" aria-hidden />
            ) : (
              <ArrowUp size={12} aria-hidden />
            )}
            Send
          </button>
        </div>
      </div>
    )
  },
)

export default ComputeAskDock

// ─── helpers ────────────────────────────────────────────────────────

function targetCellLabel(cell: ComputeCell): string {
  if (cell.title) return cell.title
  if (cell.code) {
    const firstLine = cell.code.split('\n')[0]?.trim() ?? ''
    if (firstLine.length > 0)
      return firstLine.length > 32 ? `${firstLine.slice(0, 31)}…` : firstLine
  }
  return `${cell.kind} cell`
}

function buildUserMessage(userText: string, cell: ComputeCell | null): string {
  const lines: string[] = [FIRST_TURN_PRIMER, '']
  if (cell) {
    lines.push('[Focused cell — attached context]')
    lines.push(`cell_kind: ${cell.kind}`)
    lines.push('code:')
    lines.push('```' + codeFence(cell.kind))
    lines.push(clip(cell.code, CODE_CONTEXT_CLIP))
    lines.push('```')
    const run = cell.lastRun
    if (run && run.endedAt != null) {
      lines.push(
        `last_run: exit=${run.exitCode ?? 'null'} duration=${run.durationMs ?? 0}ms`,
      )
      if (run.stderr.trim()) {
        lines.push('last_stderr:')
        lines.push('```text')
        lines.push(clip(run.stderr, STDERR_CONTEXT_CLIP))
        lines.push('```')
      }
    }
    lines.push('')
  }
  lines.push('[User request]')
  lines.push(userText)
  return lines.join('\n')
}

function codeFence(kind: ComputeCellKind): string {
  if (kind === 'python' || kind === 'structure-code') return 'python'
  if (kind === 'lammps') return 'lammps'
  if (kind === 'cp2k') return 'cp2k'
  return 'text'
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '\n…[truncated]'
}

interface ParsedCodeBlock {
  language?: string
  content: string
}

function extractFirstCodeBlock(markdown: string): ParsedCodeBlock | null {
  const re = /```([^\n]*)\n([\s\S]*?)```/m
  const m = re.exec(markdown)
  if (!m) return null
  const info = m[1].trim()
  return {
    language: info.split(/\s+/)[0] || undefined,
    content: m[2],
  }
}

function resolveCellKind(
  fenceLang: string | undefined,
  focusedKind: ComputeCellKind | undefined,
): ComputeCellKind {
  if (fenceLang === 'cif') return 'structure-ai'
  if (fenceLang === 'lammps') return 'lammps'
  if (fenceLang === 'cp2k') return 'cp2k'
  if (fenceLang === 'python') {
    return focusedKind === 'structure-code' ? 'structure-code' : 'python'
  }
  return focusedKind ?? 'python'
}
