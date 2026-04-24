import { wsClient } from '../stores/ws-client'
import { genArtifactId, useRuntimeStore } from '../stores/runtime-store'
import { DEMO_RESEARCH_REPORT } from '../stores/demo-research-report'

declare global {
  interface Window {
    __latticeMockAgentStream?: (sessionId?: string) => void
  }
}

function installMockAgentStream() {
  if (typeof window === 'undefined') return
  if (window.__latticeMockAgentStream) return

  window.__latticeMockAgentStream = (sessionId?: string) => {
    const store = useRuntimeStore.getState()
    const sid = sessionId ?? store.activeSessionId ?? store.createSession({ title: 'Session 1' })

    const taskId = `mock_task_${Date.now().toString(36)}`
    const stepId = `mock_step_${Date.now().toString(36)}`
    const artifactId = genArtifactId()
    const now = Date.now()

    const artifact = {
      id: artifactId,
      kind: 'research-report',
      title: 'Mock Research Brief',
      createdAt: now,
      updatedAt: now,
      payload: {
        ...DEMO_RESEARCH_REPORT,
        topic: 'Mock agent protocol smoke test',
        generatedAt: now,
      },
    }

    const emitLater = (
      type: string,
      payload: Record<string, unknown>,
      delayMs: number,
    ) => {
      window.setTimeout(() => {
        wsClient.dispatch(type, { type, ...payload })
      }, delayMs)
    }

    emitLater(
      'task_start',
      {
        session_id: sid,
        task_id: taskId,
        title: 'Mock Agent Task',
      },
      0,
    )
    emitLater(
      'agent_plan',
      {
        session_id: sid,
        task_id: taskId,
        steps: [
          { step_id: 'plan_1', kind: 'plan', label: 'Read active session context' },
          { step_id: stepId, kind: 'tool_call', label: 'Generate literature brief', tool: 'research_brief' },
        ],
      },
      120,
    )
    emitLater(
      'agent_reasoning',
      {
        session_id: sid,
        task_id: taskId,
        step_id: 'reason_1',
        content: 'Collecting session context and drafting a concise research brief.',
        done: true,
      },
      240,
    )
    emitLater(
      'tool_invocation',
      {
        session_id: sid,
        task_id: taskId,
        step_id: stepId,
        tool_name: 'research_brief',
        input_summary: 'topic=mock agent protocol smoke test',
      },
      420,
    )
    emitLater(
      'artifact_created',
      {
        session_id: sid,
        artifact,
      },
      820,
    )
    emitLater(
      'tool_result',
      {
        session_id: sid,
        task_id: taskId,
        step_id: stepId,
        tool_name: 'research_brief',
        status: 'succeeded',
        output_summary: 'Generated a mock research-report artifact for protocol validation.',
        artifact_ids: [artifactId],
      },
      940,
    )
    emitLater(
      'task_end',
      {
        session_id: sid,
        task_id: taskId,
        status: 'succeeded',
      },
      1080,
    )
  }
}

if (import.meta.env.DEV) {
  installMockAgentStream()
}

export {}
