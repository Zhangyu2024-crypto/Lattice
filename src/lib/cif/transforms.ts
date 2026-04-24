/**
 * Crystal-structure transforms that take and return `ParsedCif`.
 *
 * Four operations live here:
 *   - `supercell` — replicate the unit cell along each axis.
 *   - `dope`      — random element substitution, deterministic per seed.
 *   - `slabHkl`   — build a slab perpendicular to a Miller plane + vacuum.
 *   - `oxygenVacancy` — remove one O atom (or any specified site).
 *
 * Plus two derived-property helpers (`computeFormula`,
 * `computeLatticeParams`) that read-only a `ParsedCif`.
 *
 * All four structural transforms set `spaceGroup` to `'P 1'` on the
 * output because they operate on explicit atom lists and do not attempt
 * to preserve Wyckoff positions.
 */

import type { CifSite, LatticeParams, ParsedCif } from './types'
import {
  formatStoich,
  mulberry32,
  wrap01,
} from './helpers'
import {
  latticeMatrix,
  latticeParamsFromMatrix,
  matDet,
  matInverse,
  matMulVec,
  scaleVec,
  vecCross,
  vecDot,
  vecLen,
  type Mat3,
  type Vec3,
} from './math'

// ─── Derived helpers ──────────────────────────────────────────────────

export function computeFormula(sites: CifSite[]): string {
  const counts = new Map<string, number>()
  for (const s of sites) {
    counts.set(s.element, (counts.get(s.element) ?? 0) + s.occ)
  }
  const entries = Array.from(counts.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )
  const minCount = entries.reduce(
    (m, [, v]) => (v > 0 && v < m ? v : m),
    Number.POSITIVE_INFINITY,
  )
  const divisor = minCount === Number.POSITIVE_INFINITY ? 1 : minCount
  return entries
    .map(([el, n]) => {
      const ratio = n / divisor
      const rounded = Math.abs(ratio - Math.round(ratio)) < 0.05 ? Math.round(ratio) : ratio
      return rounded === 1 ? el : `${el}${typeof rounded === 'number' ? formatStoich(rounded) : rounded}`
    })
    .join('')
}

export function computeLatticeParams(parsed: ParsedCif): LatticeParams {
  return { ...parsed.lattice }
}

// ─── Transform 1: Supercell ───────────────────────────────────────────

export function supercell(
  parsed: ParsedCif,
  nx: number,
  ny: number,
  nz: number,
): ParsedCif {
  if (nx < 1 || ny < 1 || nz < 1) {
    throw new Error('Supercell dimensions must be ≥ 1')
  }
  const newSites: CifSite[] = []
  for (const s of parsed.sites) {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        for (let k = 0; k < nz; k++) {
          newSites.push({
            label: `${s.label}_${i}${j}${k}`,
            element: s.element,
            fx: (s.fx + i) / nx,
            fy: (s.fy + j) / ny,
            fz: (s.fz + k) / nz,
            occ: s.occ,
          })
        }
      }
    }
  }
  return {
    dataBlock: parsed.dataBlock + `_SC${nx}${ny}${nz}`,
    lattice: {
      ...parsed.lattice,
      a: parsed.lattice.a * nx,
      b: parsed.lattice.b * ny,
      c: parsed.lattice.c * nz,
    },
    spaceGroup: 'P 1',
    sites: newSites,
  }
}

// ─── Transform 2: Dope (element substitution) ─────────────────────────

export function dope(
  parsed: ParsedCif,
  opts: {
    targetElement: string
    dopant: string
    fraction: number
    seed?: number
  },
): ParsedCif {
  if (opts.fraction < 0 || opts.fraction > 1) {
    throw new Error('Dope fraction must be in [0, 1]')
  }
  const rand = mulberry32(opts.seed ?? 42)
  const newSites: CifSite[] = parsed.sites.map((s) => {
    if (s.element !== opts.targetElement) return s
    if (rand() < opts.fraction) {
      return {
        ...s,
        element: opts.dopant,
        label: s.label.replace(new RegExp(`^${opts.targetElement}`), opts.dopant),
      }
    }
    return s
  })
  return {
    dataBlock: `${parsed.dataBlock}_doped`,
    lattice: parsed.lattice,
    spaceGroup: 'P 1',
    sites: newSites,
  }
}

