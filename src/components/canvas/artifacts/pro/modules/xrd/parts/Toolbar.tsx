import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Activity,
  Crosshair,
  Search,
  BarChart3,
  MoreHorizontal,
  Loader2,
  ChevronDown,
  Download,
  FileDown,
  Camera,
  Gauge,
  Layers,
} from 'lucide-react'
import type { XrdSubState, XrdProPayload, XrdProPeak } from '@/types/artifact'
import { ProSelect, ProNumber, ProSlider, ProRow, ProSection } from '@/components/common/pro'
import { REFINE_PRESETS } from '@/components/canvas/artifacts/XrdProWorkbench.panel'
import ManualAddPeak from '@/components/canvas/artifacts/xrd-panel/ManualAddPeak'
import ProPeakTable from '@/components/canvas/artifacts/pro/primitives/ProPeakTable'
import { INSTRUMENT_PROFILES, DEFAULT_INSTRUMENTAL_FWHM } from '@/lib/xrd-instruments'
import { getCapability } from '@/lib/pro-capabilities'
import { exportArtifactSnapshot, snapshotFilename } from '@/lib/pro-export'
import { TYPO } from '@/lib/typography-inline'
import type { ModuleCtx } from '../../types'
import type { XrdActions } from './actions'
import { XRD_PEAK_COLUMNS } from './DataTabs'

// ─── Popover primitive ────────────────────────────────────────────

