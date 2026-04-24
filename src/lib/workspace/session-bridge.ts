// Bridge between workspace `.chat.json` files and runtime-store sessions.
//
// When the user opens a `.chat.json` in the editor (via file tree double-
// click), this module hydrates or activates the corresponding runtime-store
// session so AgentComposer immediately shows that conversation — no
// separate "session picker" needed.
//
// Call `initSessionBridge()` once from App.tsx on mount. It subscribes to
// editor-store's active-tab changes and reacts whenever the tab switches
// to/from a chat file.

import { useEditorStore } from '../../stores/editor-store'
import { useRuntimeStore } from '../../stores/runtime-store'
import { getWorkspaceFs } from './fs'
import { readEnvelope, writeEnvelope } from './envelope'
import type { TranscriptMessage } from '../../types/session'

interface ChatPayload {
  messages?: Array<{
    role: string
    content: string
    [key: string]: unknown
  }>
  mentions?: unknown[]
  mode?: string
  model?: string | null
}

let initialized = false

function isChatFile(relPath: string | null): boolean {
  return Boolean(relPath && relPath.endsWith('.chat.json'))
}

export async function activateSessionForFile(relPath: string): Promise<void> {
  const fs = getWorkspaceFs()
  if (!fs.rootPath) return

  let envelope: Awaited<ReturnType<typeof readEnvelope<ChatPayload>>>
  try {
    envelope = await readEnvelope<ChatPayload>(fs, relPath)
  } catch {
    return
  }

  if (envelope.kind !== 'chat' || !envelope.id) return

  const store = useRuntimeStore.getState()
  const existing = store.sessions[envelope.id]

  if (existing) {
    if (store.activeSessionId !== existing.id) {
      store.setActiveSession(existing.id)
    }
    return
  }

  // Hydrate a new session from the envelope content. We pre-assign the
  // envelope's id so a second click on the same file finds `existing`
  // above instead of hydrating a duplicate.
  const now = Date.now()
  const messages: TranscriptMessage[] = (envelope.payload.messages ?? []).map(
    (m, i) => ({
      id: `hydrated_${i}_${now}`,
      role: (m.role === 'user' || m.role === 'assistant' ? m.role : 'user') as
        | 'user'
        | 'assistant',
      content: typeof m.content === 'string' ? m.content : '',
      timestamp: envelope.createdAt + i,
    }),
  )

  const title =
    (envelope.meta?.title as string) ||
    relPath
      .replace(/^chats\//, '')
      .replace(/\.chat\.json$/, '')
      .replace(/[-_]/g, ' ') ||
    'Chat'

  const sessionId = store.createSession({ title, id: envelope.id })
  for (const msg of messages) {
    store.appendTranscript(sessionId, msg)
  }
  if (
    envelope.payload.mode === 'agent' ||
    envelope.payload.mode === 'dialog'
  ) {
    store.setChatMode(
      sessionId,
      envelope.payload.mode as 'agent' | 'dialog',
    )
  }

  store.setActiveSession(sessionId)
}

function getActiveTabRelPath(): string | null {
  const state = useEditorStore.getState()
  const group = state.groups.find((g) => g.id === state.activeGroupId)
  return group?.activeTab ?? null
}

/** Call once from App.tsx mount. Subscribes to editor-store tab changes
 *  and bridges `.chat.json` opens into runtime-store session activations. */
export function initSessionBridge(): () => void {
  if (initialized) return () => {}
  initialized = true

  // Check the current tab immediately (in case app starts with a chat open).
  const current = getActiveTabRelPath()
  if (isChatFile(current)) {
    void activateSessionForFile(current!)
  }

  // Subscribe to future tab switches.
  const unsub = useEditorStore.subscribe((state, prev) => {
    const group = state.groups.find((g) => g.id === state.activeGroupId)
    const prevGroup = prev.groups.find((g) => g.id === prev.activeGroupId)
    const tab = group?.activeTab ?? null
    const prevTab = prevGroup?.activeTab ?? null
    if (tab === prevTab) return
    if (isChatFile(tab)) {
      void activateSessionForFile(tab!)
    }
  })

  // Auto-migrate existing runtime-store sessions → .chat.json files so
  // they appear in the file tree. Without this, sessions created before the
  // file-first refactor are invisible (they only live in localStorage).
  void migrateSessionsToFiles()

  return () => {
    initialized = false
    unsub()
  }
}

/** One-time migration: for every runtime-store session that doesn't have a
 *  corresponding `.chat.json` on disk, create one. Idempotent — sessions
 *  that already have a matching file are skipped. */
async function migrateSessionsToFiles(): Promise<void> {
  const fs = getWorkspaceFs()
  if (!fs.rootPath) return

  try {
    await fs.mkdir('chats')
  } catch {
    // already exists
  }

  const store = useRuntimeStore.getState()
  for (const id of store.sessionOrder) {
    const session = store.sessions[id]
    if (!session) continue

    // Derive filename from session title (sanitized) or id.
    const safeName = session.title
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50)
      .toLowerCase() || id
    const relPath = `chats/${safeName}.chat.json`

    // Skip if a file with this path already exists.
    try {
      const exists = await fs.exists(relPath)
      if (exists) continue
    } catch {
      continue
    }

    // Write the envelope with transcript messages.
    const messages = session.transcript.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    try {
      await writeEnvelope(fs, relPath, {
        kind: 'chat' as const,
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        meta: { title: session.title },
        payload: {
          messages,
          mentions: [],
          mode: session.chatMode ?? 'agent',
          model: null,
        },
      })
    } catch {
      // Non-fatal — skip this session, try the rest.
    }
  }

  // Refresh the file tree so the user sees the migrated files immediately.
  const { useWorkspaceStore } = await import('../../stores/workspace-store')
  void useWorkspaceStore.getState().refreshDir('chats')
}
