import { ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { useAgentDialogStore } from '../../stores/agent-dialog-store'
import { useEscapeKey } from '../../hooks/useEscapeKey'

export default function ApprovalDialog() {
  const pending = useAgentDialogStore((s) => s.pendingApproval)
  const resolveApproval = useAgentDialogStore((s) => s.resolveApproval)

  useEscapeKey(
    () => pending && resolveApproval(pending.id, { kind: 'deny' }),
    !!pending,
  )

  if (!pending) return null

  const isHostExec = pending.trustLevel === 'hostExec'
  const Icon = isHostExec ? ShieldAlert : ShieldCheck
  const tone = isHostExec ? 'danger' : 'warn'

  const onDeny = () => resolveApproval(pending.id, { kind: 'deny' })
  const onAllowOnce = () => resolveApproval(pending.id, { kind: 'allow-once' })
  const onAllowSession = () =>
    resolveApproval(pending.id, { kind: 'allow-session' })

  return (
    <div className="agent-dialog-overlay" onClick={onDeny}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="agent-dialog agent-dialog-approval"
      >
        <div className="agent-dialog-header">
          <Icon size={18} className={`agent-dialog-icon tone-${tone}`} />
          <div className="agent-dialog-headline">
            Agent wants to run:{' '}
            <code className="agent-dialog-tool-code">{pending.toolName}</code>
          </div>
          <span className={`agent-dialog-trust-badge tone-${tone}`}>
            {pending.trustLevel}
          </span>
          <button
            onClick={onDeny}
            title="Close (Esc)"
            className="agent-dialog-close-btn"
          >
            <X size={16} />
          </button>
        </div>

        <div className="agent-dialog-description">
          {pending.toolDescription}
        </div>

        <div className="agent-dialog-input-section">
          <div className="agent-dialog-field-label">Input</div>
          <pre className="agent-dialog-input-body">
            {JSON.stringify(pending.input, null, 2)}
          </pre>
        </div>

        <div className="agent-dialog-actions">
          <button onClick={onDeny} className="agent-dialog-btn agent-dialog-btn-secondary">
            Deny
          </button>
          <button
            onClick={onAllowOnce}
            className="agent-dialog-btn agent-dialog-btn-primary"
          >
            Allow once
          </button>
          {!isHostExec ? (
            <button
              onClick={onAllowSession}
              className="agent-dialog-btn agent-dialog-btn-muted"
            >
              Allow for this session
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
