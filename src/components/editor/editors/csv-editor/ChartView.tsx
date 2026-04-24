import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { BarChart3 } from 'lucide-react'

interface ChartViewProps {
  headers: string[]
  rows: string[][]
  xCol: number
  yCol: number
  onXCol: (i: number) => void
  onYCol: (i: number) => void
}

export default function ChartView({
  headers,
  rows,
  xCol,
  yCol,
  onXCol,
  onYCol,
}: ChartViewProps) {
  const [ReactECharts, setReactECharts] = useState<
    typeof import('echarts-for-react').default | null
  >(null)

  useMemo(() => {
    import('echarts-for-react').then((m) => setReactECharts(() => m.default))
  }, [])

  const chartData = useMemo(() => {
    return rows
      .map((row) => {
        const x = Number(row[xCol])
        const y = Number(row[yCol])
        return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
      })
      .filter((v): v is [number, number] => v != null)
  }, [rows, xCol, yCol])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 14px',
          borderBottom: '1px solid var(--color-border)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          flexShrink: 0,
        }}
      >
        <BarChart3 size={12} strokeWidth={1.6} />
        <label>
          X:{' '}
          <select
            value={xCol}
            onChange={(e) => onXCol(Number(e.target.value))}
            style={selectStyle}
          >
            {headers.map((h, i) => (
              <option key={i} value={i}>
                {h || `col ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Y:{' '}
          <select
            value={yCol}
            onChange={(e) => onYCol(Number(e.target.value))}
            style={selectStyle}
          >
            {headers.map((h, i) => (
              <option key={i} value={i}>
                {h || `col ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <span
          style={{
            fontSize: 'var(--text-xxs)',
            color: 'var(--color-text-muted)',
          }}
        >
          {chartData.length} points
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {ReactECharts ? (
          <ReactECharts
            option={{
              animation: false,
              grid: { top: 24, right: 24, bottom: 40, left: 56 },
              xAxis: {
                type: 'value',
                name: headers[xCol] || `col ${xCol + 1}`,
                nameLocation: 'center',
                nameGap: 26,
                nameTextStyle: { fontSize: 'var(--text-xs)', color: '#999' },
                axisLabel: { fontSize: 'var(--text-xxs)', color: '#999' },
                splitLine: { lineStyle: { color: '#2a2a2a' } },
              },
              yAxis: {
                type: 'value',
                name: headers[yCol] || `col ${yCol + 1}`,
                nameLocation: 'center',
                nameGap: 40,
                nameTextStyle: { fontSize: 'var(--text-xs)', color: '#999' },
                axisLabel: { fontSize: 'var(--text-xxs)', color: '#999' },
                splitLine: { lineStyle: { color: '#2a2a2a' } },
              },
              series: [
                {
                  type: 'line',
                  data: chartData,
                  showSymbol: chartData.length < 500,
                  symbolSize: 3,
                  lineStyle: { width: 1.5, color: '#0e7490' },
                  itemStyle: { color: '#0e7490' },
                },
              ],
            }}
            style={{ width: '100%', height: '100%' }}
            theme="dark"
            opts={{ renderer: 'canvas' }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Loading chart…
          </div>
        )}
      </div>
    </div>
  )
}

const selectStyle: CSSProperties = {
  background: 'var(--color-bg-panel)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border)',
  borderRadius: 3,
  padding: '2px 6px',
  fontSize: 'var(--text-xs)',
}
