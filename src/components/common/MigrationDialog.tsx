import { useEffect, useState } from 'react'
import { AlertCircle, Database, FolderOpen, Loader2 } from 'lucide-react'
import {
  canMigrateInCurrentRuntime,
  detectMigrationCandidate,
  finalizeMigration,
} from '@/lib/workspace/migration-boot'
import { migrateSessionStoreToWorkspace } from '@/lib/workspace/migrate-from-session-store'
import type { MigrationReport } from '@/lib/workspace/migrate-from-session-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

type Stage =
  | { kind: 'idle' }
  | { kind: 'selecting' }
  | { kind: 'exporting'; rootPath: string }
  | { kind: 'archiving'; rootPath: string }
  | { kind: 'done'; report: MigrationReport; rootPath: string }
  | { kind: 'error'; message: string; report?: MigrationReport }

export default function MigrationDialog() {
  const [open, setOpen] = useState(false)
  const [rawPayload, setRawPayload] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const setRoot = useWorkspaceStore((s) => s.setRoot)
  const getFs = useWorkspaceStore((s) => s.getFs)

  useEffect(() => {
    if (!canMigrateInCurrentRuntime()) return
    const candidate = detectMigrationCandidate()
    if (!candidate) return
    setRawPayload(candidate.raw)
    setOpen(true)
  }, [])

  if (!open) return null

  const handleSkip = () => {
    setOpen(false)
    setStage({ kind: 'idle' })
  }

  const handleChoose = async () => {
    if (!rawPayload) return
    const api = window.electronAPI
    if (!api?.openDirectory) {
      setStage({
        kind: 'error',
        message: 'Workspace APIs are unavailable in this runtime.',
      })
      return
    }
    setStage({ kind: 'selecting' })
    try {
      const picked = await api.openDirectory()
      if (!picked) {
        setStage({ kind: 'idle' })
        return
      }
      await setRoot(picked)
      const rootPath = useWorkspaceStore.getState().rootPath
      if (!rootPath) {
        setStage({
          kind: 'error',
          message: 'Failed to set workspace root.',
        })
        return
      }
      setStage({ kind: 'exporting', rootPath })
      const report = await migrateSessionStoreToWorkspace(getFs(), rawPayload)
      setStage({ kind: 'archiving', rootPath })
      finalizeMigration()
      if (report.errors.length > 0) {
        setStage({
          kind: 'error',
          message: `Migration finished with ${report.errors.length} error${report.errors.length === 1 ? '' : 's'}.`,
          report,
        })
        return
      }
      setStage({ kind: 'done', report, rootPath })
    } catch (err) {
      setStage({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleClose = () => {
    setOpen(false)
    setStage({ kind: 'idle' })
  }

  return (
    <div
      role="presentation"
      onClick={(e) => {
        // Block accidental backdrop dismissal while a write is in-flight.
        if (stage.kind === 'exporting' || stage.kind === 'archiving') return
        if (e.target === e.currentTarget) {
          stage.kind === 'done' ? handleClose() : handleSkip()
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="migration-dialog-title"
        style={{
          width: 'min(560px, 92vw)',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg-sidebar, #1e1e1e)',
          border: '1px solid var(--color-border, #2a2a2a)',
          borderRadius: 10,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.55)',
          color: 'var(--fg, #ddd)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderBottom: '1px solid var(--color-border, #2a2a2a)',
          }}
        >
          <Database size={18} strokeWidth={1.7} />
          <h2
            id="migration-dialog-title"
            style={{
              margin: 0,
              fontSize: 'var(--text-md)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}
          >
            Migrate Existing Session Data
          </h2>
        </header>

        <div
          style={{
            padding: '16px 18px',
            fontSize: "var(--text-base)",
            lineHeight: 1.55,
            color: 'var(--fg-muted, #b8bec6)',
            overflowY: 'auto',
          }}
        >
          <Body stage={stage} />
        </div>

        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 18px',
            borderTop: '1px solid var(--color-border, #2a2a2a)',
            background: 'var(--color-bg-panel, #191919)',
          }}
        >
          <Footer
            stage={stage}
            onSkip={handleSkip}
            onChoose={handleChoose}
            onClose={handleClose}
          />
        </footer>
      </div>
    </div>
  )
}

function Body({ stage }: { stage: Stage }) {
  switch (stage.kind) {
    case 'idle':
      return (
        <>
          <p style={{ margin: '0 0 10px 0' }}>
            Lattice found an existing session store in this browser's local
            storage. To migrate it into the new workspace format, choose a
            folder on disk where Lattice should store your sessions, chat
            transcripts, and artifacts.
          </p>
          <p style={{ margin: 0, color: 'var(--fg-muted, #8a9099)' }}>
            The legacy payload will be archived under{' '}
            <code style={codeStyle}>.lattice/legacy-session-store.json</code>{' '}
            and cleared from local storage once the migration succeeds.
          </p>
        </>
      )
    case 'selecting':
      return <StepRow label="Waiting for folder selection…" />
    case 'exporting':
      return (
        <>
          <StepRow label={`Exporting sessions to ${stage.rootPath}…`} />
        </>
      )
    case 'archiving':
      return <StepRow label="Archiving legacy payload…" />
    case 'done':
      return (
        <>
          <p style={{ margin: '0 0 10px 0', color: 'var(--fg, #ddd)' }}>
            Migration complete.
          </p>
          <ReportSummary report={stage.report} />
        </>
      )
    case 'error':
      return (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              color: 'var(--danger, #e5484d)',
              marginBottom: 10,
            }}
          >
            <AlertCircle size={16} strokeWidth={1.7} style={{ marginTop: 2 }} />
            <div style={{ fontSize: "var(--text-base)" }}>{stage.message}</div>
          </div>
          {stage.report ? <ReportSummary report={stage.report} /> : null}
          {stage.report && stage.report.errors.length > 0 ? (
            <ErrorList errors={stage.report.errors} />
          ) : null}
        </>
      )
  }
}

function Footer({
  stage,
  onSkip,
  onChoose,
  onClose,
}: {
  stage: Stage
  onSkip: () => void
  onChoose: () => void
  onClose: () => void
}) {
  const working =
    stage.kind === 'selecting' ||
    stage.kind === 'exporting' ||
    stage.kind === 'archiving'

  if (stage.kind === 'done') {
    return (
      <button
        type="button"
        onClick={onClose}
        style={primaryButton}
      >
        Done
      </button>
    )
  }

  if (stage.kind === 'error') {
    return (
      <>
        <button type="button" onClick={onSkip} style={secondaryButton}>
          Close
        </button>
        <button type="button" onClick={onChoose} style={primaryButton}>
          Retry
        </button>
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={onSkip}
        disabled={working}
        style={secondaryButton}
      >
        Skip for now
      </button>
      <button
        type="button"
        onClick={onChoose}
        disabled={working}
        style={primaryButton}
      >
        <FolderOpen size={14} strokeWidth={1.8} />
        Choose Workspace Folder…
      </button>
    </>
  )
}

function StepRow({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: 'var(--fg, #ddd)',
        fontSize: "var(--text-base)",
      }}
    >
      <Loader2
        size={16}
        strokeWidth={1.8}
        style={{ animation: 'mig-spin 0.9s linear infinite' }}
      />
      <span>{label}</span>
      <style>{`@keyframes mig-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ReportSummary({ report }: { report: MigrationReport }) {
  return (
    <ul style={reportListStyle}>
      <li>Sessions migrated: {report.migratedSessions}</li>
      <li>Artifacts migrated: {report.migratedArtifacts}</li>
      <li>Transcript messages: {report.migratedTranscripts}</li>
      <li>
        Archive path: <code style={codeStyle}>{report.archivePath}</code>
      </li>
    </ul>
  )
}

function ErrorList({
  errors,
}: {
  errors: MigrationReport['errors']
}) {
  return (
    <details
      style={{
        marginTop: 10,
        fontSize: "var(--text-sm)",
        color: 'var(--fg-muted, #9aa0a6)',
      }}
    >
      <summary style={{ cursor: 'pointer' }}>
        {errors.length} error{errors.length === 1 ? '' : 's'}
      </summary>
      <ul style={{ margin: '8px 0 0 0', paddingLeft: 18 }}>
        {errors.map((err, idx) => (
          <li key={`${err.sessionId}-${err.stage}-${idx}`}>
            <code style={codeStyle}>
              [{err.stage}] {err.sessionId || '(global)'}
            </code>
            : {err.message}
          </li>
        ))}
      </ul>
    </details>
  )
}

const codeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: "var(--text-xs)",
  background: 'var(--bg, #121212)',
  border: '1px solid var(--color-border, #2a2a2a)',
  padding: '1px 5px',
  borderRadius: 3,
}

const reportListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--fg-muted, #b8bec6)',
  fontSize: "var(--text-sm)",
  lineHeight: 1.75,
}

const primaryButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  border: '1px solid var(--accent, #0e7490)',
  borderRadius: 5,
  background: 'var(--accent, #0e7490)',
  color: '#fff',
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  cursor: 'pointer',
}

const secondaryButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  border: '1px solid var(--color-border, #3a3a3a)',
  borderRadius: 5,
  background: 'transparent',
  color: 'var(--fg, #ddd)',
  fontSize: "var(--text-sm)",
  cursor: 'pointer',
}
