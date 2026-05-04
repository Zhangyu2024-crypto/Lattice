import {
  AlertTriangle,
  Circle,
  Eye,
  Loader2,
  MessageSquare,
  Play,
  Settings2,
} from 'lucide-react'
import type { LatexCompileStatus } from '../../../../../types/latex'
import { Button } from '../../../../ui'
import { CompileBadge } from './CompileBadge'
import { FocusToggle } from './FocusToggle'

export type FocusDrawerTab = 'preview' | 'errors' | 'ai' | 'details'

// Right-hand action cluster of the focus-mode header: compile-status pill,
// drawer/AI toggles, primary Compile button with kbd hint. Lifted out of
// LatexDocumentCard to shrink the main component; the parent still owns
// all state — this is a pure view.
export function FocusHeaderActions({
  status,
  drawerTab,
  setDrawerTab,
  issueCount,
  compilingSince,
  onCompile,
  collabActive = false,
  collabConnected = false,
  onOpenCollab,
}: {
  status: LatexCompileStatus
  drawerTab: FocusDrawerTab | null
  setDrawerTab: (updater: (t: FocusDrawerTab | null) => FocusDrawerTab | null) => void
  issueCount: number
  compilingSince: number | null
  onCompile: () => void
  collabActive?: boolean
  collabConnected?: boolean
  onOpenCollab?: () => void
}) {
  return (
    <div className="latex-focus-actions">
      <CompileBadge status={status} />
      {collabActive ? (
        <FocusToggle
          active={drawerTab === 'details'}
          onClick={() => {
            onOpenCollab?.()
            setDrawerTab((t) => (t === 'details' ? null : 'details'))
          }}
          icon={
            <Circle
              size={9}
              fill={collabConnected ? 'currentColor' : 'none'}
              aria-hidden
            />
          }
          label={collabConnected ? 'Live' : 'Collab'}
          title="Open collaboration details"
        />
      ) : null}
      <FocusToggle
        active={drawerTab === 'errors'}
        onClick={() =>
          setDrawerTab((t) => (t === 'errors' ? null : 'errors'))
        }
        icon={<AlertTriangle size={12} aria-hidden />}
        label="Errors"
        title="Toggle the Errors drawer (Ctrl+Alt+E)"
        badge={issueCount > 0 ? issueCount : undefined}
      />
      <FocusToggle
        active={drawerTab === 'preview'}
        onClick={() =>
          setDrawerTab((t) => (t === 'preview' ? null : 'preview'))
        }
        icon={<Eye size={12} aria-hidden />}
        label="Preview"
        title="Toggle the Preview drawer (Ctrl+Alt+P)"
      />
      <FocusToggle
        active={drawerTab === 'details'}
        onClick={() =>
          setDrawerTab((t) => (t === 'details' ? null : 'details'))
        }
        icon={<Settings2 size={12} aria-hidden />}
        label="Details"
        title="Toggle the Details drawer"
      />
      <FocusToggle
        active={drawerTab === 'ai'}
        onClick={() =>
          setDrawerTab((t) => (t === 'ai' ? null : 'ai'))
        }
        icon={<MessageSquare size={12} aria-hidden />}
        label="AI"
        title="Toggle the Creator AI panel (Ctrl+K)"
        hint="⌘K"
      />
      <Button
        variant="primary"
        size="sm"
        className="latex-focus-compile-btn"
        onClick={onCompile}
        disabled={compilingSince != null}
        leading={
          compilingSince != null ? (
            <Loader2 size={12} className="spin" />
          ) : (
            <Play size={12} />
          )
        }
        title="Compile this project (Ctrl+Enter)"
      >
        {compilingSince != null ? 'Compiling…' : 'Compile'}
        <span className="latex-focus-kbd">⌘↵</span>
      </Button>
    </div>
  )
}
