import IconButton from '../common/panel/IconButton'
import PanelHeader from '../common/panel/PanelHeader'
import {
  isPeakFitArtifact,
  isRamanIdArtifact,
  isXpsAnalysisArtifact,
  isXrdAnalysisArtifact,
} from '../../types/artifact'
import {
  selectActiveSession,
  selectFocusedElement,
  useRuntimeStore,
} from '../../stores/runtime-store'
import { usePrefsStore } from '../../stores/prefs-store'
import { dispatchMentionAdd } from '../../lib/composer-bus'
import { toast } from '../../stores/toast-store'
import type { MentionRef } from '../../types/mention'
import type { FocusedElementTarget, Session } from '../../types/session'
import PeakInspector from './renderers/PeakInspector'
import PhaseInspector from './renderers/PhaseInspector'
import XpsComponentInspector from './renderers/XpsComponentInspector'
import XpsQuantRowInspector from './renderers/XpsQuantRowInspector'
import RamanMatchInspector from './renderers/RamanMatchInspector'

/**
 * Right-side rail that shows structured fields for the currently selected
 * sub-object inside the focused artifact (a peak, a phase, an XPS
 * component, etc.). Driven entirely by `session.focusedElement`; clicks
 * inside artifact cards write to that field via `setFocusedElement`.
 */
export default function InspectorRail({
  onClosePanel,
}: {
  onClosePanel?: () => void
}) {
  const session = useRuntimeStore(selectActiveSession)
  const focusedElement = useRuntimeStore(selectFocusedElement)
  const setLayout = usePrefsStore((s) => s.setLayout)

  const canMention = Boolean(session && focusedElement)

  const handleMention = () => {
    // Guarded at render-time via `disabled`; re-check here to narrow types
    // and to be robust against rapid store changes between render and click.
    if (!session || !focusedElement) return
    const label = focusedElement.label ?? focusedElement.elementId
    const ref: MentionRef = {
      type: 'artifact-element',
      sessionId: session.id,
      artifactId: focusedElement.artifactId,
      elementKind: focusedElement.elementKind,
      elementId: focusedElement.elementId,
      label: focusedElement.label,
    }
    dispatchMentionAdd({ ref, label })
    useRuntimeStore.getState().pushRecentMention(session.id, ref)
    toast.info(`Attached to chat: ${label}`)
  }

  return (
    <div className="inspector-root">
      <PanelHeader
        label="Inspector"
        dense
        actions={
          <>
            <IconButton
              title={
                canMention
                  ? 'Mention in chat'
                  : 'Select an element first to attach'
              }
              label="@"
              onClick={handleMention}
              disabled={!canMention}
            />
            <IconButton
              title="Close inspector"
              label="×"
              onClick={() => {
                if (onClosePanel) {
                  onClosePanel()
                  return
                }
                setLayout({ inspectorVisible: false })
              }}
            />
          </>
        }
      />
      <div className="inspector-body">
        {!session || !focusedElement ? (
          <EmptyState />
        ) : (
          <InspectorBody session={session} focusedElement={focusedElement} />
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="inspector-empty">
      Select a peak, phase, XPS component, quant row, or Raman match to
      inspect its structured fields.
    </div>
  )
}

function InspectorBody({
  session,
  focusedElement,
}: {
  session: Session
  focusedElement: FocusedElementTarget
}) {
  const artifact = session.artifacts[focusedElement.artifactId]
  if (!artifact) {
    return (
      <div className="inspector-empty">
        Selected object is no longer available in this session.
      </div>
    )
  }

  switch (focusedElement.elementKind) {
    case 'peak':
      return isPeakFitArtifact(artifact) ? (
        <PeakInspector artifact={artifact} elementId={focusedElement.elementId} />
      ) : (
        <UnsupportedKind kind="peak" />
      )
    case 'phase':
      return isXrdAnalysisArtifact(artifact) ? (
        <PhaseInspector artifact={artifact} elementId={focusedElement.elementId} />
      ) : (
        <UnsupportedKind kind="phase" />
      )
    case 'xps-component':
      return isXpsAnalysisArtifact(artifact) ? (
        <XpsComponentInspector
          artifact={artifact}
          elementId={focusedElement.elementId}
        />
      ) : (
        <UnsupportedKind kind="xps-component" />
      )
    case 'xps-quant-row':
      return isXpsAnalysisArtifact(artifact) ? (
        <XpsQuantRowInspector
          artifact={artifact}
          elementId={focusedElement.elementId}
        />
      ) : (
        <UnsupportedKind kind="xps-quant-row" />
      )
    case 'raman-match':
      return isRamanIdArtifact(artifact) ? (
        <RamanMatchInspector
          artifact={artifact}
          elementId={focusedElement.elementId}
        />
      ) : (
        <UnsupportedKind kind="raman-match" />
      )
    default:
      return <UnsupportedKind kind={focusedElement.elementKind} />
  }
}

function UnsupportedKind({ kind }: { kind: string }) {
  return (
    <div className="inspector-empty">
      No inspector is registered for "{kind}" on this artifact.
    </div>
  )
}
