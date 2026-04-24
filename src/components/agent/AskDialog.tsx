import { useEffect, useRef, useState } from 'react'
import { MessageCircleQuestion, X } from 'lucide-react'
import { useAgentDialogStore } from '../../stores/agent-dialog-store'

export default function AskDialog() {
  const pending = useAgentDialogStore((s) => s.pendingQuestion)
  const resolveQuestion = useAgentDialogStore((s) => s.resolveQuestion)
  const [inputValue, setInputValue] = useState('')
  const isComposingRef = useRef(false)

  useEffect(() => {
    setInputValue('')
  }, [pending?.id])

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || isComposingRef.current) return
      if (e.key === 'Escape') {
        e.preventDefault()
        resolveQuestion(pending.id, 'cancel')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, resolveQuestion])

  if (!pending) return null

  const onCancel = () => resolveQuestion(pending.id, 'cancel')
  const onSendText = () => {
    const text = inputValue.trim()
    if (!text) return
    resolveQuestion(pending.id, { answerText: text })
  }
  const onPickOption = (optId: string, label: string) =>
    resolveQuestion(pending.id, { answerId: optId, answerText: label })

  const hasOptions = !!pending.options && pending.options.length > 0
  const placeholder = hasOptions
    ? 'Or type your own answer...'
    : pending.placeholder ?? 'Type your answer...'

  const hasInput = inputValue.trim().length > 0

  return (
    <div className="agent-dialog-overlay" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="agent-dialog agent-dialog-ask"
      >
        <div className="agent-dialog-header">
          <MessageCircleQuestion
            size={18}
            className="agent-dialog-icon tone-accent"
          />
          <div className="agent-dialog-ask-title">{pending.title}</div>
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="agent-dialog-close-btn"
          >
            <X size={16} />
          </button>
        </div>

        {pending.detail && (
          <div className="agent-dialog-description">{pending.detail}</div>
        )}

        <div className="agent-dialog-ask-body">
          {hasOptions && (
            <div className="agent-dialog-options">
              {pending.options!.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onPickOption(opt.id, opt.label)}
                  className="agent-dialog-option"
                >
                  <span className="agent-dialog-option-label">{opt.label}</span>
                  {opt.detail && (
                    <span className="agent-dialog-option-detail">
                      {opt.detail}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="agent-dialog-ask-input-row">
            <input
              autoFocus={!hasOptions}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
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
                if (e.key === 'Enter' && inputValue.trim()) {
                  e.preventDefault()
                  onSendText()
                }
              }}
              placeholder={placeholder}
              className="agent-dialog-ask-input"
            />
            <button
              onClick={onSendText}
              disabled={!hasInput}
              className={`agent-dialog-btn agent-dialog-ask-send${hasInput ? ' is-active' : ''}`}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
