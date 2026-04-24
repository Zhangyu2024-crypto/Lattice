import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MessageSquare, Paperclip, Workflow } from 'lucide-react'
import type {
  ConversationMode,
  TranscriptMessage,
  TranscriptRole,
} from '@/types/session'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useEnvelopeFile } from './useEnvelopeFile'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'

interface ChatPayload {
  messages: TranscriptMessage[]
  mentions: unknown[]
  mode: ConversationMode
  model: string | null
}

interface Props {
  relPath: string
}

const VALID_ROLES: ReadonlySet<TranscriptRole> = new Set([
  'user',
  'assistant',
  'system',
])
const VALID_MODES: ReadonlySet<ConversationMode> = new Set([
  'dialog',
  'agent',
  'research',
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function normalizeMessage(raw: unknown, idx: number): TranscriptMessage | null {
  if (!isPlainObject(raw)) return null
  const role = raw.role
  if (typeof role !== 'string' || !VALID_ROLES.has(role as TranscriptRole)) {
    return null
  }
  const content = typeof raw.content === 'string' ? raw.content : ''
  const id =
    typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `msg_${idx}`
  const timestamp =
    typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
      ? raw.timestamp
      : 0
  const taskId =
    typeof raw.taskId === 'string' && raw.taskId.length > 0
      ? raw.taskId
      : undefined
  const artifactRefs = Array.isArray(raw.artifactRefs)
    ? raw.artifactRefs.filter((x): x is string => typeof x === 'string')
    : undefined
  return {
    id,
    role: role as TranscriptRole,
    content,
    timestamp,
    ...(taskId ? { taskId } : {}),
    ...(artifactRefs && artifactRefs.length > 0 ? { artifactRefs } : {}),
  }
}

function normalizePayload(raw: unknown): ChatPayload {
  const empty: ChatPayload = {
    messages: [],
    mentions: [],
    mode: 'dialog',
    model: null,
  }
  if (!isPlainObject(raw)) return empty
  const rawMessages = Array.isArray(raw.messages) ? raw.messages : []
  const messages: TranscriptMessage[] = []
  rawMessages.forEach((m, idx) => {
    const norm = normalizeMessage(m, idx)
    if (norm) messages.push(norm)
  })
  const mode: ConversationMode =
    typeof raw.mode === 'string' && VALID_MODES.has(raw.mode as ConversationMode)
      ? (raw.mode as ConversationMode)
      : 'dialog'
  const model = typeof raw.model === 'string' ? raw.model : null
  const mentions = Array.isArray(raw.mentions) ? raw.mentions : []
  return { messages, mentions, mode, model }
}

function basenameOf(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

function formatRelativeTime(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return 'unknown time'
  const delta = Date.now() - ts
  if (delta < 0) return new Date(ts).toLocaleString()
  if (delta < 60_000) return 'just now'
  const mins = Math.floor(delta / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString()
}

// Grayscale canon — per the Lattice design system, the app avoids
// saturated accent colors in chrome. Roles differentiate via border
// intensity + label caps, not hue.
const ROLE_STYLES: Record<
  TranscriptRole,
  { label: string; badgeBg: string; badgeFg: string; border: string }
> = {
  user: {
    label: 'User',
    badgeBg: 'rgba(255, 255, 255, 0.06)',
    badgeFg: 'var(--color-text-primary)',
    border: 'var(--color-border-strong)',
  },
  assistant: {
    label: 'Assistant',
    badgeBg: 'rgba(255, 255, 255, 0.03)',
    badgeFg: 'var(--color-text-secondary)',
    border: 'var(--color-border)',
  },
  system: {
    label: 'System',
    badgeBg: 'transparent',
    badgeFg: 'var(--color-text-muted)',
    border: 'var(--color-border)',
  },
}

export default function ChatFileEditor({ relPath }: Props) {
  const { status, envelope, error } = useEnvelopeFile<unknown>(relPath)
  // Phase 4b — when `useWebSocket` is streaming into this chat file, the
  // work-in-progress payload lives in `workspace-store.dirtyBuffer` and is
  // rewritten on every `chat_message_update`. Subscribing to the slot here
  // lets the editor reflect partial tokens without hitting the filesystem
  // per delta. The slot is cleared on the terminal frame, at which point
  // `useEnvelopeFile` already has the freshly-written envelope via its
  // watcher-driven refresh.
  const dirtyEntry = useWorkspaceStore((s) => s.dirtyBuffer[relPath])

  const payload = useMemo<ChatPayload | null>(() => {
    if (dirtyEntry?.data) return normalizePayload(dirtyEntry.data)
    if (envelope) return normalizePayload(envelope.payload)
    return null
  }, [dirtyEntry, envelope])

  // Only block on the envelope load when we also have nothing buffered —
  // otherwise streaming can start before the first disk read completes and
  // we'd flash the loading state mid-conversation.
  if (status === 'loading' && !dirtyEntry) {
    return <EditorLoading relPath={relPath} />
  }
  if (!payload) {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load chat file'}
      />
    )
  }

  const basename = basenameOf(relPath).replace(/\.chat\.json$/i, '')
  const { messages, mode, model } = payload

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--color-bg-panel)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
        }}
      >
        <MessageSquare size={14} strokeWidth={1.6} />
        <strong
          style={{
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={relPath}
        >
          {basename || relPath}
        </strong>
        <Badge>{mode}</Badge>
        {model ? <Badge>{model}</Badge> : null}
        <span style={{ flex: 1 }} />
        <span>
          {messages.length} message{messages.length === 1 ? '' : 's'}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {messages.length === 0 ? (
          <EmptyTranscript />
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 7px',
        borderRadius: 10,
        fontSize: 'var(--text-xxs)',
        fontWeight: 500,
        background: 'rgba(0, 0, 0, 0.25)',
        color: 'var(--color-text-secondary)',
        border: '1px solid var(--color-border)',
        letterSpacing: 0.2,
      }}
    >
      {children}
    </span>
  )
}

function EmptyTranscript() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 180,
        color: 'var(--color-text-muted)',
        fontSize: 'var(--text-sm)',
        textAlign: 'center',
        padding: 24,
      }}
    >
      No messages yet. Send a message to start the conversation.
    </div>
  )
}

