import type { LocalTool } from '../../types/agent-tool'
import type { Artifact, StructureArtifact } from '../../types/artifact'
import { parseCif, type CifSite, type LatticeParams } from '../cif'
import { useRuntimeStore } from '../../stores/runtime-store'

interface Input {
  artifactId?: string
  /** Pair-distance cutoff in Å used to enumerate bonds. Defaults to 3.0. */
  maxBondLengthAng?: number
  /** Cap on reported bond rows so large supercells don't blow up tool output. */
  topK?: number
}

interface BondRow {
  i: number
  j: number
  elementI: string
  elementJ: string
  distanceAng: number
}

interface SuccessOutput {
  success: true
  artifactId: string
  formula: string
  spaceGroup: string
  density: number | null
  cellVolume: number
  bondLengths: BondRow[]
  summary: string
}

interface ErrorOutput {
  success: false
  error: string
}

type Output = SuccessOutput | ErrorOutput

/** Atomic masses (amu) for the first four rows. Missing elements fall back
 *  to `null` for density and are called out in the summary. Kept inline so
 *  the tool stays self-contained — a full periodic table lives server-side. */
const ATOMIC_MASS: Record<string, number> = {
  H: 1.008, He: 4.0026,
  Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.18,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
  K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938,
  Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63,
  As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798,
  Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95, Tc: 98, Ru: 101.07,
  Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76,
  Te: 127.6, I: 126.9, Xe: 131.29,
  Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24, Sm: 150.36,
  Eu: 151.96, Gd: 157.25, Tb: 158.93, Dy: 162.5, Ho: 164.93, Er: 167.26, Tm: 168.93,
  Yb: 173.05, Lu: 174.97, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23,
  Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59, Tl: 204.38, Pb: 207.2, Bi: 208.98,
}

const AVOGADRO = 6.02214076e23
/** Converts Å³ × (g/mol) → g/cm³ : 1 Å³ = 1e-24 cm³ so divisor is N_A × 1e-24. */
const DENSITY_PREFACTOR = 1 / (AVOGADRO * 1e-24)

function deg2rad(d: number): number {
  return (d * Math.PI) / 180
}

/** Row-major lattice matrix: rows = a⃗, b⃗, c⃗ in Cartesian with a⃗ ∥ +x. */
function latticeVectors(p: LatticeParams): [number[], number[], number[]] {
  const ca = Math.cos(deg2rad(p.alpha))
  const cb = Math.cos(deg2rad(p.beta))
  const cg = Math.cos(deg2rad(p.gamma))
  const sg = Math.sin(deg2rad(p.gamma))
  const ax = p.a
  const bx = p.b * cg
  const by = p.b * sg
  const cx = p.c * cb
  const cy = p.c * ((ca - cb * cg) / (sg || 1e-12))
  const cz = Math.sqrt(Math.max(1e-24, p.c * p.c - cx * cx - cy * cy))
  return [
    [ax, 0, 0],
    [bx, by, 0],
    [cx, cy, cz],
  ]
}

function fracToCart(site: CifSite, vecs: ReturnType<typeof latticeVectors>): [number, number, number] {
  const [a, b, c] = vecs
  return [
    site.fx * a[0] + site.fy * b[0] + site.fz * c[0],
    site.fx * a[1] + site.fy * b[1] + site.fz * c[1],
    site.fx * a[2] + site.fy * b[2] + site.fz * c[2],
  ]
}

function cellVolume(vecs: ReturnType<typeof latticeVectors>): number {
  const [a, b, c] = vecs
  const cross = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  return Math.abs(c[0] * cross[0] + c[1] * cross[1] + c[2] * cross[2])
}

function computeDensity(sites: CifSite[], volumeAng3: number): { value: number | null; missing: string[] } {
  const missing = new Set<string>()
  let massAmu = 0
  for (const s of sites) {
    const m = ATOMIC_MASS[s.element]
    if (m == null) {
      missing.add(s.element)
      continue
    }
    massAmu += m * s.occ
  }
  if (missing.size > 0 || volumeAng3 <= 0) {
    return { value: null, missing: [...missing] }
  }
  // ρ (g/cm³) = (M_cell · DENSITY_PREFACTOR) / V(Å³)
  return { value: (massAmu * DENSITY_PREFACTOR) / volumeAng3, missing: [] }
}

