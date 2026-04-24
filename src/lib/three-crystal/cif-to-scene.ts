/**
 * CIF-to-scene-JSON bridge. Converts a `ParsedCif` into a
 * `SceneJsonObject` that `CrystalScene.addToScene()` can render.
 *
 * Handles: atom spheres, auto-detected bonds, unit cell wireframe,
 * coordinate axes, and optional multi-cell replication.
 */

import type { ParsedCif, CifSite } from '@/lib/cif/types'
import { latticeMatrix, matMulVec, type Mat3, type Vec3 } from '@/lib/cif/math'
import type { StructureStyleMode } from '@/components/canvas/artifacts/structure/StructureViewer'
import {
  elementColor,
  elementCovalentRadius,
} from './element-data'
import { JSON3DObject, type SceneJsonChild, type SceneJsonObject, type ThreePosition } from './types'

// ── Public types ────────────────────────────────────────────────────

export interface CifToSceneOptions {
  style: StructureStyleMode
  showUnitCell: boolean
  showAxes: boolean
  replication?: { nx: number; ny: number; nz: number }
  showElementLabels?: boolean
}

export interface AtomInfo {
  index: number
  element: string
  x: number
  y: number
  z: number
}

// ── Style parameters ────────────────────────────────────────────────

/** Sphere radius per style mode. */
function atomRadius(style: StructureStyleMode, element: string): number {
  const cov = elementCovalentRadius(element)
  switch (style) {
    case 'sphere':
      return cov * 0.8
    case 'ball-stick':
      return cov * 0.4
    case 'stick':
      return cov * 0.2
  }
}

/** Bond cylinder radius per style mode. */
function bondRadius(style: StructureStyleMode): number {
  switch (style) {
    case 'sphere':
      return 0.06
    case 'ball-stick':
      return 0.08
    case 'stick':
      return 0.10
  }
}

/** Bond detection threshold multiplier applied to the sum of covalent radii. */
const BOND_THRESHOLD = 1.2

// ── Main converter ──────────────────────────────────────────────────

/**
 * Convert a parsed CIF into a scene JSON tree. This is the only function
 * the lifecycle hook calls — everything else is internal.
 */
export function cifToScene(
  parsed: ParsedCif,
  opts: CifToSceneOptions,
): SceneJsonObject {
  const mat = latticeMatrix(parsed.lattice)
  const contents: SceneJsonChild[] = []

  // Expand atoms with optional replication.
  const expandedSites = expandSites(parsed.sites, opts.replication)

  // Convert fractional to Cartesian.
  const cartesians: Vec3[] = expandedSites.map((s) =>
    matMulVec(mat, [s.fx, s.fy, s.fz]),
  )

  // ── Atom spheres ──────────────────────────────────────────────────
  const atomPositions: ThreePosition[] = []
  const atomColors: string[] = []
  const atomRadii: number[] = []

  for (let i = 0; i < expandedSites.length; i++) {
    const site = expandedSites[i]
    atomPositions.push(cartesians[i] as ThreePosition)
    atomColors.push(elementColor(site.element))
    atomRadii.push(atomRadius(opts.style, site.element))
  }

  // Group by (color, radius) to minimise geometry objects.
  const sphereGroups = groupSpheres(atomPositions, atomColors, atomRadii)
  for (const group of sphereGroups) {
    contents.push({
      type: JSON3DObject.SPHERES,
      positions: group.positions,
      color: group.color,
      radius: group.radius,
      clickable: true,
    })
  }

  // ── Bonds (auto-detect) ───────────────────────────────────────────
  const bondPairs = detectBonds(expandedSites, cartesians)
  if (bondPairs.length > 0) {
    contents.push({
      type: JSON3DObject.CYLINDERS,
      positionPairs: bondPairs,
      radius: bondRadius(opts.style),
      color: '#808080',
    })
  }

  // ── Unit cell wireframe ───────────────────────────────────────────
  if (opts.showUnitCell) {
    contents.push(unitCellLines(mat))
  }

  // ── Axes ──────────────────────────────────────────────────────────
  if (opts.showAxes) {
    contents.push(...axisArrows())
  }

  // ── Element labels ────────────────────────────────────────────────
  if (opts.showElementLabels) {
    for (let i = 0; i < expandedSites.length; i++) {
      const pos = cartesians[i] as ThreePosition
      contents.push({
        type: JSON3DObject.LABEL,
        label: expandedSites[i].element,
        positions: [pos],
      })
    }
  }

  return {
    name: 'crystal',
    contents,
  }
}

// ── Atom info extraction (for click matching) ───────────────────────

export function extractAtomInfo(
  parsed: ParsedCif,
  replication?: { nx: number; ny: number; nz: number },
): AtomInfo[] {
  const mat = latticeMatrix(parsed.lattice)
  const expanded = expandSites(parsed.sites, replication)
  return expanded.map((site, i) => {
    const [x, y, z] = matMulVec(mat, [site.fx, site.fy, site.fz])
    return { index: i, element: site.element, x, y, z }
  })
}

