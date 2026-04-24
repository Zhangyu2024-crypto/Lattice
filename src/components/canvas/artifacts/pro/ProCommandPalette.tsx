// Pro workbench command palette (W5). Keyboard-first launcher for any
// registered workbench action. Scoped to a single artifact — each Pro
// workbench mounts a palette instance and opens it when the user hits
// Ctrl/⌘+K while that workbench is focused.
//
// Flow:
//   user types `refine` → fuzzy match lists commands → user selects
//   `run refine` → Tab fills `--twoTheta=5-90 --maxPhases=3` defaults
//   → user tweaks → Enter → parseCommandLine + executeCommand via the
//   registry → toast on result.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Command as CommandIcon } from 'lucide-react'
import { toast } from '../../../../stores/toast-store'
import {
  executeCommand,
  fuzzySearchCommands,
  getCommandsForArtifact,
  parseCommandLine,
  type CommandArgSchema,
  type CommandDef,
} from './commandRegistry'
import { TYPO } from '../../../../lib/typography-inline'

interface Props {
  /** Artifact id whose registry we show. When null the palette closes
   *  itself (shouldn't normally happen — parent guards it). */
  artifactId: string | null
  open: boolean
  onClose: () => void
}

const MAX_VISIBLE = 8

export default function ProCommandPalette({
  artifactId,
  open,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [runningCommand, setRunningCommand] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Reset query each time the palette opens so the history of the last
  // typed thing doesn't leak into the next session.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setMessage(null)
      // Focus on the next tick so the DOM has mounted.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(t)
    }
  }, [open])

  // Dismiss on escape / outside click.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Available commands for this workbench instance.
  const commands: CommandDef[] = useMemo(() => {
    if (!artifactId) return []
    return getCommandsForArtifact(artifactId)
  }, [artifactId])

  // Parse the current query: everything up to the first `--` is the
  // command prefix, the rest is args. Fuzzy-match on the command prefix.
  const parsed = useMemo(() => parseCommandLine(query), [query])
  const hits = useMemo(
    () => fuzzySearchCommands(commands, parsed.name, MAX_VISIBLE),
    [commands, parsed.name],
  )

  // Clamp active index when hits change.
  useEffect(() => {
    if (activeIndex >= hits.length) setActiveIndex(Math.max(0, hits.length - 1))
  }, [hits.length, activeIndex])

  const activeCmd = hits[activeIndex]?.command ?? null

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(hits.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (activeCmd) {
        setQuery(buildCompletion(activeCmd))
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void runCurrent()
    }
  }

  const runCurrent = async (): Promise<void> => {
    if (!artifactId) {
      setMessage('No Pro workbench is focused.')
      return
    }
    // Pick the command name either from the active hit (preferred —
    // the user may have typed only part of it) or from the parsed line.
    const name = activeCmd?.name ?? parsed.name
    if (!name) {
      setMessage('Type a command name.')
      return
    }
    setRunningCommand(name)
    const res = await executeCommand(artifactId, name, parsed.args)
    setRunningCommand(null)
    if (res.success) {
      onClose()
      return
    }
    setMessage(res.error)
    toast.error(res.error)
  }

  if (!open) return null

  return (
    <div style={S.backdrop} onMouseDown={onClose}>
      <div
        style={S.panel}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={S.header}>
          <CommandIcon size={14} className="pro-palette-cmd-icon" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              artifactId
                ? 'run refine --twoTheta=5-90 …'
                : 'No workbench focused'
            }
            style={S.input}
            spellCheck={false}
            aria-autocomplete="list"
          />
          {runningCommand && (
            <span style={S.runningTag}>running {runningCommand}…</span>
          )}
        </div>

        <div ref={listRef} style={S.list}>
          {commands.length === 0 ? (
            <div style={S.empty}>
              No commands registered for this workbench.
            </div>
          ) : hits.length === 0 ? (
            <div style={S.empty}>
              No command matches <code>{parsed.name}</code>.
            </div>
          ) : (
            hits.map((hit, i) => {
              const isActive = i === activeIndex
              return (
                <button
                  key={hit.command.name}
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => {
                    setActiveIndex(i)
                    void runCurrent()
                  }}
                  className={`pro-palette-row${isActive ? ' is-active' : ''}`}
                >
                  <div style={S.rowMain}>
                    <span style={S.cmdName}>{hit.command.name}</span>
                    <span style={S.cmdDesc}>{hit.command.description}</span>
                  </div>
                  {hit.command.argsSchema &&
                    hit.command.argsSchema.length > 0 && (
                      <div style={S.cmdArgs}>
                        {hit.command.argsSchema
                          .map((a) => argHint(a))
                          .join('  ')}
                      </div>
                    )}
                </button>
              )
            })
          )}
        </div>

        <div style={S.footer}>
          <span style={S.hint}>↑↓ navigate</span>
          <span style={S.hint}>Tab fill defaults</span>
          <span style={S.hint}>Enter run</span>
          <span style={S.hint}>Esc close</span>
          {message && <span style={S.error}>{message}</span>}
        </div>
      </div>
    </div>
  )
}

