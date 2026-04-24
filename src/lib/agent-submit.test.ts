// Tier 1 · unit tests for `submitAgentPrompt` — the user-facing entry point
// when someone clicks Send in AgentComposer.
//
// We exercise the *gate* branches (empty text, image guard, budget block,
// provider failure restoration) rather than the deep orchestrator path;
// the orchestrator has its own isolated test layer, and exercising it here
// would require spinning up a full LLM mock loop that adds little value
// over just pinning the gate contract.
//
// Strategy: mock the three downstream entry points (`sendLlmChat`,
// `runAgentTurn`, `submitLatticeBackendAgentTurn`) so the function's
// behaviour is reduced to "does it append the right transcript entries
// and return the right boolean".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Module-level mocks must be declared before the source-under-test import.
vi.mock('./llm-chat', () => ({
  sendLlmChat: vi.fn(async () => ({ success: true, content: 'hi back' })),
}))
vi.mock('./agent-orchestrator', () => ({
  runAgentTurn: vi.fn(async () => ({ success: true })),
}))
vi.mock('./lattice-backend-agent', () => ({
  latticeBackendAgentPreferred: vi.fn(() => false),
  submitLatticeBackendAgentTurn: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../stores/toast-store', () => ({
  toast: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}))

import { submitAgentPrompt } from './agent-submit'
import { useRuntimeStore } from '../stores/runtime-store'
import { useLLMConfigStore } from '../stores/llm-config-store'
import { usePrefsStore } from '../stores/prefs-store'
import { toast } from '../stores/toast-store'
import { sendLlmChat } from './llm-chat'
import { runAgentTurn } from './agent-orchestrator'

// Reset stores + mocks between tests so nothing bleeds across specs.
beforeEach(() => {
  useRuntimeStore.setState({
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
  })
  // Force dialog mode by default so simple tests don't invoke the orchestrator.
  usePrefsStore.setState({ composerMode: 'dialog' } as never)
  // Generous budget so budget-gate tests can opt in by lowering it per-test.
  useLLMConfigStore.setState({
    ...useLLMConfigStore.getState(),
    budget: {
      mode: 'warn',
      daily: { tokenLimit: 0, costLimitUSD: 0, warnAtPct: 0.8 },
      perRequest: { maxInputTokens: 1_000_000 },
    },
  } as never)
})

afterEach(() => {
  vi.clearAllMocks()
})

function seedSession() {
  const id = useRuntimeStore.getState().createSession({ title: 'S' })
  return id
}

describe('submitAgentPrompt — gate branches', () => {
  it('returns false and does nothing when the text is empty and no images attached', async () => {
    const id = seedSession()
    const ok = await submitAgentPrompt('   ', {
      sessionId: id,
      transcript: [],
    })
    expect(ok).toBe(false)
    expect(useRuntimeStore.getState().sessions[id].transcript).toHaveLength(0)
    expect(sendLlmChat).not.toHaveBeenCalled()
  })

  it('rejects image-bearing submits when window.electronAPI.llmInvoke is absent', async () => {
    // Setup stub: ensure electronAPI lacks llmInvoke.
    ;(window as unknown as { electronAPI?: unknown }).electronAPI = {}
    const id = seedSession()
    const ok = await submitAgentPrompt('analyze this', {
      sessionId: id,
      transcript: [],
      images: [{ base64: 'abc', mediaType: 'image/png' }],
    })
    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalled()
  })

  it('blocks on per-request budget overflow when mode=block', async () => {
    useLLMConfigStore.setState({
      ...useLLMConfigStore.getState(),
      budget: {
        mode: 'block',
        daily: { tokenLimit: 0, costLimitUSD: 0, warnAtPct: 0.8 },
        perRequest: { maxInputTokens: 1 },
      },
    } as never)
    const id = seedSession()
    const ok = await submitAgentPrompt(
      'This is a long-ish prompt that should blow past the 1-token ceiling',
      { sessionId: id, transcript: [] },
    )
    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalled()
    expect(useRuntimeStore.getState().sessions[id].transcript).toHaveLength(0)
  })

  it('happy path · agent mode · appends a user bubble + assistant placeholder and reports success', async () => {
    // Note: `composerMode='dialog'` is normalised to `'agent'` inside
    // submitAgentPrompt (see the comment at L112 of agent-submit.ts —
    // "Legacy: dialog mode is normalized to agent").
    const id = seedSession()
    const ok = await submitAgentPrompt('hi', {
      sessionId: id,
      transcript: [],
    })
    expect(ok).toBe(true)
    const t = useRuntimeStore.getState().sessions[id].transcript
    // user + assistant placeholder (runAgentTurn mock does not stream content)
    expect(t.length).toBeGreaterThanOrEqual(2)
    expect(t[0].role).toBe('user')
    expect(t[0].content).toBe('hi')
    expect(t[t.length - 1].role).toBe('assistant')
  })

  it('surfaces an assistant error message when the agent orchestrator fails', async () => {
    ;(runAgentTurn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      {
        success: false,
        error: 'orchestrator exploded',
      },
    )
    const id = seedSession()
    const ok = await submitAgentPrompt('x', {
      sessionId: id,
      transcript: [],
    })
    expect(ok).toBe(false)
    const t = useRuntimeStore.getState().sessions[id].transcript
    // User message preserved; placeholder replaced with "Error: …".
    expect(t[0].role).toBe('user')
    expect(t[t.length - 1].content).toMatch(/^Error:/)
    expect(toast.error).toHaveBeenCalled()
  })

  it('routes through runAgentTurn by default (no lattice backend)', async () => {
    const id = seedSession()
    const ok = await submitAgentPrompt('run my tool', {
      sessionId: id,
      transcript: [],
    })
    expect(ok).toBe(true)
    expect(runAgentTurn).toHaveBeenCalled()
    expect(sendLlmChat).not.toHaveBeenCalled()
  })
})
