import { describe, expect, it } from 'vitest'
import {
  buildLatexCollaborationRoomName,
  collaborationTicketEndpoint,
  createLatexCollaborationMetadata,
  DEFAULT_LATEX_COLLABORATION_SERVER_URL,
  normalizeCollaborationServerUrl,
  normalizeLatexCollaborationMetadata,
  summarizeCollaborationMembers,
} from './collaboration'
import type { LatexDocumentPayload } from '../../types/latex'

const basePayload: LatexDocumentPayload = {
  files: [{ path: 'main.tex', kind: 'tex', content: 'Hello' }],
  rootFile: 'main.tex',
  activeFile: 'main.tex',
  engine: 'pdftex',
  status: 'idle',
  errors: [],
  warnings: [],
  logTail: '',
  mentionMode: 'selection',
  outline: [],
  ghostEnabled: false,
  autoCompile: true,
  autoFixSuggest: true,
}

describe('latex collaboration helpers', () => {
  it('normalizes websocket server URLs only', () => {
    expect(normalizeCollaborationServerUrl(' wss://example.org/collab/ ')).toBe(
      'wss://example.org/collab',
    )
    expect(normalizeCollaborationServerUrl('https://example.org')).toBeUndefined()
    expect(normalizeCollaborationServerUrl('not a url')).toBeUndefined()
  })

  it('derives the HTTP ticket endpoint from websocket server URLs', () => {
    expect(collaborationTicketEndpoint('wss://example.org/_collab')).toBe(
      'https://example.org/_collab/ticket',
    )
    expect(collaborationTicketEndpoint('ws://localhost:8011')).toBe(
      'http://localhost:8011/ticket',
    )
  })

  it('creates deterministic local identity from artifact and user name', () => {
    const a = createLatexCollaborationMetadata({
      artifactId: 'artifact-1',
      documentTitle: 'Phase Diagram Draft',
      userName: 'Dr. Chen',
      now: 1000,
    })
    const b = createLatexCollaborationMetadata({
      artifactId: 'artifact-1',
      documentTitle: 'Phase Diagram Draft',
      userName: 'Dr. Chen',
      now: 2000,
    })

    expect(a.localUserId).toBe(b.localUserId)
    expect(a.workspaceRelDir).toBe('papers/phase-diagram-draft')
    expect(a.serverUrl).toBe(DEFAULT_LATEX_COLLABORATION_SERVER_URL)
    expect(a.enabled).toBe(true)
    expect(a.roomAccessKey).toMatch(/^[A-Za-z0-9_-]{32,256}$/)
    expect(a.roomSecret).toMatch(/^[A-Za-z0-9_-]{32,256}$/)
    expect(a.roomAccessKey).not.toBe(a.roomSecret)
    expect(a.encryption).toBe('e2ee-v1')
    expect(a.roomAccessKey).not.toBe(b.roomAccessKey)
    expect(a.roomSecret).not.toBe(b.roomSecret)
  })

  it('keeps old documents compatible when collaboration is absent', () => {
    expect(
      normalizeLatexCollaborationMetadata(basePayload, 'artifact-1', 'Draft'),
    ).toBeUndefined()
  })

  it('fills missing collaboration fields defensively', () => {
    const payload: LatexDocumentPayload = {
      ...basePayload,
      collaboration: {
        enabled: true,
        provider: 'yjs-websocket',
        projectId: '',
        roomId: '',
        role: 'editor',
        initialSync: 'prefer-room',
        localUserId: '',
        localUserName: '',
        localUserColor: '',
        createdAt: 0,
        updatedAt: 0,
      },
    }

    const normalized = normalizeLatexCollaborationMetadata(
      payload,
      'artifact-1',
      'Draft',
      1000,
    )

    expect(normalized?.projectId).toMatch(/^latex-artifact-1-/)
    expect(normalized?.roomId).toMatch(/^LAT-/)
    expect(normalized?.roomAccessKey).toMatch(/^[A-Za-z0-9_-]{32,256}$/)
    expect(normalized?.roomSecret).toMatch(/^[A-Za-z0-9_-]{32,256}$/)
    expect(normalized?.roomSecret).toBe(normalized?.roomAccessKey)
    expect(normalized?.encryption).toBe('e2ee-v1')
    expect(normalized?.localUserName).toBe('Local author')
    expect(normalized?.role).toBe('editor')
    expect(normalized?.serverUrl).toBeUndefined()
  })

  it('builds room names per project, room, and file', () => {
    expect(
      buildLatexCollaborationRoomName(
        { projectId: 'paper/a', roomId: 'LAT 123' },
        'chapters/intro.tex',
      ),
    ).toBe('paper-a:LAT-123:chapters-intro.tex')
  })

  it('deduplicates local and remote members', () => {
    const collab = createLatexCollaborationMetadata({
      artifactId: 'artifact-1',
      documentTitle: 'Draft',
      userName: 'Local User',
      now: 1000,
    })

    const members = summarizeCollaborationMembers(collab, [
      {
        id: collab.localUserId,
        name: 'Duplicate',
        role: 'editor',
        color: '#000',
      },
      { id: 'remote-1', name: 'Remote User', role: 'viewer', color: '#123' },
    ])

    expect(members).toHaveLength(2)
    expect(members[0]).toMatchObject({ name: 'Local User', isLocal: true })
    expect(members[1]).toMatchObject({ id: 'remote-1', role: 'viewer' })
  })
})