// ─── Transform 3: Miller-indexed slab (Surface) ───────────────────────

/**
 * Build a slab oriented perpendicular to the (hkl) plane, `slabLayers`
 * unit-cell-equivalents thick along the new z axis, with `vacuumAngstrom`
 * of vacuum added to the top of the slab.
 *
 * Algorithm (geometric MVP):
 *   1. Compute Cartesian lattice matrix A from (a,b,c,α,β,γ).
 *   2. Compute plane normal n̂ from reciprocal lattice: n⃗ = h·b₁* + k·b₂* + l·b₃*.
 *   3. Search integer combinations of lattice vectors (i,j,k ∈ [-3..3]) for
 *      three that (a) span a non-degenerate basis, (b) give the shortest
 *      two in-plane vectors (perp to n̂), and (c) give the shortest vector
 *      with positive component along n̂ (the "stacking" vector).
 *   4. Build the new lattice matrix A' with these three vectors; the third
 *      column is repeated `slabLayers` times to make the slab thick.
 *   5. Re-express each original atom in the new fractional basis and wrap
 *      into the new unit cell. For the MVP we collect every atom whose
 *      new z-fractional lies in [0, 1) after modulo wrapping — this is
 *      approximate for polar structures but correct for cubic/tetragonal.
 *   6. Add vacuum: grow c by `vacuumAngstrom`, renormalize z so all atoms
 *      sit in the lower portion of the expanded cell.
 *
 * Caveats: not Wyckoff-aware. Polar terminations handled naively. Users
 * should verify visually in the 3Dmol viewer.
 */
