// Input area for the Creator assistant: quick-action row on top, then
// a growing single-row textarea with an inline send button. The
// textarea ref is threaded in from the parent so the outer component
// keeps control over focus (e.g. on palette-open).

import { forwardRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import { QUICK_ACTIONS } from './constants'

interface Props {
  input: string
  busy: boolean
  issueCount: number
  onInputChange: (value: string) => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (prompt: string) => void
}

export const Composer = forwardRef<HTMLTextAreaElement, Props>(function Composer(
  { input, busy, issueCount, onInputChange, onKeyDown, onSubmit },
  ref,
) {
  return (
    <div className="latex-agent-chat-footer">
      <div className="latex-agent-chat-quick-row" aria-label="Quick prompts">
        {QUICK_ACTIONS.map((q) => {
          const Icon = q.icon
          const disabled = busy || (q.id === 'fix' && issueCount === 0)
          return (
            <button
              key={q.id}
              type="button"
              className="latex-agent-chat-quick-btn"
              onClick={() => onSubmit(q.prompt)}
              disabled={disabled}
              title={q.prompt}
            >
              <Icon size={12} strokeWidth={2} aria-hidden />
              <span>{q.label}</span>
            </button>
          )
        })}
      </div>

      <div className="latex-agent-chat-inputwrap">
        <textarea
          ref={ref}
          className="latex-agent-chat-input"
          placeholder="Message…"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={busy}
          aria-label="Creator assistant composer"
        />
        <button
          type="button"
          className="latex-agent-chat-send"
          onClick={() => onSubmit(input)}
          disabled={!input.trim() || busy}
          title="Send (Enter)"
          aria-label="Send message"
        >
          {busy ? (
            <Loader2
              size={16}
              strokeWidth={2.25}
              className="spin"
              aria-hidden
            />
          ) : (
            <ArrowUp size={16} strokeWidth={2.25} aria-hidden />
          )}
        </button>
      </div>
    </div>
  )
})
