import {
  FilePlus,
  FlaskConical,
  MessageSquarePlus,
  PanelRight,
} from 'lucide-react'
import IconButton from '../common/panel/IconButton'

const TB_ICON = { size: 17, strokeWidth: 1.75 } as const

interface Props {
  sessionTitle: string
  surfaceTitle: string
  rightRailOpen: boolean
  onOpenFile: () => void
  onNewSession: () => void
  onOpenProLauncher: () => void
  onToggleRightRail: () => void
}

export default function WorkspaceTopbar({
  sessionTitle,
  surfaceTitle,
  rightRailOpen,
  onOpenFile,
  onNewSession,
  onOpenProLauncher,
  onToggleRightRail,
}: Props) {
  // Breadcrumb fallbacks. Previously read "No session › Artifact Canvas" on
  // cold boot, which is both cases wrong (user hasn't chosen anything, the
  // canvas is empty). Collapse to a single segment when either side is a
  // placeholder so the bar doesn't lead with two "nothing" labels.
  const hasSession = Boolean(sessionTitle) && sessionTitle !== 'No session'
  const hasSurface =
    Boolean(surfaceTitle) && surfaceTitle !== 'Artifact Canvas'
  const crumbTitle = hasSession
    ? hasSurface
      ? `${sessionTitle} \u203A ${surfaceTitle}`
      : sessionTitle
    : hasSurface
      ? surfaceTitle
      : 'Lattice'

  return (
    <div className="workspace-topbar">
      {/*
        Breadcrumb tooltips are placed on each segment individually — not on
        the wrapper. With a wrapper `title` the hover tooltip read the whole
        "Session › Artifact" blob, duplicating info that the segments already
        showed. Per-segment `title`s only fire when the segment is actually
        elided, which matches how VSCode and Linear tooltip their crumbs.
      */}
      <div className="workspace-topbar-crumb">
        {hasSession && hasSurface ? (
          <>
            <span
              className="workspace-topbar-crumb-session"
              title={sessionTitle}
            >
              {sessionTitle}
            </span>
            <span className="workspace-topbar-crumb-sep" aria-hidden="true">
              {'\u203A'}
            </span>
            <span
              className="workspace-topbar-crumb-current"
              title={surfaceTitle}
            >
              {surfaceTitle}
            </span>
          </>
        ) : (
          <span className="workspace-topbar-crumb-current" title={crumbTitle}>
            {crumbTitle}
          </span>
        )}
      </div>

      <div
        className="workspace-topbar-actions"
        role="toolbar"
        aria-label="Workspace actions"
      >
        <IconButton
          title="Add file to session"
          icon={<FilePlus {...TB_ICON} aria-hidden />}
          onClick={onOpenFile}
        />
        <IconButton
          title="New chat session"
          icon={<MessageSquarePlus {...TB_ICON} aria-hidden />}
          onClick={onNewSession}
        />
        <span className="workspace-topbar-actions-sep" aria-hidden />
        <IconButton
          title="Lab — analysis tools"
          icon={<FlaskConical {...TB_ICON} aria-hidden />}
          onClick={onOpenProLauncher}
        />
        <span className="workspace-topbar-actions-sep" aria-hidden />
        <IconButton
          title={rightRailOpen ? 'Hide side panel' : 'Show side panel'}
          icon={<PanelRight {...TB_ICON} aria-hidden />}
          active={rightRailOpen}
          onClick={onToggleRightRail}
        />
      </div>
    </div>
  )
}
