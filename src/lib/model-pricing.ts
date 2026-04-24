import type { LLMModel, LLMPricing, LLMProviderType } from '../types/llm'

// LiteLLM maintains a ~500-model price table; raw GitHub serves it with
// CORS headers, so the renderer can fetch it directly. Swap this URL via
// env at build time if an air-gapped deployment needs to host its own
// mirror — the shape is documented at the top of the upstream JSON.
const LITELLM_JSON_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const CACHE_KEY = 'lattice:pricing-catalog'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// LiteLLM prices are per-token in USD. We multiply by 1e6 to fit the
// project's `perMillion` convention throughout token-estimator.ts /
// computeCost. Fields we actually consume — the upstream shape has many
// more (max_tokens, litellm_provider, etc.) that we ignore here.
interface RawEntry {
  input_cost_per_token?: number
  output_cost_per_token?: number
  cache_read_input_token_cost?: number
  cache_creation_input_token_cost?: number
}

interface CatalogCache {
  fetchedAt: number
  sourceUrl: string
  entries: Record<string, RawEntry>
}

export interface PricingCatalog {
  fetchedAt: number
  sourceUrl: string
  size: number
  lookup(providerType: LLMProviderType, modelId: string): LLMPricing | null
}

function readCache(): CatalogCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CatalogCache
    if (
      typeof parsed?.fetchedAt !== 'number' ||
      !parsed.entries ||
      typeof parsed.entries !== 'object'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCache(cache: CatalogCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Storage quota / disabled — non-fatal, we just lose the cache.
  }
}

function toPricing(entry: RawEntry): LLMPricing | null {
  const input = entry.input_cost_per_token
  const output = entry.output_cost_per_token
  if (typeof input !== 'number' || typeof output !== 'number') return null
  const result: LLMPricing = {
    inputPerMillion: input * 1_000_000,
    outputPerMillion: output * 1_000_000,
  }
  if (typeof entry.cache_read_input_token_cost === 'number') {
    result.cacheReadPerMillion = entry.cache_read_input_token_cost * 1_000_000
  }
  if (typeof entry.cache_creation_input_token_cost === 'number') {
    result.cacheCreatePerMillion =
      entry.cache_creation_input_token_cost * 1_000_000
  }
  return result
}

// Model ids in the catalog sometimes carry a provider prefix
// (`anthropic/claude-...`), sometimes not, and the provider's own `/v1/models`
// endpoint returns whichever form it prefers. We try exact match, prefixed,
// then unprefixed, then a loose suffix match — in that order — so the worst
// case is one full-table scan per lookup (cheap, ~500 entries).
function lookupPricing(
  entries: Record<string, RawEntry>,
  providerType: LLMProviderType,
  modelId: string,
): LLMPricing | null {
  const direct = [
    modelId,
    `${providerType}/${modelId}`,
    modelId.replace(/^(anthropic|openai|openrouter)\//, ''),
  ]
  for (const k of direct) {
    const entry = entries[k]
    if (entry) {
      const priced = toPricing(entry)
      if (priced) return priced
    }
  }
  const suffix = '/' + modelId
  for (const [k, v] of Object.entries(entries)) {
    if (k.endsWith(suffix)) {
      const priced = toPricing(v)
      if (priced) return priced
    }
  }
  return null
}

function buildCatalog(cache: CatalogCache): PricingCatalog {
  return {
    fetchedAt: cache.fetchedAt,
    sourceUrl: cache.sourceUrl,
    size: Object.keys(cache.entries).length,
    lookup: (providerType, modelId) =>
      lookupPricing(cache.entries, providerType, modelId),
  }
}

export class PricingCatalogFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'PricingCatalogFetchError'
  }
}

/**
 * Returns the pricing catalog, fresh if within TTL or forced, otherwise
 * re-fetches from LiteLLM. Throws `PricingCatalogFetchError` on network
 * failure — callers that want best-effort behaviour should catch and fall
 * back to the cached result via `getCachedPricingCatalog()`.
 */
export async function getPricingCatalog(
  options: { forceRefresh?: boolean } = {},
): Promise<PricingCatalog> {
  if (!options.forceRefresh) {
    const cached = readCache()
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return buildCatalog(cached)
    }
  }

  let resp: Response
  try {
    resp = await fetch(LITELLM_JSON_URL, { cache: 'no-cache' })
  } catch (err) {
    throw new PricingCatalogFetchError(
      err instanceof Error ? err.message : 'network error',
    )
  }
  if (!resp.ok) {
    throw new PricingCatalogFetchError(
      `HTTP ${resp.status} ${resp.statusText}`,
      resp.status,
    )
  }
  const raw = (await resp.json()) as Record<string, unknown>
  const entries: Record<string, RawEntry> = {}
  for (const [k, v] of Object.entries(raw)) {
    // Skip the `sample_spec` meta key and any non-object entries.
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      entries[k] = v as RawEntry
    }
  }
  const cache: CatalogCache = {
    fetchedAt: Date.now(),
    sourceUrl: LITELLM_JSON_URL,
    entries,
  }
  writeCache(cache)
  return buildCatalog(cache)
}

/** Returns the cached catalog without triggering a fetch, or null. */
export function getCachedPricingCatalog(): PricingCatalog | null {
  const cached = readCache()
  return cached ? buildCatalog(cached) : null
}

export interface ApplyPricingOutcome {
  models: LLMModel[]
  priced: number
  skipped: number
}

/**
 * Merge pricing into a model list. Rule: never overwrite an entry whose
 * current pricing is non-zero — treat that as user-customised or ground
 * truth from llm-defaults. Zero-priced models (the common case after a
 * fresh fetch) get looked up and filled in.
 */
export function applyPricingToModels(
  models: LLMModel[],
  catalog: PricingCatalog,
  providerType: LLMProviderType,
): ApplyPricingOutcome {
  let priced = 0
  let skipped = 0
  const next = models.map((m) => {
    const hasCustom =
      m.pricing.inputPerMillion > 0 || m.pricing.outputPerMillion > 0
    if (hasCustom) {
      skipped += 1
      return m
    }
    const found = catalog.lookup(providerType, m.id)
    if (!found) return m
    priced += 1
    return { ...m, pricing: found }
  })
  return { models: next, priced, skipped }
}
