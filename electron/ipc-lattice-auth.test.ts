// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { collabBaseFromSessionBase, collabWsUrl } from './ipc-lattice-auth'

describe('lattice collaboration endpoint helpers', () => {
  it('derives the collaboration gateway from the signed-in API endpoint', () => {
    expect(
      collabBaseFromSessionBase('https://chaxiejun.xyz/_auth/api/lattice/v1'),
    ).toBe('https://chaxiejun.xyz/_collab')
  })

  it('builds a ticket-bound websocket URL for the room', () => {
    expect(
      collabWsUrl('https://chaxiejun.xyz/_collab', 'latex.room-1', 'latt_col_x'),
    ).toBe('wss://chaxiejun.xyz/_collab/latex.room-1?ticket=latt_col_x')
  })

  it('preserves local development as plain websocket', () => {
    expect(
      collabWsUrl('http://localhost:8011', 'dev', 'latt_col_y'),
    ).toBe('ws://localhost:8011/dev?ticket=latt_col_y')
  })
})
