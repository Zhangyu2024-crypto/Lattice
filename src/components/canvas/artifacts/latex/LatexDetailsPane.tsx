import { BookOpen, Cpu, FolderSync, Info, Sparkles } from 'lucide-react'
import type { LatexDocumentPayload, LatexMentionMode } from '../../../../types/latex'
import type { LatexWorkspaceSyncState } from '../../../../lib/latex/workspace-sync'
import MetaRow from '../../../ui/MetaRow'

interface Props {
  documentTitle: string
  payload: LatexDocumentPayload
  onPatchPayload: (partial: Partial<LatexDocumentPayload>) => void
  workspaceRootPath: string | null
  workspaceSync: LatexWorkspaceSyncState
  onSyncWorkspace: () => void
}

const MENTION_LABEL: Record<LatexMentionMode, string> = {
  selection: 'Selection only',
  outline: 'Outline sections',
  full: 'Full project',
}

export default function LatexDetailsPane({
  documentTitle,
  payload,
  onPatchPayload,
  workspaceRootPath,
  workspaceSync,
  onSyncWorkspace,
}: Props) {
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

  const syncStatus =
    workspaceSync.status === 'no-workspace'
      ? 'No workspace open'
      : workspaceSync.status === 'syncing'
        ? 'Syncing'
        : workspaceSync.status === 'synced' && workspaceSync.savedAt != null
          ? `Saved ${new Date(workspaceSync.savedAt).toLocaleTimeString()}`
          : workspaceSync.status === 'error'
            ? workspaceSync.error ?? 'Sync failed'
            : workspaceRootPath
              ? 'Pending'
              : 'No workspace open'

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
          <FolderSync size={14} strokeWidth={2} aria-hidden />
          Workspace
        </h3>
        <MetaRow label="Folder" value="creator/" mono />
        <MetaRow label="Status" value={syncStatus} />
        {workspaceRootPath ? (
          <MetaRow label="Root" value={workspaceRootPath} mono />
        ) : null}
        <button
          type="button"
          className="latex-details-action"
          onClick={onSyncWorkspace}
          disabled={
            workspaceSync.status === 'syncing' ||
            workspaceSync.status === 'no-workspace'
          }
        >
          Sync now
        </button>
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
          The AI panel reads this project, the active source file, and the last
          compile diagnostics. It can return full-file replacements that you
          review and apply per file.
        </p>
      </section>
    </div>
  )
}
