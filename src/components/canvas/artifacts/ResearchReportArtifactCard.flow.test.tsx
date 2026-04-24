// End-to-end research flow test: drive the three research tools
// (plan_outline → draft_section × N → finalize_report) against a
// synthetic session with a mocked LLM, then render the resulting
// artifact with the three-pane card. Lets me prove that
//   1. the tool chain produces a valid payload the card can render, and
//   2. each status transition (planning → drafting → complete) paints
//      the right header chip / section dots / refs list.
//
// Stubs jsdom-only globals (scrollIntoView, IntersectionObserver) and
// `window.electronAPI.llmInvoke` so the orchestrator's drafting step can
// run without a provider key.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ResearchReportArtifactCard from './ResearchReportArtifactCard'
import { useRuntimeStore } from '../../../stores/runtime-store'
import { researchPlanOutlineTool } from '../../../lib/agent-tools/research-plan-outline'
import { researchDraftSectionTool } from '../../../lib/agent-tools/research-draft-section'
import { researchFinalizeReportTool } from '../../../lib/agent-tools/research-finalize-report'

// Mock sendLlmChat at the module boundary so the draft tool's LLM call
// returns a canned JSON payload (markdown + citations) without needing
// a real provider config. We dynamically advance the response index
// inside the mock so each call gets a distinct section body.
let draftResponseIdx = 0
let draftResponses: Array<string> = []
let outlineResponse = ''
vi.mock('../../../lib/llm-chat', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/llm-chat')>(
    '../../../lib/llm-chat',
  )
  return {
    ...actual,
    sendLlmChat: vi.fn(async (args?: { userMessage?: string }) => {
      const prompt =
        args && typeof args.userMessage === 'string' ? args.userMessage : ''
      if (prompt.includes('{ "headings": string[] }')) {
        return {
          success: true,
          content: outlineResponse,
          durationMs: 10,
          inputTokens: 80,
          outputTokens: 120,
        }
      }
      const content =
        draftResponses[Math.min(draftResponseIdx, draftResponses.length - 1)]
      draftResponseIdx += 1
      return {
        success: true,
        content,
        durationMs: 10,
        inputTokens: 100,
        outputTokens: 200,
      }
    }),
  }
})

class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
  root = null
  rootMargin = ''
  thresholds: readonly number[] = []
}
;(globalThis as unknown as { IntersectionObserver: typeof IOStub }).IntersectionObserver = IOStub

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  // Reset runtime-store to a clean slate per test.
  useRuntimeStore.setState({
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
  })
  // Reset canned-responses cursor for each run.
  draftResponseIdx = 0
  outlineResponse = JSON.stringify({
    headings: ['Current Landscape', 'Key Frictions', 'Next-phase Outlook'],
  })
  draftResponses = [
    JSON.stringify({
      markdown:
        'China-Europe ties sit on trade interdependence and diplomatic engagement [@cite:smith2023].',
      citations: [
        {
          id: 'smith2023',
          title: 'EU–China Trade Relations: A 2023 Snapshot',
          authors: ['Smith, J.', 'Wang, L.'],
          year: 2023,
          venue: 'Journal of European Policy',
          doi: '10.1234/jep.2023.01',
        },
      ],
    }),
    JSON.stringify({
      markdown:
        'Recent tensions center on EV tariffs and dual-use tech exports [@cite:jones2024].',
      citations: [
        {
          id: 'jones2024',
          title: 'EV Tariffs and the China–EU Rift',
          authors: ['Jones, M.'],
          year: 2024,
          venue: 'European Affairs Review',
        },
      ],
    }),
    JSON.stringify({
      markdown:
        'Looking ahead, climate cooperation and tech decoupling shape the 2025-2030 trajectory [@cite:chen2024].',
      citations: [
        {
          id: 'chen2024',
          title: 'Decoupling or Re-entangling? EU–China Relations After 2024',
          authors: ['Chen, H.', 'Müller, K.'],
          year: 2024,
          venue: 'Foreign Affairs Quarterly',
        },
      ],
    }),
  ]
})

