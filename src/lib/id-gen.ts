// Tiny shared ID generator used by stores + workspace persistence +
// dialog queue. Previously six different modules each had their own
// near-identical implementation — identical entropy / time source, but
// drifting slightly on random-suffix length and prefix conventions.
//
// Not crypto-secure. We rely on the `Date.now().toString(36)` prefix for
// chronological ordering and a short base-36 random suffix for
// collision avoidance within a session. That's enough for toasts /
// draft rows / queued questions / session artifacts — if you need a
// cryptographically strong id, reach for `crypto.randomUUID()` instead.

/**
 * `prefix_<timestamp>_<random>` where the random suffix defaults to 6
 * chars. Tight enough to avoid the ~2⁻²¹ collision rate of a 4-char
 * suffix while still printing compactly in debug logs and error
 * toasts.
 */
export function genShortId(prefix: string, randLength = 6): string {
  const len = Math.max(2, Math.min(randLength, 10))
  const rand = Math.random().toString(36).slice(2, 2 + len)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}
