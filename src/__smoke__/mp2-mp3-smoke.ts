/**
 * MP-2 / MP-3 smoke test — pure node (no React, no DOM, no Vite).
 *
 * Runs the mention pipeline's public surface end-to-end against the real
 * `useRuntimeStore` instance and two pure helpers (`generateMentionAnchor`,
 * `estimateTokens` / `estimateMentionsBudget`). Intentionally narrow: this
 * script exists to catch regressions where one of those exports
 * disappears, changes shape, or starts throwing under persist rehydrate —
 * it is *not* a substitute for the manual checklist in
 * `docs/MANUAL_TEST_MP2_MP3.md`.
 *
 * Run:
 *   npx tsx src/__smoke__/mp2-mp3-smoke.ts
 *
 * Exit codes: 0 = all checks passed; 1 = at least one check failed.
 */

// ── localStorage polyfill ──────────────────────────────────────────
//
// session-store.ts wraps itself in `persist(..., { storage:
// createJSONStorage(() => localStorage) })`. Under Node there is no
// `globalThis.localStorage`, so importing the module would throw at
// rehydrate time. A minimal in-memory Storage-compatible shim is enough
// to keep persist happy; we wipe it at the top of this file so a previous
// run cannot leak state into this one.
//
// This must run **before** the dynamic import of session-store below.
type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
  key(index: number): string | null
  readonly length: number
}

const installLocalStorageStub = (): void => {
  const g = globalThis as unknown as { localStorage?: StorageLike }
  if (g.localStorage) return
  const store = new Map<string, string>()
  const stub: StorageLike = {
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k, v) => {
      store.set(k, String(v))
    },
    removeItem: (k) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
  g.localStorage = stub
}

installLocalStorageStub()

// ── Test harness ───────────────────────────────────────────────────

type Check = { name: string; fn: () => void | Promise<void> }

const checks: Check[] = []
const test = (name: string, fn: Check['fn']): void => {
  checks.push({ name, fn })
}

// Must be a `function` declaration (not an arrow) for TS to accept the
// `asserts cond` predicate as a control-flow assertion.
function assert(cond: unknown, msg: string): asserts cond {
  // console.assert writes to stderr on failure but does not throw — we
  // pair it with an explicit throw so the harness can count the failure.
  console.assert(cond, msg)
  if (!cond) throw new Error(msg)
}

// ── Imports under test ─────────────────────────────────────────────
//
// Dynamic imports so the localStorage polyfill installs first. We import
// sources by relative path (not `@/` alias) because tsx resolves via
// node's resolver by default; the alias would require an extra loader.

