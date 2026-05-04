import { History, RotateCcw, Save } from 'lucide-react'
import type { LatexDocumentVersion } from '../../../../types/latex'
import { formatLatexVersionReason } from '../../../../lib/latex/versions'

interface Props {
  versions: readonly LatexDocumentVersion[]
  onCreateVersion: () => void
  onRestoreVersion: (version: LatexDocumentVersion) => void
}

export default function LatexVersionsPane({
  versions,
  onCreateVersion,
  onRestoreVersion,
}: Props) {
  return (
    <div className="latex-versions-pane">
      <div className="latex-versions-toolbar">
        <div className="latex-versions-title">
          <History size={14} aria-hidden />
          <span>Document versions</span>
        </div>
        <button
          type="button"
          className="latex-versions-save"
          onClick={onCreateVersion}
        >
          <Save size={13} aria-hidden />
          Save version
        </button>
      </div>

      {versions.length > 0 ? (
        <ol className="latex-versions-list">
          {versions.map((version) => (
            <li key={version.id} className="latex-version-row">
              <div className="latex-version-main">
                <div className="latex-version-label">{version.label}</div>
                <div className="latex-version-meta">
                  <span>{formatLatexVersionReason(version.reason)}</span>
                  <span>{new Date(version.createdAt).toLocaleString()}</span>
                  <span>
                    {version.files.length} file
                    {version.files.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="latex-version-restore"
                onClick={() => onRestoreVersion(version)}
                title={`Restore ${version.label}`}
              >
                <RotateCcw size={13} aria-hidden />
                Restore
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="latex-versions-empty">
          <History size={18} aria-hidden />
          <strong>No saved versions</strong>
          <span>
            Save a checkpoint before major edits, or let AI edits create an
            automatic restore point.
          </span>
        </div>
      )}
    </div>
  )
}
