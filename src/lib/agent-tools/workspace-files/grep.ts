// Agent tool — `workspace_grep`. Regex search over workspace files with
// an optional glob filter. Caps at MAX_GREP_RESULTS matches and skips
// files larger than MAX_READ_BYTES so one rogue file doesn't dominate
// the response.

import type { LocalTool } from '@/types/agent-tool'
import {
  ensureRoot,
  listFilesInRoot,
  matchesGlob,
  readText,
  rootApi,
} from './helpers'
import { MAX_GREP_RESULTS, MAX_READ_BYTES } from './types'

export const workspaceGrepTool: LocalTool<
  { pattern: string; glob?: string; caseInsensitive?: boolean },
  { matches: Array<{ file: string; line: number; text: string }>; truncated: boolean }
> = {
  name: 'workspace_grep',
  description:
    'Regex search over workspace files. Optional `glob` filter (e.g. "*.py"). Returns file / line / matched line text. Capped at 200 matches.',
  trustLevel: 'safe',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'JavaScript RegExp source.' },
      glob: { type: 'string', description: 'Optional glob filter.' },
      caseInsensitive: { type: 'boolean' },
    },
    required: ['pattern'],
  },
  async execute(input) {
    ensureRoot()
    if (!input?.pattern) throw new Error('pattern is required')

    const flags = input.caseInsensitive === true ? 'i' : ''
    let re: RegExp
    try {
      re = new RegExp(input.pattern, flags)
    } catch (err) {
      throw new Error(
        `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const files = await listFilesInRoot()
    const matches: Array<{ file: string; line: number; text: string }> = []
    let truncated = false
    for (const rel of files) {
      if (input.glob && !matchesGlob(rel, input.glob)) continue
      const st = await rootApi().workspaceStat(rel)
      if (!st.ok) continue
      if (!st.stat.exists || st.stat.isDirectory) continue
      if (st.stat.size > MAX_READ_BYTES) continue
      let content: string
      try {
        content = await readText(rel)
      } catch {
        continue
      }
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          matches.push({ file: rel, line: i + 1, text: lines[i].slice(0, 400) })
          if (matches.length >= MAX_GREP_RESULTS) {
            truncated = true
            break
          }
        }
      }
      if (truncated) break
    }
    return { matches, truncated }
  },
}
