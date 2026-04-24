import { useCallback, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { ArrowUpDown, Clock, Grid3x3, Table as TableIcon } from 'lucide-react'
import { buildMaterialBriefArtifact } from '../../../lib/local-artifact-builders'
import type { Artifact } from '../../../types/artifact'
import { CHART_PRIMARY, CHART_SECONDARY } from '../../../lib/chart-colors'
import { CHART_FONT_MONO } from '../../../lib/chart-font-stacks'
import { CHART_TEXT_PX } from '../../../lib/chart-text-px'
import { Button, EmptyState } from '../../ui'
import { TableActions } from '../../common/TableActions'
import type { TableSpec } from '../../../lib/table-export'

interface CompMaterial { id: string; name: string; formula: string; paperRef?: string }
interface CompProperty { key: string; label: string; unit?: string; higherIsBetter?: boolean }
interface MaterialComparisonPayload {
  materials: CompMaterial[]
  properties: CompProperty[]
  values: (number | null)[][]
  timeline?: { materialId: string; year: number }[]
}
interface Props {
  artifact: Artifact
  /** Open the derived material-brief artifact in the host (upsert + focus). */
  onOpenDerivedArtifact?: (next: Artifact) => void
  className?: string
}

type ViewMode = 'table' | 'heatmap' | 'timeline'
type SortState = { colIdx: number; dir: 'asc' | 'desc' } | null
interface ColStat { min: number; max: number; median: number }

const HEATMAP_SCALE = ['#0A0A0A', '#4A4A4A', '#E8E8E8']
const BAR_GOOD = '#C8C8C8'
const BAR_BAD = '#6E6E6E'
const BAR_NEUTRAL = 'var(--color-accent)'

export default function MaterialComparisonCard({
  artifact,
  onOpenDerivedArtifact,
  className,
}: Props) {
  const payload = artifact.payload as unknown as MaterialComparisonPayload
  const materials = payload?.materials ?? []
  const properties = payload?.properties ?? []
  const values = payload?.values ?? []
  const timeline = payload?.timeline

  const [view, setView] = useState<ViewMode>('table')
  const [sort, setSort] = useState<SortState>(null)
  const stats = useMemo(() => columnStats(properties, values), [properties, values])

  // Export spec — each row represents one material, each property is a
  // column. Keyed with `mat_<id>` can't be used because TableColumn's
  // `key` is constrained to `keyof T & string`; we use a
  // Record<string, string | number | null> shape so the keys are open.
  const exportSpec: TableSpec<Record<string, string | number | null>> = useMemo(() => {
    const rows: Record<string, string | number | null>[] = materials.map(
      (m, rowIdx) => {
        const row: Record<string, string | number | null> = {
          material: m.name || m.formula || m.id,
          formula: m.formula ?? '',
        }
        properties.forEach((p, colIdx) => {
          const v = values[rowIdx]?.[colIdx]
          // Property key becomes the column; append unit for clarity.
          const colKey = p.unit ? `${p.label} (${p.unit})` : p.label
          row[colKey] = v == null ? null : v
        })
        return row
      },
    )
    const columns = [
      { key: 'material' as const, header: 'Material' },
      { key: 'formula' as const, header: 'Formula' },
      ...properties.map((p) => {
        const colKey = p.unit ? `${p.label} (${p.unit})` : p.label
        return { key: colKey, header: colKey }
      }),
    ]
    return { columns, rows, filename: 'material-comparison' }
  }, [materials, properties, values])
  const heatmapOption = useMemo(
    () => buildHeatmapOption(materials, properties, values, stats),
    [materials, properties, values, stats],
  )
  const timelineOption = useMemo(
    () => (timeline ? buildTimelineOption(materials, timeline) : null),
    [materials, timeline],
  )
  const hasTimeline = Boolean(timeline && timeline.length > 0)
  const handleOpenMaterial = useCallback((material: CompMaterial, rowIdx: number) => {
    if (!onOpenDerivedArtifact) return
    const next = buildMaterialBriefArtifact({
      name: material.name,
      formula: material.formula,
      sourceArtifactId: artifact.id,
      properties: properties.map((property, colIdx) => ({
        label: property.label,
        value: values[rowIdx]?.[colIdx] ?? null,
        unit: property.unit,
        higherIsBetter: property.higherIsBetter,
      })),
      paperRef: material.paperRef,
      discoveryYear: timeline?.find((entry) => entry.materialId === material.id)?.year,
    })
    onOpenDerivedArtifact(next)
  }, [artifact.id, onOpenDerivedArtifact, properties, timeline, values])

  if (materials.length === 0 || properties.length === 0) {
    return <EmptyState title="No materials to compare" />
  }

  const rootClassName = className
    ? `card-material-root ${className}`
    : 'card-material-root'

  return (
    <div className={rootClassName}>
      <div className="card-material-top-bar">
        <div className="card-material-stats">
          <strong className="card-material-num">{materials.length}</strong>
          <span className="card-material-muted">materials ×</span>
          <strong className="card-material-num">{properties.length}</strong>
          <span className="card-material-muted">properties</span>
        </div>
        <span className="card-material-spacer" />
        <Toggle active={view === 'table'} onClick={() => setView('table')} icon={<TableIcon size={12} />} label="Table" />
        <Toggle active={view === 'heatmap'} onClick={() => setView('heatmap')} icon={<Grid3x3 size={12} />} label="Heatmap" />
        {hasTimeline && (
          <Toggle active={view === 'timeline'} onClick={() => setView('timeline')} icon={<Clock size={12} />} label="Timeline" />
        )}
        <TableActions spec={exportSpec} />
      </div>
      <div className="card-material-main">
        {view === 'table' && (
          <TableView
            materials={materials} properties={properties} values={values}
            stats={stats} sort={sort} onSort={setSort} onOpenMaterial={handleOpenMaterial}
          />
        )}
        {view === 'heatmap' && <EChart option={heatmapOption} />}
        {view === 'timeline' && timelineOption && <EChart option={timelineOption} />}
      </div>
    </div>
  )
}

function EChart({ option }: { option: Record<string, unknown> }) {
  return (
    <div className="card-material-chart-wrap">
      <ReactECharts option={option} notMerge className="card-material-echarts" opts={{ renderer: 'canvas' }} />
    </div>
  )
}

function Toggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      leading={icon}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </Button>
  )
}

