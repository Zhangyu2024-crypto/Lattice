// PropertyPanel — right rail of the structure card. Phase B introduces a
// tab strip (Lattice / Atoms / Measure) so the panel scales with the
// new query and measurement features. Tab content is inlined here
// because each panel is small (under 100 lines) and pulling them into
// separate files would add cognitive overhead with no reuse.

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Badge, MetaRow } from '../../../ui'
import type { LatticeParams } from '../../../../lib/cif'
import { TableActions } from '../../../common/TableActions'
import type { AtomInfo, Measurement } from './StructureViewer'
import { TYPO } from '../../../../lib/typography-inline'

type TabId = 'lattice' | 'atoms' | 'measure'

export interface PropertyPanelProps {
  formula: string
  spaceGroup: string
  lattice: LatticeParams
  computedFromArtifactId?: string
  atoms: AtomInfo[]
  highlightedAtomIndex: number | null
  onSelectAtom: (idx: number | null) => void
  measurements: Measurement[]
  onDeleteMeasurement: (id: string) => void
  onEditLattice?: (key: keyof LatticeParams, value: number) => void
  onEditAtom?: (index: number, field: 'element' | 'x' | 'y' | 'z', value: string | number) => void
  onDeleteAtom?: (index: number) => void
  onAddAtom?: (element: string, x: number, y: number, z: number) => void
}

export default function PropertyPanel(props: PropertyPanelProps) {
  const [tab, setTab] = useState<TabId>('lattice')

  return (
    <aside style={S.root}>
      <div style={S.tabs}>
        <TabButton id="lattice" active={tab === 'lattice'} onClick={setTab}>
          Lattice
        </TabButton>
        <TabButton id="atoms" active={tab === 'atoms'} onClick={setTab}>
          Atoms ({props.atoms.length})
        </TabButton>
        <TabButton id="measure" active={tab === 'measure'} onClick={setTab}>
          Measure ({props.measurements.length})
        </TabButton>
      </div>

      <div style={S.tabBody}>
        {tab === 'lattice' && <LatticeTab {...props} />}
        {tab === 'atoms' && <AtomsTab {...props} />}
        {tab === 'measure' && <MeasureTab {...props} />}
      </div>
    </aside>
  )
}

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: TabId
  active: boolean
  onClick: (id: TabId) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`structure-property-tab${active ? ' is-active' : ''}`}
    >
      {children}
    </button>
  )
}

// -- Lattice ------------------------------------------------------------------

