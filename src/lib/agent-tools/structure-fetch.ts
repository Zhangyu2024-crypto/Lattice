import type { LocalTool } from '../../types/agent-tool'
import type {
  StructureArtifact,
  StructureArtifactPayload,
  StructureTransform,
} from '../../types/artifact'
import {
  computeFormula,
  computeLatticeParams,
  parseCif,
  writeCif,
} from '../cif'
import { genArtifactId, useRuntimeStore } from '../../stores/runtime-store'

interface Input {
  mpId: string
}

interface SuccessOutput {
  success: true
  artifactId: string
  mpId: string
  formula: string
  spaceGroup: string
  summary: string
}

interface ErrorOutput {
  success: false
  error: string
}

type Output = SuccessOutput | ErrorOutput

const MP_API_KEY_HINT =
  'Set an MP_API_KEY environment variable (electron) or VITE_MP_API_KEY (renderer) and restart. Obtain a key at https://materialsproject.org/api.'

/**
 * Resolve a Materials Project API key from (in order):
 *   1. Renderer-visible Vite env (`VITE_MP_API_KEY`).
 *   2. Node / electron-main env (`process.env.MP_API_KEY`) — present when the
 *      renderer is bundled with nodeIntegration or the tool runs in main.
 *
 * The renderer normally can't read `process.env` at runtime, but Vite's
 * `define` can inline it at build time and some dev harnesses expose it.
 */
function resolveMpApiKey(): string | null {
  try {
    const viteKey = (import.meta as unknown as { env?: Record<string, string | undefined> })
      .env?.VITE_MP_API_KEY
    if (typeof viteKey === 'string' && viteKey.length > 0) return viteKey
  } catch {
    // import.meta not available — ignore.
  }
  if (
    typeof process !== 'undefined' &&
    process.env &&
    typeof process.env.MP_API_KEY === 'string' &&
    process.env.MP_API_KEY.length > 0
  ) {
    return process.env.MP_API_KEY
  }
  return null
}

function normalizeMpId(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  return trimmed.startsWith('mp-') ? trimmed : `mp-${trimmed}`
}

interface MpResponseDoc {
  material_id?: string
  formula_pretty?: string
  symmetry?: { symbol?: string; crystal_system?: string }
  structure?: { cif?: string }
  cif?: string
}

export const structureFetchTool: LocalTool<Input, Output> = {
  name: 'structure_fetch',
  description:
    'Fetch a crystal structure from Materials Project by mp-id (e.g. "mp-149") and register it as a structure artifact. Requires an MP API key via MP_API_KEY / VITE_MP_API_KEY; returns a graceful error pointing to Settings when the key is absent.',
  trustLevel: 'localWrite',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      mpId: {
        type: 'string',
        description: 'Materials Project id, e.g. "mp-149" or "149".',
      },
    },
    required: ['mpId'],
  },
  async execute(input, ctx) {
    if (!input?.mpId || typeof input.mpId !== 'string') {
      return { success: false, error: 'mpId is required (string)' }
    }
    const mpId = normalizeMpId(input.mpId)
    if (!/^mp-\d+$/.test(mpId)) {
      return {
        success: false,
        error: `Invalid Materials Project id: "${input.mpId}" (expected "mp-<number>")`,
      }
    }

    const apiKey = resolveMpApiKey()
    if (!apiKey) {
      return {
        success: false,
        error: `Materials Project API key not configured. ${MP_API_KEY_HINT}`,
      }
    }

    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) {
      return { success: false, error: `Session not found: ${ctx.sessionId}` }
    }

    // Materials Project v2 REST — cheapest payload that carries the CIF.
    const url = `https://api.materialsproject.org/materials/summary/${encodeURIComponent(mpId)}/?_fields=material_id,formula_pretty,symmetry,structure`
    let doc: MpResponseDoc | null = null
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: ctx.signal,
        headers: {
          'X-API-KEY': apiKey,
          Accept: 'application/json',
        },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return {
          success: false,
          error: `Materials Project request failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
        }
      }
      const json = (await res.json()) as { data?: MpResponseDoc[] } | MpResponseDoc
      if (Array.isArray((json as { data?: unknown }).data)) {
        doc = (json as { data: MpResponseDoc[] }).data[0] ?? null
      } else {
        doc = json as MpResponseDoc
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        return { success: false, error: 'Fetch aborted.' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Network error: ${msg}` }
    }

    if (!doc) {
      return { success: false, error: `No data returned for ${mpId}` }
    }

    const rawCif = doc.structure?.cif ?? doc.cif
    if (!rawCif || typeof rawCif !== 'string') {
      return {
        success: false,
        error: `Materials Project response for ${mpId} did not include a CIF (endpoint may have changed — consider the pymatgen-based backend).`,
      }
    }

    try {
      const parsed = parseCif(rawCif)
      const canonicalCif = writeCif(parsed)
      const formula = doc.formula_pretty ?? computeFormula(parsed.sites)
      const spaceGroup = doc.symmetry?.symbol ?? parsed.spaceGroup ?? 'P 1'
      const lattice = computeLatticeParams(parsed)
      const now = Date.now()
      const transform: StructureTransform = {
        id: `xfm_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: 'import',
        params: { source: 'materials-project', mpId },
        appliedAt: now,
        note: `Fetched ${mpId}`,
      }
      const payload: StructureArtifactPayload = {
        cif: canonicalCif,
        formula,
        spaceGroup,
        latticeParams: lattice,
        transforms: [transform],
      }
      const artifact: StructureArtifact = {
        id: genArtifactId(),
        kind: 'structure',
        title: `${mpId} — ${formula}`,
        createdAt: now,
        updatedAt: now,
        payload,
      }
      useRuntimeStore.getState().upsertArtifact(ctx.sessionId, artifact)

      // Phase 7c — dual-file structure write.
      if (ctx.orchestrator?.fs) {
        try {
          const slug = `${mpId}-${formula}`
            .toLowerCase().replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '').slice(0, 48)
          await ctx.orchestrator.emitStructureArtifact(
            canonicalCif,
            {
              formula,
              spaceGroup,
              latticeParams: lattice,
              transforms: payload.transforms,
              mpId,
            },
            {
              basename: `${slug}-${artifact.id.slice(-6)}`,
              id: artifact.id,
              meta: { title: artifact.title, artifactId: artifact.id },
            },
          )
        } catch (err) {
          console.warn('[structure_fetch] workspace emit failed', err)
        }
      }

      return {
        success: true,
        artifactId: artifact.id,
        mpId,
        formula,
        spaceGroup,
        summary: `Fetched ${mpId}: ${formula} (${spaceGroup})`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        error: `Failed to parse CIF returned for ${mpId}: ${msg}`,
      }
    }
  },
}
