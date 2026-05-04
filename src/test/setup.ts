// Vitest global setup — runs once per worker before any test file.
//
// Responsibilities:
//   1. Register `@testing-library/jest-dom` matchers (`toBeInTheDocument`, …)
//   2. Stub `window.electronAPI` so renderer code that uses optional-chained
//      API calls (`window.electronAPI?.computeRun(...)`) doesn't crash. Tests
//      that care about a specific IPC call override the stub per-test.
//   3. Polyfill `ResizeObserver` and `matchMedia` — jsdom omits both; many of
//      our deps (Radix, 3Dmol wrappers, some dnd-kit internals) touch them
//      at import-time.
//   4. Stub `scrollIntoView` on Element (used by MentionPicker keyboard nav).
//
// Keep this file small — expensive setup belongs in a per-suite helper.

import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// ── window.electronAPI stub ────────────────────────────────────────
// Individual tests can override via:
//   window.electronAPI = { ...window.electronAPI, computeRun: vi.fn(...) }
// ...and a global `afterEach` resets state below.
function makeStubElectronAPI(): Window['electronAPI'] {
  const noop = () => Promise.resolve()
  const noopBool = () => Promise.resolve({ success: false })
  // Only define the handful of methods the default renderer paths poke at
  // on mount. Missing methods are allowed (tests use optional chaining).
  return {
    openFile: noop as never,
    openDirectory: noop as never,
    getBackendInfo: () =>
      Promise.resolve({ ready: false, port: 0, token: '', baseUrl: '' }),
    startBackend: noopBool as never,
    onBackendStatus: () => () => {},
    auditRecord: () => Promise.resolve({ ok: true }),
    platform: 'linux',
  } as unknown as Window['electronAPI']
}

// Assign on `window` (jsdom) so renderer code sees it exactly as in Electron.
// Skipped when the suite opts into `@vitest-environment node` — `window` is
// undefined there and no renderer code imports setup polyfills anyway.
if (typeof window !== 'undefined') {
  ;(window as Window).electronAPI = makeStubElectronAPI()
}

// ── ResizeObserver polyfill ────────────────────────────────────────
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  StubResizeObserver as unknown as typeof ResizeObserver

// ── DOMMatrix polyfill ─────────────────────────────────────────────
// pdf.js touches `new DOMMatrix()` at import-time. jsdom doesn't ship it.
if (typeof globalThis.DOMMatrix === 'undefined') {
  class StubDOMMatrix {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0
    multiplySelf() { return this }
    translateSelf() { return this }
    scaleSelf() { return this }
    rotateSelf() { return this }
    invertSelf() { return this }
  }
  globalThis.DOMMatrix =
    StubDOMMatrix as unknown as typeof DOMMatrix
}

// ── matchMedia polyfill ────────────────────────────────────────────
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// ── scrollIntoView polyfill (jsdom lacks it) ───────────────────────
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// ── Cleanup between tests ───────────────────────────────────────────
afterEach(() => {
  cleanup() // unmount testing-library trees
  vi.restoreAllMocks() // reset spies / stubs
})
