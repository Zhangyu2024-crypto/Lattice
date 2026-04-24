// Modal host for `asyncPrompt`. Mounted once at the app root (next to
// ToastHost); listens for prompt-open events and renders one dialog at a
// time. Queues any overlapping requests so a second prompt fired while the
// first is still visible shows up right after it's resolved.

import { useEffect, useRef, useState } from 'react'
import {
  subscribePromptRequests,
  type PromptRequest,
} from '../../lib/prompt-dialog'

export default function PromptHost() {
  // Keep the full request in state so the dialog has stable access to the
  // resolve callback even if an HMR cycle mid-prompt would otherwise drop
  // the closure.
  const [active, setActive] = useState<PromptRequest | null>(null)
  const [value, setValue] = useState('')
  const queueRef = useRef<PromptRequest[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isComposingRef = useRef(false)

  useEffect(() => {
    return subscribePromptRequests((req) => {
      if (active) {
        queueRef.current.push(req)
        return
      }
      setActive(req)
      setValue(req.defaultValue ?? '')
    })
  }, [active])

  useEffect(() => {
    if (!active) return
    // Autofocus + select the input so the user can immediately type or
    // overtype the default value without an extra click.
    const t = window.setTimeout(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [active])

  const close = (result: string | null) => {
    if (!active) return
    active.resolve(result)
    const next = queueRef.current.shift()
    if (next) {
      setActive(next)
      setValue(next.defaultValue ?? '')
    } else {
      setActive(null)
      setValue('')
    }
  }

  if (!active) return null

  return (
    <div
      className="prompt-host-backdrop"
      onMouseDown={(e) => {
        // Dismiss on backdrop click (outside the dialog).
        if (e.target === e.currentTarget) close(null)
      }}
      role="dialog"
      aria-modal="true"
      aria-label={active.message}
    >
      <form
        className="prompt-host-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          close(value)
        }}
      >
        <div className="prompt-host-message">{active.message}</div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
          onKeyDown={(e) => {
            const composing =
              e.nativeEvent.isComposing ||
              e.keyCode === 229 ||
              isComposingRef.current
            if (composing && e.key === 'Enter') {
              e.preventDefault()
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              close(null)
            }
          }}
          placeholder={active.placeholder ?? ''}
          className="prompt-host-input"
        />
        <div className="prompt-host-actions">
          <button
            type="button"
            className="prompt-host-btn prompt-host-btn-cancel"
            onClick={() => close(null)}
          >
            {active.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="submit"
            className="prompt-host-btn prompt-host-btn-ok"
          >
            {active.okLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  )
}
