// Tier 2 · component tests for MentionPicker.
//
// Regression guards:
//   • "No matches" rendering only when there is truly nothing to pick.
//     This was the failure surface when a narrowed useMemo dep list in
//     AgentComposer caused mentionables to go stale / empty.
//   • Group headers + fuzzy scoring fork on query string non-empty.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MentionPicker from './MentionPicker'
import type { Mentionable } from '../../types/mention-resolver'
import type { MentionRef } from '../../types/mention'

const SESSION_ID = 'ses_test'

const fileRow = (name: string): Mentionable => ({
  ref: { type: 'file', sessionId: SESSION_ID, relPath: `data/${name}` },
  label: name,
  sublabel: `data/${name}`,
  kindLabel: 'file',
  group: 'files',
})

const workspaceRow = (name: string): Mentionable => ({
  ref: { type: 'file', sessionId: SESSION_ID, relPath: `ws/${name}` },
  label: name,
  sublabel: `ws/${name}`,
  kindLabel: 'file',
  group: 'workspace',
})

const artifactRow = (id: string, title: string): Mentionable => ({
  ref: { type: 'artifact', sessionId: SESSION_ID, artifactId: id },
  label: title,
  sublabel: undefined,
  kindLabel: 'structure',
  group: 'artifacts',
})

describe('MentionPicker', () => {
  it('renders "No matches" when both mentionables and recent are empty', () => {
    render(
      <MentionPicker
        open={true}
        query=""
        recent={[]}
        mentionables={[]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('renders group headers + rows when query is empty and mentionables are present', () => {
    const mentionables = [
      fileRow('peak.xy'),
      workspaceRow('notes.md'),
      artifactRow('a1', 'BaTiO3'),
    ]
    render(
      <MentionPicker
        open={true}
        query=""
        recent={[]}
        mentionables={mentionables}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    )
    // No "No matches" when there's content.
    expect(screen.queryByText('No matches')).not.toBeInTheDocument()
    // At least one group header visible.
    expect(screen.getByText('FILES')).toBeInTheDocument()
    expect(screen.getByText('WORKSPACE')).toBeInTheDocument()
    // Row labels surface.
    expect(screen.getByText('peak.xy')).toBeInTheDocument()
    expect(screen.getByText('notes.md')).toBeInTheDocument()
  })

  it('drops group headers + returns a flat scored list when a query is present', () => {
    const mentionables = [
      fileRow('peak.xy'),
      fileRow('noise.csv'),
      workspaceRow('notes.md'),
    ]
    render(
      <MentionPicker
        open={true}
        query="peak"
        recent={[]}
        mentionables={mentionables}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    )
    // Top match surfaces.
    expect(screen.getByText('peak.xy')).toBeInTheDocument()
    // Entries unrelated to "peak" should be filtered out.
    expect(screen.queryByText('noise.csv')).not.toBeInTheDocument()
    expect(screen.queryByText('notes.md')).not.toBeInTheDocument()
    // No group headers in scored mode.
    expect(screen.queryByText('FILES')).not.toBeInTheDocument()
  })

  it('shows recent items under a RECENT header when the query is empty', () => {
    const recent: MentionRef[] = [
      { type: 'file', sessionId: SESSION_ID, relPath: 'data/peak.xy' },
    ]
    const mentionables = [fileRow('peak.xy'), fileRow('noise.csv')]
    render(
      <MentionPicker
        open={true}
        query=""
        recent={recent}
        mentionables={mentionables}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('RECENT')).toBeInTheDocument()
    // `peak.xy` moved to RECENT, not duplicated under FILES.
    expect(screen.getAllByText('peak.xy')).toHaveLength(1)
  })

  it('renders nothing when `open` is false', () => {
    render(
      <MentionPicker
        open={false}
        query=""
        recent={[]}
        mentionables={[fileRow('a')]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    )
    // No listbox, no rows.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('click on a row calls onSelect with the clicked Mentionable', () => {
    const onSelect = vi.fn()
    render(
      <MentionPicker
        open={true}
        query=""
        recent={[]}
        mentionables={[fileRow('peak.xy')]}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    )
    const row = screen.getByText('peak.xy').closest('[data-picker-idx]')
    expect(row).not.toBeNull()
    ;(row as HTMLElement).click()
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].label).toBe('peak.xy')
  })
})
