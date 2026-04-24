// Global error-capture installer.
//
// Called once from `src/main.tsx` (before React mounts) to wire up:
//   1. window.error                — synchronous runtime errors
//   2. window.unhandledrejection   — promise failures with no catch
//   3. console.error / console.warn proxies — forward to log store while
//      preserving the original console behavior
//   4. Python worker `log` events  — forwarded by electron/worker-manager
//
// All sinks push into the same structured log store so the Log Console
// sees a unified stream with correct `source`/`type`.
//
// Dev-mode caveat: React StrictMode double-invokes render functions in
// development, which makes `console.error` fire twice for the same
// warning. We dedupe identical `message + first stack frame` within
// 500 ms so the log panel stays readable.

import { log } from './logger'
import { classifyError, type LogLevel } from './log-classifier'
import { onWorkerLog } from './worker-client'
import { errorMessage } from './error-message'

let installed = false
let inCapture = false

interface DedupeKey {
  value: string
  expiresAt: number
}
const recent: DedupeKey[] = []
const DEDUPE_WINDOW_MS = 500

function dedupeGate(key: string): boolean {
  const now = Date.now()
  // Drop expired entries.
  while (recent.length > 0 && recent[0].expiresAt <= now) recent.shift()
  if (recent.some((k) => k.value === key)) return true
  recent.push({ value: key, expiresAt: now + DEDUPE_WINDOW_MS })
  return false
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.message
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function installWindowHandlers(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (ev) => {
    if (inCapture) return
    inCapture = true
    try {
      const source = 'window' as const
      const detail: Record<string, unknown> = {}
      if (typeof ev.filename === 'string') detail.filename = ev.filename
      if (typeof ev.lineno === 'number') detail.lineno = ev.lineno
      if (ev.error) {
        log.exception(ev.error, { source, detail })
      } else {
        log.error(ev.message || 'window.error', { source, type: 'runtime', detail })
      }
    } finally {
      inCapture = false
    }
  })

  window.addEventListener('unhandledrejection', (ev) => {
    if (inCapture) return
    inCapture = true
    try {
      log.exception(ev.reason, {
        source: 'window',
        type: classifyError(ev.reason),
        message: `Unhandled rejection: ${errorMessage(ev.reason)}`,
      })
    } finally {
      inCapture = false
    }
  })
}

function installConsoleProxy(): void {
  if (typeof console === 'undefined') return

  const wrap = (level: LogLevel, original: (...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      // Always call the native method first so devtools still show output
      try {
        original(...args)
      } catch {
        // If the original console call throws we still want to log.
      }
      if (inCapture) return
      inCapture = true
      try {
        const joined = args.map(stringifyArg).join(' ')
        if (!joined) return
        // Extract a stack from the first Error argument (if any) so the
        // dedupe key can distinguish similar messages from different
        // sites.
        const firstError = args.find((a): a is Error => a instanceof Error)
        const stackFrame = firstError?.stack?.split('\n')[1] ?? ''
        if (dedupeGate(`${level}|${joined}|${stackFrame}`)) return

        const detail: Record<string, unknown> = { args }
        if (firstError?.stack) detail.stack = firstError.stack

        log[level](joined, {
          source: 'console',
          type: firstError ? classifyError(firstError) : 'runtime',
          detail,
        })
      } finally {
        inCapture = false
      }
    }
  }

  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = wrap('error', origError)
  console.warn = wrap('warn', origWarn)
}

function installWorkerLogPipe(): void {
  try {
    onWorkerLog(({ level, message }) => {
      const lvl: LogLevel =
        level === 'error' || level === 'warn' || level === 'info' || level === 'success'
          ? level
          : 'info'
      // `log.info` defaults type to 'unknown'; keep that for benign
      // worker emissions. Errors/warnings keep 'runtime'.
      const fn =
        lvl === 'error' ? log.error
        : lvl === 'warn' ? log.warn
        : lvl === 'info' ? log.info
        : log.success
      fn(message || '(empty)', { source: 'worker', type: 'runtime' })
    })
  } catch {
    // Worker IPC may be unavailable (pure Vite dev or web build) — OK.
  }
}

/** Idempotent installer. Safe to call multiple times (HMR etc.). */
export function installGlobalErrorCapture(): void {
  if (installed) return
  installed = true
  installWindowHandlers()
  installConsoleProxy()
  installWorkerLogPipe()
}
