import { useCallback, useState } from 'react'
import { AtSign, Crosshair, RotateCcw, Send, X } from 'lucide-react'
import type { PeakFitArtifact, SpectrumArtifact } from '../../../types/artifact'
import type { FocusedElementTarget } from '../../../types/session'
import type { MentionAddRequest } from '../../../lib/composer-bus'
import SpectrumArtifactCard from './SpectrumArtifactCard'
import { toast } from '../../../stores/toast-store'
import ContextMenu, { type ContextMenuItem } from '../../common/ContextMenu'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  IconButton,
} from '../../ui'

interface Props {
  peakFit: PeakFitArtifact
  spectrum: SpectrumArtifact | null
  /** Which peak (elementId) the inspector currently highlights, or null. */
  focusedPeakId?: string | null
  /** Row-click → focus this peak element in the inspector rail. */
  onFocusPeak?: (target: FocusedElementTarget) => void
  /** Context-menu "Mention in chat" action. */
  onMentionPeak?: (req: MentionAddRequest) => void
  /** "Refit with constraints" submit — opens the agent with a pre-built prompt. */
  onSubmitRefit?: (prompt: string) => void | Promise<void>
  className?: string
}

const ANCHOR_MERGE_DISTANCE = 0.5

type PeakRow = PeakFitArtifact['payload']['peaks'][number]

// Stable element id used by the inspector / mention layer. New writes will
// always have peak.id set (MP-1 backfill), but inline-constructed peaks
// from older code paths fall back to the index-based form.
const peakElementId = (peak: PeakRow): string =>
  peak.id ?? `peak_${peak.index}`