function LatticeTab({
  formula,
  spaceGroup,
  lattice,
  computedFromArtifactId,
  onEditLattice,
}: PropertyPanelProps) {
  const editable = !!onEditLattice
  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Identity</div>
      <MetaRow label="Formula" value={formula} mono />
      <MetaRow label="Space group" value={spaceGroup} mono />
      {computedFromArtifactId && (
        <MetaRow
          label="Computed from"
          value={
            <Badge variant="agent" size="sm">
              {computedFromArtifactId}
            </Badge>
          }
        />
      )}

      <div
        className="structure-property-section-gap"
        style={{
          ...S.sectionTitle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>Lattice</span>
        <TableActions
          variant="compact"
          spec={{
            filename: `lattice-${formula.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'structure'}`,
            columns: [
              { key: 'param', header: 'Parameter' },
              {
                key: 'value',
                header: 'Value',
                format: (v: number) =>
                  Number.isFinite(v) ? Number(v.toFixed(4)) : null,
              },
              { key: 'unit', header: 'Unit' },
            ],
            rows: LATTICE_ROWS.map((r) => ({
              param: r.key,
              value: lattice[r.key],
              unit: r.unit,
            })),
          }}
        />
      </div>
      <table style={S.table}>
        <tbody>
          {LATTICE_ROWS.map(({ key, unit }) => (
            <tr key={key}>
              <td style={S.tKey}>{key}</td>
              <td style={S.tVal}>
                {editable ? (
                  <input
                    type="number"
                    value={lattice[key]}
                    step={key === 'a' || key === 'b' || key === 'c' ? 0.001 : 0.01}
                    style={S.latticeInput}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isFinite(n)) onEditLattice!(key, n)
                    }}
                  />
                ) : (
                  lattice[key].toFixed(3)
                )}
              </td>
              <td style={S.tUnit}>{unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface LatticeRow {
  key: keyof LatticeParams
  unit: string
}

const LATTICE_ROWS: ReadonlyArray<LatticeRow> = [
  { key: 'a', unit: 'A' },
  { key: 'b', unit: 'A' },
  { key: 'c', unit: 'A' },
  { key: 'alpha', unit: 'deg' },
  { key: 'beta', unit: 'deg' },
  { key: 'gamma', unit: 'deg' },
]

// -- Atoms --------------------------------------------------------------------

function AtomsTab({
  atoms,
  highlightedAtomIndex,
  onSelectAtom,
  onEditAtom,
  onDeleteAtom,
  onAddAtom,
}: PropertyPanelProps) {
  const editable = !!onEditAtom
  const [addEl, setAddEl] = useState('O')
  const [addX, setAddX] = useState(0)
  const [addY, setAddY] = useState(0)
  const [addZ, setAddZ] = useState(0)

  if (atoms.length === 0 && !onAddAtom) {
    return (
      <div style={S.empty}>No atoms parsed from this structure yet.</div>
    )
  }
  return (
    <div style={S.atomsList}>
      <div style={S.atomsHead}>
        <span style={S.atomsHeadCell}>#</span>
        <span style={S.atomsHeadCell}>Elem</span>
        <span className="structure-property-atoms-cell--right" style={S.atomsHeadCell}>x</span>
        <span className="structure-property-atoms-cell--right" style={S.atomsHeadCell}>y</span>
        <span className="structure-property-atoms-cell--right" style={S.atomsHeadCell}>z</span>
        {onDeleteAtom && <span style={S.atomsHeadCell} />}
      </div>
      {atoms.map((atom) => {
        const active = atom.index === highlightedAtomIndex
        if (editable) {
          return (
            <div
              key={atom.index}
              className={`structure-property-atom-row${active ? ' is-active' : ''}`}
              style={S.atomRowEditable}
            >
              <span style={S.atomCell}>{atom.index}</span>
              <input
                type="text"
                value={atom.element}
                maxLength={3}
                style={S.atomInputEl}
                onChange={(e) => onEditAtom!(atom.index, 'element', e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <input
                type="number"
                value={atom.x}
                step={0.001}
                style={S.atomInputCoord}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) onEditAtom!(atom.index, 'x', n)
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <input
                type="number"
                value={atom.y}
                step={0.001}
                style={S.atomInputCoord}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) onEditAtom!(atom.index, 'y', n)
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <input
                type="number"
                value={atom.z}
                step={0.001}
                style={S.atomInputCoord}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) onEditAtom!(atom.index, 'z', n)
                }}
                onClick={(e) => e.stopPropagation()}
              />
              {onDeleteAtom && (
                <button
                  type="button"
                  style={S.atomDeleteBtn}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteAtom(atom.index)
                  }}
                  title="Delete atom"
                  aria-label="Delete atom"
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          )
        }
        return (
          <button
            key={atom.index}
            type="button"
            onClick={() => onSelectAtom(active ? null : atom.index)}
            className={`structure-property-atom-row${active ? ' is-active' : ''}`}
          >
            <span style={S.atomCell}>{atom.index}</span>
            <span className="structure-property-atom-elem" style={S.atomCell}>
              {atom.element}
            </span>
            <span className="structure-property-atoms-cell--right" style={S.atomCell}>
              {atom.x.toFixed(3)}
            </span>
            <span className="structure-property-atoms-cell--right" style={S.atomCell}>
              {atom.y.toFixed(3)}
            </span>
            <span className="structure-property-atoms-cell--right" style={S.atomCell}>
              {atom.z.toFixed(3)}
            </span>
          </button>
        )
      })}

      {onAddAtom && (
        <div style={S.addAtomRow}>
          <div style={S.addAtomLabel}>
            <Plus size={10} />
            Add atom
          </div>
          <div style={S.addAtomFields}>
            <input
              type="text"
              value={addEl}
              maxLength={3}
              placeholder="El"
              style={S.atomInputEl}
              onChange={(e) => setAddEl(e.target.value)}
            />
            <input
              type="number"
              value={addX}
              step={0.001}
              style={S.atomInputCoord}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setAddX(n)
              }}
            />
            <input
              type="number"
              value={addY}
              step={0.001}
              style={S.atomInputCoord}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setAddY(n)
              }}
            />
            <input
              type="number"
              value={addZ}
              step={0.001}
              style={S.atomInputCoord}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setAddZ(n)
              }}
            />
            <button
              type="button"
              style={S.addAtomBtn}
              onClick={() => {
                if (addEl.trim()) {
                  onAddAtom(addEl.trim(), addX, addY, addZ)
                }
              }}
              title="Add atom"
            >
              <Plus size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// -- Measure ------------------------------------------------------------------