function MessageBubble({ message }: { message: TranscriptMessage }) {
  const style = ROLE_STYLES[message.role]
  return (
    <div
      style={{
        border: `1px solid ${style.border}`,
        borderRadius: 6,
        padding: '8px 12px 10px 12px',
        background: 'rgba(0, 0, 0, 0.25)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '1px 7px',
            borderRadius: 10,
            fontSize: 'var(--text-xxs)',
            fontWeight: 600,
            background: style.badgeBg,
            color: style.badgeFg,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
          }}
        >
          {style.label}
        </span>
        <span title={new Date(message.timestamp || 0).toLocaleString()}>
          {formatRelativeTime(message.timestamp)}
        </span>
      </div>

      <div
        className="chat-file-markdown"
        style={{
          fontSize: 'var(--text-base)',
          lineHeight: 1.55,
          color: 'var(--color-text-primary)',
          wordBreak: 'break-word',
        }}
      >
        {message.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        ) : (
          <span
            style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}
          >
            (empty message)
          </span>
        )}
      </div>

      <MessageRefs message={message} />
      <style>{MD_STYLE}</style>
    </div>
  )
}

function MessageRefs({ message }: { message: TranscriptMessage }) {
  const hasTask = !!message.taskId
  const refs = message.artifactRefs ?? []
  if (!hasTask && refs.length === 0) return null
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
        fontSize: "var(--text-xxs)",
      }}
    >
      {hasTask ? (
        <InlineBadge icon={<Workflow size={10} strokeWidth={1.8} />}>
          task: {message.taskId}
        </InlineBadge>
      ) : null}
      {refs.map((ref) => (
        <InlineBadge
          key={ref}
          icon={<Paperclip size={10} strokeWidth={1.8} />}
        >
          {ref}
        </InlineBadge>
      ))}
    </div>
  )
}

function InlineBadge({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        borderRadius: 10,
        fontSize: 'var(--text-xxs)',
        background: 'var(--color-bg-base)',
        color: 'var(--color-text-muted)',
        border: '1px solid var(--color-border)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {icon}
      {children}
    </span>
  )
}

const MD_STYLE = `
.chat-file-markdown p { margin: 4px 0; }
.chat-file-markdown ul, .chat-file-markdown ol { padding-left: 20px; margin: 4px 0; }
.chat-file-markdown li { margin: 2px 0; }
.chat-file-markdown code { background: rgba(0, 0, 0, 0.25); font-family: var(--font-mono); font-size: var(--text-sm); padding: 1px 4px; border-radius: 3px; }
.chat-file-markdown pre { background: rgba(0, 0, 0, 0.25); padding: 8px 10px; border-radius: 4px; overflow-x: auto; margin: 6px 0; border: 1px solid var(--color-border); }
.chat-file-markdown pre code { background: transparent; padding: 0; font-size: var(--text-sm); }
.chat-file-markdown blockquote { border-left: 3px solid var(--color-border); padding-left: 8px; color: var(--color-text-muted); margin: 6px 0; }
.chat-file-markdown a { color: var(--color-text-primary); text-decoration: underline; text-underline-offset: 2px; }
.chat-file-markdown a:hover { color: var(--color-text-emphasis); }
.chat-file-markdown table { border-collapse: collapse; margin: 6px 0; font-size: var(--text-sm); }
.chat-file-markdown th, .chat-file-markdown td { border: 1px solid var(--color-border); padding: 4px 7px; text-align: left; }
.chat-file-markdown th { background: rgba(0, 0, 0, 0.25); font-weight: 600; }
.chat-file-markdown h1, .chat-file-markdown h2, .chat-file-markdown h3 { margin: 8px 0 4px 0; }
.chat-file-markdown hr { border: none; border-top: 1px solid var(--color-border); margin: 10px 0; }
`