;(async () => {
  const {
    useRuntimeStore,
    selectMentionablesForActiveSession,
    selectRecentMentions,
    resolveMentionPreview,
  } = await import('../stores/runtime-store')
  const { generateMentionAnchor } = await import('../types/mention')
  const { estimateTokens, estimateMentionsBudget } = await import(
    '../lib/token-estimator'
  )

  type PeakFitLike = {
    id: string
    kind: 'peak-fit'
    title: string
    createdAt: number
    updatedAt: number
    sourceFile: string | null
    payload: {
      spectrumId: string | null
      algorithm: string
      peaks: Array<{
        id: string
        index: number
        position: number
        intensity: number
        fwhm: number | null
        area: number | null
        snr: number | null
        label: string
      }>
    }
  }
  type XrdAnalysisLike = {
    id: string
    kind: 'xrd-analysis'
    title: string
    createdAt: number
    updatedAt: number
    sourceFile: string | null
    payload: {
      query: { range: [number, number]; method: 'peak-match' }
      experimentalPattern: {
        x: number[]
        y: number[]
        xLabel: string
        yLabel: string
      }
      phases: Array<{
        id: string
        name: string
        formula: string
        spaceGroup: string
        cifRef: string | null
        confidence: number
        weightFraction: number | null
        matchedPeaks: []
      }>
      rietveld: null
    }
  }

  // Fixture builders — kept inline so the smoke script has zero runtime
  // dependency on the demo stores (which pull in Vite-only modules).
  const now = Date.now()
  const peakFit: PeakFitLike = {
    id: 'art_smoke_peakfit',
    kind: 'peak-fit',
    title: 'Smoke PeakFit',
    createdAt: now,
    updatedAt: now,
    sourceFile: 'smoke/spectrum.csv',
    payload: {
      spectrumId: null,
      algorithm: 'pseudo-voigt',
      peaks: [
        {
          id: 'pk_1',
          index: 0,
          position: 31.72,
          intensity: 1000,
          fwhm: 0.12,
          area: 120.5,
          snr: 48,
          label: 'Peak 1',
        },
        {
          id: 'pk_2',
          index: 1,
          position: 45.55,
          intensity: 640,
          fwhm: 0.18,
          area: 92.3,
          snr: 32,
          label: 'Peak 2',
        },
      ],
    },
  }
  const xrd: XrdAnalysisLike = {
    id: 'art_smoke_xrd',
    kind: 'xrd-analysis',
    title: 'Smoke XRD',
    createdAt: now,
    updatedAt: now,
    sourceFile: 'smoke/spectrum.csv',
    payload: {
      query: { range: [10, 90], method: 'peak-match' },
      experimentalPattern: { x: [], y: [], xLabel: '2θ', yLabel: 'I' },
      phases: [
        {
          id: 'ph_1',
          name: 'Anatase',
          formula: 'TiO2',
          spaceGroup: 'I4₁/amd',
          cifRef: null,
          confidence: 0.92,
          weightFraction: null,
          matchedPeaks: [],
        },
      ],
      rietveld: null,
    },
  }

  // ── Test cases ──────────────────────────────────────────────────

  // Shared session id used across later tests.
  let sid = ''

  test('createSession + upsertArtifact + addFile + focusArtifact wire up state', () => {
    const store = useRuntimeStore.getState()
    sid = store.createSession({ title: 'smoke' })
    assert(typeof sid === 'string' && sid.length > 0, 'createSession did not return an id')

    // Cast away strict Artifact typing — we only exercise the public actions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useRuntimeStore.getState().upsertArtifact(sid, peakFit as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useRuntimeStore.getState().upsertArtifact(sid, xrd as any)
    useRuntimeStore.getState().addFile(sid, {
      relPath: 'smoke/spectrum.csv',
      spectrumType: 'xrd',
      size: 4096,
      importedAt: now,
    })
    // Explicitly focus the peak-fit so the focused-element group is emitted.
    useRuntimeStore.getState().focusArtifact(sid, peakFit.id)

    const ses = useRuntimeStore.getState().sessions[sid]
    assert(ses, 'session not present after createSession')
    assert(ses.artifacts[peakFit.id], 'peak-fit artifact missing from store')
    assert(ses.artifacts[xrd.id], 'xrd artifact missing from store')
    assert(ses.focusedArtifactId === peakFit.id, 'focusedArtifactId did not move to peak-fit')
  })

  test('selectMentionablesForActiveSession returns focused + files + artifacts', () => {
    const state = useRuntimeStore.getState()
    const rows = selectMentionablesForActiveSession(state)
    assert(Array.isArray(rows) && rows.length > 0, 'mentionables empty')
    const groups = new Set(rows.map((r) => r.group))
    assert(groups.has('focused'), 'focused group missing from mentionables')
    assert(groups.has('files'), 'files group missing from mentionables')
    assert(groups.has('artifacts'), 'artifacts group missing from mentionables')

    // Focused rows should reference the peak-fit artifact's peaks.
    const focused = rows.filter((r) => r.group === 'focused')
    assert(focused.length >= 1, 'no focused rows emitted for peak-fit with peaks')
    assert(
      focused.every((r) => r.ref.type === 'artifact-element'),
      'focused row ref is not artifact-element',
    )
  })

  test('selectRecentMentions starts empty and grows via pushRecentMention', () => {
    const initial = selectRecentMentions(useRuntimeStore.getState())
    assert(initial.length === 0, `initial recentMentions expected [], got length ${initial.length}`)

    const ref = {
      type: 'artifact-element' as const,
      sessionId: sid,
      artifactId: peakFit.id,
      elementKind: 'peak' as const,
      elementId: 'pk_1',
      label: 'Peak 1',
    }
    useRuntimeStore.getState().pushRecentMention(sid, ref)

    const after = selectRecentMentions(useRuntimeStore.getState())
    assert(after.length === 1, `recentMentions length after push: ${after.length}`)
    assert(after[0].type === 'artifact-element', 'recent entry lost its type')
  })

  test('resolveMentionPreview handles file / artifact / artifact-element refs', () => {
    const state = useRuntimeStore.getState()

    const filePreview = resolveMentionPreview(state, {
      type: 'file',
      sessionId: sid,
      relPath: 'smoke/spectrum.csv',
    })
    assert(
      typeof filePreview.label === 'string' && filePreview.label.length > 0,
      `file preview missing label: ${JSON.stringify(filePreview)}`,
    )
    assert(!filePreview.missing, 'file preview marked missing unexpectedly')

    const artifactPreview = resolveMentionPreview(state, {
      type: 'artifact',
      sessionId: sid,
      artifactId: peakFit.id,
    })
    assert(
      typeof artifactPreview.label === 'string' && artifactPreview.label.length > 0,
      `artifact preview missing label: ${JSON.stringify(artifactPreview)}`,
    )
    assert(!artifactPreview.missing, 'artifact preview marked missing unexpectedly')

    const elementPreview = resolveMentionPreview(state, {
      type: 'artifact-element',
      sessionId: sid,
      artifactId: peakFit.id,
      elementKind: 'peak',
      elementId: 'pk_1',
      label: 'Peak 1',
    })
    assert(
      typeof elementPreview.label === 'string' && elementPreview.label.length > 0,
      `element preview missing label: ${JSON.stringify(elementPreview)}`,
    )
    assert(!elementPreview.missing, 'element preview marked missing unexpectedly')

    // Missing element should degrade gracefully, not throw.
    const ghost = resolveMentionPreview(state, {
      type: 'artifact-element',
      sessionId: sid,
      artifactId: peakFit.id,
      elementKind: 'peak',
      elementId: 'pk_does_not_exist',
      label: 'Ghost',
    })
    assert(ghost.missing === true, 'missing element preview did not flag missing')
  })

  test('generateMentionAnchor returns a unique 5-char base36 token', () => {
    const anchor = generateMentionAnchor(new Set())
    assert(typeof anchor === 'string', `anchor type: ${typeof anchor}`)
    assert(anchor.length === 5, `anchor length: ${anchor.length} (expected 5)`)
    assert(/^[0-9a-z]{5}$/.test(anchor), `anchor format invalid: "${anchor}"`)

    // Uniqueness sanity — 20 draws should all succeed and avoid supplied
    // collisions.
    const used = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const next = generateMentionAnchor(used)
      assert(!used.has(next), `anchor collision on draw ${i}: ${next}`)
      used.add(next)
    }
  })

  test('estimateTokens produces positive integers for non-empty text', () => {
    const n = estimateTokens('hello world')
    assert(typeof n === 'number' && Number.isInteger(n), `token count not int: ${n}`)
    assert(n > 0, `expected > 0 tokens for "hello world", got ${n}`)
    assert(estimateTokens('') === 0, 'empty string should cost 0 tokens')
    // Chinese should cost more per char than ASCII under the heuristic.
    // Han script via escapes — keeps repo free of CJK source literals.
    assert(estimateTokens('\u4f60\u597d\u4e16\u754c') > 0, 'CJK tokens should be > 0')
  })

  test('estimateMentionsBudget sums a batch and filters bad values', () => {
    const total = estimateMentionsBudget([
      { tokenEstimate: 100 },
      { tokenEstimate: 50 },
    ])
    assert(total === 150, `expected 150, got ${total}`)

    const robust = estimateMentionsBudget([
      { tokenEstimate: 100 },
      { tokenEstimate: Number.NaN },
      { tokenEstimate: -5 },
      { tokenEstimate: Number.POSITIVE_INFINITY },
      { tokenEstimate: 50 },
    ])
    assert(robust === 150, `bad-value filter broken, got ${robust}`)

    assert(estimateMentionsBudget([]) === 0, 'empty batch should be 0')
  })

  // ── Runner ──────────────────────────────────────────────────────

  let passed = 0
  let failed = 0
  for (const c of checks) {
    try {
      await c.fn()
      console.log(`  ok  — ${c.name}`)
      passed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  FAIL — ${c.name}\n         ${msg}`)
      failed++
    }
  }

  if (failed > 0) {
    console.error(`\nSMOKE FAIL: ${failed} failed, ${passed} passed (of ${checks.length})`)
    process.exit(1)
  }
  console.log(`\nSMOKE OK \u2705  ${passed}/${checks.length} checks passed`)
})().catch((err) => {
  // Catastrophic failure — module load, async wiring, etc. Print the stack
  // so CI logs surface the real cause.
  console.error('SMOKE FAIL: unhandled error')
  console.error(err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