function argHint(schema: CommandArgSchema): string {
  const brackets = schema.required ? ['<', '>'] : ['[', ']']
  const kind = schema.choices
    ? schema.choices.join('|')
    : schema.type === 'range'
      ? 'min-max'
      : schema.type
  return `--${schema.name}=${brackets[0]}${kind}${brackets[1]}`
}

function buildCompletion(cmd: CommandDef): string {
  if (!cmd.argsSchema || cmd.argsSchema.length === 0) return cmd.name
  const parts: string[] = [cmd.name]
  for (const a of cmd.argsSchema) {
    if (a.default != null) {
      parts.push(`--${a.name}=${formatDefault(a.default)}`)
    } else if (a.required) {
      parts.push(
        `--${a.name}=${a.choices ? a.choices[0] : a.type === 'range' ? '0-0' : ''}`,
      )
    }
  }
  return parts.join(' ')
}

function formatDefault(v: unknown): string {
  if (Array.isArray(v) && v.length === 2) return `${v[0]}-${v[1]}`
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

const S: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.35)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: '10vh',
    zIndex: 2000,
  },
  panel: {
    width: 640,
    maxWidth: '92vw',
    background: 'var(--color-bg-sidebar)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderBottom: '1px solid var(--color-border)',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--color-text-primary)',
    fontSize: TYPO.md,
    fontFamily: 'var(--font-mono)',
  },
  runningTag: {
    fontSize: TYPO.xxs,
    color: 'var(--color-accent)',
    fontFamily: 'var(--font-mono)',
  },
  list: {
    maxHeight: 420,
    overflowY: 'auto',
    padding: '4px 0',
  },
  rowMain: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
  },
  cmdName: {
    fontSize: TYPO.base,
    fontWeight: 600,
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-primary)',
  },
  cmdDesc: {
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
  },
  cmdArgs: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.02em',
  },
  empty: {
    padding: '16px',
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
    textAlign: 'center',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px',
    borderTop: '1px solid var(--color-border)',
    background: 'var(--color-bg-panel)',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    flexWrap: 'wrap',
  },
  hint: {
    fontFamily: 'var(--font-mono)',
  },
  error: {
    color: 'var(--color-red, #dc2626)',
    flex: 1,
    textAlign: 'right',
    fontSize: TYPO.xs,
  },
}

/**
 * Hook that opens the supplied palette on Ctrl/⌘+K **only while the
 * passed artifact is focused in the session**. Multiple Pro workbench
 * instances can mount without fighting over the shortcut — only one
 * will respond, and whoever the user is currently looking at wins.
 *
 * Prefer this over ad-hoc `window.addEventListener('keydown')` in each
 * workbench so the guard logic stays in one place.
 */
export function useProCommandPaletteHotkey(args: {
  artifactId: string
  focusedArtifactId: string | null | undefined
  onOpen: () => void
}): void {
  const { artifactId, focusedArtifactId, onOpen } = args
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusedArtifactId !== artifactId) return
      if (!(e.key === 'k' || e.key === 'K')) return
      if (!(e.metaKey || e.ctrlKey)) return
      // Let the app-level command palette keep ⌘Shift+P; we own plain ⌘K.
      if (e.shiftKey || e.altKey) return
      e.preventDefault()
      onOpen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [artifactId, focusedArtifactId, onOpen])
}
