import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  History,
  Image as ImageIcon,
  Package,
  Play,
  Square,
} from 'lucide-react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import type {
  Artifact,
  ComputeArtifactPayload,
  ComputeFigure,
  ComputeRunEntry,
  ComputeStatus,
} from '../../../types/artifact'
import { useComputeConfigStore } from '../../../stores/compute-config-store'
import { toast } from '../../../stores/toast-store'
import { Badge, Button, EmptyState, type BadgeVariant } from '../../ui'

type TabKey = 'output' | 'figures' | 'errors'

interface Props {
  artifact: Artifact
  /** Persist the unsaved editor text back into payload.code (called on run + blur-sync). */
  onPatchPayload?: (nextPayload: ComputeArtifactPayload) => void
  /** "Run" — host spawns a runCompute for this artifact. */
  onRun?: (args: { code: string }) => void | Promise<void>
  /** "Stop" — host cancels the in-flight run. */
  onStop?: () => void | Promise<void>
  className?: string
}

const STATUS_VARIANTS: Record<ComputeStatus, BadgeVariant> = {
  idle: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

function pickDefaultTab(p: ComputeArtifactPayload): TabKey {
  if (p.stdout.length > 0) return 'output'
  if (p.figures.length > 0) return 'figures'
  if ((p.exitCode != null && p.exitCode !== 0) || p.stderr.length > 0) return 'errors'
  return 'output'
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}

export default function ComputeArtifactCard({
  artifact,
  onPatchPayload,
  onRun,
  onStop,
  className,
}: Props) {
  const payload = artifact.payload as unknown as ComputeArtifactPayload
  const [code, setCode] = useState<string>(payload.code)
  const [activeTab, setActiveTab] = useState<TabKey>(() => pickDefaultTab(payload))
  const [envOpen, setEnvOpen] = useState(false)
  const computeMode = useComputeConfigStore((s) => s.mode)

  const isRunning = payload.status === 'running'
  const tabCounts = useMemo(
    () => ({
      output: payload.stdout.length > 0,
      figures: payload.figures.length,
      errors: payload.stderr.length > 0 || (payload.exitCode != null && payload.exitCode !== 0),
    }),
    [payload.stdout, payload.figures, payload.stderr, payload.exitCode],
  )

  // Keep payload.code in sync with the editor so a Run picks up unsaved edits.
  // We patch on blur/run rather than every keystroke to avoid store churn.
  const syncCode = () => {
    if (code !== payload.code) {
      onPatchPayload?.({ ...payload, code })
    }
  }

  const handleRun = async () => {
    syncCode()
    if (computeMode === 'disabled') {
      toast.warn('Compute is disabled. Configure in Settings -> Compute Environment (Ctrl+,).')
      return
    }
    await onRun?.({ code })
  }

  const handleStop = async () => {
    await onStop?.()
  }

  const rootClassName = className
    ? `card-compute-root ${className}`
    : 'card-compute-root'

  return (
    <div className={rootClassName}>
      <TopBar
        status={payload.status}
        language={payload.language}
        env={payload.env}
        envOpen={envOpen}
        onToggleEnv={() => setEnvOpen((v) => !v)}
        onRun={handleRun}
        onStop={handleStop}
        isRunning={isRunning}
      />
      {(payload.status === 'cancelled' || payload.status === 'failed') && (
        <StaleResultBanner
          status={payload.status}
          durationMs={payload.durationMs}
          exitCode={payload.exitCode}
          workdir={payload.runs?.[0]?.workdir}
        />
      )}
      {payload.runs && payload.runs.length > 0 && (
        <RunHistoryBar runs={payload.runs} />
      )}
      <div className="card-compute-main-split">
        <div className="card-compute-left">
          <CodeEditor value={code} onChange={setCode} />
        </div>
        <div className="card-compute-splitter" />
        <div className="card-compute-right">
          <TabBar activeTab={activeTab} onChange={setActiveTab} counts={tabCounts} />
          <div className="card-compute-tab-body">
            {activeTab === 'output' && <OutputPane stdout={payload.stdout} />}
            {activeTab === 'figures' && <FiguresPane figures={payload.figures} />}
            {activeTab === 'errors' && <ErrorsPane stderr={payload.stderr} exitCode={payload.exitCode} />}
          </div>
        </div>
      </div>
      <BottomBar exitCode={payload.exitCode} durationMs={payload.durationMs} pythonVersion={payload.env?.pythonVersion} />
    </div>
  )
}

function TopBar({
  status, language, env, envOpen, onToggleEnv, onRun, onStop, isRunning,
}: {
  status: ComputeStatus
  language: string
  env?: ComputeArtifactPayload['env']
  envOpen: boolean
  onToggleEnv: () => void
  onRun: () => void
  onStop: () => void
  isRunning: boolean
}) {
  return (
    <div className="card-compute-top-bar">
      <StatusChip status={status} />
      <Badge variant="neutral" className="card-compute-lang-badge">{language}</Badge>
      <span className="card-compute-spacer" />
      <div className="card-compute-env-wrap">
        <Button
          variant="ghost"
          size="sm"
          leading={<Package size={13} />}
          onClick={onToggleEnv}
          title="Environment packages"
        >
          env
        </Button>
        {envOpen && env && (
          <div className="card-compute-env-tooltip">
            <div className="card-compute-env-tooltip-head">python {env.pythonVersion}</div>
            <ul className="card-compute-env-list">
              {env.packages.map((pkg) => <li key={pkg} className="card-compute-env-item">{pkg}</li>)}
            </ul>
          </div>
        )}
      </div>
      {isRunning ? (
        <Button variant="danger" size="sm" leading={<Square size={12} />} onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Button variant="primary" size="sm" leading={<Play size={12} />} onClick={onRun}>
          Run
        </Button>
      )}
    </div>
  )
}

/** Prominent "results below may be stale" banner shown when the most
 *  recent run ended in `cancelled` or `failed`. Pairs with the L1-L3
 *  hallucination defense: even if the agent lies about the outcome in
 *  chat, the card itself flags the untrusted state so the user can
 *  disbelieve the LLM's summary. Clicking opens the archived workdir
 *  so the user can inspect meta.json / stdout.log directly. */
function StaleResultBanner({
  status,
  durationMs,
  exitCode,
  workdir,
}: {
  status: 'cancelled' | 'failed'
  durationMs?: number
  exitCode: number | null
  workdir?: string
}) {
  const label =
    status === 'cancelled' ? 'Last run cancelled' : 'Last run failed'
  const detail =
    status === 'cancelled'
      ? `cancelled after ${formatDuration(durationMs)}`
      : `exit=${exitCode ?? '?'} after ${formatDuration(durationMs)}`

  const handleOpen = async () => {
    if (!workdir) {
      toast.warn('This run was not archived (older than retention window).')
      return
    }
    const api = window.electronAPI
    if (!api?.computeOpenWorkdir) {
      toast.warn('Open-workdir needs the Electron desktop shell.')
      return
    }
    const r = await api.computeOpenWorkdir(workdir)
    if (!r.success) toast.error(r.error ?? 'Could not open workdir')
  }

  return (
    <div
      className="card-compute-stale-banner"
      role="alert"
      aria-live="polite"
    >
      <AlertTriangle size={13} strokeWidth={2} aria-hidden />
      <div className="card-compute-stale-banner-body">
        <div className="card-compute-stale-banner-title">{label}</div>
        <div className="card-compute-stale-banner-detail">
          {detail}. Any numeric results the chat mentions may be from an earlier run — verify against the run log before trusting them.
        </div>
      </div>
      <button
        type="button"
        className="card-compute-stale-banner-action"
        onClick={handleOpen}
        disabled={!workdir}
        title={workdir ?? 'Workdir was pruned (retention window)'}
      >
        <FolderOpen size={11} />
        Open run log
      </button>
    </div>
  )
}

/** Collapsible strip listing the last few runs of this artifact. Shows
 *  only when `payload.runs` has any entries. Click a row's folder icon
 *  to pop the archived workdir in the host file manager. */
function RunHistoryBar({ runs }: { runs: ComputeRunEntry[] }) {
  const [open, setOpen] = useState(false)
  const latest = runs[0]
  const count = runs.length

  const handleOpen = async (workdir?: string) => {
    if (!workdir) {
      toast.warn('This run was not archived (older than retention window).')
      return
    }
    const api = window.electronAPI
    if (!api?.computeOpenWorkdir) {
      toast.warn('Open-workdir needs the Electron desktop shell.')
      return
    }
    const r = await api.computeOpenWorkdir(workdir)
    if (!r.success) toast.error(r.error ?? 'Could not open workdir')
  }

  return (
    <div className="card-compute-run-history">
      <button
        type="button"
        className="card-compute-run-history-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <History size={11} />
        <span>Run history</span>
        <span className="card-compute-run-history-count">{count}</span>
        {!open && latest && (
          <span className="card-compute-run-history-latest">
            latest: {formatRunSummary(latest)}
          </span>
        )}
      </button>
      {open && (
        <ul className="card-compute-run-history-list">
          {runs.slice(0, 8).map((r) => (
            <li key={r.runId} className="card-compute-run-history-item">
              <span className={`card-compute-run-history-dot card-compute-run-history-dot--${r.status}`} />
              <span className="card-compute-run-history-time">
                {formatHistoryTime(r.startedAt)}
              </span>
              <span className="card-compute-run-history-dur">
                {formatDuration(r.durationMs)}
              </span>
              <span className="card-compute-run-history-exit">
                exit {r.exitCode ?? (r.status === 'running' ? '—' : r.cancelled ? 'cancel' : '?')}
              </span>
              <button
                type="button"
                className="card-compute-run-history-open"
                onClick={() => handleOpen(r.workdir)}
                disabled={!r.workdir}
                title={r.workdir ?? 'Workdir pruned (retention window)'}
              >
                <FolderOpen size={11} />
              </button>
            </li>
          ))}
          {runs.length > 8 && (
            <li className="card-compute-run-history-more">
              … {runs.length - 8} older entries (archived workdirs auto-pruned beyond the 3 most recent)
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function formatRunSummary(r: ComputeRunEntry): string {
  if (r.status === 'running') return 'running…'
  const exit = r.exitCode ?? (r.cancelled ? 'cancel' : '?')
  return `exit ${exit} · ${formatDuration(r.durationMs)}`
}

function formatHistoryTime(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    const sameDay = d.toDateString() === new Date().toDateString()
    if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

function StatusChip({ status }: { status: ComputeStatus }) {
  return (
    <Badge
      variant={STATUS_VARIANTS[status]}
      leading={
        <span className={`card-compute-status-dot-wrap${status === 'running' ? ' spin' : ''}`}>
          <span className="card-compute-status-dot" />
        </span>
      }
      className="card-compute-status-badge"
    >
      {status}
    </Badge>
  )
}

function CodeEditor({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        keymap.of([...defaultKeymap, indentWithTab]),
        python(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: 'var(--text-sm)' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="card-compute-editor-host" />
}

function TabBar({
  activeTab, onChange, counts,
}: {
  activeTab: TabKey
  onChange: (t: TabKey) => void
  counts: { output: boolean; figures: number; errors: boolean }
}) {
  return (
    <div className="card-compute-tab-bar">
      <TabButton active={activeTab === 'output'} onClick={() => onChange('output')} icon={<FileText size={12} />} label="Output" dot={counts.output} />
      <TabButton active={activeTab === 'figures'} onClick={() => onChange('figures')} icon={<ImageIcon size={12} />} label="Figures" badge={counts.figures || undefined} />
      <TabButton active={activeTab === 'errors'} onClick={() => onChange('errors')} icon={<AlertCircle size={12} />} label="Errors" dot={counts.errors} danger />
    </div>
  )
}

function TabButton({
  active, onClick, icon, label, dot, badge, danger,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  dot?: boolean
  badge?: number
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card-compute-tab-btn${active ? ' is-active' : ''}`}
    >
      {icon}
      <span>{label}</span>
      {badge != null && <span className="card-compute-tab-badge">{badge}</span>}
      {dot && (
        <span className={`card-compute-tab-dot${danger ? ' is-danger' : ''}`} />
      )}
    </button>
  )
}

const FIGURE_SENTINEL_RE = /__LATTICE_FIGURES__[\s\S]*$/

function OutputPane({ stdout }: { stdout: string }) {
  const visible = useMemo(
    () => stdout.replace(FIGURE_SENTINEL_RE, '').trimEnd(),
    [stdout],
  )
  if (!visible) return <EmptyState compact title="No stdout captured" />
  return <pre className="card-compute-pre">{visible}</pre>
}

function FiguresPane({ figures }: { figures: ComputeFigure[] }) {
  if (figures.length === 0) return <EmptyState compact title="No figures produced" />
  return (
    <div className="card-compute-figures-grid">
      {figures.map((fig, idx) => (
        <figure key={idx} className="card-compute-figure">
          <img
            src={`data:image/${fig.format};base64,${fig.base64}`}
            alt={fig.caption ?? `figure ${idx + 1}`}
            className="card-compute-figure-img"
          />
          {fig.caption && <figcaption className="card-compute-figure-caption">{fig.caption}</figcaption>}
        </figure>
      ))}
    </div>
  )
}

function ErrorsPane({ stderr, exitCode }: { stderr: string; exitCode: number | null }) {
  const hasError = stderr.length > 0 || (exitCode != null && exitCode !== 0)
  if (!hasError) return <EmptyState compact title="No errors" />
  return (
    <pre className="card-compute-pre card-compute-pre--error">
      {exitCode != null && exitCode !== 0 ? `exit ${exitCode}\n` : ''}
      {stderr}
    </pre>
  )
}

function BottomBar({
  exitCode, durationMs, pythonVersion,
}: {
  exitCode: number | null
  durationMs?: number
  pythonVersion?: string
}) {
  return (
    <div className="card-compute-bottom-bar">
      <span className="card-compute-bottom-item">exit <code className="card-compute-bottom-code">{exitCode ?? '—'}</code></span>
      <span className="card-compute-bottom-divider" />
      <span className="card-compute-bottom-item"><Clock size={11} />{formatDuration(durationMs)}</span>
      {pythonVersion && (
        <>
          <span className="card-compute-bottom-divider" />
          <span className="card-compute-bottom-item">py {pythonVersion}</span>
        </>
      )}
    </div>
  )
}
