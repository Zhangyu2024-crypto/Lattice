// Shared clipboard-copy helper — wraps `navigator.clipboard.writeText`
// with a uniform toast + error message so the 15+ "copy this to
// clipboard" sites across the app all share identical feedback.
//
// The pattern being replaced:
//
//   try {
//     await navigator.clipboard.writeText(text)
//     toast.success('Copied')
//   } catch (err) {
//     toast.error(`Copy failed: ${err instanceof Error ? err.message : String(err)}`)
//   }
//
// Call sites that deliberately fire-and-forget silently (no feedback
// desired — e.g. a right-click copy where the toast would feel noisy)
// should keep using `navigator.clipboard.writeText` directly.

import { toast } from '../stores/toast-store'

/**
 * Copy `text` to the system clipboard. Fires toast feedback (info on
 * success, error on failure). Returns the boolean success so callers
 * that want to gate follow-up work on a successful copy can do so.
 *
 * @param text - Payload to copy. Falsy → toast error + return false.
 * @param successMsg - Toast shown on success. Default "Copied".
 */
export async function copyText(
  text: string,
  successMsg = 'Copied',
): Promise<boolean> {
  if (!text) {
    toast.error('Nothing to copy')
    return false
  }
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API unavailable')
    }
    await navigator.clipboard.writeText(text)
    toast.success(successMsg)
    return true
  } catch (err) {
    toast.error(
      `Copy failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}
