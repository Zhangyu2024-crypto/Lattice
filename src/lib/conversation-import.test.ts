import { describe, it, expect, beforeEach } from 'vitest'
import { importConversationFromText } from './conversation-import'
import { useRuntimeStore } from '../stores/runtime-store'

describe('importConversationFromText', () => {
  beforeEach(() => {
    useRuntimeStore.setState({
      sessions: {},
      sessionOrder: [],
      activeSessionId: null,
    })
  })

  it('rejects non-JSON text', () => {
    const r = importConversationFromText('not json')
    expect(r.ok).toBe(false)
  })

  it('rejects unknown formats', () => {
    const r = importConversationFromText(JSON.stringify({ foo: 1 }))
    expect(r.ok).toBe(false)
  })

  it('imports our own JSON export shape', () => {
    const payload = {
      format: 'lattice-session-chat',
      version: 1,
      exportedAt: Date.now(),
      sessionId: 'orig',
      title: 'Demo Import',
      chatMode: 'agent',
      transcript: [
        { id: 'm1', role: 'user', content: 'hello', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'hi', timestamp: 2 },
      ],
    }
    const r = importConversationFromText(JSON.stringify(payload))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.title).toBe('Demo Import')
    expect(r.messageCount).toBe(2)
    const s = useRuntimeStore.getState().sessions[r.sessionId]
    expect(s?.transcript).toHaveLength(2)
    expect(useRuntimeStore.getState().activeSessionId).toBe(r.sessionId)
  })

  it('imports the legacy .chat.json envelope shape', () => {
    const envelope = {
      kind: 'chat',
      id: 'legacy',
      createdAt: 1,
      updatedAt: 2,
      meta: { title: 'Legacy Chat' },
      payload: {
        messages: [{ id: 'a', role: 'user', content: 'howdy', timestamp: 1 }],
        mentions: [],
        mode: 'dialog',
        model: null,
      },
    }
    const r = importConversationFromText(JSON.stringify(envelope))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.messageCount).toBe(1)
    expect(r.title).toBe('Legacy Chat')
  })
})