export function slabHkl(
  parsed: ParsedCif,
  opts: {
    h: number
    k: number
    l: number
    slabLayers: number
    vacuumAngstrom: number
  },
): ParsedCif {
  const { h, k, l, slabLayers, vacuumAngstrom } = opts
  if (h === 0 && k === 0 && l === 0) {
    throw new Error('Surface Miller index cannot be (0,0,0)')
  }
  if (slabLayers < 1) throw new Error('Slab layers must be ≥ 1')

  const A = latticeMatrix(parsed.lattice)
  const aVec: Vec3 = [A[0], A[1], A[2]]
  const bVec: Vec3 = [A[3], A[4], A[5]]
  const cVec: Vec3 = [A[6], A[7], A[8]]

  // Reciprocal lattice (drop the 2π prefactor — only direction matters for n̂).
  const vol = matDet(A)
  if (Math.abs(vol) < 1e-12) throw new Error('Degenerate lattice')
  const bStar1 = scaleVec(vecCross(bVec, cVec), 1 / vol)
  const bStar2 = scaleVec(vecCross(cVec, aVec), 1 / vol)
  const bStar3 = scaleVec(vecCross(aVec, bVec), 1 / vol)
  const nRaw: Vec3 = [
    h * bStar1[0] + k * bStar2[0] + l * bStar3[0],
    h * bStar1[1] + k * bStar2[1] + l * bStar3[1],
    h * bStar1[2] + k * bStar2[2] + l * bStar3[2],
  ]
  const nLen = vecLen(nRaw)
  if (nLen < 1e-12) throw new Error('Plane normal has zero length')
  const nHat: Vec3 = [nRaw[0] / nLen, nRaw[1] / nLen, nRaw[2] / nLen]

  // Enumerate integer combinations and classify as in-plane vs stacking.
  const candidates: Array<{ ijk: Vec3; vec: Vec3; length: number; perp: number }> = []
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      for (let kk = -3; kk <= 3; kk++) {
        if (i === 0 && j === 0 && kk === 0) continue
        const v: Vec3 = [
          i * aVec[0] + j * bVec[0] + kk * cVec[0],
          i * aVec[1] + j * bVec[1] + kk * cVec[1],
          i * aVec[2] + j * bVec[2] + kk * cVec[2],
        ]
        const length = vecLen(v)
        const perp = vecDot(v, nHat)
        candidates.push({ ijk: [i, j, kk], vec: v, length, perp })
      }
    }
  }
  // In-plane candidates: |perp| ≈ 0
  const inPlane = candidates
    .filter((c) => Math.abs(c.perp) < 1e-6)
    .sort((x, y) => x.length - y.length)
  if (inPlane.length < 2) {
    throw new Error(`No integer lattice vectors found in the (${h},${k},${l}) plane within the ±3 search window`)
  }
  const u = inPlane[0].vec
  let v: Vec3 | null = null
  for (let idx = 1; idx < inPlane.length; idx++) {
    const candidate = inPlane[idx].vec
    // Reject vectors parallel to u.
    const cross = vecCross(u, candidate)
    if (vecLen(cross) > 1e-6) {
      v = candidate
      break
    }
  }
  if (!v) throw new Error('Could not find a second in-plane vector')

  // Stacking vector: shortest with positive perp.
  const stacking = candidates
    .filter((c) => c.perp > 1e-6)
    .sort((x, y) => x.length - y.length)[0]
  if (!stacking) throw new Error('No lattice vector with positive component along the plane normal')
  const t = scaleVec(stacking.vec, slabLayers)

  // Build the new lattice matrix with columns u, v, t.
  const Aprime: Mat3 = [u[0], u[1], u[2], v[0], v[1], v[2], t[0], t[1], t[2]]
  const AprimeInv = matInverse(Aprime)

  // For each atom in the original unit cell, compute Cartesian position
  // and re-express in A'. Because the new basis covers a larger volume,
  // we also sample replicas of the original cell so we don't miss atoms.
  const newSites: CifSite[] = []
  const sampleRange = 3
  for (const s of parsed.sites) {
    for (let i = -sampleRange; i <= sampleRange; i++) {
      for (let j = -sampleRange; j <= sampleRange; j++) {
        for (let kk = -sampleRange; kk <= sampleRange; kk++) {
          const frac: Vec3 = [s.fx + i, s.fy + j, s.fz + kk]
          const cart = matMulVec(A, frac)
          const newFrac = matMulVec(AprimeInv, cart)
          if (
            newFrac[0] >= -1e-6 && newFrac[0] < 1 - 1e-6 &&
            newFrac[1] >= -1e-6 && newFrac[1] < 1 - 1e-6 &&
            newFrac[2] >= -1e-6 && newFrac[2] < 1 - 1e-6
          ) {
            newSites.push({
              label: s.label,
              element: s.element,
              fx: wrap01(newFrac[0]),
              fy: wrap01(newFrac[1]),
              fz: wrap01(newFrac[2]),
              occ: s.occ,
            })
          }
        }
      }
    }
  }
  // Dedupe (atoms that landed on the boundary between sample cells).
  const dedup = new Map<string, CifSite>()
  for (const s of newSites) {
    const key = `${s.element}:${s.fx.toFixed(4)},${s.fy.toFixed(4)},${s.fz.toFixed(4)}`
    if (!dedup.has(key)) dedup.set(key, s)
  }
  const atomsInSlab = Array.from(dedup.values())

  // Add vacuum: grow c_new by vacuumAngstrom along the current z axis of
  // the new cell; renormalize z fractional coords.
  let newLattice = latticeParamsFromMatrix(Aprime)
  const originalC = newLattice.c
  const newC = originalC + vacuumAngstrom
  const scale = originalC / newC
  for (const s of atomsInSlab) {
    s.fz = s.fz * scale
  }
  newLattice = { ...newLattice, c: newC }

  // Relabel uniquely in the new cell.
  const relabeled = atomsInSlab.map((s, idx) => ({
    ...s,
    label: `${s.element}${idx + 1}`,
  }))

  return {
    dataBlock: `${parsed.dataBlock}_slab${h}${k}${l}`,
    lattice: newLattice,
    spaceGroup: 'P 1',
    sites: relabeled,
  }
}

// ─── Transform 4: O-Vacancy defect ────────────────────────────────────

export function oxygenVacancy(
  parsed: ParsedCif,
  opts?: { siteIndex?: number },
): ParsedCif {
  const idx = opts?.siteIndex ?? parsed.sites.findIndex((s) => s.element === 'O')
  if (idx < 0 || idx >= parsed.sites.length) {
    throw new Error('No oxygen atom found to remove')
  }
  const newSites = parsed.sites.filter((_, i) => i !== idx)
  return {
    dataBlock: `${parsed.dataBlock}_Ovac`,
    lattice: parsed.lattice,
    spaceGroup: 'P 1',
    sites: newSites,
  }
}