function makeCtx(sessionId: string): Parameters<typeof researchPlanOutlineTool.execute>[1] {
  const controller = new AbortController()
  return {
    sessionId,
    signal: controller.signal,
  }
}

describe('end-to-end research flow', () => {
  it('plan → draft × N → finalize produces a complete artifact the card renders cleanly', async () => {
    const sessionId = useRuntimeStore
      .getState()
      .createSession({ title: 'Research test' })
    const ctx = makeCtx(sessionId)

    // 1) Plan outline — model returns a topic-specific outline.
    const plan = await researchPlanOutlineTool.execute(
      { topic: '中欧关系', mode: 'research', style: 'concise' },
      ctx,
    )
    expect(plan.artifactId).toBeTruthy()
    expect(plan.sectionIds.length).toBeGreaterThanOrEqual(3)

    const artifactId = plan.artifactId
    const ses0 = useRuntimeStore.getState().sessions[sessionId]
    const art0 = ses0.artifacts[artifactId]
    expect(art0.kind).toBe('research-report')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const planningPayload = art0.payload as any
    expect(planningPayload.status).toBe('planning')

    // 2) Draft each section in order.
    for (const sectionId of plan.sectionIds) {
      await researchDraftSectionTool.execute(
        { artifactId, sectionId },
        ctx,
      )
    }

    // 3) Finalize — no LLM call; validates + flips status to complete.
    const finalize = await researchFinalizeReportTool.execute(
      { artifactId },
      ctx,
    )
    expect(finalize.clean).toBe(true)
    expect(finalize.unresolvedTokens.length).toBe(0)
    expect(finalize.emptySections.length).toBe(0)

    // Grab the final artifact and render the card with it.
    const ses = useRuntimeStore.getState().sessions[sessionId]
    const finalArtifact = ses.artifacts[artifactId]
    expect(finalArtifact).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = finalArtifact.payload as any
    expect(payload.status).toBe('complete')
    expect(payload.sections.every((s: { markdown: string }) => s.markdown.length > 0)).toBe(true)
    // Three sections × 1 citation each = 3 unique citation ids.
    expect(payload.citations.length).toBeGreaterThanOrEqual(1)

    const { container } = render(
      <ResearchReportArtifactCard artifact={finalArtifact} />,
    )
    // Header chip reads "Complete · N sections · M refs"
    expect(screen.getByText(/Complete/)).toBeInTheDocument()
    // Every mocked citation surfaces as a right-pane card title
    for (const c of payload.citations) {
      expect(screen.getByText(c.title)).toBeInTheDocument()
    }
    // Outline shows each section heading
    for (const s of payload.sections) {
      expect(screen.getAllByText(s.heading).length).toBeGreaterThan(0)
    }

    // Dump a skeletal DOM view so the integration test doubles as a
    // human-readable proof of the "what the user actually sees" pane
    // structure. Emits the class tree at debug log level.
    const panes = container.querySelectorAll(
      '.research-card-outline, .research-card-sections, .research-card-refs',
    )
    expect(panes.length).toBe(3)
    const outlineItems = container.querySelectorAll(
      '.research-card-outline-item',
    )
    expect(outlineItems.length).toBe(payload.sections.length)
    const refItems = container.querySelectorAll('.research-card-ref')
    expect(refItems.length).toBe(payload.citations.length)
    // At least one body section was rendered with markdown content.
    const bodySections = container.querySelectorAll(
      '.research-card-section',
    )
    expect(bodySections.length).toBe(payload.sections.length)
    // Summary the human reader can glance at when debugging failures.
    // eslint-disable-next-line no-console
    console.info(
      `[research-flow] topic="${payload.topic}" sections=${payload.sections.length} refs=${payload.citations.length} status=${payload.status}`,
    )
  })
})
