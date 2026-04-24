import { create } from 'zustand'
import { genShortId } from '../lib/id-gen'
import { useLogStore, type LogDetail } from './log-store'
import type { LogSource, LogType } from '../lib/log-classifier'

export type ToastKind = 'error' | 'warn' | 'info' | 'success'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  ttl: number | null
  createdAt: number
}

/** Optional metadata passed to `toast.error(msg, meta)`. When provided,
 *  the log store sees the richer source/type/detail instead of the
 *  default `source: 'ui', type: 'runtime'`. */
export interface ToastMeta {
  source?: LogSource
  type?: LogType
  detail?: LogDetail
  /** Suppress the log entry entirely (toast only). Rare — use when the
   *  same event has already been logged by a deeper layer. */
  skipLog?: boolean
  /** Override the default TTL (ms). null = sticky. */
  ttl?: number | null
}

interface PushInput {
  kind: ToastKind
  message: string
  ttl?: number | null
}

interface ToastState {
  toasts: Toast[]
  push: (t: PushInput) => string
  dismiss: (id: string) => void
  clear: () => void
}

const DEFAULT_TTL: Record<ToastKind, number | null> = {
  error: 8000,
  warn: 6000,
  info: 4000,
  success: 3000,
}

const DEFAULT_LOG_TYPE: Record<ToastKind, LogType> = {
  error: 'runtime',
  warn: 'runtime',
  info: 'unknown',
  success: 'unknown',
}

const genId = () => genShortId('toast', 4)

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = genId()
    const ttl = t.ttl !== undefined ? t.ttl : DEFAULT_TTL[t.kind]
    const toast: Toast = {
      id,
      kind: t.kind,
      message: t.message,
      ttl,
      createdAt: Date.now(),
    }
    set((s) => ({ toasts: [...s.toasts, toast] }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

function pushToLog(kind: ToastKind, message: string, meta?: ToastMeta): void {
  if (meta?.skipLog) return
  useLogStore.getState().pushEntry({
    level: kind,
    source: meta?.source ?? 'ui',
    type: meta?.type ?? DEFAULT_LOG_TYPE[kind],
    message,
    detail: meta?.detail,
  })
}

function showToast(kind: ToastKind, message: string, meta?: ToastMeta): string {
  const id = useToastStore.getState().push({
    kind,
    message,
    ttl: meta?.ttl,
  })
  pushToLog(kind, message, meta)
  return id
}

export const toast = {
  error: (message: string, meta?: ToastMeta) => showToast('error', message, meta),
  warn: (message: string, meta?: ToastMeta) => showToast('warn', message, meta),
  info: (message: string, meta?: ToastMeta) => showToast('info', message, meta),
  success: (message: string, meta?: ToastMeta) => showToast('success', message, meta),
}
