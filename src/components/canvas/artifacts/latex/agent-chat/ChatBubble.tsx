// Renders a single chat turn (user, pending assistant, errored assistant,
// or normal assistant with interleaved text + code-block patch cards).
//
// The "Apply to <file>" button is the whole reason this component exists
// — one click commits the patch in the parent's artifact store. Copy
// state is also owned by the parent so it can animate back after a
// timeout without bubbling local state up.

import { AlertCircle, Check, Copy, Wand2 } from 'lucide-react'
import type { ChatTurn, ParsedCodeBlock } from './constants'
import { isModelSetupMessage, splitAroundCodeBlocks } from './helpers'

interface Props {
  turn: ChatTurn
  filesSet: Set<string>
  activeFile: string
  appliedBlocks: Record<string, true>
  copiedBlocks: Record<string, true>
  onApply: (block: ParsedCodeBlock) => void
  onCopy: (block: ParsedCodeBlock) => void
}

export function ChatBubble({
  turn,
  filesSet,
  activeFile,
  appliedBlocks,
  copiedBlocks,
  onApply,
  onCopy,
}: Props) {
  if (turn.role === 'user') {
    return (
      <div className="latex-agent-row latex-agent-row--user" role="article">
        <div className="latex-agent-bubble-user">{turn.content}</div>
      </div>
    )
  }
  if (turn.pending) {
    return (
      <div
        className="latex-agent-row latex-agent-row--assistant"
        role="article"
        aria-label="Assistant is thinking"
        aria-busy="true"
      >
        <div className="latex-agent-bubble-pending">
          <span className="thinking-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>
      </div>
    )
  }
  if (turn.error) {
    const raw = turn.content || 'Assistant failed.'
    if (isModelSetupMessage(raw)) {
      return (
        <div className="latex-agent-row latex-agent-row--assistant" role="article">
          <div className="latex-agent-callout latex-agent-callout--setup" role="alert">
            <AlertCircle size={15} strokeWidth={2} aria-hidden />
            <div className="latex-agent-callout-body">
              <span className="latex-agent-callout-title">No model selected</span>
              <span className="latex-agent-callout-hint">
                Settings → Models · <kbd>Ctrl+Shift+L</kbd>
              </span>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="latex-agent-row latex-agent-row--assistant" role="article">
        <div className="latex-agent-callout latex-agent-callout--error" role="alert">
          <AlertCircle size={14} strokeWidth={2} aria-hidden />
          <p className="latex-agent-callout-msg" title={raw}>
            {raw}
          </p>
        </div>
      </div>
    )
  }
  const segments = splitAroundCodeBlocks(turn.content)
  return (
    <div className="latex-agent-row latex-agent-row--assistant" role="article">
      <div className="latex-agent-bubble-assistant">
        {segments.map((seg, i) => {
          if (seg.type === 'text') {
            const trimmed = seg.text.trim()
            if (!trimmed) return null
            return (
              <p key={`t-${i}`}>{trimmed}</p>
            )
          }
          const { block } = seg
          const target = block.path ?? activeFile
          const targetExists = filesSet.has(target)
          const applyKey = `${turn.id}:${block.index}`
          const isApplied = Boolean(appliedBlocks[applyKey])
          const isCopied = Boolean(copiedBlocks[applyKey])
          return (
            <div className="latex-agent-chat-patch" key={`c-${i}`}>
              <div className="latex-agent-chat-patch-toolbar">
                <span className="latex-agent-chat-patch-lang">
                  {block.language || 'tex'}
                </span>
                {block.path ? (
                  <span className="latex-agent-chat-patch-path">{block.path}</span>
                ) : (
                  <span className="latex-agent-chat-patch-path is-muted">
                    no path — applies to {activeFile}
                  </span>
                )}
                <span className="latex-agent-chat-patch-spacer" />
                <button
                  type="button"
                  className="latex-agent-chat-patch-btn"
                  onClick={() => onCopy(block)}
                  title="Copy code"
                  aria-label="Copy code"
                >
                  {isCopied ? (
                    <Check size={11} aria-hidden />
                  ) : (
                    <Copy size={11} aria-hidden />
                  )}
                  <span>{isCopied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  className="latex-agent-chat-patch-btn is-primary"
                  onClick={() => onApply(block)}
                  disabled={!targetExists || isApplied}
                  title={
                    targetExists
                      ? isApplied
                        ? 'Already applied'
                        : `Replace ${target} with this content`
                      : `File "${target}" is not in the project`
                  }
                >
                  {isApplied ? (
                    <>
                      <Check size={11} aria-hidden />
                      <span>Applied</span>
                    </>
                  ) : (
                    <>
                      <Wand2 size={11} aria-hidden />
                      <span>Apply to {target}</span>
                    </>
                  )}
                </button>
              </div>
              <pre>
                <code>{block.content}</code>
              </pre>
            </div>
          )
        })}
      </div>
    </div>
  )
}
