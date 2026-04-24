// StructureArtifactCard — VESTA-style three-pane shell. Owns the
// artifact payload + transform pipeline + AI build modal; delegates the
// 3D scene to `structure/StructureViewer`, the left controls to
// `structure/ToolSidebar`, and the right metadata to
// `structure/PropertyPanel`. Phase A landed the layout. Phase B layered
// in atom click + measurement state, multi-cell visual replicate,
// background / projection / axes / labels / screenshot. Phase C
// (polyhedra) will reuse the same shell — no further structural
// changes anticipated.
//
// Most of the state machine lives in `./structure-card/*`:
//   - useAtomInteractions: atom + measurement click machine
//   - useTransforms:       CIF transform pipeline + quick actions
//   - useComputeActions:   Simulate / Export overlay dispatchers
//   - TransformsRow / UsedInRow: the two pill rows under the shell
// so this file can stay focused on composition + viewer-side chrome.

import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  Artifact,
  StructureArtifactPayload,
} from '../../../types/artifact'
import { toast } from '../../../stores/toast-store'
import { downloadBinary } from '../../../lib/pro-export'
import { chartImageToPdf, dataUrlToBytes } from '../../../lib/chart-pdf'
import {
  computeFormula,
  computeLatticeParams,
  parseCif,
  writeCif,
  type LatticeParams,
} from '../../../lib/cif'
import SurfaceDialog from './SurfaceDialog'
import SupercellDialog from './structure/SupercellDialog'
import DopeDialog from './structure/DopeDialog'
import VacancyDialog from './structure/VacancyDialog'
import EditCifDialog from './structure/EditCifDialog'
import StructureViewer, {
  type ProjectionMode,
  type Replication,
  type StructureStyleMode,
  type StructureViewerHandle,
} from './structure/StructureViewer'
import ToolSidebar from './structure/ToolSidebar'
import PropertyPanel from './structure/PropertyPanel'
import {
  selectActiveSession,
  selectCellsUsingStructure,
  useRuntimeStore,
} from '../../../stores/runtime-store'
import { DEFAULT_REPLICATION } from './structure-card/constants'
import TransformsRow from './structure-card/TransformsRow'
import UsedInRow from './structure-card/UsedInRow'
import { useAtomInteractions } from './structure-card/use-atom-interactions'
import { useTransforms } from './structure-card/use-transforms'
import Resizer from '../../common/Resizer'

interface Props {
  artifact: Artifact
  /** Persist an in-place payload patch after a transform is applied. */
  onPatchPayload?: (nextPayload: StructureArtifactPayload) => void
  className?: string
}

