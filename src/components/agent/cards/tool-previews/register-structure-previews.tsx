// Side-effect module: wires the structure_* agent-tool preview resolvers
// into the shared preview registry. Imported from AgentCard alongside the
// other register-* files so the side-effect fires exactly once at
// AgentCard bundle load.

import {
  isStructureArtifact,
  type StructureArtifact,
} from '../../../../types/artifact'
import { registerToolPreview } from '../preview-registry'
import { compactList, listRow } from '../preview-registry/helpers'

// ─── structure_from_cif ───────────────────────────────────────────────

interface StructureFromCifOut {
  formula?: string
  spaceGroup?: string
  cellVolume?: number
}

registerToolPreview('structure_from_cif', (step, artifact) => {
  const out = (step.output ?? {}) as StructureFromCifOut
  const structure = artifact && isStructureArtifact(artifact)
    ? (artifact as StructureArtifact)
    : null
  const formula = out.formula ?? structure?.payload.formula
  const sg = out.spaceGroup ?? structure?.payload.spaceGroup
  const lp = structure?.payload.latticeParams
  const oneLiner = [formula, sg].filter(Boolean).join(' · ')
  return {
    oneLiner: oneLiner || undefined,
    compact: lp ? (
      compactList([
        listRow('a, b, c (Å)', `${lp.a.toFixed(3)}, ${lp.b.toFixed(3)}, ${lp.c.toFixed(3)}`, 'abc'),
        listRow('α, β, γ (°)', `${lp.alpha.toFixed(2)}, ${lp.beta.toFixed(2)}, ${lp.gamma.toFixed(2)}`, 'angles'),
      ])
    ) : undefined,
  }
})

// ─── structure_fetch ──────────────────────────────────────────────────

interface StructureFetchOut {
  mpId?: string
  formula?: string
  spaceGroup?: string
}

function cellVolumeFromLattice(
  a: number, b: number, c: number,
  alphaDeg: number, betaDeg: number, gammaDeg: number,
): number {
  const toRad = Math.PI / 180
  const ca = Math.cos(alphaDeg * toRad)
  const cb = Math.cos(betaDeg * toRad)
  const cg = Math.cos(gammaDeg * toRad)
  const inner = 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg
  if (inner <= 0) return 0
  return a * b * c * Math.sqrt(inner)
}

registerToolPreview('structure_fetch', (step, artifact) => {
  const out = (step.output ?? {}) as StructureFetchOut
  const structure = artifact && isStructureArtifact(artifact)
    ? (artifact as StructureArtifact)
    : null
  const mpId = out.mpId
  const formula = out.formula ?? structure?.payload.formula
  const lp = structure?.payload.latticeParams
  const vol = lp
    ? cellVolumeFromLattice(lp.a, lp.b, lp.c, lp.alpha, lp.beta, lp.gamma)
    : null
  const parts: string[] = []
  if (mpId) parts.push(mpId)
  if (formula) parts.push(formula)
  if (vol != null && vol > 0) parts.push(`V=${vol.toFixed(2)} Å³`)
  return {
    oneLiner: parts.join(' · ') || undefined,
  }
})

// ─── structure_analyze ────────────────────────────────────────────────

interface BondRow {
  elementI?: string
  elementJ?: string
  distanceAng?: number
}
interface StructureAnalyzeOut {
  density?: number | null
  cellVolume?: number
  bondLengths?: BondRow[]
  formula?: string
}

registerToolPreview('structure_analyze', (step) => {
  const out = (step.output ?? {}) as StructureAnalyzeOut
  const density = out.density
  const vol = out.cellVolume
  const bonds = out.bondLengths ?? []
  const top5 = bonds.slice(0, 5)
  const headParts: string[] = []
  if (out.formula) headParts.push(out.formula)
  if (typeof vol === 'number') headParts.push(`V=${vol.toFixed(2)} Å³`)
  if (typeof density === 'number') headParts.push(`ρ=${density.toFixed(3)} g/cm³`)
  return {
    oneLiner: headParts.join(' · ') || undefined,
    compact: top5.length > 0
      ? compactList(
          top5.map((b, i) =>
            listRow(
              `${b.elementI ?? '?'}–${b.elementJ ?? '?'}`,
              typeof b.distanceAng === 'number' ? `${b.distanceAng.toFixed(3)} Å` : '',
              i,
            ),
          ),
        )
      : undefined,
  }
})

// ─── structure_modify ─────────────────────────────────────────────────

interface StructureModifyOut {
  sourceFormula?: string
  formula?: string
  operation?: string
  summary?: string
}

registerToolPreview('structure_modify', (step) => {
  const out = (step.output ?? {}) as StructureModifyOut
  const before = out.sourceFormula
  const after = out.formula
  const oneLiner = before && after
    ? `${before} → ${after}${out.operation ? ` · ${out.operation}` : ''}`
    : out.summary
  return {
    oneLiner,
  }
})
