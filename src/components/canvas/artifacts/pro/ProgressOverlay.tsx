import { Loader2 } from 'lucide-react'

// Human-readable label for each `busy` key emitted by the Pro workbenches.
// Keeping the map here (rather than inside each workbench) means all three
// techniques speak the same vocabulary and drift is visible at a glance.
const BUSY_LABELS: Record<string, string> = {
  quality: 'Assessing data quality…',
  smooth: 'Applying smoothing…',
  baseline: 'Subtracting baseline…',
  detect: 'Detecting peaks…',
  'detect-peaks': 'Detecting peaks…',
  identify: 'Matching against database…',
  fit: 'Fitting peaks…',
  quantify: 'Quantifying…',
  lookup: 'Looking up reference…',
  'charge-correct': 'Applying charge correction…',
  'xrd-search': 'Searching phase database…',
  'xrd-refine': 'Running Rietveld refinement…',
  'export-cif': 'Exporting refined CIF…',
}

interface Props {
  /** Falsy → overlay hidden. Any string → overlay shown with the matching
   *  human label (falls back to the raw key if not in the map). */
  busy: string | null | undefined
}

// Absolute-positioned spinner + label that sits on top of the chart while
// a long-running worker call is in flight. Pointer-events are allowed on
// the backdrop so the user can't accidentally drag-zoom a half-rendered
// chart mid-operation.
export default function ProgressOverlay({ busy }: Props) {
  if (!busy) return null
  const label = BUSY_LABELS[busy] ?? `${busy}…`
  return (
    <div className="pro-progress-overlay" role="status" aria-live="polite">
      <div className="pro-progress-card">
        <Loader2 size={18} className="pro-progress-spinner" />
        <span className="pro-progress-label">{label}</span>
      </div>
    </div>
  )
}
