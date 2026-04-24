// Async replacement for `window.prompt()` — Electron disables the native
// Chromium prompt() at the renderer layer. Rather than polyfill the
// synchronous API (can't be done without SharedArrayBuffer + cross-origin
// isolation), we expose a Promise-based helper and a small host component
// that renders a modal dialog on demand.
//
// Usage:
//   const next = await asyncPrompt({ message: 'Rename session', defaultValue: oldName })
//   if (next != null && next.trim()) rename(next.trim())
//
// `null` means user cancelled (Esc / cancel button); matches the semantics
// of `window.prompt` so the migration from sync to async is a diff-minimal
// rename.

export interface PromptOptions {
  message: string
  defaultValue?: string
  /** Custom confirm-button label. Defaults to "OK". */
  okLabel?: string
  /** Custom cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string
  /** Placeholder shown in the input when empty. */
  placeholder?: string
}

export interface PromptRequest extends PromptOptions {
  id: string
  resolve: (value: string | null) => void
}

const EVENT = 'lattice:prompt:open'

/** Fire-and-forget; consumers await the returned Promise for the value. */
export function asyncPrompt(
  optionsOrMessage: PromptOptions | string,
  defaultValue?: string,
): Promise<string | null> {
  const options: PromptOptions =
    typeof optionsOrMessage === 'string'
      ? { message: optionsOrMessage, defaultValue }
      : optionsOrMessage
  return new Promise((resolve) => {
    const id = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const request: PromptRequest = { ...options, id, resolve }
    window.dispatchEvent(new CustomEvent<PromptRequest>(EVENT, { detail: request }))
  })
}

export function subscribePromptRequests(
  handler: (req: PromptRequest) => void,
): () => void {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<PromptRequest>
    if (ce.detail) handler(ce.detail)
  }
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
