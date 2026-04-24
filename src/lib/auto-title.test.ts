import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useRuntimeStore } from '../stores/runtime-store'
import { useLLMConfigStore } from '../stores/llm-config-store'
import { maybeAutoTitle, __resetAutoTitleAttempted } from './auto-title'

describe('maybeAutoTitle', () => {
  beforeEach(() => {
    __resetAutoTitleAttempted()
    // Reset to a known baseline so tests don't interfere with each other.
    useRuntimeStore.setState({
      sessions: {},
      sessionOrder: [],
      activeSessionId: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no-ops when session does not exist', () => {
    expect(() => maybeAutoTitle('missing')).not.toThrow()
  })

  it('no-ops when user has renamed the session away from the naive slug', () => {
    const id = useRuntimeStore
      .getState()
      .createSession({ title: 'Untitled Session' })
    useRuntimeStore.getState().appendTranscript(id, {
      id: 'u1',
      role: 'user',
      content: 'What is the Scherrer equation?',
      timestamp: Date.now(),
    })
    // User manually renames before the LLM ever runs.
    useRuntimeStore.getState().renameSession(id, 'My handpicked title')

    const invoke = vi.fn()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      llmInvoke: invoke,
    }
    vi.spyOn(useLLMConfigStore, 'getState').mockReturnValue({
      getResolvedModel: () => ({
        provider: { type: 'anthropic', apiKey: 'x', enabled: true, name: 'x' },
        model: { id: 'claude' },
      }),
    } as unknown as ReturnType<typeof useLLMConfigStore.getState>)

    maybeAutoTitle(id)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('silently bails when no LLM is configured', () => {
    const id = useRuntimeStore
      .getState()
      .createSession({ title: 'Untitled Session' })
    useRuntimeStore.getState().appendTranscript(id, {
      id: 'u1',
      role: 'user',
      content: 'Explain Bragg diffraction',
      timestamp: Date.now(),
    })
    vi.spyOn(useLLMConfigStore, 'getState').mockReturnValue({
      getResolvedModel: () => null,
    } as unknown as ReturnType<typeof useLLMConfigStore.getState>)

    expect(() => maybeAutoTitle(id)).not.toThrow()
    // Title should remain the naive slug (no crash, no rename).
    expect(useRuntimeStore.getState().sessions[id]?.title).toBe(
      'Explain Bragg diffraction',
    )
  })
})