export default function PeakFitArtifactCard({
  peakFit,
  spectrum,
  focusedPeakId = null,
  onFocusPeak,
  onMentionPeak,
  onSubmitRefit,
  className,
}: Props) {
  const peaks = peakFit.payload.peaks
  const [editMode, setEditMode] = useState(false)
  const [anchors, setAnchors] = useState<number[]>([])

  const canFocus = Boolean(onFocusPeak)
  const canMention = Boolean(onMentionPeak)

  // Right-click "Mention in chat" menu state. One menu is shared across rows;
  // we stash the target peak row on open so the menu's action knows what to
  // dispatch. TODO(MP-3+): extend to multi-peak selection once the peak-group
  // ref shape (single synthetic id vs array of peak ids) stabilises — the
  // design doc (§5.4) notes this is still an open question.
  const [menuState, setMenuState] = useState<{
    x: number
    y: number
    peak: PeakRow
  } | null>(null)
  const openRowMenu = useCallback(
    (peak: PeakRow, e: React.MouseEvent) => {
      if (!canMention) return
      e.preventDefault()
      setMenuState({ x: e.clientX, y: e.clientY, peak })
    },
    [canMention],
  )
  const closeMenu = useCallback(() => setMenuState(null), [])
  const mentionMenuPeak = menuState?.peak ?? null
  const mentionRowItems: ContextMenuItem[] = mentionMenuPeak && onMentionPeak
    ? [
        {
          label: 'Mention in chat',
          icon: <AtSign size={12} />,
          onClick: () => {
            const id = peakElementId(mentionMenuPeak)
            const label =
              mentionMenuPeak.label || `Peak ${mentionMenuPeak.index + 1}`
            // sessionId is filled in by the host; Card must not manufacture one.
            onMentionPeak({
              ref: {
                type: 'artifact-element',
                sessionId: '',
                artifactId: peakFit.id,
                elementKind: 'peak',
                elementId: id,
                label,
              },
              label,
            })
          },
        },
      ]
    : []

  const handleChartClick = useCallback((x: number, _y: number) => {
    setAnchors((prev) => {
      const existingIdx = prev.findIndex(
        (a) => Math.abs(a - x) < ANCHOR_MERGE_DISTANCE,
      )
      if (existingIdx >= 0) {
        return prev.filter((_, i) => i !== existingIdx)
      }
      return [...prev, Math.round(x * 100) / 100].sort((a, b) => a - b)
    })
  }, [])

  const enterEditMode = useCallback(() => {
    setEditMode(true)
    const seed = peaks.map((p) => p.position)
    setAnchors(seed)
  }, [peaks])

  const exitEditMode = useCallback(() => {
    setEditMode(false)
    setAnchors([])
  }, [])

  const clearAnchors = useCallback(() => {
    setAnchors([])
  }, [])

  const refitWithConstraints = useCallback(async () => {
    if (!onSubmitRefit) return
    if (anchors.length === 0) {
      toast.warn('Add at least one constraint anchor first')
      return
    }
    const posList = anchors.map((a) => a.toFixed(2)).join(', ')
    const prompt = `Refit the current peak-fit artifact using these user-placed constraints as initial peak positions: [${posList}]. Keep the existing profile model.`
    await onSubmitRefit(prompt)
    setEditMode(false)
  }, [onSubmitRefit, anchors])

  // Header split into two modes: "browsing" (default) vs. "editing
  // constraints". We render one unified Card so the rest of the layout is
  // identical between modes and only the title / actions change.
  const browsingTitle = (
    <>
      {peaks.length} peaks · algorithm {peakFit.payload.algorithm}
    </>
  )
  const editingTitle = 'Click chart to add / remove constraint anchors'
  const editingSubtitle = (
    <span className="card-peak-fit-anchor-count">
      {anchors.length} anchor{anchors.length === 1 ? '' : 's'}
    </span>
  )

  const canRefit = Boolean(spectrum) && Boolean(onSubmitRefit)
  const browsingActions = (
    <Button
      variant="primary"
      size="sm"
      leading={<Crosshair size={12} />}
      onClick={enterEditMode}
      disabled={!canRefit}
      title={
        !spectrum
          ? 'Needs a source spectrum to edit'
          : !onSubmitRefit
            ? 'Refit requires an agent session'
            : 'Place anchors to constrain the next fit'
      }
    >
      Edit constraints
    </Button>
  )

  const editingActions = (
    <>
      <Button
        variant="ghost"
        size="sm"
        leading={<RotateCcw size={12} />}
        onClick={clearAnchors}
        disabled={anchors.length === 0}
      >
        Clear
      </Button>
      <Button
        variant="primary"
        size="sm"
        leading={<Send size={12} />}
        onClick={refitWithConstraints}
        disabled={anchors.length === 0}
        title="Submit refit prompt to agent"
      >
        Refit with constraints
      </Button>
      <IconButton
        icon={<X size={14} />}
        label="Exit edit mode"
        onClick={exitEditMode}
      />
    </>
  )

  const rootClassName = className
    ? `card-peak-fit-root ${className}`
    : 'card-peak-fit-root'

  return (
    // Parent `data-artifact-body` lays children out as `display:flex`
    // (row). Without `flex:1` / `minWidth:0`, a column-direction child
    // only takes the intrinsic width of its longest toolbar button,
    // collapsing the chart to a narrow strip. Card itself already sets
    // `flex-direction:column` + `min-height:0`; we only add flex sizing
    // against the parent row.
    <Card borderless className={rootClassName}>
      <CardHeader
        icon={
          editMode ? (
            <Crosshair size={14} className="card-peak-fit-edit-icon" />
          ) : undefined
        }
        title={editMode ? editingTitle : browsingTitle}
        subtitle={editMode ? editingSubtitle : undefined}
        actions={editMode ? editingActions : browsingActions}
      />
      <CardBody>
        {spectrum ? (
          <div className="card-peak-fit-spectrum-wrap">
            <SpectrumArtifactCard
              spectrum={spectrum}
              overlayPeakFit={peakFit}
              constraintAnchors={editMode ? anchors : undefined}
              onChartClick={editMode ? handleChartClick : undefined}
            />
          </div>
        ) : (
          <EmptyState
            compact
            title="No source spectrum linked to this peak fit"
          />
        )}

        <div className="card-peak-fit-table-scroll">
          {peaks.length === 0 ? (
            <EmptyState compact title="No peaks in this fit" />
          ) : (
            <table className="card-peak-fit-table">
              <thead>
                <tr className="card-peak-fit-thead-row">
                  <th className="card-peak-fit-th">#</th>
                  <th className="card-peak-fit-th">Position</th>
                  <th className="card-peak-fit-th">Intensity</th>
                  <th className="card-peak-fit-th">FWHM</th>
                  <th className="card-peak-fit-th">Assignment</th>
                </tr>
              </thead>
              <tbody>
                {peaks.map((peak) => {
                  const id = peakElementId(peak)
                  const selected = focusedPeakId === id
                  const rowClass = [
                    'card-peak-fit-body-row',
                    selected ? 'is-selected-row' : '',
                    canFocus ? 'is-clickable' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <tr
                      key={peak.id ?? peak.index}
                      className={rowClass}
                      onClick={() => {
                        if (!onFocusPeak) return
                        onFocusPeak({
                          artifactId: peakFit.id,
                          elementKind: 'peak',
                          elementId: id,
                          label: peak.label || `Peak ${peak.index + 1}`,
                        })
                      }}
                      onContextMenu={(e) => openRowMenu(peak, e)}
                    >
                      <td className="card-peak-fit-td">{peak.index + 1}</td>
                      <td className="card-peak-fit-td">{peak.position.toFixed(2)}</td>
                      <td className="card-peak-fit-td">{peak.intensity.toFixed(1)}</td>
                      <td className="card-peak-fit-td">{peak.fwhm?.toFixed(2) ?? '-'}</td>
                      <td
                        className="card-peak-fit-td card-peak-fit-td--assignment"
                        title={peak.label || undefined}
                      >
                        {peak.label || '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </CardBody>
      {/* ContextMenu renders via portal; placement in tree only matters
          for React parentage. Keep it as a sibling of CardBody so the
          Card shell stays purely structural. */}
      <ContextMenu
        open={menuState !== null}
        x={menuState?.x ?? 0}
        y={menuState?.y ?? 0}
        items={mentionRowItems}
        onClose={closeMenu}
      />
    </Card>
  )
}
