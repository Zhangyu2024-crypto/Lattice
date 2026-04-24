// XPS analysis artifact card — wraps a set of per-element/line fits
// with a shared quantification table and optional charge-correction
// footer. The body chrome (fit tabs, chart, quant table, CC row) lives
// in ./xps-analysis/*; this file owns the lifecycle (selected fit,
// context-menu state, "Open in XPS Lab" callback) and the header
// chrome.

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { AlertCircle, AtSign, FlaskConical } from 'lucide-react'
import ContextMenu, { type ContextMenuItem } from '../../common/ContextMenu'
import { buildSeriesChartInstanceKey } from '../../../lib/chart-instance-key'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
} from '../../ui'
import { ChargeCorrectionRow } from './xps-analysis/ChargeCorrectionRow'
import { FitTabsBar } from './xps-analysis/FitTabsBar'
import { QuantTable } from './xps-analysis/QuantTable'
import { buildChartOption } from './xps-analysis/helpers'
import type {
  XpsAnalysisCardProps,
  XpsAnalysisPayload,
  XpsQuantRow,
} from './xps-analysis/types'

function XpsAnalysisCardImpl({
  artifact,
  onMentionQuantRow,
  onOpenInProWorkbench,
  className,
}: XpsAnalysisCardProps) {
  const payload = artifact.payload as unknown as XpsAnalysisPayload
  const fits = payload?.fits ?? []
  const [selectedFitIdx, setSelectedFitIdx] = useState(0)
  const safeIdx = Math.min(Math.max(selectedFitIdx, 0), Math.max(fits.length - 1, 0))
  const fit = fits[safeIdx]
  useEffect(() => {
    setSelectedFitIdx(0)
  }, [artifact.id])

  const chartOption = useMemo(() => (fit ? buildChartOption(fit) : null), [fit])
  const chartKey = useMemo(
    () =>
      fit
        ? buildSeriesChartInstanceKey(
            {
              x: fit.experimentalPattern.x,
              y: fit.experimentalPattern.y,
              sourceFile: artifact.sourceFile ?? artifact.id,
              seriesType: `${fit.element} ${fit.line}`,
            },
            [fit.bindingRange[0], fit.bindingRange[1]],
          )
        : `empty::${artifact.id}`,
    [artifact.id, artifact.sourceFile, fit],
  )
  const sortedQuant = useMemo(
    () => [...(payload?.quantification ?? [])].sort((a, b) => b.atomicPercent - a.atomicPercent),
    [payload?.quantification],
  )

  // Right-click "Mention in chat" for quantification rows. Per-fit XPS
  // components are not surfaced in this card's UI (they live in the chart
  // series only); MP-3+ leaves them to InspectorRail's button instead of
  // adding a synthetic peak list here.
  const [menuState, setMenuState] = useState<{
    x: number
    y: number
    row: XpsQuantRow
  } | null>(null)
  const openQuantMenu = useCallback(
    (row: XpsQuantRow, e: React.MouseEvent) => {
      if (!onMentionQuantRow) return
      e.preventDefault()
      setMenuState({ x: e.clientX, y: e.clientY, row })
    },
    [onMentionQuantRow],
  )
  const closeMenu = useCallback(() => setMenuState(null), [])
  const menuRow = menuState?.row ?? null
  const menuItems: ContextMenuItem[] = menuRow && onMentionQuantRow
    ? [
        {
          label: 'Mention in chat',
          icon: <AtSign size={12} />,
          onClick: () => {
            const elementId = menuRow.element || `quant_${sortedQuant.indexOf(menuRow)}`
            onMentionQuantRow({
              ref: {
                type: 'artifact-element',
                sessionId: '',
                artifactId: artifact.id,
                elementKind: 'xps-quant-row',
                elementId,
                label: menuRow.element,
              },
              label: menuRow.element,
            })
          },
        },
      ]
    : []

  const rootClassName = className ? `card-xps-root ${className}` : 'card-xps-root'

  if (!fit || !chartOption) {
    return (
      <Card borderless className={rootClassName}>
        <CardBody>
          <EmptyState compact title="No XPS fits in this artifact" />
        </CardBody>
      </Card>
    )
  }

  const cc = payload.chargeCorrection
  const flags = payload.validation?.flags ?? []

  const handleOpenInWorkbench = () => {
    if (!onOpenInProWorkbench) return
    onOpenInProWorkbench({
      experimentalPattern: fit.experimentalPattern ?? null,
      peaks: fit.peaks,
      bindingRange: fit.bindingRange,
    })
  }

  return (
    <Card borderless className={rootClassName}>
      <CardHeader
        title={
          <span className="card-xps-title">
            <Badge variant="type-xps" size="sm">XPS</Badge>
            <span>
              {fits.length} fit{fits.length === 1 ? '' : 's'}
            </span>
          </span>
        }
        subtitle={`${fit.element} ${fit.line} · background ${fit.background}`}
        actions={
          onOpenInProWorkbench ? (
            <Button
              variant="primary"
              size="sm"
              leading={<FlaskConical size={12} />}
              onClick={handleOpenInWorkbench}
              title={
                fit.peaks.length > 0
                  ? 'Refit these peaks in the interactive XPS Lab workbench'
                  : 'Open the interactive XPS Lab workbench on this spectrum'
              }
            >
              {fit.peaks.length > 0 ? 'Refit in XPS Lab' : 'Open in XPS Lab'}
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {fits.length > 1 && (
          <FitTabsBar
            fits={fits}
            safeIdx={safeIdx}
            background={fit.background}
            onSelect={setSelectedFitIdx}
          />
        )}

        <div className="card-xps-chart-wrap">
          <ReactECharts
            key={chartKey}
            option={chartOption}
            notMerge
            className="card-xps-chart"
            opts={{ renderer: 'canvas' }}
          />
        </div>

        <QuantTable
          rows={sortedQuant}
          hasMention={Boolean(onMentionQuantRow)}
          onContextMenu={openQuantMenu}
        />

        <div className="card-xps-footer">
          {cc == null ? (
            <div className="card-xps-not-corrected">Not charge-corrected</div>
          ) : (
            <ChargeCorrectionRow cc={cc} />
          )}
          {flags.length > 0 && (
            <div className="card-xps-flag-row">
              {flags.map((flag, i) => (
                <Badge
                  key={i}
                  variant="warning"
                  size="sm"
                  leading={<AlertCircle size={10} />}
                >
                  {flag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardBody>
      <ContextMenu
        open={menuState !== null}
        x={menuState?.x ?? 0}
        y={menuState?.y ?? 0}
        items={menuItems}
        onClose={closeMenu}
      />
    </Card>
  )
}

export default memo(XpsAnalysisCardImpl)
