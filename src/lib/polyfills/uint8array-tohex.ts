// Polyfills for Stage-3 collection / typed-array helpers that pdfjs-dist 5.x
// already uses, while Electron 33's Chromium 130 still lacks them:
//
// - `Uint8Array.prototype.toHex()`
// - `Map.prototype.getOrInsertComputed()`
// - `WeakMap.prototype.getOrInsertComputed()`
//
// Without these, PDF loading/rendering fails with runtime errors such as
// `n.toHex is not a function` or `map.getOrInsertComputed is not a function`.
//
// Two realms need patching:
//   1. Main renderer thread — patched as a side effect of importing this
//      module once from `src/main.tsx`.
//   2. The pdfjs Web Worker — a separate realm, so the main-thread patch
//      does NOT reach it. `PdfContinuousViewer` wraps the pdfjs worker
//      source in a blob-URL shim that inlines {@link POLYFILL_SOURCE} and
//      then dynamically imports the real worker. See the viewer for the
//      wrapper construction.
//
// The `disableWorker` option that pdfjs 4.x honoured no longer exists
// in pdfjs-dist 5.x — only `isNodeJS === true` takes the fake-worker
// path, so we cannot avoid the worker spawn in-browser. Hence the
// wrapper approach.
//
// Remove both this file and the wrapper call site once Electron upgrades
// past Chromium 135.

declare global {
  interface Uint8Array {
    // TS lib defs don't include this proposal yet; declaring it keeps
    // call sites in pdfjs-dist type-clean without casting.
    toHex(): string
  }

  interface Map<K, V> {
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V
  }

  interface WeakMap<K extends WeakKey, V> {
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V
  }
}

/**
 * Polyfill source as a plain-text template. Consumed by the pdfjs-worker
 * wrapper in `PdfContinuousViewer` — the blob-URL wrapper inlines this
 * string before dynamic-importing the real worker, so the method lands
 * in the worker realm the same way the block below lands in the main
 * realm.
 *
 * Kept deliberately free of TS syntax so it parses as plain ES2015 in
 * the worker's module context (which evaluates it verbatim, NOT through
 * `eval` — the wrapper is a real Worker source, not `new Function`).
 *
 * Source parity with the main-thread implementation below is enforced
 * by eyeballing — if you change one, mirror the other. Tiny enough that
 * deduping (e.g. extracting a shared function body string) would cost
 * more than it saves.
 */
export const POLYFILL_SOURCE = `
if (typeof Uint8Array.prototype.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value: function toHex() {
      var HEX = '0123456789abcdef';
      var out = '';
      for (var i = 0; i < this.length; i++) {
        var b = this[i];
        out += HEX[(b >>> 4) & 0xf] + HEX[b & 0xf];
      }
      return out;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

if (typeof Map !== 'undefined' &&
    typeof Map.prototype.getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value: function getOrInsertComputed(key, callbackfn) {
      if (typeof callbackfn !== 'function') {
        throw new TypeError('callbackfn must be a function');
      }
      if (this.has(key)) {
        return this.get(key);
      }
      var value = callbackfn(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

if (typeof WeakMap !== 'undefined' &&
    typeof WeakMap.prototype.getOrInsertComputed !== 'function') {
  Object.defineProperty(WeakMap.prototype, 'getOrInsertComputed', {
    value: function getOrInsertComputed(key, callbackfn) {
      if (typeof callbackfn !== 'function') {
        throw new TypeError('callbackfn must be a function');
      }
      if (this.has(key)) {
        return this.get(key);
      }
      var value = callbackfn(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
`

// Main-realm patch. Running this as real TS (rather than eval-ing
// POLYFILL_SOURCE via `new Function`) keeps the CSP tight — the default
// `script-src` has `'self' 'unsafe-inline' blob:` but deliberately NO
// `'unsafe-eval'`, and `new Function(...)` is treated as eval.
if (typeof Uint8Array.prototype.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value: function toHex(this: Uint8Array): string {
      const HEX = '0123456789abcdef'
      let out = ''
      for (let i = 0; i < this.length; i++) {
        const b = this[i]
        out += HEX[(b >>> 4) & 0xf] + HEX[b & 0xf]
      }
      return out
    },
    writable: true,
    enumerable: false,
    configurable: true,
  })
}

if (
  typeof Map !== 'undefined' &&
  typeof Map.prototype.getOrInsertComputed !== 'function'
) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value: function getOrInsertComputed<K, V>(
      this: Map<K, V>,
      key: K,
      callbackfn: (key: K) => V,
    ): V {
      if (typeof callbackfn !== 'function') {
        throw new TypeError('callbackfn must be a function')
      }
      if (this.has(key)) {
        return this.get(key) as V
      }
      const value = callbackfn(key)
      this.set(key, value)
      return value
    },
    writable: true,
    enumerable: false,
    configurable: true,
  })
}

if (
  typeof WeakMap !== 'undefined' &&
  typeof WeakMap.prototype.getOrInsertComputed !== 'function'
) {
  Object.defineProperty(WeakMap.prototype, 'getOrInsertComputed', {
    value: function getOrInsertComputed<K extends WeakKey, V>(
      this: WeakMap<K, V>,
      key: K,
      callbackfn: (key: K) => V,
    ): V {
      if (typeof callbackfn !== 'function') {
        throw new TypeError('callbackfn must be a function')
      }
      if (this.has(key)) {
        return this.get(key) as V
      }
      const value = callbackfn(key)
      this.set(key, value)
      return value
    },
    writable: true,
    enumerable: false,
    configurable: true,
  })
}
