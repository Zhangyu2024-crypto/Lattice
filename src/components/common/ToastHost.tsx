import { useEffect } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore, type Toast } from '../../stores/toast-store'
import { compactAssistantErrorToast } from '../../lib/assistant-error-display'

export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <div className="toast-host-stack">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    if (toast.ttl === null) return
    const handle = setTimeout(onDismiss, toast.ttl)
    return () => clearTimeout(handle)
  }, [toast.id, toast.ttl, onDismiss])

  const palette = kindPalette(toast.kind)
  const Icon = palette.icon
  const message = formatToastMessage(toast.message)

  return (
    <div
      className="toast-host-card"
      style={
        {
          '--toast-border': palette.border,
          '--toast-accent': palette.accent,
        } as React.CSSProperties
      }
    >
      <Icon size={16} className="toast-host-icon" />
      <div className="toast-host-message">
        {message.title ? (
          <>
            <div className="toast-host-message-title">{message.title}</div>
            <div className="toast-host-message-body">{message.body}</div>
          </>
        ) : (
          message.body
        )}
        {message.meta ? (
          <div className="toast-host-message-meta">{message.meta}</div>
        ) : null}
      </div>
      <button
        onClick={onDismiss}
        className="toast-host-dismiss"
        title="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  )
}

function kindPalette(kind: Toast['kind']) {
  switch (kind) {
    case 'error':
      return { icon: AlertCircle, accent: 'var(--color-red)', border: 'rgba(240, 240, 240, 0.35)' }
    case 'warn':
      return { icon: AlertTriangle, accent: 'var(--color-yellow)', border: 'rgba(144, 144, 144, 0.40)' }
    case 'success':
      return { icon: CheckCircle2, accent: 'var(--color-green)', border: 'rgba(168, 168, 168, 0.40)' }
    case 'info':
    default:
      return { icon: Info, accent: 'var(--color-accent)', border: 'var(--color-border)' }
  }
}

interface ToastMessageView {
  title?: string
  body: string
  meta?: string
}

function formatToastMessage(message: string): ToastMessageView {
  return compactAssistantErrorToast(message)
}
