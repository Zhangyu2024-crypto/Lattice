import { useRuntimeStore } from '../stores/runtime-store'
import { sendLlmChat } from './llm-chat'

const attempted = new Set<string>()

const SYSTEM_PROMPT =
  'You name chat sessions. Given the user\'s first message, reply with a 3-7 word topic label. No quotes, no punctuation at the end, no emojis, no "Chat about". Title case. Respond with only the label.'

const MAX_TITLE_CHARS = 48

function sanitizeTitle(raw: string): string | null {
  const first = raw.split(/\r?\n/).find((l) => l.trim().length > 0)
  if (!first) return null
  let t = first.trim()
  t = t.replace(/^["""'`]+|["""'`]+$/g, '')
  t = t.replace(/[.!。!]+$/g, '')
  t = t.replace(/\s+/g, ' ')
  if (t.length === 0) return null
  if (t.length > MAX_TITLE_CHARS) t = `${t.slice(0, MAX_TITLE_CHARS - 1)}…`
  return t
}

export function maybeAutoTitle(sessionId: string): void {
  if (attempted.has(sessionId)) return
  const session = useRuntimeStore.getState().sessions[sessionId]
  if (!session) return
  const firstUserMsg = session.transcript.find((m) => m.role === 'user')
  if (!firstUserMsg) return
  const naiveSlug = firstUserMsg.content
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40)
  const placeholderMatches =
    session.title === naiveSlug ||
    session.title === `${naiveSlug.slice(0, 39)}…` ||
    /^(Untitled|Session)/.test(session.title.trim())
  if (!placeholderMatches) return

  attempted.add(sessionId)

  void (async () => {
    try {
      const result = await sendLlmChat({
        mode: 'dialog',
        userMessage: firstUserMsg.content.slice(0, 1500),
        transcript: [],
        sessionId: null,
      })
      if (!result.success || !result.content) return
      const title = sanitizeTitle(result.content)
      if (!title) return
      const fresh = useRuntimeStore.getState().sessions[sessionId]
      if (!fresh) return
      const stillPlaceholder =
        fresh.title === naiveSlug ||
        fresh.title === `${naiveSlug.slice(0, 39)}…` ||
        /^(Untitled|Session)/.test(fresh.title.trim())
      if (!stillPlaceholder) return
      useRuntimeStore.getState().renameSession(sessionId, title)
    } catch {
      // swallow — offline / proxy-missing / provider-down: naive slug stays
    }
  })()
}

export function __resetAutoTitleAttempted(): void {
  attempted.clear()
}