// ── Internals ───────────────────────────────────────────────────────

/** Replicate sites across nx x ny x nz cells. */
function expandSites(
  sites: CifSite[],
  rep?: { nx: number; ny: number; nz: number },
): CifSite[] {
  const nx = rep?.nx ?? 1
  const ny = rep?.ny ?? 1
  const nz = rep?.nz ?? 1
  if (nx <= 1 && ny <= 1 && nz <= 1) return sites

  const out: CifSite[] = []
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        for (const s of sites) {
          out.push({
            ...s,
            fx: s.fx + ix,
            fy: s.fy + iy,
            fz: s.fz + iz,
          })
        }
      }
    }
  }
  return out
}

/** Group atoms that share the same (color, radius) to reduce draw calls. */
function groupSpheres(
  positions: ThreePosition[],
  colors: string[],
  radii: number[],
): Array<{ color: string; radius: number; positions: ThreePosition[] }> {
  const map = new Map<string, { color: string; radius: number; positions: ThreePosition[] }>()
  for (let i = 0; i < positions.length; i++) {
    const key = `${colors[i]}|${radii[i].toFixed(4)}`
    let group = map.get(key)
    if (!group) {
      group = { color: colors[i], radius: radii[i], positions: [] }
      map.set(key, group)
    }
    group.positions.push(positions[i])
  }
  return Array.from(map.values())
}

/** Auto-detect bonds: distance < sum of covalent radii * threshold. */
function detectBonds(
  sites: CifSite[],
  cartesians: Vec3[],
): [ThreePosition, ThreePosition][] {
  const pairs: [ThreePosition, ThreePosition][] = []
  const n = sites.length
  // For large structures (>500 atoms) skip auto-detection to stay fast.
  if (n > 500) return pairs

  for (let i = 0; i < n; i++) {
    const ri = elementCovalentRadius(sites[i].element)
    for (let j = i + 1; j < n; j++) {
      const rj = elementCovalentRadius(sites[j].element)
      const thresh = (ri + rj) * BOND_THRESHOLD
      const dx = cartesians[i][0] - cartesians[j][0]
      const dy = cartesians[i][1] - cartesians[j][1]
      const dz = cartesians[i][2] - cartesians[j][2]
      const d2 = dx * dx + dy * dy + dz * dz
      // Minimum bond distance of 0.4 Angstrom to avoid self-overlaps.
      if (d2 > 0.16 && d2 < thresh * thresh) {
        pairs.push([
          cartesians[i] as ThreePosition,
          cartesians[j] as ThreePosition,
        ])
      }
    }
  }
  return pairs
}

/** Generate line-segment pairs for the 12 edges of the unit cell. */
function unitCellLines(mat: Mat3): SceneJsonChild {
  const o: Vec3 = [0, 0, 0]
  const a = matMulVec(mat, [1, 0, 0])
  const b = matMulVec(mat, [0, 1, 0])
  const c = matMulVec(mat, [0, 0, 1])
  const ab = matMulVec(mat, [1, 1, 0])
  const ac = matMulVec(mat, [1, 0, 1])
  const bc = matMulVec(mat, [0, 1, 1])
  const abc = matMulVec(mat, [1, 1, 1])

  // 12 edges of the parallelepiped, each as a pair of XYZ triples.
  const positions: ThreePosition[] = [
    // Bottom face (z=0 fractional).
    ...o, ...a,
    ...a, ...ab,
    ...ab, ...b,
    ...b, ...o,
    // Top face (z=1 fractional).
    ...c, ...ac,
    ...ac, ...abc,
    ...abc, ...bc,
    ...bc, ...c,
    // Vertical pillars.
    ...o, ...c,
    ...a, ...ac,
    ...b, ...bc,
    ...ab, ...abc,
  ] as unknown as ThreePosition[]

  return {
    type: JSON3DObject.LINES,
    positions,
    color: '#888888',
    line_width: 1,
  }
}

/** Three axis arrows at the origin: x (light), y (mid), z (dark). */
function axisArrows(): SceneJsonChild[] {
  const axes: Array<{ dir: ThreePosition; color: string; label: string }> = [
    { dir: [1, 0, 0], color: '#E8E8E8', label: 'x' },
    { dir: [0, 1, 0], color: '#989898', label: 'y' },
    { dir: [0, 0, 1], color: '#585858', label: 'z' },
  ]

  return axes.map(({ dir, color }) => ({
    type: JSON3DObject.ARROWS,
    positionPairs: [[[0, 0, 0] as ThreePosition, dir]],
    radius: 0.04,
    headLength: 0.18,
    headWidth: 0.10,
    color,
  }))
}
