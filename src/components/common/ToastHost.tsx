import { useEffect } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore, type Toast } from '../../stores/toast-store'

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
      <div className="toast-host-message">{toast.message}</div>
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
