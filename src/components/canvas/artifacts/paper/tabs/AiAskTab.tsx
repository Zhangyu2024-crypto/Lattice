import { useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send } from 'lucide-react'
import type { RagSource } from '../../../../../types/library-api'
import { Badge, EmptyState, IconButton } from '../../../../ui'

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: RagSource[]
}

export default function AiAskTab({
  messages,
  input,
  onInputChange,
  onSend,
  loading,
  endRef,
  ready,
}: {
  messages: AiMessage[]
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  loading: boolean
  endRef: React.RefObject<HTMLDivElement | null>
  ready: boolean
}) {
  const isComposingRef = useRef(false)

  return (
    <div className="card-paper-ai-wrap">
      <div className="card-paper-ai-messages">
        <div className="card-paper-ai-top-spacer" aria-hidden="true" />
        {messages.length === 0 && (
          <EmptyState
            compact
            title="Ask a question about this paper"
            hint="The AI uses the full text for context."
          />
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === 'user' ? 'card-paper-ai-user-bubble' : 'card-paper-ai-assist-bubble'}
          >
            {m.role === 'assistant' ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {m.content}
              </ReactMarkdown>
            ) : (
              m.content
            )}
            {m.sources && m.sources.length > 0 && (
              <div className="card-paper-ai-sources">
                {m.sources.map((s, i) => (
                  <Badge
                    key={i}
                    variant="neutral"
                    className="card-paper-ai-source-badge"
                  >
                    {s.title ? s.title.slice(0, 40) : `Source ${i + 1}`}
                    {s.page != null && ` (p.${s.page})`}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="card-paper-ai-assist-bubble">
            <span className="thinking-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="card-paper-ai-input-row">
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
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
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder={
            ready
              ? 'Ask about this paper...'
              : 'Connect backend for RAG'
          }
          disabled={loading || !ready}
          className="card-paper-ai-input"
        />
        <IconButton
          icon={<Send size={12} />}
          label="Send"
          size="md"
          onClick={onSend}
          disabled={loading || !input.trim() || !ready}
          className="card-paper-ai-send"
        />
      </div>
    </div>
  )
}
