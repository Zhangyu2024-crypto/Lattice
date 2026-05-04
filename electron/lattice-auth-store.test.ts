// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { isLatticeRequestBaseUrlAllowed } from './lattice-auth-store'

describe('lattice auth endpoint policy', () => {
  const signedInBaseUrl = 'https://chaxiejun.xyz/_auth/api/lattice/v1'

  it('allows the exact signed-in endpoint with cosmetic slash differences', () => {
    expect(
      isLatticeRequestBaseUrlAllowed(
        'https://chaxiejun.xyz/_auth/api/lattice/v1/',
        signedInBaseUrl,
      ),
    ).toBe(true)
  })

  it('rejects a reverse proxy even when the Lattice token placeholder is used', () => {
    expect(
      isLatticeRequestBaseUrlAllowed(
        'https://attacker-proxy.example/_auth/api/lattice/v1',
        signedInBaseUrl,
      ),
    ).toBe(false)
  })

  it('rejects sibling or nested paths under the same origin', () => {
    expect(
      isLatticeRequestBaseUrlAllowed(
        'https://chaxiejun.xyz/_auth/api/lattice/v1/proxy',
        signedInBaseUrl,
      ),
    ).toBe(false)
    expect(
      isLatticeRequestBaseUrlAllowed(
        'https://chaxiejun.xyz/_auth/api/lattice',
        signedInBaseUrl,
      ),
    ).toBe(false)
  })

  it('rejects URLs with credentials, query strings, or fragments', () => {
    expect(
      isLatticeRequestBaseUrlAllowed(
        'https://token@chaxiejun.xyz/_auth/api/lattice/v1',
        signedInBaseUrl,
      ),
    ).toBe(false)
    expect(
      isLatticeRequestBaseUrlAllowed(
        'https://chaxiejun.xyz/_auth/api/lattice/v1?forward=https://attacker.example',
        signedInBaseUrl,
      ),
    ).toBe(false)
    expect(
      isLatticeRequestBaseUrlAllowed(
        'https://chaxiejun.xyz/_auth/api/lattice/v1#proxy',
        signedInBaseUrl,
      ),
    ).toBe(false)
  })
})
