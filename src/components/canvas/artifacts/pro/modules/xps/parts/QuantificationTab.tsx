// XPS quantification tab — atomic-percent table rendered inside the
// bottom data tabs. Styling is local so the table can be tuned without
// pulling on the shared XpsProWorkbench styles.

import type { XpsProFitResult } from '@/types/artifact'
import { TYPO } from '@/lib/typography-inline'
import { TableActions } from '@/components/common/TableActions'
import { S } from '@/components/canvas/artifacts/XpsProWorkbench.styles'

const QUANT_STYLES = {
  wrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '4px 0',
  },
  head: {
    display: 'grid',
    gridTemplateColumns: '1fr 80px 90px',
    padding: '4px 14px',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    borderBottom: '1px solid var(--color-border)',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 80px 90px',
    padding: '4px 14px',
    fontSize: TYPO.xs,
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-primary)',
  },
  numCell: {
    textAlign: 'right' as const,
  },
  lineTag: {
    color: 'var(--color-text-muted)',
    fontSize: TYPO.xxs,
  },
}

export function XpsQuantificationTab({
  rows,
}: {
  rows: NonNullable<XpsProFitResult['quantification']>
}) {
  if (rows.length === 0) {
    return (
      <div style={S.tabPlaceholder}>
        Run <code>quantify</code> to populate element atomic percentages.
      </div>
    )
  }
  // Build the export spec up-front — Format functions pre-stringify
  // numbers so the serialised CSV / clipboard payload matches the
  // on-screen precision exactly.
  const tableSpec = {
    filename: 'xps-quantification',
    columns: [
      { key: 'element' as const, header: 'Element' },
      {
        key: 'line' as const,
        header: 'Line',
        format: (v: NonNullable<XpsProFitResult['quantification']>[number]['line']) =>
          v ?? '',
      },
      {
        key: 'atomic_percent' as const,
        header: 'at%',
        format: (v: number) =>
          Number.isFinite(v) ? Number(v.toFixed(2)) : null,
      },
      {
        key: 'area' as const,
        header: 'Area',
        format: (v: number | null | undefined) =>
          v != null && Number.isFinite(v) ? Number(v.toFixed(2)) : null,
      },
    ],
    rows,
  }
  return (
    <div style={QUANT_STYLES.wrap}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '2px 14px 4px',
        }}
      >
        <TableActions spec={tableSpec} />
      </div>
      <div style={QUANT_STYLES.head}>
        <span>Element</span>
        <span style={QUANT_STYLES.numCell}>at%</span>
        <span style={QUANT_STYLES.numCell}>Area</span>
      </div>
      {rows.map(
        (
          r: NonNullable<XpsProFitResult['quantification']>[number],
          i: number,
        ) => (
          <div
            key={`quant-${r.element}-${r.line ?? i}`}
            style={QUANT_STYLES.row}
          >
            <span>
              {r.element}
              {r.line ? (
                <span style={QUANT_STYLES.lineTag}>{` ${r.line}`}</span>
              ) : null}
            </span>
            <span style={QUANT_STYLES.numCell}>
              {Number.isFinite(r.atomic_percent)
                ? r.atomic_percent.toFixed(1)
                : '—'}
            </span>
            <span style={QUANT_STYLES.numCell}>
              {r.area != null && Number.isFinite(r.area)
                ? r.area.toFixed(1)
                : '—'}
            </span>
          </div>
        ),
      )}
    </div>
  )
}
