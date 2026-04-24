// Phase 3a · workspace_grep preview — per-file collapsible match block.
//
// Each file's hits render as a collapsible section so a 200-match result
// doesn't drown the chat thread. Clicking any individual match fires a
// composer mention-add for the file, letting the user carry the hit back
// into their next turn.

import { useMemo, useState } from 'react'
import { fileKindFromName } from '@/lib/workspace/file-kind'
import { dispatchMentionAdd } from '@/lib/composer-bus'
import { useRuntimeStore } from '@/stores/runtime-store'
import { basename, compileHighlightRegex, highlightLine } from './helpers'
import type { GrepInput, GrepMatch } from './types'

export function FileBlock({
  relPath,
  matches,
  input,
  initiallyOpen,
}: {
  relPath: string
  matches: GrepMatch[]
  input: GrepInput | null
  initiallyOpen: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const kind = fileKindFromName(basename(relPath))

  // Compile once per (pattern, flag) pair — cheap, but still wasted work
  // if we recompiled on every file block.
  const re = useMemo(
    () =>
      input
        ? compileHighlightRegex(input.pattern, input.caseInsensitive === true)
        : null,
    [input],
  )

  const onMentionFile = () => {
    const sessionId = useRuntimeStore.getState().activeSessionId
    if (!sessionId) return
    dispatchMentionAdd({
      ref: { type: 'file', sessionId, relPath },
      label: basename(relPath) || relPath,
    })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-primary)',
          width: '100%',
        }}
      >
        <span
          aria-hidden
          style={{
            fontFamily: 'var(--font-sans)',
            color: 'var(--color-text-muted)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms',
            display: 'inline-block',
            width: 10,
          }}
        >
          ▸
        </span>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: "var(--text-xxs)",
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(110, 168, 254, 0.12)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          {kind}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          title={relPath}
        >
          {relPath}
        </span>
        <span
          style={{
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-sans)',
            fontSize: "var(--text-xxs)",
          }}
        >
          {matches.length}
        </span>
      </button>
      {open ? (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: '2px 0 4px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {matches.map((m, i) => (
            <li key={`${m.line}-${i}`}>
              <button
                type="button"
                onClick={onMentionFile}
                title={`Mention ${basename(relPath)} in composer`}
                style={{
                  display: 'flex',
                  gap: 8,
                  width: '100%',
                  padding: '2px 8px 2px 28px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <span
                  style={{
                    color: 'var(--color-text-muted)',
                    minWidth: 34,
                    textAlign: 'right',
                  }}
                >
                  {m.line}:
                </span>
                <span
                  style={{
                    whiteSpace: 'pre',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {input
                    ? highlightLine(
                        m.text,
                        re,
                        input.pattern,
                        input.caseInsensitive === true,
                      )
                    : m.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
