// Pure helpers extracted from GenericToolCard.tsx. No React imports — these
// operate on plain values only and are safe to import from anywhere.
//
// Ordering in `detectShape` matters: more specific shapes (list-wrapper,
// array-of-objects, array-primitive) come before the generic kv-object
// fallback so a literature_search output like `{ papers: [...] }` is
// recognised as a list-wrapper rather than a single-entry KV object.

import type { TaskStep } from '@/types/session'

// `step.input` is scheduled for Phase 1 but may not yet be populated on
// live steps. We accept a permissive shape so the component keeps
// rendering while the runtime plumbing catches up; readers guard on
// presence.
export type StepWithInput = TaskStep & { input?: unknown }

export type Detected =
  | { kind: 'array-of-objects'; rows: Record<string, unknown>[] }
  | { kind: 'array-primitive'; items: unknown[] }
  | { kind: 'list-wrapper'; key: string; items: unknown[] }
  | { kind: 'kv-object'; entries: [string, unknown][] }
  | { kind: 'string-blob'; text: string }
  | { kind: 'unknown'; json: unknown }

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function isPrimitive(v: unknown): boolean {
  if (v === null) return true
  const t = typeof v
  return t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint'
}

export function isArrayOfObjects(
  v: unknown,
): v is Record<string, unknown>[] {
  if (!Array.isArray(v) || v.length === 0) return false
  // Require the first element to be a plain object. We don't require
  // every row to be homogeneous — the table renderer takes the union of
  // keys across rows and leaves missing cells blank.
  return v.every((row) => isPlainObject(row))
}

export function isArrayOfPrimitives(v: unknown): v is unknown[] {
  if (!Array.isArray(v) || v.length === 0) return false
  return v.every(isPrimitive)
}

/**
 * Pure shape detector. Ordering matters: more specific shapes
 * (list-wrapper, array-of-objects, array-primitive) come before the
 * generic kv-object fallback so a literature_search output like
 * `{ papers: [...] }` is recognised as a list-wrapper rather than a
 * single-entry KV object.
 */
export function detectShape(value: unknown): Detected {
  if (typeof value === 'string') {
    return { kind: 'string-blob', text: value }
  }
  if (isArrayOfObjects(value)) {
    return { kind: 'array-of-objects', rows: value }
  }
  if (isArrayOfPrimitives(value)) {
    return { kind: 'array-primitive', items: value }
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    // list-wrapper: exactly one array-valued field whose items we can
    // render structurally. We check primitive arrays first (e.g. a tool
    // returning `{ tags: [...] }`), then arrays of objects.
    const arrayFields = entries.filter(([, v]) => Array.isArray(v))
    if (arrayFields.length === 1) {
      const [k, arr] = arrayFields[0] as [string, unknown[]]
      if (arr.length > 0 && (isArrayOfObjects(arr) || isArrayOfPrimitives(arr))) {
        return { kind: 'list-wrapper', key: k, items: arr }
      }
    }
    return { kind: 'kv-object', entries }
  }
  return { kind: 'unknown', json: value }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function truncateInline(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

export function renderValueInline(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v)
  }
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function shapeLabel(value: unknown): string {
  const d = detectShape(value)
  switch (d.kind) {
    case 'array-of-objects': {
      const n = d.rows.length
      return `${n} row${n === 1 ? '' : 's'}`
    }
    case 'array-primitive': {
      const n = d.items.length
      return `${n} item${n === 1 ? '' : 's'}`
    }
    case 'list-wrapper': {
      const n = d.items.length
      return `${n} ${d.key}`
    }
    case 'kv-object': {
      const n = d.entries.length
      return `${n} field${n === 1 ? '' : 's'}`
    }
    case 'string-blob': {
      const bytes = new Blob([d.text]).size
      return `${formatBytes(bytes)} text`
    }
    case 'unknown': {
      const t = typeof d.json
      if (d.json === null) return 'null'
      if (t === 'number' || t === 'boolean' || t === 'bigint') {
        return String(d.json)
      }
      return t
    }
  }
}

/** Build the `oneLiner` a caller should use next to the tool name. */
export function buildOneLiner(step: StepWithInput): string | undefined {
  if (step.output !== undefined && step.output !== null) {
    return shapeLabel(step.output)
  }
  return step.outputSummary || undefined
}
