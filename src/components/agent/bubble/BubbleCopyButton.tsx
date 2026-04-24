import { useCallback, useState } from 'react'
import { ClipboardCopy } from 'lucide-react'
import { copyText } from '../../../lib/clipboard-helper'

/**
 * Small hover-only Copy button pinned to a chat bubble's top-right.
 * Grabs the raw message text (without timestamps / chat chrome) for
 * pasting into a note / doc / ticket.
 */
export default function BubbleCopyButton({ text }: { text: string }) {
  const [pending, setPending] = useState(false)
  const handle = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setPending(true)
    await copyText(trimmed, 'Message copied')
    setPending(false)
  }, [text])
  if (!text.trim()) return null
  return (
    <button
      type="button"
      className={`chat-bubble-copy${pending ? ' is-pending' : ''}`}
      onClick={handle}
      title="Copy message"
      aria-label="Copy message"
    >
      <ClipboardCopy size={11} aria-hidden />
    </button>
  )
}
