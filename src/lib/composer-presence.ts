// Tiny "is the AgentComposer currently mounted?" registry.
//
// The PDF selection toolbar fires `dispatchComposerPrefill` /
// `dispatchMentionAdd` to push a quote into the main chat input (see
// composer-bus.ts). Those events quietly no-op when the chat panel is
// hidden — the composer isn't subscribed, so the user's "Ask AI" click
// would look broken without any feedback. This module exposes a simple
// ref-counted "is-mounted" flag the toolbar consults before dispatching,
// plus an auto-open request when the composer isn't ready yet.
//
// Not a store on purpose — we don't want composer-mount to trigger React
// renders anywhere else; a plain module-scoped counter is enough.

import { useEffect } from 'react'

let mountCount = 0

/** Call when the AgentComposer mounts; pair with `unregister`. Usually
 *  wrapped in {@link useRegisterComposerPresence} so the ref counting is
 *  automatic. */
function registerComposerMount(): void {
  mountCount += 1
}

function unregisterComposerMount(): void {
  mountCount = Math.max(0, mountCount - 1)
}

/** AgentComposer should call this once from a top-level `useEffect`. It
 *  balances automatically on unmount. */
export function useRegisterComposerPresence(): void {
  useEffect(() => {
    registerComposerMount()
    return unregisterComposerMount
  }, [])
}

/** True when at least one AgentComposer instance is mounted in the app. */
export function isComposerMounted(): boolean {
  return mountCount > 0
}

// ── Open-chat request ─────────────────────────────────────────────────
//
// If a caller (e.g. the PDF selection "Ask AI" action) wants to send a
// prefill but the composer isn't mounted, it can fire this event and the
// App shell will flip the chat panel visible. Modelled after composer-bus
// so subscribers don't need to import anything other than a named event.

const OPEN_CHAT_EVENT = 'lattice:open-chat-panel'

export function dispatchOpenChatPanel(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT))
}

export function useOpenChatPanelListener(handler: () => void): void {
  useEffect(() => {
    const listener = () => handler()
    window.addEventListener(OPEN_CHAT_EVENT, listener)
    return () => window.removeEventListener(OPEN_CHAT_EVENT, listener)
  }, [handler])
}
