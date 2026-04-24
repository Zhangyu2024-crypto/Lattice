// Tier 2 · component tests for the shared TableActions toolbar.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { TableActions } from './TableActions'
import type { TableSpec } from '../../lib/table-export'

interface Row {
  name: string
  value: number
}

const SPEC: TableSpec<Row> = {
  columns: [
    { key: 'name', header: 'Name' },
    { key: 'value', header: 'Value' },
  ],
  rows: [
    { name: 'alpha', value: 1 },
    { name: 'beta', value: 2 },
  ],
  filename: 'demo',
}

const EMPTY_SPEC: TableSpec<Row> = { ...SPEC, rows: [] }

describe('TableActions', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mocked')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
  })

  it('renders nothing when the table has zero rows', () => {
    const { container } = render(<TableActions spec={EMPTY_SPEC} />)
    expect(container.firstChild).toBeNull()
  })

  it('inline variant renders two primary icon buttons + overflow toggle', () => {
    render(<TableActions spec={SPEC} />)
    expect(screen.getByLabelText('Copy table')).toBeInTheDocument()
    expect(screen.getByLabelText('Download CSV')).toBeInTheDocument()
    expect(screen.getByLabelText('More copy formats')).toBeInTheDocument()
  })

  it('inline · Copy button writes TSV to the clipboard', async () => {
    render(<TableActions spec={SPEC} />)
    fireEvent.click(screen.getByLabelText('Copy table'))
    // copyTable is async; let the event loop flush.
    await Promise.resolve()
    await Promise.resolve()
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    const payload = (
      navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0][0]
    expect(payload).toContain('Name\tValue')
    expect(payload).toContain('alpha\t1')
  })

  it('inline · Download button synthesises a Blob anchor click', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    render(<TableActions spec={SPEC} />)
    fireEvent.click(screen.getByLabelText('Download CSV'))
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
  })

  it('inline · overflow menu reveals "Copy as Markdown"', () => {
    render(<TableActions spec={SPEC} />)
    fireEvent.click(screen.getByLabelText('More copy formats'))
    expect(screen.getByText('Copy as Markdown')).toBeInTheDocument()
  })

  it('compact variant collapses everything into a single ⋯ menu', () => {
    render(<TableActions spec={SPEC} variant="compact" />)
    // Only the single toggle is present initially.
    expect(screen.getByLabelText('Table actions')).toBeInTheDocument()
    expect(screen.queryByLabelText('Copy table')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Download CSV')).not.toBeInTheDocument()
    // Open → all three items show.
    fireEvent.click(screen.getByLabelText('Table actions'))
    expect(screen.getByText('Copy (TSV)')).toBeInTheDocument()
    expect(screen.getByText('Copy as Markdown')).toBeInTheDocument()
    expect(screen.getByText('Download CSV')).toBeInTheDocument()
  })
})