interface TableViewProps {
  materials: CompMaterial[]
  properties: CompProperty[]
  values: (number | null)[][]
  stats: ColStat[]
  sort: SortState
  onSort: (s: SortState) => void
  onOpenMaterial: (material: CompMaterial, rowIdx: number) => void
}

function TableView({
  materials,
  properties,
  values,
  stats,
  sort,
  onSort,
  onOpenMaterial,
}: TableViewProps) {
  const rowOrder = useMemo(() => {
    const idx = materials.map((_, i) => i)
    if (!sort) return idx
    return idx.sort((a, b) => {
      const va = values[a]?.[sort.colIdx] ?? null
      const vb = values[b]?.[sort.colIdx] ?? null
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return sort.dir === 'asc' ? va - vb : vb - va
    })
  }, [materials, values, sort])

  const handleSort = (colIdx: number) => {
    if (sort?.colIdx === colIdx) onSort(sort.dir === 'asc' ? { colIdx, dir: 'desc' } : null)
    else onSort({ colIdx, dir: 'asc' })
  }

  return (
    <div className="card-material-table-scroll">
      <table className="card-material-table">
        <thead>
          <tr className="card-material-thead-row">
            <th className="card-material-th card-material-th--formula">Formula</th>
            {properties.map((p, i) => {
              const sorted = sort?.colIdx === i
              const arrowClass = [
                'card-material-sort-arrow',
                sorted ? 'is-active' : '',
                sorted && sort?.dir === 'desc' ? 'is-desc' : '',
              ].filter(Boolean).join(' ')
              return (
                <th key={p.key} className="card-material-th-sort" onClick={() => handleSort(i)} title={`Sort by ${p.label}`}>
                  <span className="card-material-th-inner">
                    <span>
                      {p.label}
                      {p.unit && <span className="card-material-unit"> ({p.unit})</span>}
                    </span>
                    <ArrowUpDown size={10} className={arrowClass} />
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rowOrder.map((rowIdx) => {
            const m = materials[rowIdx]
            return (
              <tr
                key={m.id}
                className="card-material-body-row"
                onClick={() => onOpenMaterial(m, rowIdx)}
              >
                <td className="card-material-formula-cell">
                  <div className="card-material-formula-text">{m.formula}</div>
                  <div className="card-material-material-sub">{m.name}</div>
                </td>
                {properties.map((prop, colIdx) => (
                  <td key={prop.key} className="card-material-td">
                    <ValueBar value={values[rowIdx]?.[colIdx] ?? null} stat={stats[colIdx]} property={prop} />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ValueBar({ value, stat, property }: { value: number | null; stat: ColStat; property: CompProperty }) {
  if (value == null) return <span className="card-material-null-cell">—</span>
  const pct = Math.max(4, normalize(value, stat) * 100)
  const above = value >= stat.median
  const hib = property.higherIsBetter
  const color = hib === true ? (above ? BAR_GOOD : BAR_BAD) : hib === false ? (above ? BAR_BAD : BAR_GOOD) : BAR_NEUTRAL
  return (
    <div className="card-material-bar-cell">
      <div className="card-material-bar-track">
        <div
          className="card-material-bar-fill"
          style={{ '--bar-w': `${pct}%`, '--bar-bg': color } as React.CSSProperties}
        />
      </div>
      <span className="card-material-bar-label">{formatNumber(value)}</span>
    </div>
  )
}

const AXIS_LINE = { lineStyle: { color: '#2A2A2A' } }
const SPLIT_LINE = { lineStyle: { color: 'rgba(255,255,255,0.04)' } }
const TOOLTIP_BASE = {
  backgroundColor: 'rgba(20,20,20,0.96)',
  borderColor: '#2A2A2A',
  extraCssText: 'z-index: 10 !important; pointer-events: none;',
  textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.xs },
}

const Y_CAT_LABEL = {
  color: '#cccccc',
  fontSize: CHART_TEXT_PX.xs,
  fontFamily: CHART_FONT_MONO,
}

function buildHeatmapOption(
  materials: CompMaterial[],
  properties: CompProperty[],
  values: (number | null)[][],
  stats: ColStat[],
) {
  const data: [number, number, number | '-'][] = []
  for (let r = 0; r < materials.length; r++) {
    for (let c = 0; c < properties.length; c++) {
      const raw = values[r]?.[c] ?? null
      data.push([c, r, raw == null ? '-' : normalize(raw, stats[c])])
    }
  }
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 16, left: 120, right: 40, bottom: 90 },
    tooltip: {
      ...TOOLTIP_BASE,
      formatter: (params: { data: [number, number, number | '-'] }) => {
        const [c, r] = params.data
        const raw = values[r]?.[c] ?? null
        const prop = properties[c]
        const txt = raw == null ? 'missing' : `${formatNumber(raw)}${prop.unit ? ' ' + prop.unit : ''}`
        return `<strong>${materials[r].formula}</strong><br/>${prop.label}: ${txt}`
      },
    },
    xAxis: {
      type: 'category' as const,
      data: properties.map((p) => p.label),
      axisLabel: { color: '#888888', fontSize: CHART_TEXT_PX.xxs, rotate: 30, interval: 0 },
      axisLine: AXIS_LINE,
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category' as const,
      data: materials.map((m) => m.formula),
      axisLabel: Y_CAT_LABEL,
      axisLine: AXIS_LINE,
      splitArea: { show: false },
    },
    visualMap: { min: 0, max: 1, show: false, inRange: { color: HEATMAP_SCALE } },
    series: [{
      type: 'heatmap' as const,
      data,
      itemStyle: { borderColor: 'rgba(0,0,0,0.3)', borderWidth: 1 },
      emphasis: { itemStyle: { borderColor: '#ffffff', borderWidth: 1 } },
    }],
  }
}

function buildTimelineOption(
  materials: CompMaterial[],
  timeline: NonNullable<MaterialComparisonPayload['timeline']>,
) {
  const byId = new Map(materials.map((m, i) => [m.id, i]))
  const data = timeline
    .map((t) => {
      const i = byId.get(t.materialId)
      return i == null ? null : { value: [t.year, materials[i].formula], name: materials[i].name }
    })
    .filter((d): d is { value: [number, string]; name: string } => d !== null)
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 24, right: 40, bottom: 60, left: 120 },
    tooltip: {
      ...TOOLTIP_BASE,
      formatter: (p: { data: { value: [number, string]; name: string } }) =>
        `<strong>${p.data.name}</strong><br/>first reported: ${p.data.value[0]}`,
    },
    xAxis: {
      type: 'value' as const,
      name: 'Year',
      nameLocation: 'middle' as const,
      nameGap: 28,
      nameTextStyle: { color: '#888888', fontSize: CHART_TEXT_PX.xs },
      axisLabel: { color: '#888888', fontSize: CHART_TEXT_PX.xxs, formatter: (v: number) => String(v) },
      axisLine: AXIS_LINE,
      splitLine: SPLIT_LINE,
    },
    yAxis: {
      type: 'category' as const,
      data: materials.map((m) => m.formula),
      axisLabel: Y_CAT_LABEL,
      axisLine: AXIS_LINE,
      splitLine: SPLIT_LINE,
    },
    series: [{
      type: 'scatter' as const,
      data,
      symbolSize: 18,
      itemStyle: { color: CHART_PRIMARY, borderColor: '#ffffff', borderWidth: 1 },
      emphasis: { itemStyle: { color: CHART_SECONDARY } },
    }],
  }
}

function columnStats(properties: CompProperty[], values: (number | null)[][]): ColStat[] {
  return properties.map((_, colIdx) => {
    const col = values.map((row) => row?.[colIdx] ?? null).filter((v): v is number => v != null)
    if (col.length === 0) return { min: 0, max: 0, median: 0 }
    const sorted = [...col].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    return { min: sorted[0], max: sorted[sorted.length - 1], median }
  })
}

function normalize(v: number, stat: ColStat): number {
  if (stat.max === stat.min) return 0.5
  return (v - stat.min) / (stat.max - stat.min)
}

function formatNumber(v: number): string {
  const abs = Math.abs(v)
  if (abs === 0) return '0'
  if (abs >= 1000) return v.toFixed(0)
  if (abs >= 100) return v.toFixed(1)
  if (abs >= 1) return v.toFixed(2)
  return v.toFixed(3)
}
