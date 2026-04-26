// Smoke + behavior tests for the three-pane research-report card. Tests
// mount the component against synthetic payloads that mirror each stage
// of the agent flow (planning → drafting → complete) so regressions in
// status-chip wording, pane contents, and cross-pane interactions get
// caught before they reach the canvas.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ResearchReportArtifactCard from './ResearchReportArtifactCard'
import type { Artifact } from '../../../types/artifact'

// `scrollIntoView` isn't implemented by jsdom — stub to a no-op so
// outline + citation click handlers don't explode during the test.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// jsdom doesn't ship IntersectionObserver. The card uses it to drive
// the outline's active-section highlight; a no-op stub is enough to
// keep the component from throwing at mount — active-state correctness
// is covered at the human-smoke layer, not here.
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

function makeArtifact(payload: Record<string, unknown>): Artifact {
  return {
    id: 'art_test',
    kind: 'research-report',
    title: 'Test report',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payload,
  } as unknown as Artifact
}

describe('ResearchReportArtifactCard — three-pane redesign', () => {
  it('shows "Planning outline" chip when status is planning', () => {
    const artifact = makeArtifact({
      topic: 'Perovskite stability',
      mode: 'research',
      style: 'concise',
      sections: [
        { id: 's1', heading: 'Intro', level: 2, markdown: '', citationIds: [], status: 'empty' },
        { id: 's2', heading: 'Background', level: 2, markdown: '', citationIds: [], status: 'empty' },
      ],
      citations: [],
      generatedAt: Date.now(),
      status: 'planning',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    expect(screen.getByText(/Planning outline/i)).toBeInTheDocument()
  })

  it('shows "Drafting X/Y · <heading>" chip during drafting', () => {
    const artifact = makeArtifact({
      topic: '中欧关系',
      mode: 'research',
      style: 'concise',
      sections: [
        { id: 's1', heading: 'Snapshot', level: 2, markdown: 'done body', citationIds: [], status: 'done' },
        { id: 's2', heading: 'Background', level: 2, markdown: '', citationIds: [], status: 'drafting' },
        { id: 's3', heading: 'Outlook', level: 2, markdown: '', citationIds: [], status: 'empty' },
      ],
      citations: [],
      generatedAt: Date.now(),
      status: 'drafting',
      currentSectionId: 's2',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    // 1 of the 3 is marked done; currentSection is s2; expect "2/3".
    expect(screen.getByText(/Drafting\s+2\/3/i)).toBeInTheDocument()
    // "Background" heading appears in both the outline and the body
    // section heading; assert at least one presence (chip sub-label).
    expect(screen.getAllByText(/Background/).length).toBeGreaterThan(0)
  })

  it('shows "Complete · N sections · M refs" chip when done', () => {
    const artifact = makeArtifact({
      topic: 'Perovskite solar cells',
      mode: 'survey',
      style: 'comprehensive',
      sections: [
        { id: 's1', heading: 'Intro', level: 2, markdown: 'body', citationIds: ['c1'], status: 'done' },
        { id: 's2', heading: 'Methods', level: 2, markdown: 'body', citationIds: ['c2'], status: 'done' },
      ],
      citations: [
        { id: 'c1', title: 'Paper A', authors: ['Smith'], year: 2023 },
        { id: 'c2', title: 'Paper B', authors: ['Jones'], year: 2024 },
      ],
      generatedAt: Date.now(),
      status: 'complete',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    expect(screen.getByText(/Complete/)).toBeInTheDocument()
    expect(screen.getByText(/2 sections/)).toBeInTheDocument()
    expect(screen.getByText(/2 refs/)).toBeInTheDocument()
  })

  it('renders all three panes with headings', () => {
    const artifact = makeArtifact({
      topic: 'Test',
      mode: 'research',
      style: 'concise',
      sections: [
        { id: 's1', heading: 'Intro', level: 2, markdown: 'body', citationIds: ['c1'], status: 'done' },
      ],
      citations: [
        { id: 'c1', title: 'Paper A', authors: ['Smith'], year: 2023 },
      ],
      generatedAt: Date.now(),
      status: 'complete',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    expect(screen.getByLabelText(/Section outline/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/References/i)).toBeInTheDocument()
    // "Intro" is the heading in both the outline pane and the body;
    // that's expected — assert both rather than expecting a single hit.
    expect(screen.getAllByText('Intro').length).toBeGreaterThanOrEqual(2)
    // Right-pane citation card shows the paper title.
    expect(screen.getByText('Paper A')).toBeInTheDocument()
  })

  it('outline item click scrolls the body section into view', () => {
    const artifact = makeArtifact({
      topic: 'Test',
      mode: 'research',
      style: 'concise',
      sections: [
        { id: 's1', heading: 'First', level: 2, markdown: 'a', citationIds: [], status: 'done' },
        { id: 's2', heading: 'Second', level: 2, markdown: 'b', citationIds: [], status: 'done' },
      ],
      citations: [],
      generatedAt: Date.now(),
      status: 'complete',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    const outline = screen.getByLabelText(/Section outline/i)
    const secondItem = within(outline).getByTitle('Second')
    fireEvent.click(secondItem)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('references-pane jump button scrolls body to the first citing section', () => {
    const artifact = makeArtifact({
      topic: 'Test',
      mode: 'research',
      style: 'concise',
      sections: [
        { id: 's1', heading: 'First', level: 2, markdown: 'a', citationIds: [], status: 'done' },
        { id: 's2', heading: 'Second', level: 2, markdown: 'b [@cite:c1]', citationIds: ['c1'], status: 'done' },
      ],
      citations: [
        { id: 'c1', title: 'Paper A', authors: ['Smith'], year: 2023 },
      ],
      generatedAt: Date.now(),
      status: 'complete',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    const refs = screen.getByLabelText(/References/i)
    const jumpBtn = within(refs).getByTitle(/Jump to first section/i)
    fireEvent.click(jumpBtn)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('unverified banner appears when any citation is unverified', () => {
    const artifact = makeArtifact({
      topic: 'Test',
      mode: 'research',
      style: 'concise',
      sections: [
        { id: 's1', heading: 'Intro', level: 2, markdown: 'body', citationIds: ['c1'], status: 'done' },
      ],
      citations: [
        { id: 'c1', title: 'Paper A', authors: ['Smith'], year: 2023, unverified: true },
      ],
      generatedAt: Date.now(),
      status: 'complete',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    expect(screen.getByText(/Citations drafted by LLM/i)).toBeInTheDocument()
    expect(screen.getAllByText(/unverified/i).length).toBeGreaterThan(0)
  })

  it('"Cited in §N" footer appears on each reference', () => {
    const artifact = makeArtifact({
      topic: 'Test',
      mode: 'research',
      style: 'concise',
      sections: [
        { id: 's1', heading: 'First', level: 2, markdown: 'a [@cite:c1]', citationIds: ['c1'], status: 'done' },
        { id: 's2', heading: 'Second', level: 2, markdown: 'b [@cite:c1]', citationIds: ['c1'], status: 'done' },
      ],
      citations: [
        { id: 'c1', title: 'Paper A', authors: ['Smith'], year: 2023 },
      ],
      generatedAt: Date.now(),
      status: 'complete',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    const refs = screen.getByLabelText(/References/i)
    expect(within(refs).getByText('§1 · §2')).toBeInTheDocument()
  })

  it('numbers citations by first body use and sorts the references pane accordingly', () => {
    const artifact = makeArtifact({
      topic: 'Test',
      mode: 'research',
      style: 'concise',
      sections: [
        {
          id: 's1',
          heading: 'First',
          level: 2,
          markdown: 'first cited [@cite:c2], then another [@cite:c1]',
          citationIds: ['c2', 'c1'],
          status: 'done',
        },
      ],
      citations: [
        { id: 'c1', title: 'Paper A', authors: ['Smith'], year: 2023 },
        { id: 'c2', title: 'Paper B', authors: ['Jones'], year: 2024 },
      ],
      generatedAt: Date.now(),
      status: 'complete',
    })
    const { container } = render(<ResearchReportArtifactCard artifact={artifact} />)

    const bodyRefs = Array.from(
      container.querySelectorAll('.research-card-cite-pill'),
    ).map((el) => el.textContent)
    expect(bodyRefs).toEqual(['1', '2'])

    const refs = screen.getByLabelText(/References/i)
    const refItems = within(refs).getAllByRole('listitem')
    expect(refItems[0]).toHaveTextContent('[1]')
    expect(refItems[0]).toHaveTextContent('Paper B')
    expect(refItems[1]).toHaveTextContent('[2]')
    expect(refItems[1]).toHaveTextContent('Paper A')
  })

  it('renders empty placeholder text when refs list is empty', () => {
    const artifact = makeArtifact({
      topic: 'Test',
      mode: 'research',
      style: 'concise',
      sections: [
        { id: 's1', heading: 'Intro', level: 2, markdown: 'body', citationIds: [], status: 'done' },
      ],
      citations: [],
      generatedAt: Date.now(),
      status: 'drafting',
      currentSectionId: 's1',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    expect(
      screen.getByText(/Citations will appear here as sections are drafted/i),
    ).toBeInTheDocument()
  })

  it('Detach button is present but disabled (reserved for future)', () => {
    const artifact = makeArtifact({
      topic: 'Test',
      mode: 'research',
      style: 'concise',
      sections: [
        { id: 's1', heading: 'Intro', level: 2, markdown: 'body', citationIds: [], status: 'done' },
      ],
      citations: [],
      generatedAt: Date.now(),
      status: 'complete',
    })
    render(<ResearchReportArtifactCard artifact={artifact} />)
    const detach = screen.getByRole('button', { name: /Detach/i })
    expect(detach).toBeDisabled()
  })
})
