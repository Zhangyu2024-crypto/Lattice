import { FileText, Plus, X } from 'lucide-react'
import type { LatexFile } from '../../../../../types/latex'
import { Button } from '../../../../ui'

// Shared tab strip for both `card` and `focus` variants. The two variants
// differ only in class-name prefix (`latex-card-*` vs `latex-focus-*`) —
// everything else (icons, root chip, close button, "New File" trailing
// action, a11y roles) is identical.
export function LatexFileTabs({
  variant,
  files,
  activeFile,
  rootFile,
  onSwitchFile,
  onCloseFile,
  onNewFile,
}: {
  variant: 'card' | 'focus'
  files: LatexFile[]
  activeFile: string
  rootFile: string
  onSwitchFile: (path: string) => void
  onCloseFile: (path: string) => void
  onNewFile: () => void
}) {
  const prefix = variant === 'focus' ? 'latex-focus' : 'latex-card'
  return (
    <div
      className={`${prefix}-tabs`}
      role="tablist"
      aria-label="LaTeX project files"
    >
      {files.map((f) => {
        const isActive = f.path === activeFile
        const isRoot = f.path === rootFile
        return (
          <div
            key={f.path}
            role="tab"
            aria-selected={isActive}
            className={`${prefix}-tab` + (isActive ? ' is-active' : '')}
            onClick={() => onSwitchFile(f.path)}
            title={isRoot ? `${f.path} · root file` : f.path}
          >
            <FileText size={11} aria-hidden />
            <span className={`${prefix}-tab-path`}>{f.path}</span>
            {isRoot ? (
              <span className={`${prefix}-tab-root-chip`}>root</span>
            ) : null}
            <button
              type="button"
              className={`${prefix}-tab-close`}
              onClick={(e) => {
                e.stopPropagation()
                onCloseFile(f.path)
              }}
              aria-label={`Remove ${f.path}`}
            >
              <X size={10} aria-hidden />
            </button>
          </div>
        )
      })}
      <Button
        variant="ghost"
        size="sm"
        className={`${prefix}-new-file-btn`}
        onClick={onNewFile}
        leading={<Plus size={12} />}
        title="Add a new file to the project"
      >
        File
      </Button>
    </div>
  )
}
