/**
 * 3x3 matrix + 3-vector helpers used by the slab transform.
 *
 * Matrices are column-major: entries [0..2] form column a, [3..5] column
 * b, [6..8] column c. That matches the convention in `latticeMatrix`
 * where each column is one lattice vector expressed in Cartesian.
 */

import type { LatticeParams } from './types'

export type Mat3 = [number, number, number, number, number, number, number, number, number]
export type Vec3 = [number, number, number]

export const DEG2RAD = Math.PI / 180

/**
 * Build the column-major Cartesian lattice matrix for (a, b, c, α, β, γ).
 * Columns are the three lattice vectors a⃗, b⃗, c⃗ in a convention where
 * a⃗ is along +x, b⃗ in the xy-plane, c⃗ is the remaining vector.
 */
export function latticeMatrix(p: LatticeParams): Mat3 {
  const ca = Math.cos(p.alpha * DEG2RAD)
  const cb = Math.cos(p.beta * DEG2RAD)
  const cg = Math.cos(p.gamma * DEG2RAD)
  const sg = Math.sin(p.gamma * DEG2RAD)

  const ax = p.a
  const ay = 0
  const az = 0
  const bx = p.b * cg
  const by = p.b * sg
  const bz = 0
  const cx = p.c * cb
  const cyy = p.c * ((ca - cb * cg) / (sg || 1e-12))
  const czz = Math.sqrt(Math.max(1e-24, p.c * p.c - cx * cx - cyy * cyy))

  // column-major: m[0..2] = column a; [3..5] = column b; [6..8] = column c
  return [ax, ay, az, bx, by, bz, cx, cyy, czz]
}

export function matDet(m: Mat3): number {
  const a = m[0], b = m[3], c = m[6]
  const d = m[1], e = m[4], f = m[7]
  const g = m[2], h = m[5], i = m[8]
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

export function matInverse(m: Mat3): Mat3 {
  const a = m[0], b = m[3], c = m[6]
  const d = m[1], e = m[4], f = m[7]
  const g = m[2], h = m[5], i = m[8]
  const det = matDet(m)
  if (Math.abs(det) < 1e-12) throw new Error('Singular lattice matrix')
  const inv = 1 / det
  return [
    (e * i - f * h) * inv,
    -(d * i - f * g) * inv,
    (d * h - e * g) * inv,
    -(b * i - c * h) * inv,
    (a * i - c * g) * inv,
    -(a * h - b * g) * inv,
    (b * f - c * e) * inv,
    -(a * f - c * d) * inv,
    (a * e - b * d) * inv,
  ]
}

export function matMulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ]
}

export function vecLen(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

export function vecDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

export function scaleVec(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

/** Derive (a, b, c, α, β, γ) from three column Cartesian lattice vectors. */
export function latticeParamsFromMatrix(m: Mat3): LatticeParams {
  const a: Vec3 = [m[0], m[1], m[2]]
  const b: Vec3 = [m[3], m[4], m[5]]
  const c: Vec3 = [m[6], m[7], m[8]]
  const la = vecLen(a)
  const lb = vecLen(b)
  const lc = vecLen(c)
  const alpha = Math.acos(vecDot(b, c) / (lb * lc + 1e-24)) / DEG2RAD
  const beta = Math.acos(vecDot(a, c) / (la * lc + 1e-24)) / DEG2RAD
  const gamma = Math.acos(vecDot(a, b) / (la * lb + 1e-24)) / DEG2RAD
  return { a: la, b: lb, c: lc, alpha, beta, gamma }
}
