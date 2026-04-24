import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { AtSign, Database, FlaskConical, Target } from 'lucide-react'
import type { Artifact } from '../../../types/artifact'
import type { MentionAddRequest } from '../../../lib/composer-bus'
import { buildSeriesChartInstanceKey } from '../../../lib/chart-instance-key'
import ContextMenu, { type ContextMenuItem } from '../../common/ContextMenu'
import { TableActions } from '../../common/TableActions'
import { CHART_PRIMARY, CHART_SERIES_PALETTE } from '../../../lib/chart-colors'
import { CHART_TEXT_PX } from '../../../lib/chart-text-px'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
} from '../../ui'

interface RamanMatch {
  id: string
  mineralName: string
  formula: string
  referenceSource: string
  rruffId?: string
  cosineScore: number
  referenceSpectrum: { x: number[]; y: number[] }
  keyPeaks: number[]
}

interface RamanIdPayload {
  experimentalSpectrum: { x: number[]; y: number[]; xLabel: string; yLabel: string }
  query: { source: 'RRUFF' | 'user-db'; topN: number; hint: string | null }
  matches: RamanMatch[]
}

interface Props {
  artifact: Artifact
  /** Context-menu "Mention in chat" action on a match row. */
  onMentionMatch?: (req: MentionAddRequest) => void
  /** "Open in Raman Lab" — host materialises the pro-workbench artifact. */
  onOpenInProWorkbench?: (args: {
    experimentalSpectrum: RamanIdPayload['experimentalSpectrum']
  }) => void
  className?: string
}

const EXPERIMENTAL_COLOR = CHART_PRIMARY
const EXPERIMENTAL_NAME = 'Experimental'
const TOP_PALETTE = Array.from(CHART_SERIES_PALETTE).slice(0, 3)
const EXTRA_PALETTE = Array.from(CHART_SERIES_PALETTE).slice(3)

const colorForRank = (r: number): string =>
  r < 3 ? TOP_PALETTE[r] : EXTRA_PALETTE[(r - 3) % EXTRA_PALETTE.length]

const dotColorForRank = (r: number): string =>
  r < 3 ? TOP_PALETTE[r] : 'var(--color-text-muted)'

function scoreBarColor(score: number): string {
  if (score >= 0.9) return 'var(--color-green)'
  if (score >= 0.75) return 'var(--color-accent)'
  if (score >= 0.6) return 'var(--color-yellow)'
  return 'var(--color-red)'
}

