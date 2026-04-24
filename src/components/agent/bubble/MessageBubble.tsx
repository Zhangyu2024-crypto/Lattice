import { memo, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import AgentCard from '../cards/AgentCard'
import { isSilentStep } from '../cards/agent-card/helpers'
import ArtifactBadge from '../ArtifactBadge'
import MentionChip from '../../mention/MentionChip'
import BubbleCopyButton from './BubbleCopyButton'
import ChatBubbleImage from './ChatBubbleImage'
import ChatMarkdownTable from './ChatMarkdownTable'
import { flushRuntimePersist, useSessionStore } from '../../../stores/session-store'
import type { TaskStep, TranscriptMessage } from '../../../types/session'
import type { MentionRef } from '../../../types/mention'

// ── MessageBubble ───────────────────────────────────────────────────────────
// Rendering strategy:
//   - User messages: plain text, but we walk it for `@[label#anchor]` tokens
//     and render each as a read-only MentionChip (cross-referencing
//     message.mentions for the full ref so hover tooltips are useful).
//   - Assistant messages: markdown, with a component override for `<a>` that
//     treats `mention://` hrefs as chips.

// React.memo short-circuits re-renders when `message` / `toolSteps` /
// `relTime` / `sessionId` didn't change. The bubble intentionally does
// NOT subscribe to `selectActiveSession` directly — that would make every
// bubble re-render on every streaming token (session ref changes per
// token even when the individual message ref is stable), which compounds
// into visible stutter once the transcript grows. The parent composer
// precomputes the two session-derived values (`toolSteps`, `relTime`)
// once per relevant store change and hands them down as primitive-stable
// props.
const MessageBubble = memo(function MessageBubble({
  message,
  toolSteps,
  relTime,
  sessionId,
}: {
  message: TranscriptMessage
  toolSteps: readonly TaskStep[]
  relTime: string
  sessionId: string | null
}) {
  const mentionsByAnchor = useMemo(() => {
    const map = new Map<string, MentionRef>()
    for (const m of message.mentions ?? []) map.set(m.anchor, m.ref)
    return map
  }, [message.mentions])

  // Zustand action references are stable across state updates, so this
  // subscription does NOT cause re-renders. It's only here because the
  // artifact-card dismiss button calls it. Subscribing at the bubble
  // rather than threading yet another callback avoids a parent-side
  // useCallback that would widen this component's prop surface.
  const removeTranscriptMessage = useSessionStore(
    (s) => s.removeTranscriptMessage,
  )
  // Retrieval-style steps (cardMode:'silent') don't get their own cards
  // in the main stream — they collapse into the audit chip at the
  // bottom of the bubble. `visibleSteps` keeps the original order for
  // the prominent cards; `silentSteps` feeds the chip.
  const [visibleSteps, silentSteps] = useMemo(() => {
    const visible: TaskStep[] = []
    const silent: TaskStep[] = []
    for (const s of toolSteps) {
      if (isSilentStep(s)) silent.push(s)
      else visible.push(s)
    }
    return [visible, silent] as const
  }, [toolSteps])
  const [auditExpanded, setAuditExpanded] = useState(false)
  const [thinkingExpanded, setThinkingExpanded] = useState(false)

  // Phase ε — shared workbench opener for AgentCard. We bind directly to
  // `window.electronAPI.openWorkbenchWindow` so the card stays
  // renderer-agnostic (web builds see `undefined` and the Open-Workbench
  // button is hidden). Wrapped in useMemo so a fresh callback isn't
  // allocated on every MessageBubble re-render.
  const openWorkbenchWindow = useMemo(
    () =>
      typeof window !== 'undefined' && window.electronAPI?.openWorkbenchWindow
        ? (sessionId: string, artifactId: string) => {
            // Flush persist writes first: the satellite window hydrates
            // from localStorage on spawn, and the debounced wrapper would
            // otherwise hold the freshly-created artifact for 300ms.
            flushRuntimePersist()
            void window.electronAPI?.openWorkbenchWindow?.({
              sessionId,
              artifactId,
            })
          }
        : undefined,
    [],
  )

  const isStreaming = message.status === 'streaming'
  const trimmedContent = message.content.trim()
  const isAssistantErrorNotice =
    message.role === 'assistant' &&
    (message.status === 'error' || /^error\s*:/i.test(trimmedContent))
  const showThinkingPlaceholder =
    message.role === 'assistant' &&
    message.id.startsWith('thinking_') &&
    !trimmedContent &&
    !isStreaming

  // Pre-process assistant body so bare `@[label#anchor]` literals (i.e.
  // not wrapped in a markdown link) become real `mention://` links, then
  // let react-markdown render them and our `a` override convert them to
  // chips. Hoisted above the `user` branch so hook order is stable
  // regardless of role.
  const rewritten = useMemo(
    () =>
      message.content.replace(
        MENTION_TOKEN_RE,
        (_m, label: string, anchor: string) =>
          `[${label}#${anchor}](mention://anchor/${anchor})`,
      ),
    [message.content],
  )

  if (message.role === 'user') {
    const imgs = message.attachedImages
    const hasText = message.content.trim().length > 0
    return (
      <div
        className="chat-message chat-message-user"
        role="article"
        aria-label="User message"
      >
        <div className="chat-bubble">
          {imgs && imgs.length > 0 ? (
            <div
              className="chat-bubble-attached-images"
              aria-label={`${imgs.length} attached image(s)`}
            >
              {imgs.map((img, i) => (
                <ChatBubbleImage
                  key={`${message.id}-img-${i}`}
                  mediaType={img.mediaType}
                  base64={img.base64}
                />
              ))}
            </div>
          ) : null}
          {hasText ? renderInlineMentions(message.content, mentionsByAnchor) : null}
        </div>
        <div className="chat-bubble-meta">
          {relTime && (
            <span className="chat-bubble-meta-time">{relTime}</span>
          )}
          <BubbleCopyButton text={message.content} />
        </div>
      </div>
    )
  }

  // Phase ε — pure artifact card (no tool-call step). These are emitted
  // by `appendArtifactCardMessage` when an artifact is created outside a
  // live agent turn (demo loads, Pro-workbench spawns). We route them
  // through AgentCard's artifact-only path so the visual is identical
  // to the tool-call card.
  if (message.artifactCardRef) {
    return (
      <div
        className="chat-message chat-message-artifact"
        role="article"
        aria-label="Artifact card"
      >
        <AgentCard
          artifactCardRef={message.artifactCardRef}
          onDismiss={
            sessionId
              ? () => removeTranscriptMessage(sessionId, message.id)
              : undefined
          }
          onOpenWorkbench={openWorkbenchWindow}
        />
        {relTime ? (
          <div className="chat-bubble-meta" aria-hidden="true">
            <span className="chat-bubble-meta-time">{relTime}</span>
          </div>
        ) : null}
      </div>
    )
  }

  const roleLabel =
    message.role === 'system' ? 'System message' : 'Assistant message'
  return (
    <div
      className={
        'chat-message chat-message-assistant' +
        (isAssistantErrorNotice ? ' chat-message-assistant--error' : '')
      }
      role="article"
      aria-label={roleLabel}
      aria-busy={isStreaming ? true : undefined}
    >
      <div className="chat-bubble">
        {visibleSteps.length > 0 && (
          <div
            className="chat-bubble-tool-steps"
            role="group"
            aria-label="Tool invocations"
          >
            {visibleSteps.map((step) => (
              <AgentCard
                key={step.id}
                step={step}
                onOpenWorkbench={openWorkbenchWindow}
              />
            ))}
          </div>
        )}
        {message.thinking && (
          <div
            className={
              'chat-bubble-thinking' +
              (thinkingExpanded ? ' is-expanded' : '')
            }
          >
            <button
              type="button"
              className="chat-bubble-thinking-toggle"
              aria-expanded={thinkingExpanded}
              onClick={() => setThinkingExpanded((v) => !v)}
            >
              <span className="chat-bubble-thinking-chev" aria-hidden>
                {thinkingExpanded ? '▾' : '▸'}
              </span>
              <span>Thinking</span>
            </button>
            {thinkingExpanded && (
              <pre className="chat-bubble-thinking-content">
                {message.thinking}
              </pre>
            )}
          </div>
        )}
        {showThinkingPlaceholder ? (
          <span className="thinking-dots" aria-hidden>
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        ) : (
          <>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  if (typeof href === 'string' && href.startsWith('mention://')) {
                    const text = Array.isArray(children)
                      ? children.join('')
                      : String(children ?? '')
                    const match = /^([^#]+)#([0-9a-z]{5})$/.exec(text.trim())
                    const label = match ? match[1] : text
                    const anchor = match ? match[2] : undefined
                    const ref = anchor ? mentionsByAnchor.get(anchor) : undefined
                    return (
                      <MentionChip
                        label={label}
                        anchor={anchor}
                        ref={ref}
                        missing={Boolean(anchor) && !ref}
                      />
                    )
                  }
                  return (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  )
                },
                pre: ({ node: _node, children, ...rest }) => (
                  <div className="chat-bubble-pre-wrap">
                    <pre {...rest}>{children}</pre>
                  </div>
                ),
                code: ({ node: _node, children, ...rest }) => (
                  <code {...rest}>{children}</code>
                ),
                table: ({ node: _node, children, ...rest }) => (
                  <ChatMarkdownTable {...rest}>{children}</ChatMarkdownTable>
                ),
              }}
            >
              {rewritten}
            </ReactMarkdown>
            {isStreaming ? (
              <span className="chat-stream-cursor" aria-hidden />
            ) : null}
          </>
        )}
        {message.artifactRefs && message.artifactRefs.length > 0 && (
          <div className="chat-bubble-artifact-refs">
            {message.artifactRefs.map((id) => (
              <ArtifactBadge key={id} artifactId={id} />
            ))}
          </div>
        )}
        {silentSteps.length > 0 && (
          <div
            className={
              'chat-bubble-audit' +
              (auditExpanded ? ' is-expanded' : '')
            }
          >
            <button
              type="button"
              className="chat-bubble-audit-toggle"
              aria-expanded={auditExpanded}
              onClick={() => setAuditExpanded((v) => !v)}
              title={
                auditExpanded
                  ? 'Hide the tools the agent used'
                  : 'See the tools the agent used to produce this answer'
              }
            >
              <span className="chat-bubble-audit-count">
                {silentSteps.length}
              </span>
              <span>Used {silentSteps.length === 1 ? 'tool' : 'tools'}</span>
              <span className="chat-bubble-audit-names">
                {silentSteps
                  .slice(0, 3)
                  .map((s) => s.toolName)
                  .filter((n): n is string => typeof n === 'string')
                  .join(' · ')}
                {silentSteps.length > 3 ? ' …' : ''}
              </span>
              <span className="chat-bubble-audit-chev" aria-hidden>
                {auditExpanded ? '▾' : '▸'}
              </span>
            </button>
            {auditExpanded && (
              <div
                className="chat-bubble-audit-cards"
                role="group"
                aria-label="Tools consulted"
              >
                {silentSteps.map((step) => (
                  <AgentCard
                    key={step.id}
                    step={step}
                    onOpenWorkbench={openWorkbenchWindow}
                    forceShow
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="chat-bubble-meta">
        {relTime && (
          <span className="chat-bubble-meta-time">{relTime}</span>
        )}
        <BubbleCopyButton text={message.content} />
      </div>
    </div>
  )
})

export default MessageBubble

// Matches `@[label#anchor]` literals in a message body. `label` may contain
// any char except `]` or `#`; `anchor` is exactly 5 chars base36 per
// generateMentionAnchor. Global + multi-line because a single message can
// carry many mentions.
const MENTION_TOKEN_RE = /@\[([^\]#]+)#([0-9a-z]{5})\]/g

// Walks a plain-text body, splitting on `@[label#anchor]` tokens and emitting
// a mix of text nodes and MentionChip nodes. Uses `matchAll` to avoid the
// shared-regex `lastIndex` dance — the iterator returns results in
// document order, so we just interleave preceding text with each match.
function renderInlineMentions(
  content: string,
  byAnchor: Map<string, MentionRef>,
): ReactNode[] {
  const out: ReactNode[] = []
  let lastIdx = 0
  let k = 0
  // `matchAll` requires a /g regex. We reuse `MENTION_TOKEN_RE`'s source
  // + flags to avoid sharing (and mutating) the module-level regex's
  // internal state across renders.
  const re = new RegExp(MENTION_TOKEN_RE.source, MENTION_TOKEN_RE.flags)
  for (const match of content.matchAll(re)) {
    const start = match.index ?? 0
    if (start > lastIdx) {
      out.push(content.slice(lastIdx, start))
    }
    const [, label, anchor] = match
    const ref = byAnchor.get(anchor)
    out.push(
      <MentionChip
        key={`m-${k++}-${anchor}`}
        label={label}
        anchor={anchor}
        ref={ref}
        missing={Boolean(anchor) && !ref}
      />,
    )
    lastIdx = start + match[0].length
  }
  if (lastIdx < content.length) out.push(content.slice(lastIdx))
  return out
}
