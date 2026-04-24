// Shared "CIF text → Structure artifact" factory.
//
// Both the `structure_from_cif` tool (raw paste) and `build_structure`
// tool (LLM → pymatgen → CIF) go through here so they produce an
// identical artifact shape, provenance row, and workspace file layout.
// Split out from `structure-from-cif.ts` so a renderer-side UI caller
// (the "Add Structure" modal) can invoke the same pipeline without
// dragging in the full agent-tool contract.

import {
  computeFormula,
  computeLatticeParams,
  parseCif,
  writeCif,
} from './cif'
import { genArtifactId, useRuntimeStore } from '../stores/runtime-store'
import type { OrchestratorCtx } from './agent/orchestrator-ctx'
import type {
  StructureArtifact,
  StructureArtifactPayload,
  StructureTransform,
} from '../types/artifact'

/** Cartesian cell volume from (a, b, c, α, β, γ). Kept here so the
 *  tool's summary line and the modal's toast can agree on the number
 *  without either depending on a fuller matrix helper. */
export function cellVolumeFromLattice(
  a: number,
  b: number,
  c: number,
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): number {
  const toRad = Math.PI / 180
  const ca = Math.cos(alphaDeg * toRad)
  const cb = Math.cos(betaDeg * toRad)
  const cg = Math.cos(gammaDeg * toRad)
  const inner = 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg
  if (inner <= 0) return 0
  return a * b * c * Math.sqrt(inner)
}

export interface CreateStructureFromCifArgs {
  sessionId: string
  /** Raw CIF text — must parse as P1 with explicit atom coords.
   *  Upstream source is either a user paste or pymatgen stdout. */
  cif: string
  /** Display title override. When omitted, the helper derives a title
   *  from `titleMode`. */
  title?: string
  /** How to auto-derive the title when `title` is unset:
   *   `'formula'`   → just the formula ("BaTiO3"). Best for
   *                   structures that will be loaded by slug from
   *                   LAMMPS / CP2K cells — the ACTIVE_CIFS key becomes
   *                   a clean `batio3` instead of `structure_batio3`.
   *   `'prefixed'`  → `"Structure — <formula>"` (default). Friendlier
   *                   when the artifact is shown in a long list of
   *                   mixed-kind artifacts. */
  titleMode?: 'formula' | 'prefixed'
  /** `StructureTransform.kind` stamped on the provenance row. The kind
   *  union is fixed (supercell/dope/surface/defect/import) so both
   *  paste and LLM flows use `'import'` and differentiate via
   *  `transformParams.source`. */
  transformKind?: StructureTransform['kind']
  /** Freeform params captured on the provenance transform (e.g.
   *  `{ source: 'structure_from_cif' }` or
   *  `{ source: 'build_structure', description: '...' }`). */
  transformParams?: Record<string, unknown>
  /** Human-readable note on the transform row. */
  transformNote?: string
  /** Optional orchestrator hookup — when provided, the helper also
   *  writes `.cif` + `.structure.meta.json` to the workspace so the
   *  structure survives page reloads. No-op otherwise. */
  orchestrator?: OrchestratorCtx | null
}

export interface CreatedStructure {
  artifact: StructureArtifact
  formula: string
  spaceGroup: string
  cellVolume: number
  atomCount: number
}

/** Parse CIF, build the artifact, upsert to runtime-store, and
 *  (optionally) persist to the workspace. Throws on malformed CIF so
 *  the caller can surface a clean toast. */
export async function createStructureFromCif(
  args: CreateStructureFromCifArgs,
): Promise<CreatedStructure> {
  const session = useRuntimeStore.getState().sessions[args.sessionId]
  if (!session) {
    throw new Error(`Session not found: ${args.sessionId}`)
  }

  const parsed = parseCif(args.cif)
  const canonicalCif = writeCif(parsed)
  const formula = computeFormula(parsed.sites)
  const lattice = computeLatticeParams(parsed)
  const spaceGroup = parsed.spaceGroup ?? 'P 1'
  const cellVolume = cellVolumeFromLattice(
    lattice.a,
    lattice.b,
    lattice.c,
    lattice.alpha,
    lattice.beta,
    lattice.gamma,
  )

  const now = Date.now()
  const transform: StructureTransform = {
    id: `xfm_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind: args.transformKind ?? 'import',
    params: args.transformParams ?? {},
    appliedAt: now,
    note: args.transformNote ?? 'Imported from CIF',
  }
  const payload: StructureArtifactPayload = {
    cif: canonicalCif,
    formula,
    spaceGroup,
    latticeParams: lattice,
    transforms: [transform],
  }
  const derivedTitle =
    args.titleMode === 'formula' ? formula : `Structure — ${formula}`
  const artifact: StructureArtifact = {
    id: genArtifactId(),
    kind: 'structure',
    title: args.title?.trim() || derivedTitle,
    createdAt: now,
    updatedAt: now,
    payload,
  }
  useRuntimeStore.getState().upsertArtifact(args.sessionId, artifact)

  // Workspace emission is best-effort — a missing root just skips the
  // write. Errors are logged and swallowed so a filesystem glitch
  // doesn't lose the in-memory artifact the user just built.
  if (args.orchestrator?.fs) {
    try {
      const slug =
        formula
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 48) || 'structure'
      await args.orchestrator.emitStructureArtifact(
        canonicalCif,
        {
          formula,
          spaceGroup,
          latticeParams: lattice,
          transforms: payload.transforms,
        },
        {
          basename: `${slug}-${artifact.id.slice(-6)}`,
          id: artifact.id,
          meta: { title: artifact.title, artifactId: artifact.id },
        },
      )
    } catch (err) {
      console.warn('[structure-builder] workspace emit failed', err)
    }
  }

  return {
    artifact,
    formula,
    spaceGroup,
    cellVolume,
    atomCount: parsed.sites.length,
  }
}
