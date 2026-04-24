import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { TranscriptMessage } from '../../../types/session'

// Mock sendLlmChat so the test doesn't hit the IPC bridge. Exported
// handle so individual tests can set per-call behaviour.
const sendLlmChatMock = vi.fn()
vi.mock('../../llm-chat', () => ({
  sendLlmChat: (...args: unknown[]) => sendLlmChatMock(...args),
}))

import { compactCommand, pickRecentTail } from './compact'
import { useRuntimeStore } from '../../../stores/runtime-store'

function msg(
  role: 'user' | 'assistant' | 'system',
  content: string,
  id: string,
  ts: number,
): TranscriptMessage {
  return { id, role, content, timestamp: ts }
}

function buildCtx(transcript: TranscriptMessage[]) {
  return {
    sessionId: 'sess-1',
    transcript,
    signal: new AbortController().signal,
    caller: 'user' as const,
  }
}

beforeEach(() => {
  sendLlmChatMock.mockReset()
  // Reset runtime store. Create a single empty session we can mutate.
  useRuntimeStore.setState({
    sessions: {
      'sess-1': {
        id: 'sess-1',
        title: 'test',
        transcript: [],
        createdAt: 1,
        updatedAt: 1,
        artifacts: {},
        artifactOrder: [],
        focusedArtifactId: null,
        taskSteps: [],
      } as unknown as ReturnType<
        typeof useRuntimeStore.getState
      >['sessions'][string],
    },
    sessionOrder: ['sess-1'],
    activeSessionId: 'sess-1',
  })
})

describe('pickRecentTail', () => {
  it('returns empty when n=0', () => {
    const t = [msg('user', 'u1', 'u1', 1), msg('assistant', 'a1', 'a1', 2)]
    expect(pickRecentTail(t, 0)).toEqual([])
  })

  it('returns the last n full user→assistant pairs in forward order', () => {
    const t = [
      msg('user', 'u1', 'u1', 1),
      msg('assistant', 'a1', 'a1', 2),
      msg('user', 'u2', 'u2', 3),
      msg('assistant', 'a2', 'a2', 4),
      msg('user', 'u3', 'u3', 5),
      msg('assistant', 'a3', 'a3', 6),
    ]
    expect(pickRecentTail(t, 1).map((m) => m.id)).toEqual(['u3', 'a3'])
    expect(pickRecentTail(t, 2).map((m) => m.id)).toEqual([
      'u2',
      'a2',
      'u3',
      'a3',
    ])
  })

  it('ignores interleaved system messages', () => {
    const t = [
      msg('user', 'u1', 'u1', 1),
      msg('system', 'sys', 's1', 2),
      msg('assistant', 'a1', 'a1', 3),
    ]
    expect(pickRecentTail(t, 1).map((m) => m.id)).toEqual(['u1', 'a1'])
  })

  it('returns empty when there are no complete pairs', () => {
    const t = [msg('user', 'u1', 'u1', 1), msg('user', 'u2', 'u2', 2)]
    expect(pickRecentTail(t, 2)).toEqual([])
  })
})

describe('compactCommand', () => {
  it('skips when transcript is too short', async () => {
    const t = [
      msg('user', 'u1', 'u1', 1),
      msg('assistant', 'a1', 'a1', 2),
    ]
    const result = await compactCommand.call('', buildCtx(t))
    expect(result).toEqual({
      kind: 'text',
      text: expect.stringContaining('nothing to compact yet'),
    })
    expect(sendLlmChatMock).not.toHaveBeenCalled()
    // Session unchanged
    expect(useRuntimeStore.getState().sessions['sess-1']!.transcript).toEqual(
      [],
    )
  })

  it('does not mutate transcript on LLM error', async () => {
    const t = [
      msg('user', 'u1', 'u1', 1),
      msg('assistant', 'a1', 'a1', 2),
      msg('user', 'u2', 'u2', 3),
      msg('assistant', 'a2', 'a2', 4),
    ]
    useRuntimeStore.setState((s) => ({
      sessions: {
        ...s.sessions,
        'sess-1': { ...s.sessions['sess-1']!, transcript: t },
      },
    }))
    sendLlmChatMock.mockResolvedValueOnce({
      success: false,
      content: '',
      error: 'LLM down',
    })
    const result = await compactCommand.call('', buildCtx(t))
    expect(result).toEqual({
      kind: 'text',
      text: expect.stringContaining('Compact failed: LLM down'),
    })
    expect(
      useRuntimeStore.getState().sessions['sess-1']!.transcript,
    ).toHaveLength(4)
  })

  it('aborts on empty summary without mutating', async () => {
    const t = [
      msg('user', 'u1', 'u1', 1),
      msg('assistant', 'a1', 'a1', 2),
      msg('user', 'u2', 'u2', 3),
      msg('assistant', 'a2', 'a2', 4),
    ]
    useRuntimeStore.setState((s) => ({
      sessions: {
        ...s.sessions,
        'sess-1': { ...s.sessions['sess-1']!, transcript: t },
      },
    }))
    sendLlmChatMock.mockResolvedValueOnce({ success: true, content: '   ' })
    const result = await compactCommand.call('', buildCtx(t))
    expect(result).toEqual({
      kind: 'text',
      text: expect.stringContaining('empty summary'),
    })
    expect(
      useRuntimeStore.getState().sessions['sess-1']!.transcript,
    ).toHaveLength(4)
  })

  it('resets transcript and preserves the latest pair on success', async () => {
    const t = [
      msg('user', 'u1 old', 'u1', 1),
      msg('assistant', 'a1 old', 'a1', 2),
      msg('user', 'u2 old', 'u2', 3),
      msg('assistant', 'a2 old', 'a2', 4),
      msg('user', 'u3 latest', 'u3', 5),
      msg('assistant', 'a3 latest', 'a3', 6),
    ]
    useRuntimeStore.setState((s) => ({
      sessions: {
        ...s.sessions,
        'sess-1': { ...s.sessions['sess-1']!, transcript: t },
      },
    }))
    sendLlmChatMock.mockResolvedValueOnce({
      success: true,
      content: '- u1/u2 decisions\n- a1 found X\n- u3 asked Y',
    })
    const result = await compactCommand.call('', buildCtx(t))
    expect(result).toEqual({ kind: 'skip' })
    expect(sendLlmChatMock).toHaveBeenCalledOnce()
    const arg = sendLlmChatMock.mock.calls[0]?.[0] as {
      mode: string
      tools: unknown[]
    }
    expect(arg.mode).toBe('agent')
    expect(arg.tools).toEqual([])

    const next = useRuntimeStore.getState().sessions['sess-1']!.transcript
    // 1 summary + 2 kept tail messages
    expect(next).toHaveLength(3)
    expect(next[0]!.role).toBe('system')
    expect(next[0]!.content).toContain('Conversation compacted')
    expect(next[0]!.content).toContain('u1/u2 decisions')
    expect(next[1]!.content).toBe('u3 latest')
    expect(next[2]!.content).toBe('a3 latest')
    // Kept ids are suffixed to avoid key collisions with any future writes
    expect(next[1]!.id).toBe('u3_kept')
    expect(next[2]!.id).toBe('a3_kept')
  })
})