function Popover({
  trigger,
  children,
  open,
  onToggle,
  panelWidth = 280,
  panelStyle,
}: {
  trigger: ReactNode
  children: ReactNode
  open: boolean
  onToggle: (next: boolean) => void
  panelWidth?: number
  panelStyle?: CSSProperties
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open || !anchorRef.current) { setPos(null); return }
    const rect = anchorRef.current.getBoundingClientRect()
    // Prefer left-aligned; clamp so the panel stays inside the viewport.
    let left = rect.left
    if (left + panelWidth > window.innerWidth - 8) {
      left = window.innerWidth - panelWidth - 8
    }
    if (left < 8) left = 8
    setPos({ top: rect.bottom + 4, left })
  }, [open, panelWidth])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        anchorRef.current?.contains(t) ||
        panelRef.current?.contains(t)
      ) return
      onToggle(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle(false)
    }
    window.addEventListener('mousedown', onClick, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onClick, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, onToggle])

  return (
    <div ref={anchorRef} style={S.popoverAnchor}>
      {trigger}
      {open && pos && (
        <div
          ref={panelRef}
          style={{
            ...S.popoverPanel,
            width: panelWidth,
            top: pos.top,
            left: pos.left,
            ...panelStyle,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Toolbar button ───────────────────────────────────────────────

function ToolbarBtn({
  label,
  icon,
  loading,
  active,
  onClick,
}: {
  label: string
  icon: ReactNode
  loading?: boolean
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...S.toolBtn,
        ...(active ? S.toolBtnActive : {}),
      }}
      title={label}
    >
      {loading ? <Loader2 size={12} className="pro-progress-spinner" /> : icon}
      <span>{label}</span>
      <ChevronDown size={9} style={{ opacity: 0.5 }} />
    </button>
  )
}

// ─── Menu item ────────────────────────────────────────────────────

function MenuItem({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onClick() }}
      style={{
        ...S.menuItem,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {icon && <span style={{ display: 'flex', width: 14 }}>{icon}</span>}
      {label}
    </button>
  )
}

function MenuDivider() {
  return <div style={S.menuDivider} />
}

function num(v: number | '', fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

// ─── Main toolbar ─────────────────────────────────────────────────

interface Props {
  ctx: ModuleCtx<XrdSubState>
  actions: XrdActions
}

export default function XrdToolbar({ ctx, actions }: Props) {
  const { sub } = ctx
  const [openPanel, setOpenPanel] = useState<string | null>(null)

  const toggle = useCallback(
    (id: string) => setOpenPanel((prev) => (prev === id ? null : id)),
    [],
  )
  const close = useCallback(() => setOpenPanel(null), [])

  const setParams = actions.setParams
  const busy = actions.busy
  const hasElements = sub.params.phaseSearch.elements.trim().length > 0
  const canSearch = hasElements && sub.peaks.length > 0

  return (
    <div style={S.toolbar}>
      {/* ── Detect ── */}
      <Popover
        trigger={
          <ToolbarBtn
            label="Detect"
            icon={<Crosshair size={12} />}
            loading={busy === 'detect-peaks'}
            active={openPanel === 'detect'}
            onClick={() => toggle('detect')}
          />
        }
        open={openPanel === 'detect'}
        onToggle={(v) => (v ? toggle('detect') : close())}
      >
        <div style={S.popoverTitle}>Peak Detection</div>
        <ProRow label="Sensitivity">
          <ProSelect
            value={
              sub.params.peakDetect.prominenceMult <= 0.5
                ? 'high'
                : sub.params.peakDetect.prominenceMult >= 2
                  ? 'low'
                  : 'medium'
            }
            onChange={(v) => {
              const mult = v === 'high' ? 0.3 : v === 'low' ? 3.0 : 1.0
              setParams((p) => ({
                ...p,
                peakDetect: { ...p.peakDetect, prominenceMult: mult },
              }))
            }}
            options={[
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
          />
        </ProRow>
        <ProRow label="Min spacing">
          <ProNumber
            value={sub.params.peakDetect.minSpacing}
            min={0.05}
            max={50}
            step={0.05}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: { ...p.peakDetect, minSpacing: num(v, p.peakDetect.minSpacing) },
              }))
            }
            width={64}
          />
          <span style={S.unit}>°</span>
        </ProRow>
        <ProRow label="Top K">
          <ProNumber
            value={sub.params.peakDetect.topK}
            min={1}
            max={100}
            step={1}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                peakDetect: { ...p.peakDetect, topK: num(v, p.peakDetect.topK) },
              }))
            }
            width={52}
          />
        </ProRow>
        <ProSection title="Advanced" defaultOpen={false}>
          <ProRow label="Engine">
            <ProSelect
              value={sub.params.peakDetect.engine}
              onChange={(v) =>
                setParams((p) => ({
                  ...p,
                  peakDetect: {
                    ...p.peakDetect,
                    engine: v as 'scipy' | 'dara',
                  },
                }))
              }
              options={[
                { value: 'scipy', label: 'SciPy' },
                { value: 'dara', label: 'BGMN' },
              ]}
            />
          </ProRow>
          <ProRow label="SNR thresh">
            <ProNumber
              value={sub.params.peakDetect.snr}
              min={0.5}
              max={20}
              step={0.5}
              onChange={(v) =>
                setParams((p) => ({
                  ...p,
                  peakDetect: { ...p.peakDetect, snr: num(v, p.peakDetect.snr) },
                }))
              }
              width={52}
            />
          </ProRow>
          <ProRow label="Background">
            <ProSelect
              value={sub.params.peakDetect.background}
              onChange={(v) =>
                setParams((p) => ({
                  ...p,
                  peakDetect: {
                    ...p.peakDetect,
                    background: v as 'snip' | 'polynomial' | 'none',
                  },
                }))
              }
              options={[
                { value: 'snip', label: 'SNIP' },
                { value: 'polynomial', label: 'Polynomial' },
                { value: 'none', label: 'None' },
              ]}
            />
          </ProRow>
        </ProSection>
        <button
          type="button"
          style={S.runBtn}
          onClick={() => { actions.handleDetectPeaks(); close() }}
          disabled={busy === 'detect-peaks' || !ctx.payload.spectrum}
        >
          {busy === 'detect-peaks' && <Loader2 size={12} className="pro-progress-spinner" />}
          Run Detection
        </button>
      </Popover>

      {/* ── Peaks ── */}
      <Popover
        trigger={
          <ToolbarBtn
            label="Peaks"
            icon={<Activity size={12} />}
            active={openPanel === 'peaks'}
            onClick={() => toggle('peaks')}
          />
        }
        open={openPanel === 'peaks'}
        onToggle={(v) => (v ? toggle('peaks') : close())}
        panelWidth={360}
        panelStyle={{ maxHeight: 520 }}
      >
        <div style={S.popoverTitle}>Manual Peak Editing</div>
        <div style={S.peaksMetaRow}>
          <span style={S.badge}>{sub.peaks.length} peaks</span>
          {sub.peaks.length > 0 && (
            <button
              type="button"
              style={S.inlineBtn}
              onClick={actions.handleClearPeaks}
              title="Clear all detected and manual peaks"
            >
              Clear
            </button>
          )}
        </div>
        <div style={S.peaksTableWrap}>
          <ProPeakTable<XrdProPeak>
            peaks={sub.peaks}
            columns={XRD_PEAK_COLUMNS}
            onEdit={actions.handleUpdatePeak}
            onDelete={actions.handleRemovePeak}
            onAdd={actions.handleAddBlankPeak}
            onFocus={actions.setFocusedPeakIdx}
            emptyMessage="No peaks yet — run detection or add a row below."
            maxRows={12}
          />
        </div>
        <div style={S.peaksHint}>
          Click a value to edit it, drag a peak directly on the chart, or add a manual peak by position and intensity.
        </div>
        <ManualAddPeak onAdd={actions.handleManualAddPeak} />
      </Popover>

      {/* ── Search ── */}
      <Popover
        trigger={
          <ToolbarBtn
            label="Search"
            icon={<Search size={12} />}
            loading={busy === 'xrd-search'}
            active={openPanel === 'search'}
            onClick={() => toggle('search')}
          />
        }
        open={openPanel === 'search'}
        onToggle={(v) => (v ? toggle('search') : close())}
      >
        <div style={S.popoverTitle}>Phase Search</div>
        <ProRow label="Elements">
          <input
            type="text"
            className="pro-text-input is-mono"
            placeholder="Si, O, Fe"
            value={sub.params.phaseSearch.elements}
            onChange={(e) =>
              setParams((p) => ({
                ...p,
                phaseSearch: { ...p.phaseSearch, elements: e.target.value },
              }))
            }
            style={{ flex: 1, minWidth: 0 }}
          />
        </ProRow>
        <ProRow label="Tolerance">
          <ProNumber
            value={sub.params.phaseSearch.tolerance}
            min={0.05}
            max={2}
            step={0.05}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                phaseSearch: { ...p.phaseSearch, tolerance: num(v, p.phaseSearch.tolerance) },
              }))
            }
            width={56}
          />
          <span style={S.unit}>°</span>
        </ProRow>
        <ProRow label="Top K">
          <ProNumber
            value={sub.params.phaseSearch.topK}
            min={3}
            max={100}
            step={1}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                phaseSearch: { ...p.phaseSearch, topK: num(v, p.phaseSearch.topK) },
              }))
            }
            width={52}
          />
        </ProRow>
        <button
          type="button"
          style={S.runBtn}
          onClick={() => { actions.handleSearchDb(); close() }}
          disabled={busy === 'xrd-search' || !canSearch}
          title={
            !hasElements
              ? 'Add element symbols (e.g. "Fe, O") to enable retrieval'
              : !sub.peaks.length
                ? 'Detect or add peaks first'
                : 'Element-subset retrieval + LLM phase identification'
          }
        >
          {busy === 'xrd-search' && <Loader2 size={12} className="pro-progress-spinner" />}
          Search Phases
        </button>
      </Popover>

      {/* ── Refine ── */}
      <Popover
        trigger={
          <ToolbarBtn
            label="Refine"
            icon={<BarChart3 size={12} />}
            loading={busy === 'xrd-refine'}
            active={openPanel === 'refine'}
            onClick={() => toggle('refine')}
          />
        }
        open={openPanel === 'refine'}
        onToggle={(v) => (v ? toggle('refine') : close())}
      >
        <div style={S.popoverTitle}>Whole-Pattern Refinement</div>
        <ProRow label="Wavelength">
          <ProSelect
            value={sub.params.refinement.wavelength}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                refinement: { ...p.refinement, wavelength: v as XrdProPayload['params']['refinement']['wavelength'] },
              }))
            }
            options={[
              { value: 'Cu', label: 'Cu Kα' },
              { value: 'Mo', label: 'Mo Kα' },
              { value: 'Co', label: 'Co Kα' },
              { value: 'Fe', label: 'Fe Kα' },
              { value: 'Cr', label: 'Cr Kα' },
              { value: 'Ag', label: 'Ag Kα' },
            ]}
          />
        </ProRow>
        <ProRow label="2θ range">
          <ProNumber
            value={sub.params.refinement.twoThetaMin}
            min={0}
            max={180}
            step={1}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                refinement: { ...p.refinement, twoThetaMin: num(v, p.refinement.twoThetaMin) },
              }))
            }
            width={48}
          />
          <span style={S.unit}>–</span>
          <ProNumber
            value={sub.params.refinement.twoThetaMax}
            min={0}
            max={180}
            step={1}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                refinement: { ...p.refinement, twoThetaMax: num(v, p.refinement.twoThetaMax) },
              }))
            }
            width={48}
          />
          <span style={S.unit}>°</span>
        </ProRow>
        <ProRow label="Max phases">
          <ProNumber
            value={sub.params.refinement.maxPhases}
            min={1}
            max={6}
            step={1}
            onChange={(v) =>
              setParams((p) => ({
                ...p,
                refinement: { ...p.refinement, maxPhases: num(v, p.refinement.maxPhases) },
              }))
            }
            width={42}
          />
        </ProRow>
        <ProRow label="Instrument">
          <ProSelect
            value={sub.params.refinement.instrumentProfile ?? ''}
            options={INSTRUMENT_PROFILES}
            onChange={(v) =>
              setParams((p) => {
                const lut = DEFAULT_INSTRUMENTAL_FWHM[v]
                return {
                  ...p,
                  refinement: { ...p.refinement, instrumentProfile: v },
                  scherrer:
                    lut != null
                      ? { ...p.scherrer, instrumentalFwhm: lut }
                      : p.scherrer,
                }
              })
            }
          />
        </ProRow>
        <ProRow label="Preset">
          <div style={S.presetRow}>
            {Object.keys(REFINE_PRESETS).map((k) => (
              <button
                key={k}
                type="button"
                style={S.presetChip}
                onClick={() => actions.handleApplyPreset(k)}
              >
                {k}
              </button>
            ))}
          </div>
        </ProRow>
        <ProSection title="BGMN Rietveld" defaultOpen={false}>
          <ProRow label="CIF files">
            <label style={S.fileLabel}>
              Upload CIF…
              <input
                type="file"
                accept=".cif"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) actions.handleAddCif(f)
                  e.target.value = ''
                }}
              />
            </label>
            {(sub.uploadedCifs ?? []).length > 0 && (
              <span style={S.badge}>{sub.uploadedCifs?.length}</span>
            )}
          </ProRow>
        </ProSection>
        <ProRow label="Residuals">
          <input
            type="checkbox"
            checked={sub.params.showResiduals !== false}
            onChange={(e) =>
              setParams((p) => ({ ...p, showResiduals: e.target.checked }))
            }
          />
          <span style={S.checkLabel}>Show Δ overlay</span>
        </ProRow>
        <button
          type="button"
          style={{ ...S.runBtn, ...S.runBtnPrimary }}
          onClick={() => { actions.handleRefine(); close() }}
          disabled={busy === 'xrd-refine'}
        >
          {busy === 'xrd-refine' && <Loader2 size={12} className="pro-progress-spinner" />}
          Run Refine
        </button>
      </Popover>

      {/* ── More ── */}
      <Popover
        trigger={
          <ToolbarBtn
            label=""
            icon={<MoreHorizontal size={13} />}
            active={openPanel === 'more'}
            onClick={() => toggle('more')}
          />
        }
        open={openPanel === 'more'}
        onToggle={(v) => (v ? toggle('more') : close())}
      >
        <MenuItem
          label="Assess Quality"
          icon={<Gauge size={12} />}
          onClick={() => { actions.handleAssessQuality(); close() }}
        />
        <MenuDivider />
        <MenuItem
          label="Load Pattern Overlay…"
          icon={<Layers size={12} />}
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.csv,.tsv,.xy,.dat,.txt,.chi,.uxd,.xrdml,.gsa,.fxye,.cpi,.udf'
            input.onchange = () => {
              const f = input.files?.[0]
              if (f) actions.handleAddPatternOverlay(f)
            }
            input.click()
            close()
          }}
        />
        {(sub.patternOverlays ?? []).length > 0 && (
          <MenuItem
            label={`Clear Overlays (${(sub.patternOverlays ?? []).length})`}
            onClick={() => { actions.handleClearPatternOverlays(); close() }}
          />
        )}
        <MenuDivider />
        <MenuItem
          label="Export PNG"
          icon={<Camera size={12} />}
          onClick={() => {
            const base = snapshotFilename(ctx.artifact, 'xrd').replace(/\.json$/, '')
            actions.chartExporter.download(base, 'png')
            close()
          }}
        />
        <MenuItem
          label="Export CSV"
          icon={<Download size={12} />}
          onClick={() => { actions.handleExportCsv(); close() }}
        />
        <MenuItem
          label="Export CIF"
          icon={<Download size={12} />}
          onClick={() => { actions.handleExportCif(); close() }}
          disabled={!getCapability('xrd-cif-export').available}
        />
        <MenuDivider />
        <MenuItem
          label="Save JSON Snapshot"
          icon={<FileDown size={12} />}
          onClick={() => {
            exportArtifactSnapshot(ctx.artifact, snapshotFilename(ctx.artifact, 'xrd'))
            close()
          }}
        />
        <MenuItem
          label="Save to Session"
          icon={<FileDown size={12} />}
          onClick={() => { actions.handleSnapshot(); close() }}
        />
      </Popover>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────

