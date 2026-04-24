import { useEffect, useMemo, useRef, useState } from 'react'
import { categoryOf, renderLabelWithHighlight } from './command-palette/helpers'
import type { Command, CommandPaletteProps } from './command-palette/types'
import {
  buildSessionOpenerCommands,
  buildSessionToolboxCommands,
} from './command-palette/builders/session'
import { buildResearchCommands } from './command-palette/builders/research'
import { buildDemoCommands } from './command-palette/builders/demos'
import {
  buildProCommands,
  buildWindowCommands,
} from './command-palette/builders/pro'
import { buildDomainAgentCommands } from './command-palette/builders/domain-agent'
import { buildCrossWorkbenchCommands } from './command-palette/builders/cross-workbench'
import { buildSlashCommands } from './command-palette/builders/slash'

export default function CommandPalette({
  open,
  onClose,
  onLoadDemo,
  onToggleSidebar,
  onToggleChat,
  onOpenFile,
  onNewSession,
  onExportSession,
  onLoadXrdDemo,
  onLoadXpsDemo,
  onLoadRamanDemo,
  onLoadJobDemo,
  onLoadComputeDemo,
  onLoadStructureDemo,
  onLoadResearchDemo,
  onLoadBatchDemo,
  onLoadMaterialCompareDemo,
  onLoadSimilarityDemo,
  onLoadOptimizationDemo,
  onLoadHypothesisDemo,
  onLoadLatexDemo,
  onOpenLibrary,
  onExportSessionZip,
  onMockAgentStream,
  onRunAgent,
  onStartResearch,
  canRunDomainCommand,
  onOpenProWorkbench,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const isComposingRef = useRef(false)
  // Focus-trap bookkeeping: we remember the element the user was focused
  // on before the palette mounted and return focus to it on close. Without
  // this, dismissing the palette leaves focus on <body> and any follow-up
  // keystroke is swallowed by the global shortcut listener instead of the
  // UI element the user came from.
  const lastFocusedRef = useRef<HTMLElement | null>(null)

  // Command list composition — the order here is visible to users and
  // cannot change without breaking muscle memory. Each builder is a pure
  // function of its inputs, so the full array is cheap to rebuild each
  // render alongside the filter memo below.
  const commands: Command[] = [
    ...buildSessionOpenerCommands({ onClose, onNewSession, onOpenFile }),
    // Slash-command registry: anything with a `paletteGroup` lands here so
    // the `/` composer typeahead and Ctrl+Shift+P share a source of truth.
    ...buildSlashCommands({ onClose }),
    ...buildResearchCommands({ onClose, onStartResearch }),
    ...buildDemoCommands({
      onClose,
      onLoadDemo,
      onLoadXrdDemo,
      onLoadXpsDemo,
      onLoadRamanDemo,
      onLoadJobDemo,
      onLoadComputeDemo,
      onLoadStructureDemo,
      onLoadResearchDemo,
      onLoadBatchDemo,
      onLoadMaterialCompareDemo,
      onLoadSimilarityDemo,
      onLoadOptimizationDemo,
      onLoadHypothesisDemo,
      onLoadLatexDemo,
      onMockAgentStream,
    }),
    ...buildProCommands({ onClose, onOpenProWorkbench }),
    // Cross-workbench domain commands — reuse the last-focused workbench
    // for the technique (or create one) and dispatch the module's
    // registered command. Lets users run high-frequency operations
    // ("XRD: Run Phase Search") from the global palette without first
    // navigating into a workbench and opening Ctrl+K.
    ...buildCrossWorkbenchCommands(onClose),
    ...buildWindowCommands({ onClose, onOpenLibrary }),
    ...(canRunDomainCommand
      ? buildDomainAgentCommands({ onClose, onRunAgent })
      : []),
    ...buildSessionToolboxCommands({
      onClose,
      onExportSession,
      onExportSessionZip,
      onToggleSidebar,
      onToggleChat,
    }),
  ]

  const filtered = useMemo(
    () =>
      query
        ? commands.filter((c) =>
            c.label.toLowerCase().includes(query.toLowerCase()),
          )
        : commands,
    // `commands` is rebuilt each render from stable prop identities plus
    // `canRunDomainCommand`; re-filtering on every render is cheap given
    // the ~40 total commands and avoids bookkeeping a memo dependency on
    // every callback prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, commands.length, canRunDomainCommand],
  )

  // Open / close lifecycle: reset state, capture prior focus, and hand
  // focus to the input on the next paint. rAF beats the old 50 ms timeout
  // because it fires after layout settles but BEFORE the next input event
  // the user might type — removing the "first keystroke dropped" bug.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      lastFocusedRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      const raf = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(raf)
    }
    // On close, return focus to whoever had it before we opened. Guard
    // with `isConnected` so we don't throw if the originating element was
    // removed from the DOM while the palette was up.
    const prior = lastFocusedRef.current
    lastFocusedRef.current = null
    if (prior && prior.isConnected) prior.focus()
    return undefined
  }, [open])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  if (!open) return null

  const commitSelected = () => {
    const cmd = filtered[selectedIdx]
    if (cmd) cmd.action()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const composing =
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      isComposingRef.current
    if (composing) {
      if (e.key === 'Enter') e.preventDefault()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      commitSelected()
      return
    }
    if (e.key === 'Tab') {
      // Two-element focus trap: input ↔ selected row. The underlying row
      // list is visual-only (all clicks go through selectedIdx), so we
      // don't need to walk every row — just bounce between the search
      // input and the highlighted option.
      e.preventDefault()
      const row = rowRefs.current[selectedIdx]
      if (document.activeElement === inputRef.current) {
        row?.focus()
      } else {
        inputRef.current?.focus()
      }
    }
  }

  const liveRegionId = 'command-palette-live'
  const listboxId = 'command-palette-listbox'

  return (
    <div onClick={onClose} className="command-palette-backdrop">
      <div
        onClick={(e) => e.stopPropagation()}
        className="command-palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="command-palette-search">
          <span className="command-palette-search-prefix" aria-hidden="true">
            &gt;
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            placeholder="Type a command..."
            className="command-palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              filtered[selectedIdx]
                ? `command-palette-row-${filtered[selectedIdx].id}`
                : undefined
            }
            aria-describedby={liveRegionId}
          />
        </div>

        <div
          id={listboxId}
          className="command-palette-list"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.map((cmd, i) => {
            const category = categoryOf(cmd.id)
            const isActive = i === selectedIdx
            return (
              <div
                key={cmd.id}
                id={`command-palette-row-${cmd.id}`}
                ref={(el) => {
                  rowRefs.current[i] = el
                }}
                role="option"
                aria-selected={isActive}
                tabIndex={-1}
                onClick={cmd.action}
                onMouseEnter={() => setSelectedIdx(i)}
                onKeyDown={handleKeyDown}
                className={
                  'command-palette-row' + (isActive ? ' is-active' : '')
                }
              >
                <span className="command-palette-row-label">
                  {renderLabelWithHighlight(cmd.label, query)}
                </span>
                {category && (
                  <span className="command-palette-row-badge">{category}</span>
                )}
                {cmd.shortcut && (
                  <span className="command-palette-row-shortcut">
                    {cmd.shortcut}
                  </span>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="command-palette-empty">No matching commands</div>
          )}
        </div>

        {/* Screen-reader-only live region. Announces the filtered count as
            the user types so they know how much the query narrowed the
            list without having to arrow-scan. Polite — does not interrupt
            an in-flight announcement. */}
        <div
          id={liveRegionId}
          className="sr-only"
          role="status"
          aria-live="polite"
        >
          {filtered.length === 0
            ? 'No matching commands'
            : filtered.length === 1
              ? '1 command'
              : `${filtered.length} commands`}
        </div>
      </div>
    </div>
  )
}
