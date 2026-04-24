// Geometry helpers for the structure viewer's measurement / polyhedra
// tools. Pure math, no React, no 3Dmol — kept dependency-free so the
// same code can later run inside a worker if measurement counts ever
// blow up. Inputs are cartesian-coordinate atoms as 3Dmol exposes them.

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Euclidean distance in Å between two cartesian points. */
export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Bond angle (in degrees) at vertex `b`, formed by the rays b→a and
 * b→c. Returns 0 when either ray is degenerate (zero-length); callers
 * should validate atom selections before calling but the guard avoids
 * NaN in the rare collinear / coincident case.
 */
export function angle(a: Vec3, b: Vec3, c: Vec3): number {
  const ba: Vec3 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
  const bc: Vec3 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z }
  const lenBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y + ba.z * ba.z)
  const lenBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y + bc.z * bc.z)
  if (lenBA === 0 || lenBC === 0) return 0
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z
  // Clamp to [-1, 1] to absorb floating-point noise around collinear
  // configurations — without this acos can NaN at exactly 180°.
  const cosTheta = Math.max(-1, Math.min(1, dot / (lenBA * lenBC)))
  return (Math.acos(cosTheta) * 180) / Math.PI
}

/**
 * Generate a short id for a measurement record. Callers store the id on
 * the measurement so React keys and "delete this row" handlers work
 * across re-renders. Same shape as session-store ids elsewhere.
 */
export function genMeasurementId(): string {
  return `meas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}
