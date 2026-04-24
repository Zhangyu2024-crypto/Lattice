// Phase B+ · tool input context injection.
//
// Many tools declare fields the LLM keeps forgetting to fill (the
// focused artifact id, the element list from the current workbench,
// etc.). Rather than scold the model, we auto-complete these from
// session state when the tool's `contextParams` lists them and the
// LLM's input omits them.
//
// This mirrors lattice-cli's `context_injection.py` ContextInjectionWrapper
// but is GUI-scoped: the sources of context are session-store slices,
// not CLI shared-state objects.

import { useRuntimeStore } from '../stores/runtime-store'
import {
  isXpsProArtifact,
  isXrdProArtifact,
} from '../types/artifact'
import type { LocalTool } from '../types/agent-tool'

/**
 * Return a copy of `input` with missing `contextParams` filled from
 * session context. Never overrides an explicit value from the LLM.
 */
export function injectContext(
  tool: LocalTool,
  input: Record<string, unknown>,
  ctx: { sessionId: string },
): Record<string, unknown> {
  if (!tool.contextParams || tool.contextParams.length === 0) return input
  const session = useRuntimeStore.getState().sessions[ctx.sessionId]
  if (!session) return input

  const patched = { ...input }
  for (const key of tool.contextParams) {
    if (patched[key] !== undefined) continue
    const value = resolveContextParam(key, ctx.sessionId, session)
    if (value !== undefined) patched[key] = value
  }
  return patched
}

function resolveContextParam(
  key: string,
  sessionId: string,
  session: NonNullable<ReturnType<typeof useRuntimeStore.getState>['sessions'][string]>,
): unknown {
  switch (key) {
    case 'sessionId':
      return sessionId
    case 'artifactId':
      return session.focusedArtifactId ?? undefined
    case 'elements': {
      // Prefer XRD phaseSearch.elements; fall back to XPS quantify.elements.
      const focused = session.focusedArtifactId
        ? session.artifacts[session.focusedArtifactId]
        : null
      if (!focused) return undefined
      if (isXrdProArtifact(focused)) {
        const raw = focused.payload.params.phaseSearch.elements
        return raw ? raw.split(/[,\s]+/).filter(Boolean) : undefined
      }
      if (isXpsProArtifact(focused)) {
        const raw = focused.payload.params.quantify.elements
        return raw ? raw.split(/[,\s]+/).filter(Boolean) : undefined
      }
      return undefined
    }
    default:
      return undefined
  }
}

/** Filter a tool catalog down to the planModeAllowed subset. Called when
 *  `session.planMode?.active` is true. */
export function filterForPlanMode(tools: LocalTool[]): LocalTool[] {
  return tools.filter((t) => t.planModeAllowed === true)
}
