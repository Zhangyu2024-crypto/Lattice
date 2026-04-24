import type { LocalCommand } from '../types'
import { useRuntimeStore } from '../../../stores/runtime-store'

// `/resume` lists recent sessions in MRU order.
// `/resume <id-or-prefix>` switches the active session.
//
// Intentionally lightweight: Lattice already has a visual session switcher
// (ChatsDropdown); this command is the keyboard-driven alternative for
// users who live in the composer. It doesn't try to re-implement the
// dropdown's search — a short id prefix is enough to disambiguate most
// cases, and the no-args listing shows the full id next to the title.

const SHOW_RECENT = 10

export const resumeCommand: LocalCommand = {
  type: 'local',
  name: 'resume',
  description: 'List recent sessions; pass an id prefix to switch',
  argumentHint: '[<session-id-prefix>]',
  source: 'builtin',
  paletteGroup: 'Navigation',
  aliases: ['sessions'],
  call: async (args) => {
    const store = useRuntimeStore.getState()
    const { sessionOrder, sessions, activeSessionId } = store
    const trimmed = args.trim()

    if (!trimmed) {
      const recent = sessionOrder
        .slice(0, SHOW_RECENT)
        .map((id) => sessions[id])
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
      if (recent.length === 0) {
        return { kind: 'text', text: 'No sessions yet.' }
      }
      const lines = recent.map((s) => {
        const marker = s.id === activeSessionId ? '▶' : ' '
        const when = new Date(s.updatedAt).toISOString().slice(5, 16).replace('T', ' ')
        return `  ${marker} ${s.id.slice(0, 10)}…  ${when}  ${s.title || '(untitled)'}`
      })
      return {
        kind: 'text',
        text:
          `Recent sessions (${recent.length}/${sessionOrder.length}):\n` +
          lines.join('\n') +
          `\n\nRun \`/resume <id-prefix>\` to switch.`,
      }
    }

    // Match by exact id, then by prefix. Ambiguous prefixes error out
    // rather than silently picking one.
    const exact = sessions[trimmed]
    let target = exact?.id
    if (!target) {
      const candidates = sessionOrder.filter((id) => id.startsWith(trimmed))
      if (candidates.length === 0) {
        return {
          kind: 'text',
          text: `No session id starts with "${trimmed}". Run \`/resume\` to see the list.`,
        }
      }
      if (candidates.length > 1) {
        return {
          kind: 'text',
          text:
            `Ambiguous — ${candidates.length} session ids start with "${trimmed}". ` +
            `Be more specific: ${candidates.slice(0, 3).map((c) => c.slice(0, 14)).join(', ')}${candidates.length > 3 ? '…' : ''}`,
        }
      }
      target = candidates[0]
    }
    if (!target) return { kind: 'skip' }
    if (target === activeSessionId) {
      return {
        kind: 'text',
        text: `Already on ${target.slice(0, 10)}… — ${sessions[target]?.title || '(untitled)'}.`,
      }
    }
    store.setActiveSession(target)
    return {
      kind: 'text',
      text: `Switched to ${target.slice(0, 10)}… — ${sessions[target]?.title || '(untitled)'}.`,
    }
  },
}
