// Write-side operations against the knowledge store.
// Each entry point calls `ensureInit()` before touching the DB, matching
// the original single-file implementation. Counter allocation goes
// through the `reserve*` helpers so the in-memory id state stays owned
// by `./init`.

import type { ChainNode } from '../../../types/library-api'
import {
  CURRENT_EXTRACTOR_VERSION,
  LEGACY_EXTRACTOR_VERSION,
  type ChainQuality,
} from '../extractor-version'
import {
  evaluateChainQuality,
  type EvaluableChain,
  type QualityVerdict,
} from '../quality-evaluator'
import {
  ensureInit,
  reserveChainId,
  reserveExtractionId,
  reserveNodeId,
  reserveProjectId,
} from './init'
import { del, getAll, getAllByIndex, put } from './transactions'
import type { DbChain, DbExtraction, DbProject } from './types'

export async function createExtraction(params: {
  paper_id?: number | null
  doi?: string
  title: string
  source_path?: string
  project_id?: number | null
}): Promise<number> {
  await ensureInit()
  const id = reserveExtractionId()
  const row: DbExtraction = {
    id,
    paper_id: params.paper_id ?? null,
    doi: params.doi ?? '',
    title: params.title,
    source_path: params.source_path ?? '',
    extracted_at: new Date().toISOString(),
    section_count: 0,
    table_count: 0,
    chain_count: 0,
    node_count: 0,
    rejected_count: 0,
    project_id: params.project_id ?? null,
    tags: [],
  }
  await put('extractions', row)
  return id
}

export interface InsertChainsOptions {
  /** Stamp written onto each chain. Defaults to the legacy tag so
   *  callers who haven't opted into the v2 gate don't silently claim
   *  the current version. */
  extractor_version?: string
  /** Quality evaluator. Rejected chains are not persisted; accepted and
   *  diagnostic chains are written with the corresponding `quality`
   *  field. When absent, all shape-valid chains are written as
   *  `quality='legacy'` (matching pre-v2 behavior). */
  evaluator?: (chain: EvaluableChain) => QualityVerdict
  /** If set, overrides the evaluator's verdict for chains that would
   *  otherwise be accepted. Used by the auto-extract heuristic fallback
   *  to force its output to `diagnostic` even when it happens to pass
   *  the gate — heuristic output is never trusted as first-class. */
  qualityFloor?: ChainQuality
}

export interface InsertChainsResult {
  chainIds: number[]
  accepted: number
  diagnostic: number
  rejected: number
  /** Rejected chains with their reasons and a short preview — callers
   *  surface these in the Log Console / diagnostics view so users can
   *  see why a chain was dropped. Not persisted. */
  rejectedDetails: Array<{
    reasons: string[]
    preview: string
  }>
}

type RawInsertChain = {
  nodes: Array<Omit<ChainNode, 'id' | 'chain_id'>>
  confidence?: number
  domain_type?: string
  chain_type?: string
  context_text?: string
  context_section?: string
}

function toEvaluable(raw: RawInsertChain): EvaluableChain {
  return {
    nodes: raw.nodes.map((n) => ({
      role: n.role,
      name: n.name,
      value: n.value,
      unit: n.unit,
    })),
    context_text: raw.context_text,
    context_section: raw.context_section,
  }
}

function clampFloor(
  verdict: QualityVerdict['verdict'],
  floor?: ChainQuality,
): ChainQuality {
  if (verdict === 'rejected') return 'diagnostic' // unreachable — rejected never reaches this path
  if (!floor) return verdict
  // diagnostic floor only demotes 'accepted' → 'diagnostic'; it never
  // promotes a diagnostic verdict to accepted.
  if (floor === 'diagnostic' && verdict === 'accepted') return 'diagnostic'
  if (floor === 'legacy') return 'legacy'
  return verdict
}

