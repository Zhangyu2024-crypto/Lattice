import { BookOpen, Copy, Cpu, Info, Sparkles, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { copyText } from '../../../../lib/clipboard-helper'
import {
  createLatexCollaborationMetadata,
  DEFAULT_LATEX_COLLABORATION_SERVER_URL,
  normalizeCollaborationServerUrl,
} from '../../../../lib/latex/collaboration'
import type {
  LatexCollaborationMetadata,
  LatexCollaborationRuntimeState,
} from '../../../../types/collaboration'
import type { LatexDocumentPayload, LatexMentionMode } from '../../../../types/latex'
import { toast } from '../../../../stores/toast-store'
import { Button } from '../../../ui'
import MetaRow from '../../../ui/MetaRow'
import { useLLMConfigStore } from '../../../../stores/llm-config-store'
import { LATTICE_AUTH_PROVIDER_ID } from '../../../../lib/lattice-auth-client'

interface Props {
  documentTitle: string
  artifactId: string
  payload: LatexDocumentPayload
  collaboration?: LatexCollaborationMetadata
  collaborationRuntime: LatexCollaborationRuntimeState
  onPatchPayload: (partial: Partial<LatexDocumentPayload>) => void
}

const MENTION_LABEL: Record<LatexMentionMode, string> = {
  selection: 'Selection only',
  outline: 'Outline sections',
  full: 'Full project',
}

export default function LatexDetailsPane({
  documentTitle,
  artifactId,
  payload,
  collaboration,
  collaborationRuntime,
  onPatchPayload,
}: Props) {
  const latticeProvider = useLLMConfigStore((s) =>
    s.providers.find((p) => p.id === LATTICE_AUTH_PROVIDER_ID),
  )
  const [desktopUserName, setDesktopUserName] = useState<string | undefined>()
  const [serverInput, setServerInput] = useState(
    collaboration?.serverUrl ?? DEFAULT_LATEX_COLLABORATION_SERVER_URL,
  )
  useEffect(() => {
    setServerInput(collaboration?.serverUrl ?? DEFAULT_LATEX_COLLABORATION_SERVER_URL)
  }, [collaboration?.serverUrl])
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.latticeAuthGetSession?.()
      .then((session) => {
        if (!cancelled && session.authenticated) {
          setDesktopUserName(session.username)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  const tex = payload.files.filter((f) => f.kind === 'tex').length
  const bib = payload.files.filter((f) => f.kind === 'bib').length
  const assets = payload.files.filter((f) => f.kind === 'asset').length

  const lastRun =
    payload.lastCompileAt != null
      ? new Date(payload.lastCompileAt).toLocaleString(undefined, {
          dateStyle: 'short',
          timeStyle: 'medium',
        })
      : '—'

  const duration =
    payload.durationMs != null && payload.durationMs >= 0
      ? `${(payload.durationMs / 1000).toFixed(1)}s`
      : '—'

  const collaborationStatus = useMemo(() => {
    switch (collaborationRuntime.status) {
      case 'connected':
        return 'Connected'
      case 'connecting':
        return 'Connecting'
      case 'disconnected':
        return 'Disconnected'
      case 'error':
        return 'Connection issue'
      case 'local-only':
        return 'Local room'
      case 'disabled':
      default:
        return 'Off'
    }
  }, [collaborationRuntime.status])

  const handleCreateCollaboration = () => {
    const next = createLatexCollaborationMetadata({
      artifactId,
      documentTitle,
      userName: desktopUserName ?? (latticeProvider?.enabled ? 'Lattice user' : undefined),
      serverUrl: serverInput,
    })
    onPatchPayload({ collaboration: next })
  }

  const handleToggleCollaboration = (enabled: boolean) => {
    if (!collaboration) return
    onPatchPayload({
      collaboration: {
        ...collaboration,
        enabled,
        updatedAt: Date.now(),
      },
    })
  }

  const handleApplyServer = () => {
    if (!collaboration) return
    const normalized = normalizeCollaborationServerUrl(serverInput)
    if (serverInput.trim() && !normalized) {
      toast.error('Use a ws:// or wss:// collaboration server URL')
      return
    }
    onPatchPayload({
      collaboration: {
        ...collaboration,
        serverUrl: normalized,
        updatedAt: Date.now(),
      },
    })
  }

  const handleCopyInvite = () => {
    if (!collaboration) return
    const invite = [
      `Lattice LaTeX room: ${collaboration.roomId}`,
      `Project: ${collaboration.projectId}`,
      collaboration.roomSecret
        ? `Room key: ${collaboration.roomSecret}`
        : collaboration.roomAccessKey
          ? `Room key: ${collaboration.roomAccessKey}`
          : null,
      collaboration.serverUrl ? `Server: ${collaboration.serverUrl}` : null,
      'Keep this invite private. Anyone with the room key can join and decrypt the room.',
    ]
      .filter(Boolean)
      .join('\n')
    void copyText(invite, 'Collaboration room copied')
  }

  return (
    <div className="latex-details-pane">
      <section className="latex-details-section">
        <h3 className="latex-details-section-title">
          <BookOpen size={14} strokeWidth={2} aria-hidden />
          Document
        </h3>
        <MetaRow label="Title" value={documentTitle || 'Untitled'} />
        <MetaRow label="Root file" value={payload.rootFile} mono />
        <MetaRow
          label="Files"
          value={`${tex} TeX · ${bib} BibTeX · ${assets} other`}
        />
      </section>

      <section className="latex-details-section">
        <h3 className="latex-details-section-title">
          <Users size={14} strokeWidth={2} aria-hidden />
          Collaboration
        </h3>
        {collaboration ? (
          <>
            <div className="latex-collab-status-row">
              <span
                className={`latex-collab-status-dot is-${collaborationRuntime.status}`}
              />
              <span className="latex-collab-status-copy">
                {collaborationStatus}
                {collaborationRuntime.error
                  ? ` · ${collaborationRuntime.error}`
                  : ''}
              </span>
            </div>
            <MetaRow label="Room" value={collaboration.roomId} mono />
            <MetaRow label="Project" value={collaboration.projectId} mono />
            <MetaRow
              label="Encryption"
              value={collaboration.encryption === 'e2ee-v1' ? 'End-to-end' : 'Local'}
            />
            <MetaRow
              label="Source layout"
              value={collaboration.workspaceRelDir ?? 'artifact files'}
              mono
            />
            <div className="latex-details-field">
              <span className="latex-details-field-label">
                Collaboration server
              </span>
              <div className="latex-collab-server-row">
                <input
                  className="latex-details-input"
                  value={serverInput}
                  placeholder={DEFAULT_LATEX_COLLABORATION_SERVER_URL}
                  onChange={(e) => setServerInput(e.target.value)}
                />
                <Button variant="secondary" size="sm" onClick={handleApplyServer}>
                  Apply
                </Button>
              </div>
              <span className="latex-details-toggle-hint">
                Empty server keeps the document in local-only mode. Online rooms
                send only encrypted LaTeX updates to the server.
              </span>
            </div>
            <div className="latex-collab-actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyInvite}
                leading={<Copy size={13} />}
              >
                Copy room
              </Button>
              <Button
                variant={collaboration.enabled ? 'ghost' : 'primary'}
                size="sm"
                onClick={() => handleToggleCollaboration(!collaboration.enabled)}
              >
                {collaboration.enabled ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
            <div className="latex-collab-members">
              {collaborationRuntime.members.map((member) => (
                <div className="latex-collab-member" key={member.id}>
                  <span
                    className="latex-collab-member-color"
                    style={{ background: member.color }}
                  />
                  <span className="latex-collab-member-name">
                    {member.name}
                    {member.isLocal ? ' (you)' : ''}
                  </span>
                  <span className="latex-collab-member-role">{member.role}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="latex-details-assistant-copy">
              Create an end-to-end encrypted room for this LaTeX artifact.
              Source edits sync online; compile output stays local.
            </p>
            <div className="latex-details-field">
              <span className="latex-details-field-label">
                Collaboration server
              </span>
              <input
                className="latex-details-input"
                value={serverInput}
                placeholder={DEFAULT_LATEX_COLLABORATION_SERVER_URL}
                onChange={(e) => setServerInput(e.target.value)}
              />
            </div>
            <Button variant="primary" size="sm" onClick={handleCreateCollaboration}>
              Create room
            </Button>
          </>
        )}
      </section>

      <section className="latex-details-section">
        <h3 className="latex-details-section-title">
          <Cpu size={14} strokeWidth={2} aria-hidden />
          Build
        </h3>
        <MetaRow
          label="Engine"
          value={payload.engine === 'pdftex' ? 'pdfTeX (BusyTeX)' : payload.engine}
        />
        <MetaRow label="Last compile" value={lastRun} />
        <MetaRow label="Last duration" value={duration} />
        <p className="latex-details-hint">
          The first compile loads the TeX engine into memory (~5-10s).
          Use the header <strong>Compile</strong> button or enable auto-compile
          below.
        </p>
      </section>

      <section className="latex-details-section">
        <h3 className="latex-details-section-title">
          <Info size={14} strokeWidth={2} aria-hidden />
          Options
        </h3>
        <label className="latex-details-toggle">
          <span className="latex-details-toggle-text">
            <span className="latex-details-toggle-label">Auto-compile</span>
            <span className="latex-details-toggle-hint">
              Rebuild ~2s after you stop typing
            </span>
          </span>
          <input
            type="checkbox"
            checked={payload.autoCompile}
            onChange={(e) =>
              onPatchPayload({ autoCompile: e.target.checked })
            }
          />
        </label>
        <label className="latex-details-toggle">
          <span className="latex-details-toggle-text">
            <span className="latex-details-toggle-label">Ghost suggestions</span>
            <span className="latex-details-toggle-hint">
              Inline completion hints in the editor (when available)
            </span>
          </span>
          <input
            type="checkbox"
            checked={payload.ghostEnabled}
            onChange={(e) =>
              onPatchPayload({ ghostEnabled: e.target.checked })
            }
          />
        </label>
        <label className="latex-details-toggle">
          <span className="latex-details-toggle-text">
            <span className="latex-details-toggle-label">Auto-fix suggestions</span>
            <span className="latex-details-toggle-hint">
              Offer LLM fixes after failed compiles
            </span>
          </span>
          <input
            type="checkbox"
            checked={payload.autoFixSuggest}
            onChange={(e) =>
              onPatchPayload({ autoFixSuggest: e.target.checked })
            }
          />
        </label>
        <div className="latex-details-field">
          <span className="latex-details-field-label">@ mention context</span>
          <select
            className="latex-details-select"
            value={payload.mentionMode}
            onChange={(e) =>
              onPatchPayload({
                mentionMode: e.target.value as LatexMentionMode,
              })
            }
            aria-label="Mention context scope"
          >
            {(Object.keys(MENTION_LABEL) as LatexMentionMode[]).map((k) => (
              <option key={k} value={k}>
                {MENTION_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="latex-details-section latex-details-section--assistant">
        <h3 className="latex-details-section-title">
          <Sparkles size={14} strokeWidth={2} aria-hidden />
          Assistant
        </h3>
        <p className="latex-details-assistant-copy">
          Use the editor selection menu for quick actions on highlighted text.
          Session-wide chat and deeper LaTeX assistance will plug in here in a
          future update.
        </p>
      </section>
    </div>
  )
}
