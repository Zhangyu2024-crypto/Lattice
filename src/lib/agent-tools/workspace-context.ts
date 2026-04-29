// `workspace_context_read` / `workspace_context_refresh` — surface a
// compact digest of the live UI state so the agent can orient before
// it fans out into specialised tools.
//
// The digest is intentionally narrow: workspace root, active session,
// focused artifact, recent files, and a list of artifacts open in the
// active session. We deliberately omit transcripts and full payloads
// — the model can pull those via `get_artifact` / `workspace_read_file`
// when it actually needs them, and including them here would balloon
// every turn's prompt.
//
// `_refresh` re-reads the current directory listing from disk so the
// next `_read` reflects external changes (e.g. a file the user just
// dropped into the workspace via Finder).

import type { LocalTool } from '../../types/agent-tool'
import { useRuntimeStore } from '../../stores/runtime-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

interface ContextSummary {
  ok: true
  workspaceRoot: string | null
  activeSessionId: string | null
  activeSessionTitle: string | null
  focusedArtifact: {
    id: string
    kind: string
    title: string
  } | null
  openArtifacts: Array<{ id: string; kind: string; title: string }>
  recentFiles: string[]
  fileCount: number
}

function buildSummary(): ContextSummary {
  const ws = useWorkspaceStore.getState()
  const rt = useRuntimeStore.getState()
  const sid = rt.activeSessionId
  const session = sid ? rt.sessions[sid] : null

  const focusedArtifact = (() => {
    if (!session?.focusedArtifactId) return null
    const a = session.artifacts[session.focusedArtifactId]
    if (!a) return null
    return {
      id: a.id,
      kind: String(a.kind),
      title: 'title' in a && typeof a.title === 'string' ? a.title : a.id,
    }
  })()

  const openArtifacts = session
    ? session.artifactOrder
        .map((id) => session.artifacts[id])
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
        .map((a) => ({
          id: a.id,
          kind: String(a.kind),
          title: 'title' in a && typeof a.title === 'string' ? a.title : a.id,
        }))
    : []

  return {
    ok: true,
    workspaceRoot: ws.rootPath,
    activeSessionId: sid ?? null,
    activeSessionTitle: session?.title ?? null,
    focusedArtifact,
    openArtifacts,
    recentFiles: ws.recentFiles.slice(0, 10),
    fileCount: Object.keys(ws.fileIndex).length,
  }
}

export const workspaceContextReadTool: LocalTool<
  Record<string, never>,
  ContextSummary
> = {
  name: 'workspace_context_read',
  description:
    'Return a compact digest of the live UI state: workspace root, active session, focused artifact, open artifacts, and recent files. Read this once at the start of a turn when you need to orient yourself; pull payloads via get_artifact / workspace_read_file as needed.',
  cardMode: 'silent',
  inputSchema: { type: 'object', properties: {} },
  async execute() {
    return buildSummary()
  },
}

interface RefreshInput {
  /** POSIX relative path inside the workspace, or empty/'/' for the
   *  root. Defaults to root. */
  dir?: string
}

interface RefreshOutput extends ContextSummary {
  refreshedDir: string
}

export const workspaceContextRefreshTool: LocalTool<
  RefreshInput,
  RefreshOutput
> = {
  name: 'workspace_context_refresh',
  description:
    'Force a re-read of the workspace directory listing from disk so the next workspace_context_read reflects external changes (e.g. a file dropped via Finder). Returns the refreshed digest.',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      dir: {
        type: 'string',
        description: 'POSIX relative path; defaults to workspace root.',
      },
    },
  },
  async execute(input) {
    const ws = useWorkspaceStore.getState()
    const dir = (input?.dir ?? '').replace(/^\/+|\/+$/g, '')
    if (ws.rootPath) {
      try {
        await ws.refreshDir(dir)
      } catch {
        // best-effort — fall through and still return the digest
      }
    }
    return { ...buildSummary(), refreshedDir: dir }
  },
}
