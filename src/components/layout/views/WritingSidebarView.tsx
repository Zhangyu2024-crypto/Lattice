import { useMemo } from 'react'
import { BookTemplate, FileText, PanelLeftClose, Plus, Sparkles } from 'lucide-react'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../../stores/runtime-store'
import { LATEX_TEMPLATES } from '../../../stores/latex-templates'
import { CollapsibleSidebarSpaceSection } from './CollapsibleSidebarBlocks'

interface Props {
  /** Open a seeded demo document. */
  onLoadLatexDemo: () => void
  /** Create an empty document and focus it. */
  onNewLatexDocument: () => void
  /** Create a fresh document from a journal template by id. */
  onLoadLatexTemplate: (templateId: string) => void
  onCollapseSidebar?: () => void
}

export default function WritingSidebarView({
  onLoadLatexDemo,
  onNewLatexDocument,
  onLoadLatexTemplate,
  onCollapseSidebar,
}: Props) {
  const session = useRuntimeStore(selectActiveSession)
  const focusArtifact = useRuntimeStore((s) => s.focusArtifact)

  const documents = useMemo(() => {
    if (!session) return []
    return session.artifactOrder
      .map((id) => session.artifacts[id])
      .filter((a) => a?.kind === 'latex-document')
      .slice()
      .reverse()
  }, [session])

  return (
    <div className="sidebar-space-view">
      <div className="sidebar-header is-split">
        <span>Creator</span>
        {onCollapseSidebar ? (
          <div className="sidebar-header-actions">
            <button
              type="button"
              onClick={onCollapseSidebar}
              title="Hide sidebar"
              aria-label="Hide sidebar"
              className="session-mini-btn"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="sidebar-space-scroll">
        <CollapsibleSidebarSpaceSection title="Quick start">
          <button
            type="button"
            className="sidebar-space-row"
            onClick={onNewLatexDocument}
            title="Start a blank document"
          >
            <span className="sidebar-space-row-main">
              <span className="sidebar-space-row-title">
                <Plus size={12} aria-hidden /> New document
              </span>
            </span>
          </button>
          <button
            type="button"
            className="sidebar-space-row"
            onClick={onLoadLatexDemo}
            title="Load a seeded multi-file example"
          >
            <span className="sidebar-space-row-main">
              <span className="sidebar-space-row-title">
                <Sparkles size={12} aria-hidden /> Load demo
              </span>
            </span>
          </button>
        </CollapsibleSidebarSpaceSection>

        <CollapsibleSidebarSpaceSection title="Journal templates">
          {LATEX_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="sidebar-space-row"
              onClick={() => onLoadLatexTemplate(template.id)}
              title={template.description}
            >
              <span className="sidebar-space-row-main">
                <span className="sidebar-space-row-title">
                  <BookTemplate size={12} aria-hidden /> {template.name}
                </span>
              </span>
            </button>
          ))}
        </CollapsibleSidebarSpaceSection>

        <CollapsibleSidebarSpaceSection
          title={`Documents (${documents.length})`}
          empty="No documents in this session"
        >
          {documents.map((artifact) => {
            const files =
              (artifact?.kind === 'latex-document'
                ? artifact.payload.files
                : []) ?? []
            return (
              <button
                key={artifact.id}
                className="sidebar-space-row"
                onClick={() =>
                  session && focusArtifact(session.id, artifact.id)
                }
                title={`${artifact.title}\n${files.length} file${files.length === 1 ? '' : 's'}`}
              >
                <span className="sidebar-space-row-main">
                  <span className="sidebar-space-row-title">
                    <FileText size={12} aria-hidden /> {artifact.title}
                  </span>
                </span>
              </button>
            )
          })}
        </CollapsibleSidebarSpaceSection>
      </div>
    </div>
  )
}