function isStructureArtifact(a: Artifact | undefined): a is StructureArtifact {
  return !!a && a.kind === 'structure'
}

export const structureAnalyzeTool: LocalTool<Input, Output> = {
  name: 'structure_analyze',
  description:
    'Compute geometric summary of a structure artifact: cell volume, density (when atomic masses are known), space group (from CIF), and nearest-neighbour bond lengths up to a cutoff. Pure JS — no Python worker required.',
  trustLevel: 'safe',
  cardMode: 'info',
  contextParams: ['artifactId'],
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Structure artifact id. Falls back to focused artifact when omitted.',
      },
      maxBondLengthAng: {
        type: 'number',
        description: 'Bond cutoff in Å (default 3.0).',
      },
      topK: {
        type: 'number',
        description: 'Max bond rows to return (default 50).',
      },
    },
  },
  async execute(input, ctx) {
    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) {
      return { success: false, error: `Session not found: ${ctx.sessionId}` }
    }
    const targetId = input?.artifactId ?? session.focusedArtifactId
    if (!targetId) {
      return {
        success: false,
        error: 'No artifactId provided and no focused artifact in the session.',
      }
    }
    const artifact = session.artifacts[targetId]
    if (!isStructureArtifact(artifact)) {
      return {
        success: false,
        error: `Artifact ${targetId} is not a structure artifact (kind=${artifact?.kind ?? 'missing'}).`,
      }
    }

    let parsed
    try {
      parsed = parseCif(artifact.payload.cif)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `CIF parse failed: ${msg}` }
    }

    const cutoff = Math.max(0.1, input?.maxBondLengthAng ?? 3.0)
    const topK = Math.max(1, input?.topK ?? 50)
    const vecs = latticeVectors(parsed.lattice)
    const vol = cellVolume(vecs)
    const density = computeDensity(parsed.sites, vol)

    // Intra-cell O(N²) pair scan. Large supercells are slow — the topK cap
    // still holds but the scan itself is O(N²). Acceptable for MVP since
    // the structure artifact is expected to be the primitive / small
    // supercell; a future worker-backed version can replicate neighbours
    // and handle PBC properly.
    const carts = parsed.sites.map((s) => fracToCart(s, vecs))
    const bonds: BondRow[] = []
    for (let i = 0; i < parsed.sites.length; i++) {
      for (let j = i + 1; j < parsed.sites.length; j++) {
        const dx = carts[i][0] - carts[j][0]
        const dy = carts[i][1] - carts[j][1]
        const dz = carts[i][2] - carts[j][2]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d > 0 && d <= cutoff) {
          bonds.push({
            i,
            j,
            elementI: parsed.sites[i].element,
            elementJ: parsed.sites[j].element,
            distanceAng: d,
          })
        }
      }
    }
    bonds.sort((a, b) => a.distanceAng - b.distanceAng)
    const topBonds = bonds.slice(0, topK)

    const densityStr =
      density.value != null
        ? `${density.value.toFixed(3)} g/cm³`
        : density.missing.length > 0
          ? `unavailable (missing atomic masses for: ${density.missing.join(', ')})`
          : 'unavailable'
    const summary =
      `${artifact.payload.formula} — V=${vol.toFixed(2)} Å³, ρ=${densityStr}, ` +
      `${bonds.length} bond(s) within ${cutoff.toFixed(2)} Å` +
      (bonds.length > topK ? ` (top ${topK} returned)` : '')

    return {
      success: true,
      artifactId: artifact.id,
      formula: artifact.payload.formula,
      spaceGroup: parsed.spaceGroup ?? artifact.payload.spaceGroup ?? 'P 1',
      density: density.value,
      cellVolume: vol,
      bondLengths: topBonds,
      summary,
    }
  },
}