function RamanIdCardImpl({
  artifact,
  onMentionMatch,
  onOpenInProWorkbench,
  className,
}: Props) {
  const payload = artifact.payload as unknown as RamanIdPayload
  const { experimentalSpectrum, query, matches } = payload
  const defaultVisibleMatchIds = useMemo(
    () => matches.slice(0, 3).map((m) => m.id),
    [matches],
  )

  const [visibleMatchIds, setVisibleMatchIds] = useState<Set<string>>(
    () => new Set(defaultVisibleMatchIds),
  )
  useEffect(() => {
    setVisibleMatchIds(new Set(defaultVisibleMatchIds))
  }, [artifact.id, defaultVisibleMatchIds])

  const [menuState, setMenuState] = useState<{
    x: number
    y: number
    match: RamanMatch
  } | null>(null)
  const openMatchMenu = useCallback(
    (match: RamanMatch, e: React.MouseEvent) => {
      if (!onMentionMatch) return
      e.preventDefault()
      setMenuState({ x: e.clientX, y: e.clientY, match })
    },
    [onMentionMatch],
  )
  const closeMenu = useCallback(() => setMenuState(null), [])
  const menuMatch = menuState?.match ?? null
  const menuItems: ContextMenuItem[] = menuMatch && onMentionMatch
    ? [
        {
          label: 'Mention in chat',
          icon: <AtSign size={12} />,
          onClick: () => {
            onMentionMatch({
              ref: {
                type: 'artifact-element',
                sessionId: '',
                artifactId: artifact.id,
                elementKind: 'raman-match',
                elementId: menuMatch.id,
                label: menuMatch.mineralName,
              },
              label: menuMatch.mineralName,
            })
          },
        },
      ]
    : []

  const toggleMatch = useCallback((id: string) => {
    setVisibleMatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const colorById = useMemo(() => {
    const map = new Map<string, string>()
    matches.forEach((m, i) => map.set(m.id, colorForRank(i)))
    return map
  }, [matches])

  const option = useMemo(
    () => buildChartOption(experimentalSpectrum, matches, colorById, visibleMatchIds),
    [experimentalSpectrum, matches, colorById, visibleMatchIds],
  )
  const chartKey = useMemo(
    () =>
      buildSeriesChartInstanceKey({
        x: experimentalSpectrum.x,
        y: experimentalSpectrum.y,
        sourceFile: artifact.sourceFile ?? artifact.id,
        seriesType: 'raman-id',
      }),
    [
      artifact.id,
      artifact.sourceFile,
      experimentalSpectrum.x,
      experimentalSpectrum.y,
    ],
  )

  const onEvents = useMemo(
    () => ({
      legendselectchanged: (e: { name: string; selected: Record<string, boolean> }) => {
        if (e.name === EXPERIMENTAL_NAME) return
        const next = new Set<string>()
        for (const m of matches) if (e.selected[m.id]) next.add(m.id)
        setVisibleMatchIds(next)
      },
    }),
    [matches],
  )

  const rootClassName = className ? `card-raman-root ${className}` : 'card-raman-root'

  return (
    <Card borderless className={rootClassName}>
      <CardHeader
        title={
          <span className="card-raman-title">
            <Badge variant="type-raman" size="sm">Raman</Badge>
            <span>{matches.length} match{matches.length === 1 ? '' : 'es'}</span>
          </span>
        }
        actions={
          onOpenInProWorkbench ? (
            <Button
              variant="primary"
              size="sm"
              leading={<FlaskConical size={12} />}
              onClick={() =>
                onOpenInProWorkbench({ experimentalSpectrum })
              }
              title="Clone into an interactive Pro workbench"
            >
              Open in Raman Lab
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {/* Query metadata strip. Three pieces (source / top-N / hint)
            are rendered as neutral Badges so the chrome stays on the
            v7 palette instead of bespoke mono text runs. */}
        <div className="card-raman-query-bar">
          <Badge
            variant="neutral"
            size="sm"
            leading={<Database size={10} />}
          >
            {query.source}
          </Badge>
          <Badge variant="neutral" size="sm" leading={<Target size={10} />}>
            Top-{query.topN}
          </Badge>
          {query.hint && (
            <span className="card-raman-query-hint">hint: {query.hint}</span>
          )}
        </div>

        <div className="card-raman-chart-wrap">
          <ReactECharts
            key={chartKey}
            option={option}
            className="card-raman-echarts"
            opts={{ renderer: 'canvas' }}
            onEvents={onEvents}
          />
        </div>

        <div className="card-raman-list-header">
          <span className="card-raman-list-title">Matches</span>
          <TableActions
            spec={{
              filename: 'raman-matches',
              columns: [
                { key: 'rank', header: 'Rank' },
                { key: 'mineralName', header: 'Material' },
                { key: 'formula', header: 'Formula' },
                {
                  key: 'cosineScore',
                  header: 'Score',
                  format: (v: number) =>
                    Number.isFinite(v) ? Number(v.toFixed(4)) : null,
                },
                { key: 'referenceSource', header: 'Source' },
                {
                  key: 'rruffId',
                  header: 'RRUFF ID',
                  format: (v: string | undefined) => v ?? '',
                },
                {
                  key: 'keyPeaksStr',
                  header: 'Key peaks (cm⁻¹)',
                },
              ],
              rows: matches.map((m, i) => ({
                rank: i + 1,
                mineralName: m.mineralName,
                formula: m.formula,
                cosineScore: m.cosineScore,
                referenceSource: m.referenceSource,
                rruffId: m.rruffId,
                keyPeaksStr: (m.keyPeaks ?? []).join('; '),
              })),
            }}
          />
        </div>
        <div className="card-raman-list">
          {matches.map((m, rank) => (
            <MatchRow
              key={m.id}
              match={m}
              rank={rank}
              visible={visibleMatchIds.has(m.id)}
              onToggle={toggleMatch}
              onContextMenu={openMatchMenu}
            />
          ))}
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

interface RowProps {
  match: RamanMatch
  rank: number
  visible: boolean
  onToggle: (id: string) => void
  onContextMenu: (match: RamanMatch, e: React.MouseEvent) => void
}

function MatchRow({ match, rank, visible, onToggle, onContextMenu }: RowProps) {
  const pct = Math.max(0, Math.min(1, match.cosineScore)) * 100
  return (
    <button
      onClick={() => onToggle(match.id)}
      onContextMenu={(e) => onContextMenu(match, e)}
      className={`card-raman-row${visible ? ' is-visible' : ''}`}
      title={visible ? 'Hide from overlay' : 'Show in overlay'}
    >
      <span
        className="card-raman-dot"
        style={{ '--dot-bg': dotColorForRank(rank), '--dot-op': visible ? 1 : 0.45 } as React.CSSProperties}
      />
      <span className="card-raman-rank">{rank + 1}</span>
      <div className="card-raman-name-col">
        <div className="card-raman-mineral-name">{match.mineralName}</div>
        <div className="card-raman-formula">{match.formula}</div>
      </div>
      <div className="card-raman-bar-track">
        <div
          className="card-raman-bar-fill"
          style={{ '--bar-w': `${pct}%`, '--bar-bg': scoreBarColor(match.cosineScore) } as React.CSSProperties}
        />
      </div>
      <span className="card-raman-score-text">{match.cosineScore.toFixed(2)}</span>
      <span className="card-raman-source-badge">{match.referenceSource}</span>
      {match.rruffId && <span className="card-raman-rruff-id">{match.rruffId}</span>}
    </button>
  )
}

const AXIS_COMMON = {
  type: 'value' as const,
  nameLocation: 'middle' as const,
  nameTextStyle: { color: '#888888', fontSize: CHART_TEXT_PX.sm },
  axisLabel: { color: '#888888', fontSize: CHART_TEXT_PX.xs },
  axisLine: { lineStyle: { color: '#2A2A2A' } },
  splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
}

function buildChartOption(
  exp: RamanIdPayload['experimentalSpectrum'],
  matches: RamanMatch[],
  colorById: Map<string, string>,
  visible: Set<string>,
) {
  const expData = exp.x.map((x, i) => [x, exp.y[i]])

  const matchSeries = matches.map((m) => {
    const color = colorById.get(m.id)!
    const isVisible = visible.has(m.id)
    return {
      name: m.id,
      type: 'line' as const,
      data: m.referenceSpectrum.x.map((x, i) => [x, m.referenceSpectrum.y[i]]),
      showSymbol: false,
      lineStyle: { color, width: 1, opacity: 0.7 },
      emphasis: { focus: 'series' as const },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color, type: 'dashed', width: 1, opacity: 0.55 },
        label: { show: false },
        data: isVisible ? m.keyPeaks.map((pos) => ({ xAxis: pos })) : [],
      },
    }
  })

  const legendSelected: Record<string, boolean> = { [EXPERIMENTAL_NAME]: true }
  for (const m of matches) legendSelected[m.id] = visible.has(m.id)

  const legendData = [
    { name: EXPERIMENTAL_NAME, itemStyle: { color: EXPERIMENTAL_COLOR } },
    ...matches.map((m) => ({ name: m.id, itemStyle: { color: colorById.get(m.id)! } })),
  ]

  const tooltipFormatter = (
    params: Array<{ seriesName: string; value: [number, number]; color: string }>,
  ) => {
    if (!params.length) return ''
    const rows = params
      .map((p) => {
        const label =
          p.seriesName === EXPERIMENTAL_NAME
            ? EXPERIMENTAL_NAME
            : matches.find((m) => m.id === p.seriesName)?.mineralName ?? p.seriesName
        return `<span style="color:${p.color}">\u25CF</span> ${label}: ${p.value[1].toFixed(1)}`
      })
      .join('<br/>')
    return `${params[0].value[0].toFixed(0)} cm\u207B\u00B9<br/>${rows}`
  }

  const legendFormatter = (name: string) =>
    name === EXPERIMENTAL_NAME ? name : matches.find((x) => x.id === name)?.mineralName ?? name

  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 48, right: 24, bottom: 58, left: 64 },
    legend: {
      data: legendData, selected: legendSelected, top: 6, right: 16,
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.xs },
      inactiveColor: '#555', itemWidth: 14, itemHeight: 8, formatter: legendFormatter,
    },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderColor: '#2A2A2A',
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.sm },
      axisPointer: { lineStyle: { color: EXPERIMENTAL_COLOR, width: 1 } },
      formatter: tooltipFormatter,
    },
    xAxis: { ...AXIS_COMMON, name: exp.xLabel, nameGap: 32 },
    yAxis: { ...AXIS_COMMON, name: exp.yLabel, nameGap: 48 },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      {
        type: 'slider', xAxisIndex: 0, bottom: 8, height: 18,
        borderColor: '#2A2A2A', fillerColor: 'rgba(232,232,232,0.12)',
        textStyle: { color: '#888888', fontSize: CHART_TEXT_PX.xxs },
      },
    ],
    series: [
      {
        name: EXPERIMENTAL_NAME,
        type: 'line' as const,
        data: expData,
        showSymbol: false,
        z: 5,
        lineStyle: { color: EXPERIMENTAL_COLOR, width: 1.8 },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(232,232,232,0.20)' },
              { offset: 1, color: 'rgba(232,232,232,0)' },
            ],
          },
        },
      },
      ...matchSeries,
    ],
  }
}

export default memo(RamanIdCardImpl)
