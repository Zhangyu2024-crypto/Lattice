/**
 * Pure number/string utilities for CIF parsing, writing, and transforms.
 *
 * Nothing in here touches the CIF structure itself — these are the
 * low-level building blocks (token splitting, std-dev stripping,
 * formatting, deterministic PRNG) shared across parser, writer, and
 * the geometric transforms.
 */

/** Parse a `_tag  value` line as a number, tolerating std-dev parens. */
export function parseNumberField(line: string, tag: string): number {
  const rest = line.slice(tag.length).trim()
  // CIFs often include standard-deviation parentheses, e.g. "3.994(2)".
  const cleaned = rest.replace(/\(.*\)/, '').trim()
  const n = Number(cleaned)
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot parse ${tag}: ${rest}`)
  }
  return n
}

/** Parse a `_tag  'value'` line, returning the (optionally quoted) string. */
export function parseStringField(line: string): string {
  const space = line.indexOf(' ')
  if (space < 0) return ''
  const rest = line.slice(space + 1).trim()
  const m = /^['"](.*)['"]$/.exec(rest)
  return m ? m[1] : rest
}

/** First index in `headers` whose entry begins with `target`. -1 if none. */
export function indexOfCol(headers: string[], target: string): number {
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].startsWith(target)) return i
  }
  return -1
}

/**
 * Split a CIF loop row on whitespace. Simple by design — CIF values in
 * atom loops are rarely quoted and our atom labels never contain spaces.
 */
export function tokenizeCifRow(line: string): string[] {
  return line.split(/\s+/).filter((t) => t.length > 0)
}

/** Strip std-dev parentheses and coerce to number (NaN on failure). */
export function stripStdDev(s: string): number {
  const cleaned = s.replace(/\(.*\)/, '')
  return Number(cleaned)
}

/** Fixed-digit float, safe against non-finite input. */
export function fmtFloat(n: number, digits: number): string {
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(digits)
}

/**
 * Format a fractional coordinate, wrapped into [0, 1) for readability.
 * Uses more precision than lattice params since fractions are dimensionless.
 */
export function fmtFrac(n: number): string {
  let v = n
  if (v < 0) v += Math.ceil(Math.abs(v)) + 1
  v = v % 1
  if (v < 0) v += 1
  return v.toFixed(5)
}

/** Format a stoichiometric subscript; integer-like values render as integers. */
export function formatStoich(n: number): string {
  if (Math.abs(n - Math.round(n)) < 0.01) return String(Math.round(n))
  return n.toFixed(2)
}

/** Wrap a fractional coordinate into the canonical [0, 1) interval. */
export function wrap01(v: number): number {
  let x = v
  if (x < 0) x += Math.ceil(Math.abs(x)) + 1
  x = x % 1
  if (x < 0) x += 1
  return x
}

/**
 * Deterministic 32-bit PRNG. Same seed → same sequence. Used by `dope`
 * so that doping a structure twice with the same seed is reproducible.
 */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return function () {
    t = (t + 0x6d2b79f5) >>> 0
    let r = t
    r = Math.imul(r ^ (r >>> 15), r | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