export async function insertChains(
  extractionId: number,
  chains: RawInsertChain[],
  opts: InsertChainsOptions = {},
): Promise<InsertChainsResult> {
  await ensureInit()
  const extractorVersion = opts.extractor_version ?? LEGACY_EXTRACTOR_VERSION
  const chainIds: number[] = []
  const rejectedDetails: InsertChainsResult['rejectedDetails'] = []
  let accepted = 0
  let diagnostic = 0
  let rejected = 0

  for (const raw of chains) {
    const verdict = opts.evaluator
      ? opts.evaluator(toEvaluable(raw))
      : ({ verdict: 'accepted' as const, reasons: [] } satisfies QualityVerdict)

    if (verdict.verdict === 'rejected') {
      rejected += 1
      rejectedDetails.push({
        reasons: verdict.reasons,
        preview: summarizeChain(raw),
      })
      continue
    }

    let quality: ChainQuality
    if (opts.evaluator) {
      quality = clampFloor(verdict.verdict, opts.qualityFloor)
    } else {
      // No evaluator = legacy write (manual selection extraction, tests).
      // We still respect an explicit floor so callers can force a quality.
      quality = opts.qualityFloor ?? 'legacy'
    }

    if (quality === 'accepted') accepted += 1
    else if (quality === 'diagnostic') diagnostic += 1

    const chainId = reserveChainId()
    const nodes: ChainNode[] = raw.nodes.map((n, i) => ({
      id: reserveNodeId(),
      chain_id: chainId,
      ordinal: n.ordinal ?? i,
      role: n.role,
      name: n.name,
      value: n.value,
      value_numeric: n.value_numeric ?? (n.value != null ? parseFloat(n.value) || undefined : undefined),
      unit: n.unit,
      metadata: n.metadata,
    }))
    const chain: DbChain = {
      id: chainId,
      extraction_id: extractionId,
      domain_type: raw.domain_type ?? 'materials',
      chain_type: raw.chain_type ?? '',
      extractor_version: extractorVersion,
      quality,
      context_text: raw.context_text ?? '',
      context_section: raw.context_section ?? '',
      confidence: raw.confidence ?? 0.5,
      nodes,
    }
    await put('chains', chain)
    chainIds.push(chainId)
  }
  await updateExtractionCounts(extractionId, rejected)
  return { chainIds, accepted, diagnostic, rejected, rejectedDetails }
}

function summarizeChain(raw: RawInsertChain): string {
  const parts = raw.nodes.slice(0, 4).map((n) => `${n.role}:${n.name}`)
  return parts.join(' → ')
}

async function updateExtractionCounts(
  extractionId: number,
  rejectedDelta: number,
): Promise<void> {
  const chains = await getAllByIndex<DbChain>('chains', 'extraction_id', extractionId)
  const extractions = await getAll<DbExtraction>('extractions')
  const ext = extractions.find((e) => e.id === extractionId)
  if (!ext) return
  ext.chain_count = chains.length
  ext.node_count = chains.reduce((sum, c) => sum + c.nodes.length, 0)
  ext.rejected_count = (ext.rejected_count ?? 0) + rejectedDelta
  await put('extractions', ext)
}

export async function deleteExtraction(id: number): Promise<boolean> {
  await ensureInit()
  const chains = await getAllByIndex<DbChain>('chains', 'extraction_id', id)
  for (const c of chains) await del('chains', c.id)
  await del('extractions', id)
  return true
}

/** Bulk-delete all chains produced by a given extractor version. Used
 *  by the "Clear v1 legacy" action in the knowledge browser when a user
 *  wants to purge old heuristic data instead of just hiding it. Returns
 *  the number of chains removed. */
export async function clearChainsByVersion(
  version: string,
): Promise<{ chainsRemoved: number; extractionsPruned: number }> {
  await ensureInit()
  const allChains = await getAll<DbChain>('chains')
  const doomed = allChains.filter((c) => (c.extractor_version ?? LEGACY_EXTRACTOR_VERSION) === version)
  for (const c of doomed) await del('chains', c.id)

  // Prune extractions that no longer have any chains attached.
  const remaining = await getAll<DbChain>('chains')
  const stillAlive = new Set(remaining.map((c) => c.extraction_id))
  const extractions = await getAll<DbExtraction>('extractions')
  let extractionsPruned = 0
  for (const ext of extractions) {
    if (!stillAlive.has(ext.id)) {
      await del('extractions', ext.id)
      extractionsPruned += 1
    }
  }
  return { chainsRemoved: doomed.length, extractionsPruned }
}

export async function addTag(extractionId: number, tag: string): Promise<boolean> {
  await ensureInit()
  const extractions = await getAll<DbExtraction>('extractions')
  const ext = extractions.find((e) => e.id === extractionId)
  if (!ext) return false
  if (!ext.tags.includes(tag)) {
    ext.tags.push(tag)
    await put('extractions', ext)
  }
  return true
}

export async function removeTag(extractionId: number, tag: string): Promise<boolean> {
  await ensureInit()
  const extractions = await getAll<DbExtraction>('extractions')
  const ext = extractions.find((e) => e.id === extractionId)
  if (!ext) return false
  ext.tags = ext.tags.filter((t) => t !== tag)
  await put('extractions', ext)
  return true
}

export async function createProject(name: string, description?: string, keywords?: string[]): Promise<number> {
  await ensureInit()
  const id = reserveProjectId()
  const proj: DbProject = {
    id,
    name,
    description: description ?? '',
    keywords: keywords ?? [],
    color: '#3C5488',
    created_at: new Date().toISOString(),
  }
  await put('projects', proj)
  return id
}

// Re-exports so callers who construct the evaluator inline still have
// access. The default v2 pipeline (auto-extract) passes the evaluator
// explicitly; one-off callers can pull it from here.
export { CURRENT_EXTRACTOR_VERSION, LEGACY_EXTRACTOR_VERSION, evaluateChainQuality }
