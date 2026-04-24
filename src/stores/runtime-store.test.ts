// Tier 1 · unit tests for the session / transcript / artifact reducers.
//
// These are the hot reducers — every user message, every streaming token,
// every artifact upsert goes through them. The regressions we've hit in
// practice (transcript reference churn, dangling focusedArtifactId after
// remove) all lived here, so the suite focuses on invariants rather than
// shallow happy-path coverage.
//
// jsdom env (default) is fine — the store reads/writes localStorage via
// a debounced wrapper, but debounce + short test lifetimes means nothing
// actually flushes. We reset store state in `beforeEach`.

import { beforeEach, describe, expect, it } from 'vitest'
import { useRuntimeStore } from './runtime-store'
import type {
  ComputeProArtifact,
  StructureArtifact,
} from '../types/artifact'
import type { TranscriptMessage } from '../types/session'

function resetStore() {
  useRuntimeStore.setState({
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
  })
}

function baseMessage(
  overrides: Partial<TranscriptMessage> & { id: string; role: TranscriptMessage['role'] },
): TranscriptMessage {
  return {
    content: '',
    timestamp: Date.now(),
    ...overrides,
  } as TranscriptMessage
}

function makeStructureArtifact(id: string): StructureArtifact {
  return {
    id,
    kind: 'structure',
    title: `struct-${id}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payload: {
      cif: 'data_x\n',
      formula: 'Xy',
      spaceGroup: 'P 1',
      latticeParams: { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 },
      transforms: [],
    },
  }
}

function makeComputeProArtifact(
  id: string,
  overrides: Partial<ComputeProArtifact> = {},
): ComputeProArtifact {
  const now = Date.now()
  return {
    id,
    kind: 'compute-pro',
    title: `compute-${id}`,
    createdAt: now,
    updatedAt: now,
    payload: {
      cells: [],
      focusedCellId: null,
      timeoutS: 60,
      health: null,
      status: 'idle',
      ...(overrides.payload ?? {}),
    },
    ...overrides,
  } as ComputeProArtifact
}

beforeEach(resetStore)

// ── Session lifecycle ───────────────────────────────────────────────

describe('createSession / setActiveSession / removeSession', () => {
  it('creates a session, orders it at the head, and seeds it as active when none was active', () => {
    const { createSession } = useRuntimeStore.getState()
    const id = createSession({ title: 'Hello' })
    const state = useRuntimeStore.getState()
    expect(state.sessions[id]).toBeDefined()
    expect(state.sessions[id].title).toBe('Hello')
    expect(state.sessionOrder).toEqual([id])
    expect(state.activeSessionId).toBe(id)
  })

  it('setActiveSession is a no-op when id is unknown', () => {
    const { createSession, setActiveSession } = useRuntimeStore.getState()
    const id = createSession()
    setActiveSession('nonexistent')
    expect(useRuntimeStore.getState().activeSessionId).toBe(id)
  })

  it('removeSession picks the next session in order as active when the removed one was active', () => {
    const s = useRuntimeStore.getState()
    const a = s.createSession({ title: 'A' })
    const b = s.createSession({ title: 'B' })
    // After two creates, order is [b, a] (newest at head) and activeSessionId is A (first seeded).
    expect(useRuntimeStore.getState().sessionOrder).toEqual([b, a])
    expect(useRuntimeStore.getState().activeSessionId).toBe(a)
    useRuntimeStore.getState().removeSession(a)
    const post = useRuntimeStore.getState()
    expect(post.sessions[a]).toBeUndefined()
    expect(post.sessionOrder).toEqual([b])
    // Since `a` was active, the next session in order (`b`) is chosen.
    expect(post.activeSessionId).toBe(b)
  })

  it('removeSession nulls activeSessionId when no sessions remain', () => {
    const s = useRuntimeStore.getState()
    const a = s.createSession()
    useRuntimeStore.getState().removeSession(a)
    expect(useRuntimeStore.getState().activeSessionId).toBeNull()
  })
})

// ── Transcript reducers ─────────────────────────────────────────────

describe('appendTranscript / appendTranscriptIfAbsent', () => {
  it('appends the message in order and touches updatedAt', () => {
    const s = useRuntimeStore.getState()
    const id = s.createSession()
    const before = useRuntimeStore.getState().sessions[id].updatedAt
    s.appendTranscript(
      id,
      baseMessage({ id: 'm1', role: 'user', content: 'hi' }),
    )
    const after = useRuntimeStore.getState().sessions[id]
    expect(after.transcript.map((m) => m.id)).toEqual(['m1'])
    expect(after.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('appendTranscriptIfAbsent is idempotent on duplicate id', () => {
    const s = useRuntimeStore.getState()
    const id = s.createSession()
    s.appendTranscriptIfAbsent(
      id,
      baseMessage({ id: 'm1', role: 'user', content: 'hi' }),
    )
    s.appendTranscriptIfAbsent(
      id,
      baseMessage({ id: 'm1', role: 'user', content: 'hi again' }),
    )
    const t = useRuntimeStore.getState().sessions[id].transcript
    expect(t).toHaveLength(1)
    expect(t[0].content).toBe('hi') // first write wins
  })
})

describe('updateTranscriptMessage / appendToTranscriptContent', () => {
  it('updateTranscriptMessage only replaces the touched message reference', () => {
    const s = useRuntimeStore.getState()
    const id = s.createSession()
    s.appendTranscript(
      id,
      baseMessage({ id: 'm1', role: 'user', content: 'first' }),
    )
    s.appendTranscript(
      id,
      baseMessage({ id: 'm2', role: 'assistant', content: '' }),
    )
    const before = useRuntimeStore.getState().sessions[id].transcript
    s.updateTranscriptMessage(id, 'm2', { content: 'hi' })
    const after = useRuntimeStore.getState().sessions[id].transcript
    // Unchanged message keeps its reference — the `React.memo` bubble-skip
    // in AgentComposer depends on this invariant.
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[1].content).toBe('hi')
  })

  it('appendToTranscriptContent concatenates the delta and flips status to streaming', () => {
    const s = useRuntimeStore.getState()
    const id = s.createSession()
    s.appendTranscript(
      id,
      baseMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Hel',
        status: 'complete',
      }),
    )
    const ok = s.appendToTranscriptContent(id, 'a1', 'lo')
    expect(ok).toBe(true)
    const m = useRuntimeStore.getState().sessions[id].transcript[0]
    expect(m.content).toBe('Hello')
    expect(m.status).toBe('streaming')
  })

  it('appendToTranscriptContent returns false and no-ops when the message does not exist', () => {
    const s = useRuntimeStore.getState()
    const id = s.createSession()
    const ok = s.appendToTranscriptContent(id, 'no-such-msg', 'x')
    expect(ok).toBe(false)
  })
})

describe('removeTranscriptMessage', () => {
  it('removes by id without touching siblings', () => {
    const s = useRuntimeStore.getState()
    const id = s.createSession()
    s.appendTranscript(id, baseMessage({ id: 'a', role: 'user', content: '1' }))
    s.appendTranscript(id, baseMessage({ id: 'b', role: 'user', content: '2' }))
    s.appendTranscript(id, baseMessage({ id: 'c', role: 'user', content: '3' }))
    s.removeTranscriptMessage(id, 'b')
    const t = useRuntimeStore.getState().sessions[id].transcript
    expect(t.map((m) => m.id)).toEqual(['a', 'c'])
  })
})

// ── Artifact upsert / patch / focus ─────────────────────────────────

describe('upsertArtifact / patchArtifact', () => {
  it('upsertArtifact adds the artifact to order exactly once, even across re-upserts', () => {
    const s = useRuntimeStore.getState()
    const id = s.createSession()
    const art = makeStructureArtifact('art_1')
    s.upsertArtifact(id, art)
    s.upsertArtifact(id, { ...art, title: 'renamed' })
    const ses = useRuntimeStore.getState().sessions[id]
    expect(ses.artifactOrder).toEqual(['art_1'])
    expect(ses.artifacts['art_1'].title).toBe('renamed')
  })

  it('upsertArtifact focuses the artifact on first insert and keeps the existing focus otherwise', () => {
    const s = useRuntimeStore.getState()
    const id = s.createSession()
    const a = makeStructureArtifact('a')
    const b = makeStructureArtifact('b')
    s.upsertArtifact(id, a)
    expect(useRuntimeStore.getState().sessions[id].focusedArtifactId).toBe('a')
    s.upsertArtifact(id, b)
    // Focus sticks with 'a' — new artifact doesn't steal focus by default.
    expect(useRuntimeStore.getState().sessions[id].focusedArtifactId).toBe('a')
  })

  it('patchArtifact deep-merges the payload patch onto the existing artifact', () => {
    const s = useRuntimeStore.getState()
    const id = s.createSession()
    const art = makeComputeProArtifact('cp_1')
    s.upsertArtifact(id, art)
    s.patchArtifact(id, 'cp_1', {
      payload: {
        cells: [],
        focusedCellId: 'cell_1',
        timeoutS: 60,
        health: null,
        status: 'idle',
      },
    })
    const next = useRuntimeStore.getState().sessions[id].artifacts[
      'cp_1'
    ] as ComputeProArtifact
    expect(next.payload.focusedCellId).toBe('cell_1')
  })
})