export default function StructureArtifactCard({
  artifact,
  onPatchPayload,
  className,
}: Props) {
  const payload = artifact.payload as unknown as StructureArtifactPayload
  const {
    cif,
    formula,
    spaceGroup,
    latticeParams,
    transforms,
    computedFromArtifactId,
  } = payload

  // -- Resizable pane widths ---------------------------------------------------
  const [leftWidth, setLeftWidth] = useState(184)
  const [rightWidth, setRightWidth] = useState(240)

  // -- Viewer-side state ------------------------------------------------------
  const viewerRef = useRef<StructureViewerHandle | null>(null)
  const [styleMode, setStyleMode] = useState<StructureStyleMode>('ball-stick')
  const [showUnitCell, setShowUnitCell] = useState(true)
  const [autoSpin, setAutoSpin] = useState(false)
  const [backgroundColor, setBackgroundColor] = useState('#1A1A1A')
  const [projection, setProjection] = useState<ProjectionMode>('perspective')
  const [replication, setReplication] = useState<Replication>(DEFAULT_REPLICATION)
  const [showAxes, setShowAxes] = useState(false)
  const [showElementLabels, setShowElementLabels] = useState(false)

  // -- Atom + measurement state machine ---------------------------------------
  const {
    atoms,
    highlightedAtomIndex,
    measurements,
    selectionBuffer,
    measureMode,
    setHighlightedAtomIndex,
    handleAtomsLoaded,
    handleAtomClick,
    handleToggleMeasureMode,
    handleClearMeasurements,
    handleDeleteMeasurement,
  } = useAtomInteractions()

  // -- Modals -----------------------------------------------------------------
  const [surfaceDialogOpen, setSurfaceDialogOpen] = useState(false)
  const [supercellDialogOpen, setSupercellDialogOpen] = useState(false)
  const [dopeDialogOpen, setDopeDialogOpen] = useState(false)
  const [vacancyDialogOpen, setVacancyDialogOpen] = useState(false)
  const [editCifOpen, setEditCifOpen] = useState(false)

  const openSurfaceDialog = useCallback(() => setSurfaceDialogOpen(true), [])
  const closeSurfaceDialog = useCallback(() => setSurfaceDialogOpen(false), [])
  const openSupercellDialog = useCallback(() => setSupercellDialogOpen(true), [])
  const closeSupercellDialog = useCallback(() => setSupercellDialogOpen(false), [])
  const openDopeDialog = useCallback(() => setDopeDialogOpen(true), [])
  const closeDopeDialog = useCallback(() => setDopeDialogOpen(false), [])
  const openVacancyDialog = useCallback(() => setVacancyDialogOpen(true), [])
  const closeVacancyDialog = useCallback(() => setVacancyDialogOpen(false), [])

  const handleExport = useCallback(
    (format: 'png' | 'jpeg' | 'pdf' | 'cif') => {
      const slug = (formula || 'structure').toLowerCase().replace(/[^a-z0-9]+/g, '_')

      if (format === 'cif') {
        const blob = new Blob([cif], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${slug}.cif`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 0)
        toast.success('CIF saved')
        return
      }

      const dataUri = viewerRef.current?.screenshot()
      if (!dataUri) {
        toast.error('Export failed (viewer not ready)')
        return
      }

      if (format === 'pdf') {
        const bytes = dataUrlToBytes(dataUri)
        const blob = chartImageToPdf(bytes, 800, 600, 400, 300)
        downloadBinary(`${slug}.pdf`, blob)
        toast.success('PDF saved')
        return
      }

      if (format === 'jpeg') {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0)
          const jpegUrl = canvas.toDataURL('image/jpeg', 0.92)
          const a = document.createElement('a')
          a.href = jpegUrl
          a.download = `${slug}.jpg`
          a.click()
          toast.success('JPG saved')
        }
        img.src = dataUri
        return
      }

      const a = document.createElement('a')
      a.href = dataUri
      a.download = `${slug}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      toast.success('PNG saved')
    },
    [formula, cif],
  )

  const handleResetView = useCallback(() => {
    viewerRef.current?.resetView()
  }, [])

  // -- Transform pipeline -----------------------------------------------------
  const {
    handleTransformClick,
    handleSupercellApply,
    handleDopeApply,
    handleVacancyApply,
    handleSurfaceApply,
  } = useTransforms({
    cif,
    payload,
    transforms,
    onPatchPayload,
    openSupercellDialog,
    openDopeDialog,
    openVacancyDialog,
    openSurfaceDialog,
  })

  const handleSurfaceDialogApply = useCallback(
    (opts: {
      h: number
      k: number
      l: number
      slabLayers: number
      vacuumAngstrom: number
    }) => {
      handleSurfaceApply(opts)
      closeSurfaceDialog()
    },
    [handleSurfaceApply, closeSurfaceDialog],
  )

  const handleSupercellDialogApply = useCallback(
    (opts: { nx: number; ny: number; nz: number }) => {
      handleSupercellApply(opts)
      closeSupercellDialog()
    },
    [handleSupercellApply, closeSupercellDialog],
  )

  const handleDopeDialogApply = useCallback(
    (opts: { targetElement: string; dopant: string; fraction: number }) => {
      handleDopeApply(opts)
      closeDopeDialog()
    },
    [handleDopeApply, closeDopeDialog],
  )

  const handleVacancyDialogApply = useCallback(
    (opts: { element: string; count: number }) => {
      handleVacancyApply(opts)
      closeVacancyDialog()
    },
    [handleVacancyApply, closeVacancyDialog],
  )

  // -- PropertyPanel edit handlers (CIF-based round-trip) ---------------------

  /** Helper: parse CIF, apply a mutation, write back, patch payload. */
  const patchCif = useCallback(
    (mutate: (parsed: ReturnType<typeof parseCif>) => void) => {
      if (!onPatchPayload) return
      try {
        const parsed = parseCif(cif)
        mutate(parsed)
        const newCif = writeCif(parsed)
        const newFormula = computeFormula(parsed.sites)
        const newLattice = computeLatticeParams(parsed)
        onPatchPayload({
          ...payload,
          cif: newCif,
          formula: newFormula,
          spaceGroup: parsed.spaceGroup ?? 'P 1',
          latticeParams: newLattice,
        })
      } catch (err) {
        toast.error(
          `Edit failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        )
      }
    },
    [cif, payload, onPatchPayload],
  )

  const handleEditLattice = useCallback(
    (key: keyof LatticeParams, value: number) => {
      patchCif((parsed) => {
        parsed.lattice[key] = value
      })
    },
    [patchCif],
  )

  const handleEditAtom = useCallback(
    (index: number, field: 'element' | 'x' | 'y' | 'z', value: string | number) => {
      patchCif((parsed) => {
        const site = parsed.sites[index]
        if (!site) return
        if (field === 'element') {
          site.element = String(value)
          site.label = String(value) + index
        } else if (field === 'x') {
          site.fx = Number(value)
        } else if (field === 'y') {
          site.fy = Number(value)
        } else if (field === 'z') {
          site.fz = Number(value)
        }
      })
    },
    [patchCif],
  )

  const handleDeleteAtom = useCallback(
    (index: number) => {
      patchCif((parsed) => {
        if (index >= 0 && index < parsed.sites.length) {
          parsed.sites.splice(index, 1)
        }
      })
    },
    [patchCif],
  )

  const handleAddAtom = useCallback(
    (element: string, x: number, y: number, z: number) => {
      patchCif((parsed) => {
        parsed.sites.push({
          label: element + parsed.sites.length,
          element,
          fx: x,
          fy: y,
          fz: z,
          occ: 1,
        })
      })
    },
    [patchCif],
  )

  /** "Used in" back-link list — all compute cells in the active
   *  session whose provenance.parentStructureId === this artifact. The
   *  scan is tiny; see selectCellsUsingStructure for the shape. */
  const activeSession = useRuntimeStore(selectActiveSession)
  const usedInCells = useMemo(
    () => selectCellsUsingStructure(activeSession, artifact.id),
    [activeSession, artifact.id],
  )

  const sortedTransforms = useMemo(
    () => [...transforms].sort((a, b) => b.appliedAt - a.appliedAt),
    [transforms],
  )

  // -- Derive available elements for dope / vacancy dialogs -------------------
  const availableElements = useMemo(() => {
    const seen = new Set<string>()
    try {
      const parsed = parseCif(cif)
      for (const s of parsed.sites) seen.add(s.element)
    } catch {
      // Fall back to atoms from the viewer if CIF parse fails.
      for (const a of atoms) seen.add(a.element)
    }
    return Array.from(seen).sort()
  }, [cif, atoms])

  const rootClassName = className
    ? `card-structure-root ${className}`
    : 'card-structure-root'

  return (
    <div className={rootClassName}>
      <div className="card-structure-three-column">
        <div style={{ width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ToolSidebar
          style={styleMode}
          onStyleChange={setStyleMode}
          showUnitCell={showUnitCell}
          onToggleUnitCell={() => setShowUnitCell((v) => !v)}
          replication={replication}
          onReplicationChange={setReplication}
          autoSpin={autoSpin}
          onToggleAutoSpin={() => setAutoSpin((v) => !v)}
          onResetView={handleResetView}
          measureMode={measureMode}
          onToggleMeasureMode={handleToggleMeasureMode}
          onClearMeasurements={handleClearMeasurements}
          measurementCount={measurements.length}
          selectionBufferCount={selectionBuffer.length}
          showElementLabels={showElementLabels}
          onToggleElementLabels={() => setShowElementLabels((v) => !v)}
          backgroundColor={backgroundColor}
          onBackgroundChange={setBackgroundColor}
          projection={projection}
          onProjectionChange={setProjection}
          showAxes={showAxes}
          onToggleAxes={() => setShowAxes((v) => !v)}
          onExport={handleExport}
          onTransformAction={handleTransformClick}
          onEditCif={onPatchPayload ? () => setEditCifOpen(true) : undefined}
        />
        </div>

        <Resizer
          orientation="vertical"
          value={leftWidth}
          onDraft={setLeftWidth}
          onCommit={setLeftWidth}
          min={120}
          max={320}
          resetTo={184}
          label="Left sidebar width"
        />

        <div className="card-structure-viewer-wrap">
          <StructureViewer
            ref={viewerRef}
            cif={cif}
            style={styleMode}
            showUnitCell={showUnitCell}
            autoSpin={autoSpin}
            backgroundColor={backgroundColor}
            projection={projection}
            replication={replication}
            showAxes={showAxes}
            showElementLabels={showElementLabels}
            highlightedAtomIndex={highlightedAtomIndex}
            measurements={measurements}
            onAtomsLoaded={handleAtomsLoaded}
            onAtomClick={handleAtomClick}
          />
        </div>

        <Resizer
          orientation="vertical"
          value={rightWidth}
          onDraft={setRightWidth}
          onCommit={setRightWidth}
          min={160}
          max={400}
          resetTo={240}
          invert
          label="Right panel width"
        />

        <div style={{ width: rightWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <PropertyPanel
          formula={formula}
          spaceGroup={spaceGroup}
          lattice={latticeParams}
          computedFromArtifactId={computedFromArtifactId}
          atoms={atoms}
          highlightedAtomIndex={highlightedAtomIndex}
          onSelectAtom={setHighlightedAtomIndex}
          measurements={measurements}
          onDeleteMeasurement={handleDeleteMeasurement}
          onEditLattice={onPatchPayload ? handleEditLattice : undefined}
          onEditAtom={onPatchPayload ? handleEditAtom : undefined}
          onDeleteAtom={onPatchPayload ? handleDeleteAtom : undefined}
          onAddAtom={onPatchPayload ? handleAddAtom : undefined}
        />
        </div>
      </div>

      <TransformsRow transforms={sortedTransforms} />
      <UsedInRow cells={usedInCells} />

      {surfaceDialogOpen && (
        <SurfaceDialog
          onApply={handleSurfaceDialogApply}
          onClose={closeSurfaceDialog}
        />
      )}

      {supercellDialogOpen && (
        <SupercellDialog
          onApply={handleSupercellDialogApply}
          onClose={closeSupercellDialog}
        />
      )}

      {dopeDialogOpen && (
        <DopeDialog
          availableElements={availableElements}
          onApply={handleDopeDialogApply}
          onClose={closeDopeDialog}
        />
      )}

      {vacancyDialogOpen && (
        <VacancyDialog
          availableElements={availableElements}
          onApply={handleVacancyDialogApply}
          onClose={closeVacancyDialog}
        />
      )}

      {editCifOpen && onPatchPayload && (
        <EditCifDialog
          open={editCifOpen}
          onClose={() => setEditCifOpen(false)}
          payload={payload}
          onSave={(nextPayload) => {
            onPatchPayload(nextPayload)
            toast.success(
              `Structure updated: ${nextPayload.formula} · ${nextPayload.spaceGroup}`,
            )
          }}
        />
      )}
    </div>
  )
}
