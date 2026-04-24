// Tweak popover family — extracted from ComputeCellView.
//
// 4-tab popover covering the Structure · Code tweak catalogue:
//   • Supercell — replicate the unit cell nx×ny×nz
//   • Dope     — randomly substitute a fraction of sites
//   • Slab     — cleave a surface along a Miller plane
//   • Vacancy  — remove N random sites of a target element
// Each tab has its own small form; on commit the popover dispatches a
// single `onApply(args)` call upstream. Per-tab state is local to this
// component and reset each time the popover re-opens.
//
// `TweakButton` is the standalone trigger + popover wrapper. It owns
// its own outside-click dismissal; `open` is lifted into the parent
// `ComputeCellView` so the popover can close automatically once a
// Create-cell action fires.

import { useRef, useState } from 'react'
import { Wrench } from 'lucide-react'
import { useOutsideClickDismiss } from '../../../../hooks/useOutsideClickDismiss'

export type TweakApplyArgs =
  | {
      kind: 'supercell'
      params: { nx: number; ny: number; nz: number }
    }
  | {
      kind: 'dope'
      params: { fromElement: string; toElement: string; fraction: number }
    }
  | {
      kind: 'surface'
      params: {
        miller: [number, number, number]
        minSlab: number
        minVacuum: number
      }
    }
  | {
      kind: 'vacancy'
      params: { element: string; count: number; seed: number }
    }

type TweakTab = TweakApplyArgs['kind']

export const TWEAK_TABS: ReadonlyArray<{ kind: TweakTab; label: string }> = [
  { kind: 'supercell', label: 'Supercell' },
  { kind: 'dope', label: 'Dope' },
  { kind: 'surface', label: 'Slab' },
  { kind: 'vacancy', label: 'Vacancy' },
]

function TweakPopover({
  onApply,
  onClose,
}: {
  onApply: (args: TweakApplyArgs) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<TweakTab>('supercell')

  // Per-tab local state. Kept separate so switching tabs doesn't wipe
  // in-progress numbers in sibling tabs — cheap and easier than lifting
  // into a reducer.
  const [nx, setNx] = useState(2)
  const [ny, setNy] = useState(2)
  const [nz, setNz] = useState(2)

  const [dopeFrom, setDopeFrom] = useState('Ti')
  const [dopeTo, setDopeTo] = useState('Zr')
  const [dopeFraction, setDopeFraction] = useState(0.25)

  const [millerH, setMillerH] = useState(1)
  const [millerK, setMillerK] = useState(0)
  const [millerL, setMillerL] = useState(0)
  const [minSlab, setMinSlab] = useState(8)
  const [minVacuum, setMinVacuum] = useState(12)

  const [vacancyElement, setVacancyElement] = useState('O')
  const [vacancyCount, setVacancyCount] = useState(1)

  const apply = () => {
    switch (tab) {
      case 'supercell':
        onApply({ kind: 'supercell', params: { nx, ny, nz } })
        return
      case 'dope':
        onApply({
          kind: 'dope',
          params: {
            fromElement: dopeFrom.trim() || 'Ti',
            toElement: dopeTo.trim() || 'Zr',
            fraction: dopeFraction,
          },
        })
        return
      case 'surface':
        onApply({
          kind: 'surface',
          params: {
            miller: [millerH, millerK, millerL],
            minSlab,
            minVacuum,
          },
        })
        return
      case 'vacancy':
        onApply({
          kind: 'vacancy',
          params: {
            element: vacancyElement.trim() || 'O',
            count: vacancyCount,
            seed: 0,
          },
        })
        return
    }
  }

  return (
    <div
      className="compute-nb-tweak-popover"
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="compute-nb-tweak-tabs" role="tablist">
        {TWEAK_TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            role="tab"
            aria-selected={tab === t.kind}
            className={
              'compute-nb-tweak-tab' +
              (tab === t.kind ? ' is-active' : '')
            }
            onClick={() => setTab(t.kind)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'supercell' && (
        <div className="compute-nb-tweak-row">
          <TweakNumber label="n_x" value={nx} onChange={setNx} />
          <TweakNumber label="n_y" value={ny} onChange={setNy} />
          <TweakNumber label="n_z" value={nz} onChange={setNz} />
        </div>
      )}

      {tab === 'dope' && (
        <>
          <div className="compute-nb-tweak-row">
            <TweakText label="From" value={dopeFrom} onChange={setDopeFrom} />
            <TweakText label="To" value={dopeTo} onChange={setDopeTo} />
            <TweakNumber
              label="Frac"
              value={dopeFraction}
              min={0}
              max={1}
              step={0.05}
              onChange={setDopeFraction}
            />
          </div>
        </>
      )}

      {tab === 'surface' && (
        <>
          <div className="compute-nb-tweak-row">
            <TweakNumber label="h" value={millerH} onChange={setMillerH} min={-9} />
            <TweakNumber label="k" value={millerK} onChange={setMillerK} min={-9} />
            <TweakNumber label="l" value={millerL} onChange={setMillerL} min={-9} />
          </div>
          <div className="compute-nb-tweak-row">
            <TweakNumber
              label="Slab Å"
              value={minSlab}
              onChange={setMinSlab}
              min={1}
              max={40}
            />
            <TweakNumber
              label="Vac Å"
              value={minVacuum}
              onChange={setMinVacuum}
              min={1}
              max={40}
            />
          </div>
        </>
      )}

      {tab === 'vacancy' && (
        <div className="compute-nb-tweak-row">
          <TweakText
            label="Element"
            value={vacancyElement}
            onChange={setVacancyElement}
          />
          <TweakNumber
            label="Count"
            value={vacancyCount}
            onChange={setVacancyCount}
            min={1}
            max={32}
          />
        </div>
      )}

      <div className="compute-nb-tweak-actions">
        <button type="button" className="compute-nb-ghost-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="compute-nb-run-btn is-small"
          onClick={apply}
        >
          Create cell
        </button>
      </div>
    </div>
  )
}

function TweakNumber({
  label,
  value,
  onChange,
  min = 1,
  max = 16,
  step = 1,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="compute-nb-tweak-num">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const raw = e.target.value
          const parsed = step < 1 ? Number.parseFloat(raw) : parseInt(raw, 10)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
    </label>
  )
}

function TweakText({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="compute-nb-tweak-num">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export function TweakButton({
  open,
  onOpenChange,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (args: TweakApplyArgs) => void
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClickDismiss(wrapRef, open, () => onOpenChange(false))

  return (
    <div
      className="compute-nb-tweak-wrap"
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="session-mini-btn"
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(!open)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tweak · Supercell · Dope · Slab · Vacancy"
        aria-label="Tweak structure"
      >
        <Wrench size={12} aria-hidden />
      </button>
      {open && (
        <TweakPopover
          onApply={(args) => {
            onOpenChange(false)
            onApply(args)
          }}
          onClose={() => onOpenChange(false)}
        />
      )}
    </div>
  )
}
