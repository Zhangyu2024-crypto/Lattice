// Tier 2 · component tests for the ResizeHandle.
//
// Contract: `mousedown` captures the start y + height, each `mousemove`
// emits an `onDraft(next)` clamped to [min,max], and a single `mouseup`
// emits `onCommit(final)` followed by state reset (no more onDraft fires).

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { ResizeHandle } from './ResizeHandle'

function setup(initial = 200) {
  const onDraft = vi.fn()
  const onCommit = vi.fn()
  render(
    <ResizeHandle
      height={initial}
      min={80}
      max={800}
      onDraft={onDraft}
      onCommit={onCommit}
      label="Resize editor"
    />,
  )
  const handle = screen.getByRole('separator', { name: 'Resize editor' })
  return { onDraft, onCommit, handle }
}

describe('ResizeHandle', () => {
  it('calls onDraft with the clamped next height on mousemove and onCommit once on mouseup', () => {
    const { onDraft, onCommit, handle } = setup(200)

    fireEvent.mouseDown(handle, { clientY: 100 })
    // Drag down 50px → next = 200 + 50 = 250.
    fireEvent.mouseMove(window, { clientY: 150 })
    expect(onDraft).toHaveBeenLastCalledWith(250)
    // Drag further — handle should keep firing drafts.
    fireEvent.mouseMove(window, { clientY: 180 })
    expect(onDraft).toHaveBeenLastCalledWith(280)
    // Release.
    fireEvent.mouseUp(window, { clientY: 180 })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenLastCalledWith(280)
  })

  it('clamps below `min`', () => {
    const { onDraft, onCommit, handle } = setup(200)
    fireEvent.mouseDown(handle, { clientY: 500 })
    fireEvent.mouseMove(window, { clientY: 0 })
    // Candidate would be 200 - 500 = -300; clamped to 80.
    expect(onDraft).toHaveBeenLastCalledWith(80)
    fireEvent.mouseUp(window, { clientY: 0 })
    expect(onCommit).toHaveBeenLastCalledWith(80)
  })

  it('clamps above `max`', () => {
    const { onDraft, onCommit, handle } = setup(200)
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 10_000 })
    // Candidate would be 200 + 9900; clamped to 800.
    expect(onDraft).toHaveBeenLastCalledWith(800)
    fireEvent.mouseUp(window, { clientY: 10_000 })
    expect(onCommit).toHaveBeenLastCalledWith(800)
  })

  it('detaches global listeners after release (no further drafts on mousemove)', () => {
    const { onDraft, handle } = setup(200)
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseUp(window, { clientY: 100 })
    onDraft.mockClear()
    fireEvent.mouseMove(window, { clientY: 200 })
    expect(onDraft).not.toHaveBeenCalled()
  })
})
