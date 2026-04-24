// Monotonic ID generation + one-time initialization for the local store.
//
// IDB object stores here use numeric keyPaths, but we generate the ids
// ourselves so new rows keep monotonically increasing without relying
// on autoIncrement (which would reset if a store were ever recreated).
// `ensureInit` is the module-wide gate: every exported public operation
// awaits it before touching any store.

import { openDb } from './schema'
import { getAll } from './transactions'
import type { DbChain, DbExtraction, DbProject } from './types'

let nextExtractionId = 1
let nextChainId = 1
let nextNodeId = 1
let nextProjectId = 1

async function initIds(): Promise<void> {
  const extractions = await getAll<DbExtraction>('extractions')
  const chains = await getAll<DbChain>('chains')
  const projects = await getAll<DbProject>('projects')
  nextExtractionId = extractions.length > 0
    ? Math.max(...extractions.map((e) => e.id)) + 1
    : 1
  nextChainId = chains.length > 0
    ? Math.max(...chains.map((c) => c.id)) + 1
    : 1
  nextNodeId = chains.length > 0
    ? Math.max(...chains.flatMap((c) => c.nodes.map((n) => n.id ?? 0))) + 1
    : 1
  nextProjectId = projects.length > 0
    ? Math.max(...projects.map((p) => p.id)) + 1
    : 1
}

let initialized = false
export async function ensureInit(): Promise<void> {
  if (initialized) return
  await openDb()
  await initIds()
  initialized = true
}

// Reserve-next helpers. Each call returns the current value and
// post-increments the counter, matching the original `nextXId++`
// semantics exactly.
export function reserveExtractionId(): number {
  return nextExtractionId++
}

export function reserveChainId(): number {
  return nextChainId++
}

export function reserveNodeId(): number {
  return nextNodeId++
}

export function reserveProjectId(): number {
  return nextProjectId++
}