function MeasureTab({
  measurements,
  atoms,
  onDeleteMeasurement,
  onSelectAtom,
}: PropertyPanelProps) {
  if (measurements.length === 0) {
    return (
      <div style={S.empty}>
        No measurements yet. Toggle <em>Measure mode</em> in the left
        sidebar, then click 2 atoms (distance) or 3 atoms (angle).
      </div>
    )
  }
  return (
    <div style={S.measureList}>
      {measurements.map((m) => {
        const labels = m.atoms
          .map((idx) => {
            const a = atoms[idx]
            return a ? `${a.element}#${idx}` : `#${idx}`
          })
          .join(' -- ')
        const value =
          m.kind === 'distance'
            ? `${m.value.toFixed(3)} A`
            : `${m.value.toFixed(2)} deg`
        return (
          <div key={m.id} style={S.measureRow}>
            <div style={S.measureMain}>
              <button
                type="button"
                style={S.measureLabel}
                title="Highlight first atom"
                onClick={() => onSelectAtom(m.atoms[0] ?? null)}
              >
                {labels}
              </button>
              <span style={S.measureValue}>{value}</span>
            </div>
            <button
              type="button"
              style={S.deleteBtn}
              onClick={() => onDeleteMeasurement(m.id)}
              title="Delete measurement"
              aria-label="Delete measurement"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// -- Atoms (shared) -----------------------------------------------------------
//
// MetaRow used to live here as a private helper; it was lifted to
// `src/components/ui/MetaRow.tsx` in Wave 5 and is now imported at the
// top of this file. The private implementation is gone.

// -- Shared inline input style base -------------------------------------------

const inputBase: CSSProperties = {
  background: 'var(--color-bg-input)',
  border: '1px solid var(--color-border)',
  borderRadius: 2,
  color: 'var(--color-text-primary)',
  fontSize: TYPO.xxs,
  outline: 'none',
  padding: '2px 4px',
}

const S: Record<string, CSSProperties> = {
  root: {
    width: '100%',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--color-bg-panel)',
    minHeight: 0,
  },
  tabs: {
    display: 'flex',
    flexShrink: 0,
    borderBottom: '1px solid var(--color-border)',
  },
  tabBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 14px',
    minHeight: 0,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 6 },
  sectionTitle: {
    fontSize: TYPO.xxs,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: 'var(--color-text-muted)',
    marginBottom: 4,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: TYPO.xs },
  tKey: {
    padding: '3px 6px 3px 0',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-sans)',
    width: 40,
  },
  tVal: {
    padding: '3px 6px',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
    textAlign: 'right',
  },
  tUnit: {
    padding: '3px 0 3px 6px',
    color: 'var(--color-text-muted)',
    fontSize: TYPO.xxs,
  },
  latticeInput: {
    ...inputBase,
    width: '100%',
    textAlign: 'right',
  },

  // Atoms tab
  atomsList: { display: 'flex', flexDirection: 'column', gap: 1 },
  atomsHead: {
    display: 'grid',
    gridTemplateColumns: '28px 36px 1fr 1fr 1fr',
    gap: 6,
    padding: '4px 6px',
    fontSize: TYPO['2xs'],
    fontWeight: 600,
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    borderBottom: '1px solid var(--color-border)',
    marginBottom: 3,
  },
  atomsHeadCell: { display: 'inline-block' },
  atomCell: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Editable atom row
  atomRowEditable: {
    display: 'grid',
    gridTemplateColumns: '28px 36px 1fr 1fr 1fr auto',
    gap: 3,
    alignItems: 'center',
    padding: '2px 6px',
  },
  atomInputEl: {
    ...inputBase,
    width: 32,
    textAlign: 'center',
  },
  atomInputCoord: {
    ...inputBase,
    width: '100%',
    textAlign: 'right',
  },
  atomDeleteBtn: {
    flexShrink: 0,
    width: 18,
    height: 18,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border)',
    borderRadius: 2,
    cursor: 'pointer',
    padding: 0,
  },

  // Add atom row
  addAtomRow: {
    marginTop: 6,
    padding: '6px 6px',
    borderTop: '1px solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  addAtomLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: TYPO.xxs,
    fontWeight: 600,
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
  },
  addAtomFields: {
    display: 'grid',
    gridTemplateColumns: '36px 1fr 1fr 1fr auto',
    gap: 3,
    alignItems: 'center',
  },
  addAtomBtn: {
    width: 18,
    height: 18,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-accent)',
    color: 'white',
    border: 'none',
    borderRadius: 2,
    cursor: 'pointer',
    padding: 0,
  },

  // Measure tab
  measureList: { display: 'flex', flexDirection: 'column', gap: 6 },
  measureRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 8px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    background: 'var(--color-bg-sidebar)',
  },
  measureMain: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  measureLabel: {
    fontSize: TYPO.xxs,
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-text-secondary)',
    background: 'transparent',
    border: 'none',
    padding: 0,
    textAlign: 'left',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  measureValue: {
    fontSize: TYPO.sm,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
  },
  deleteBtn: {
    flexShrink: 0,
    width: 22,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    cursor: 'pointer',
  },
  empty: {
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
    padding: 8,
    lineHeight: 1.5,
  },
}
