import { useCallback } from 'react'
import { ClipboardCopy, Download } from 'lucide-react'
import { toast } from '../../../stores/toast-store'
import { downloadBinary } from '../../../lib/pro-export'

/**
 * Image thumbnail that exposes its own Copy / Download affordances on
 * hover. "Copy" copies the raw image bytes to the clipboard via
 * `ClipboardItem` (Chromium / Electron support this). "Download" saves
 * the image as a local file. Falls back to a "base64 text copy" toast
 * when native image clipboard isn't available.
 */
export default function ChatBubbleImage({
  mediaType,
  base64,
}: {
  mediaType: string
  base64: string
}) {
  const dataUrl = `data:${mediaType};base64,${base64}`

  const base64ToBlob = useCallback(() => {
    const bytes = atob(base64)
    const buf = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
    return new Blob([buf], { type: mediaType })
  }, [base64, mediaType])

  const handleCopy = useCallback(async () => {
    try {
      const blob = base64ToBlob()
      // Chromium / Electron renderer supports native image copy via
      // ClipboardItem; plain browsers without the API fall back below.
      if (
        typeof ClipboardItem !== 'undefined' &&
        navigator.clipboard?.write
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({ [mediaType]: blob }),
        ])
        toast.success('Image copied')
        return
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(dataUrl)
        toast.success('Image data-URL copied')
        return
      }
      throw new Error('Clipboard API unavailable')
    } catch (err) {
      toast.error(
        `Copy failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [base64ToBlob, dataUrl, mediaType])

  const handleDownload = useCallback(() => {
    const ext = mediaType.split('/')[1] || 'bin'
    downloadBinary(`image-${Date.now()}.${ext}`, base64ToBlob())
    toast.success('Image saved')
  }, [base64ToBlob, mediaType])

  return (
    <div className="chat-bubble-attached-image-wrap">
      <img src={dataUrl} alt="" className="chat-bubble-attached-image" />
      <div className="chat-bubble-image-actions">
        <button
          type="button"
          className="session-mini-btn"
          onClick={handleCopy}
          title="Copy image"
          aria-label="Copy image"
        >
          <ClipboardCopy size={11} aria-hidden />
        </button>
        <button
          type="button"
          className="session-mini-btn"
          onClick={handleDownload}
          title="Download image"
          aria-label="Download image"
        >
          <Download size={11} aria-hidden />
        </button>
      </div>
    </div>
  )
}
