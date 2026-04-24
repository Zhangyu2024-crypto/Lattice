// Skill loader — reads `<userData>/skills/*.md` via Electron IPC.
//
// Each file is a PromptCommand:
//
//   ---
//   name: my-skill                    # required; used as /name
//   description: one-line summary     # required; shown in typeahead + tool
//   aliases: [m, ms]                  # optional extra names
//   argumentHint: "<topic>"           # optional; shown in typeahead
//   disableModelInvocation: false     # optional; hide from SlashCommandTool
//   ---
//   <markdown body — the expanded prompt>
//
// Body templating: `{args}` in the body is replaced with the user's args
// string. When `{args}` is absent and args are non-empty, we append them on
// a blank line — matches the `/research` builtin's "topic appended"
// behaviour without making every skill file remember to add the placeholder.
//
// Loading model: the registry's lookup path is synchronous, so we keep a
// module-local cache that starts empty and is populated by
// `warmSkillsCache()`. Call it once at app startup before the composer
// renders. In the Vite-only dev path (no Electron IPC) the cache stays
// empty and the loader becomes a no-op, matching the stub's behaviour.

import type { Command, PromptCommand } from '../types'
import type { ModelBinding } from '../../model-routing'
import type { ReasoningEffort } from '../../../types/llm'
import { invalidateRegistryCache } from '../registry'

export interface RawSkill {
  fileName: string
  source: string
}

export interface SkillLoadError {
  fileName: string
  message: string
}

let cache: Command[] = []
let lastErrors: SkillLoadError[] = []

export function loadSkillCommands(): Command[] {
  return cache
}

/** Error list from the most recent cache warm, for `/help` to surface. */
export function getSkillLoadErrors(): readonly SkillLoadError[] {
  return lastErrors
}

/**
 * Pull skills from Electron's main process, parse them, and swap the
 * registry cache. Safe to call multiple times — each call replaces the
 * previous set. No-op when `window.electronAPI.listSkills` is missing
 * (e.g. Vite-only dev mode).
 */
export async function warmSkillsCache(): Promise<void> {
  if (typeof window === 'undefined') return
  const api = window.electronAPI
  if (!api?.listSkills) return
  try {
    const raw = await api.listSkills()
    // Legacy path (older main processes that returned an array directly)
    // still works — we normalise into the {skills, errors} shape.
    if (Array.isArray(raw)) {
      cache = compileSkills(raw)
      lastErrors = []
    } else {
      cache = compileSkills(raw?.skills ?? [])
      lastErrors = raw?.errors ?? []
    }
    invalidateRegistryCache()
  } catch (err) {
    // Skills are non-critical — a parse failure or permission error must
    // not block the composer from booting. Log and keep an empty cache.
    // eslint-disable-next-line no-console
    console.warn('[slash-commands] failed to load skills:', err)
    cache = []
    lastErrors = [
      {
        fileName: '<ipc>',
        message: err instanceof Error ? err.message : String(err),
      },
    ]
    invalidateRegistryCache()
  }
}

/** Test / dev hook. Not exported from the package index. */
export function __setSkillsCacheForTests(commands: Command[]): void {
  cache = commands
}

export function compileSkills(raw: RawSkill[]): Command[] {
  const out: Command[] = []
  for (const entry of raw) {
    const compiled = compileOne(entry)
    if (compiled) out.push(compiled)
  }
  return out
}

function compileOne(entry: RawSkill): PromptCommand | null {
  const parsed = parseFrontmatter(entry.source)
  const data = parsed.data

  // An explicitly-declared name is authoritative: if the user wrote
  // `name: has space` we drop the skill rather than silently swapping in
  // the filename and masking the typo. Only fall through to the filename
  // when `name` is absent entirely.
  let name: string | null
  if (typeof data.name === 'string') {
    name = coerceName(data.name)
    if (!name) return null
  } else {
    name = deriveNameFromFile(entry.fileName)
  }
  if (!name) return null
  const description = coerceString(data.description) ?? 'User skill'
  const aliases = coerceStringArray(data.aliases)
  const argumentHint = coerceString(data.argumentHint)
  const disableModelInvocation = data.disableModelInvocation === true
  const model = coerceModelBinding(data.model, data.effort)
  const body = parsed.body

  const cmd: PromptCommand = {
    type: 'prompt',
    name: name.toLowerCase(),
    description,
    source: 'skill',
    ...(aliases ? { aliases } : {}),
    ...(argumentHint ? { argumentHint } : {}),
    ...(disableModelInvocation ? { disableModelInvocation: true } : {}),
    ...(model ? { model } : {}),
    getPrompt: async (args) => renderBody(body, args),
  }
  return cmd
}

// Accept frontmatter like `model: providerId/modelId` or just `model: modelId`
// (same shape as `/model` args). `effort: low|medium|high` populates the
// reasoningEffort slot. Returns undefined when nothing usable is present.
function coerceModelBinding(
  modelRaw: unknown,
  effortRaw: unknown,
): ModelBinding | undefined {
  const out: ModelBinding = {}
  if (typeof modelRaw === 'string' && modelRaw.trim().length > 0) {
    const trimmed = modelRaw.trim()
    const slash = trimmed.indexOf('/')
    if (slash > 0) {
      out.providerId = trimmed.slice(0, slash).trim() || null
      out.modelId = trimmed.slice(slash + 1).trim() || null
    } else {
      out.modelId = trimmed
    }
  }
  if (typeof effortRaw === 'string') {
    const e = effortRaw.trim().toLowerCase()
    if (e === 'low' || e === 'medium' || e === 'high') {
      out.reasoningEffort = e as ReasoningEffort
    }
  }
  if (!out.providerId && !out.modelId && !out.reasoningEffort) return undefined
  return out
}

function renderBody(body: string, args: string): string {
  const trimmedArgs = args.trim()
  if (body.includes('{args}')) {
    return body.replace(/\{args\}/g, trimmedArgs)
  }
  if (!trimmedArgs) return body
  const sep = body.endsWith('\n') ? '' : '\n'
  return `${body}${sep}\n${trimmedArgs}`
}

function coerceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Slash names must be whitespace-free; matches `parseSlashCommand` which
  // splits on the first whitespace.
  if (/\s/.test(trimmed)) return null
  return trimmed
}

function deriveNameFromFile(fileName: string): string | null {
  const base = fileName.replace(/\.md$/i, '').trim()
  if (!base || /\s/.test(base)) return null
  return base
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value
  return undefined
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strs = value.filter((v): v is string => typeof v === 'string')
  if (strs.length === 0) return undefined
  return strs
}

// Imported last to keep the warmSkillsCache dependency list tight on
// circular readers — parseFrontmatter has no import graph into this file.
import { parseFrontmatter } from './frontmatter'
