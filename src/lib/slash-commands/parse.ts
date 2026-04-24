// `/command args…` parser.
//
// Mirrors Claude Code's `src/utils/slashCommandParsing.ts`: the slash must be
// at column 0 (no leading whitespace) so that a pasted markdown link like
// `see /docs/foo` doesn't get mis-interpreted. Name is the next token, args
// is everything after the first whitespace, trimmed. Names are matched
// case-insensitively in `registry.findCommand`, so we lowercase them here
// to keep the downstream lookup symmetric.

export interface ParsedSlashCommand {
  name: string
  args: string
}

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  if (!input || input[0] !== '/') return null
  // Reject `//`, `/ `, and the bare `/` prefix — none are valid command
  // invocations and all three would otherwise produce empty names.
  const body = input.slice(1)
  if (body.length === 0) return null
  if (body[0] === '/' || body[0] === ' ' || body[0] === '\t') return null

  const wsMatch = body.match(/\s/)
  if (!wsMatch || wsMatch.index === undefined) {
    return { name: body.toLowerCase(), args: '' }
  }
  const name = body.slice(0, wsMatch.index).toLowerCase()
  const args = body.slice(wsMatch.index + 1).trim()
  return { name, args }
}
