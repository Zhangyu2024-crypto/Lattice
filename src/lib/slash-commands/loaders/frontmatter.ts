// Minimal frontmatter parser. Shape we accept:
//
//   ---
//   name: foo
//   description: one-line summary
//   aliases: [f, foo-alias]
//   argumentHint: "<topic>"
//   disableModelInvocation: false
//   ---
//   <markdown body — becomes the expanded prompt>
//
// We support a deliberately tiny subset of YAML — string / number / boolean
// scalars and bracketed string arrays. That's enough for the skill
// frontmatter without pulling `gray-matter` and `js-yaml` (~80 KB). Anything
// richer (nested maps, multi-line strings) should either be rewritten in
// the supported subset or deferred until a real YAML need appears.

export interface ParsedFrontmatter {
  data: Record<string, unknown>
  body: string
}

const OPEN_RE = /^---\s*\r?\n/
const CLOSE_RE = /\r?\n---\s*(\r?\n|$)/

export function parseFrontmatter(source: string): ParsedFrontmatter {
  if (!OPEN_RE.test(source)) return { data: {}, body: source }
  const withoutOpen = source.replace(OPEN_RE, '')
  const closeMatch = withoutOpen.match(CLOSE_RE)
  if (!closeMatch || closeMatch.index === undefined) {
    return { data: {}, body: source }
  }
  const yamlBlock = withoutOpen.slice(0, closeMatch.index)
  const body = withoutOpen.slice(closeMatch.index + closeMatch[0].length)
  return { data: parseScalarYaml(yamlBlock), body }
}

function parseScalarYaml(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const rawValue = line.slice(colon + 1).trim()
    out[key] = coerceScalar(rawValue)
  }
  return out
}

function coerceScalar(raw: string): unknown {
  if (raw === '' || raw === '~' || raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false

  // Bracketed array: `[a, "b", c]`. Strings with commas inside quotes are
  // supported; nested arrays and objects are not (intentional — see top).
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return splitArrayItems(raw.slice(1, -1)).map((item) =>
      coerceScalar(item.trim()),
    )
  }

  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1)
  }

  const asNumber = Number(raw)
  if (!Number.isNaN(asNumber) && raw !== '' && /^-?\d+(\.\d+)?$/.test(raw)) {
    return asNumber
  }

  return raw
}

function splitArrayItems(body: string): string[] {
  const items: string[] = []
  let depth = 0
  let buf = ''
  let quote: '"' | "'" | null = null
  for (const ch of body) {
    if (quote) {
      buf += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      items.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim().length > 0) items.push(buf)
  return items
}