const S: Record<string, CSSProperties> = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  toolBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    border: '1px solid transparent',
    borderRadius: 4,
    fontSize: TYPO.xs,
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 80ms, border-color 80ms',
  },
  toolBtnActive: {
    background: 'var(--color-bg-active)',
    borderColor: 'var(--color-border)',
  },
  popoverAnchor: {
    position: 'relative',
  },
  popoverPanel: {
    position: 'fixed',
    maxHeight: 420,
    overflowY: 'auto',
    background: 'var(--color-bg-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    padding: '8px 12px',
    zIndex: 1100,
  },
  popoverTitle: {
    padding: '4px 12px 8px',
    fontSize: TYPO.xs,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    borderBottom: '1px solid var(--color-border)',
    marginBottom: 6,
  },
  runBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: 'calc(100% - 24px)',
    margin: '8px 12px 4px',
    padding: '6px 12px',
    background: 'var(--color-bg-active)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: TYPO.xs,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  runBtnPrimary: {
    background: 'var(--color-accent, #555)',
    color: '#fff',
    borderColor: 'transparent',
  },
  unit: {
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
    flexShrink: 0,
  },
  presetRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  presetChip: {
    padding: '2px 8px',
    fontSize: TYPO.xxs,
    background: 'var(--color-bg-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  fileLabel: {
    padding: '2px 8px',
    fontSize: TYPO.xxs,
    background: 'var(--color-bg-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
  },
  badge: {
    fontSize: TYPO.xxs,
    padding: '1px 5px',
    borderRadius: 3,
    background: 'var(--color-bg-active)',
    color: 'var(--color-text-muted)',
  },
  peaksMetaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '2px 12px 8px',
  },
  peaksTableWrap: {
    padding: '0 12px',
  },
  peaksHint: {
    padding: '8px 12px 0',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    lineHeight: 1.4,
  },
  inlineBtn: {
    padding: '3px 8px',
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: TYPO.xxs,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  checkLabel: {
    fontSize: TYPO.xs,
    color: 'var(--color-text-secondary)',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '5px 12px',
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-secondary)',
    fontSize: TYPO.xs,
    fontFamily: 'inherit',
    textAlign: 'left' as const,
    cursor: 'pointer',
  },
  menuDivider: {
    height: 1,
    background: 'var(--color-border)',
    margin: '4px 8px',
  },
}
