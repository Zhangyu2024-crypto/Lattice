// Keep every `research-report` artifact in the session-store mirrored to
// `${userData}/research/<sessionId>/<artifactId>.json` so cloud-sync has a
// stable per-file unit to hash & upload.
//
// Strategy: subscribe to session-store, diff on each snapshot vs a
// lightweight `(artifactId -> updatedAt)` table, and queue writes through
// a 1.5 s debounce. On boot, hydrate missing artifacts from disk so a
// second machine (fresh localStorage) starts with the cloud state.
//
// Only `research-report` is mirrored. Other artifact kinds (spectrum, XRD,
// compute outputs, …) stay in-memory — they're generated on demand and
// don't represent durable "writing" work in the sense the user cares about.

import { useRuntimeStore } from '../stores/runtime-store'
import type { Session } from '../types/session'

interface ResearchItem {
  sessionId: string
  artifactId: string
  payload: unknown
  kind: string
  updatedAt: number
}

const DEBOUNCE_MS = 1500

let started = false
let snapshot = new Map<string, number>() // key = `${sessionId}|${artifactId}`, value = updatedAt
let pendingPersist = new Map<string, ResearchItem>()
let pendingDelete = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

function key(sessionId: string, artifactId: string): string {
  return `${sessionId}|${artifactId}`
}

function parseKey(k: string): { sessionId: string; artifactId: string } {
  const [sessionId, artifactId] = k.split('|', 2)
  return { sessionId: sessionId ?? '', artifactId: artifactId ?? '' }
}

function collectResearch(sessions: Record<string, Session>): Map<string, ResearchItem> {
  const out = new Map<string, ResearchItem>()
  for (const session of Object.values(sessions)) {
    for (const artifact of Object.values(session.artifacts)) {
      if (artifact.kind !== 'research-report') continue
      out.set(key(session.id, artifact.id), {
        sessionId: session.id,
        artifactId: artifact.id,
        payload: artifact.payload,
        kind: artifact.kind,
        updatedAt: artifact.updatedAt,
      })
    }
  }
  return out
}

async function flush(): Promise<void> {
  timer = null
  const api = window.electronAPI
  if (!api) return
  const toPersist = Array.from(pendingPersist.values())
  const toDelete = Array.from(pendingDelete).map(parseKey)
  pendingPersist = new Map()
  pendingDelete = new Set()
  // Best-effort — if one call fails, keep going. Failures surface via toast
  // only on explicit user actions (push/pull); mirror errors are logged.
  await Promise.all([
    ...toPersist.map(async (item) => {
      try {
        await api.researchPersist?.(item)
      } catch (err) {
        console.warn('[research-mirror] persist failed', item.artifactId, err)
      }
    }),
    ...toDelete.map(async ({ sessionId, artifactId }) => {
      try {
        await api.researchDelete?.({ sessionId, artifactId })
      } catch (err) {
        console.warn('[research-mirror] delete failed', artifactId, err)
      }
    }),
  ])
}

function scheduleFlush(): void {
  if (timer) return
  timer = setTimeout(() => {
    void flush()
  }, DEBOUNCE_MS)
}

function onStateChange(nextSessions: Record<string, Session>): void {
  const current = collectResearch(nextSessions)
  // Detect inserts + updates by comparing updatedAt against the snapshot.
  for (const [k, item] of current) {
    const prev = snapshot.get(k)
    if (prev === undefined || prev !== item.updatedAt) {
      pendingPersist.set(k, item)
      pendingDelete.delete(k)
    }
  }
  // Detect deletes: keys in snapshot but not in current.
  for (const k of snapshot.keys()) {
    if (!current.has(k)) {
      pendingDelete.add(k)
      pendingPersist.delete(k)
    }
  }
  snapshot = new Map(
    Array.from(current.entries()).map(([k, v]) => [k, v.updatedAt]),
  )
  if (pendingPersist.size > 0 || pendingDelete.size > 0) {
    scheduleFlush()
  }
}

/** Start the mirror. Hydrates disk → store first, then installs the
 *  subscriber and a `beforeunload` flush hook. Idempotent. */
export async function startResearchMirror(): Promise<void> {
  if (started) return
  started = true
  const api = window.electronAPI
  if (!api?.researchList) return

  // Hydrate from disk so machines that have no localStorage but do have
  // synced files still see their content. Disk wins when the disk file is
  // newer; otherwise keep the store entry (the normal case where the user
  // was just working locally).
  try {
    const res = await api.researchList()
    if (res.ok) {
      const store = useRuntimeStore.getState()
      for (const item of res.items) {
        const ses = store.sessions[item.sessionId]
        const existing = ses?.artifacts[item.artifactId]
        if (existing && existing.updatedAt >= item.updatedAt) continue
        if (!ses) continue // Session not yet created — skip; once it exists the next persist catches it up.
        // Minimal patch: merge payload + updatedAt. Type is opaque by design
        // to avoid coupling this helper to the artifact union.
        store.patchArtifact(item.sessionId, item.artifactId, {
          payload: item.payload,
          updatedAt: item.updatedAt,
        } as Parameters<typeof store.patchArtifact>[2])
      }
    }
  } catch (err) {
    console.warn('[research-mirror] hydrate failed', err)
  }

  // Seed the snapshot from the post-hydration store so the first change
  // emits only genuine deltas (not every artifact as "new").
  snapshot = new Map(
    Array.from(collectResearch(useRuntimeStore.getState().sessions).entries()).map(
      ([k, v]) => [k, v.updatedAt],
    ),
  )

  useRuntimeStore.subscribe((state, prev) => {
    if (state.sessions === prev.sessions) return
    onStateChange(state.sessions)
  })

  // `beforeunload` fires on renderer reload / window close — flush so the
  // in-flight 1.5 s debounce doesn't lose the last edit.
  window.addEventListener('beforeunload', () => {
    if (timer) clearTimeout(timer)
    void flush()
  })
}
