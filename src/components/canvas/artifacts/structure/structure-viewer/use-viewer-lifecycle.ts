// Lifecycle hook for the 3Dmol crystal structure viewer. Owns the
// mount/teardown effect and the "rebuild model when cif / replication /
// style changes" effect. Extracted from StructureViewer.tsx so the main
// file stays under the size budget.
//
// The hook returns refs that the caller (StructureViewer) needs to wire
// the host div, drive imperative ops (resetView / screenshot / rerender),
// and read the current atoms array.

import * as $3Dmol from '3dmol'
import { useEffect, useRef, type MutableRefObject } from 'react'
import type {
  AtomInfo,
  Measurement,
  Replication,
  StructureStyleMode,
} from '../StructureViewer'
import { STYLE_CONFIGS } from './constants'
import { rebuildOverlays } from './helpers'

/** Props that participate in the initial model load's overlay pass.
 *  These are read via a ref (not deps) so the model-load effect stays
 *  keyed only on cif/replication/style — a separate overlay-rebuild
 *  effect in the caller handles subsequent changes. */
interface OverlayInputs {
  showUnitCell: boolean
  showAxes: boolean
  showElementLabels: boolean
  highlightedAtomIndex: number | null
  measurements?: Measurement[]
}

export interface ViewerLifecycleArgs extends OverlayInputs {
  cif: string
  style: StructureStyleMode
  backgroundColor: string
  replication?: Replication
  onAtomsLoaded?: (atoms: AtomInfo[]) => void
  onAtomClick?: (atom: AtomInfo) => void
}

export interface ViewerLifecycleHandles {
  hostRef: MutableRefObject<HTMLDivElement | null>
  viewerRef: MutableRefObject<$3Dmol.GLViewer | null>
  atomsRef: MutableRefObject<AtomInfo[]>
}

/**
 * Mount a 3Dmol viewer on a host div and rebuild the model whenever the
 * CIF text, style, or replication count changes. Returns the refs the
 * caller needs to wire the host div and to drive imperative ops from
 * other effects / imperative handles.
 */
export function useViewerLifecycle(
  args: ViewerLifecycleArgs,
): ViewerLifecycleHandles {
  const {
    cif,
    style,
    backgroundColor,
    replication,
    onAtomsLoaded,
    onAtomClick,
  } = args

  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<$3Dmol.GLViewer | null>(null)
  const atomsRef = useRef<AtomInfo[]>([])

  // Pin the latest callbacks in refs so the click handler installed once
  // on mount survives parent re-renders that change callback identity.
  const onAtomClickRef = useRef<typeof onAtomClick>(onAtomClick)
  const onAtomsLoadedRef = useRef<typeof onAtomsLoaded>(onAtomsLoaded)
  useEffect(() => { onAtomClickRef.current = onAtomClick }, [onAtomClick])
  useEffect(() => { onAtomsLoadedRef.current = onAtomsLoaded }, [onAtomsLoaded])

  // Pin overlay inputs in a ref so the scene-rebuild effect can read
  // the latest values without retriggering on every label / measurement
  // toggle.
  const overlayInputsRef = useRef<OverlayInputs>({
    showUnitCell: args.showUnitCell,
    showAxes: args.showAxes,
    showElementLabels: args.showElementLabels,
    highlightedAtomIndex: args.highlightedAtomIndex,
    measurements: args.measurements,
  })
  overlayInputsRef.current = {
    showUnitCell: args.showUnitCell,
    showAxes: args.showAxes,
    showElementLabels: args.showElementLabels,
    highlightedAtomIndex: args.highlightedAtomIndex,
    measurements: args.measurements,
  }

  // ── Mount 3Dmol viewer once ──────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const viewer = $3Dmol.createViewer(host, {
      backgroundColor,
    })

    viewerRef.current = viewer
    return () => {
      viewer.clear()
      viewerRef.current = null
    }
    // backgroundColor seeded once; later changes go through the
    // dedicated setBackgroundColor call in the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Rebuild model when cif / style / replication change ──────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // Clear previous model.
    viewer.removeAllModels()

    if (!cif) {
      atomsRef.current = []
      return
    }

    // Add the CIF model.
    viewer.addModel(cif, 'cif')

    // Apply supercell replication if requested.
    const nx = replication?.nx ?? 1
    const ny = replication?.ny ?? 1
    const nz = replication?.nz ?? 1
    if (nx > 1 || ny > 1 || nz > 1) {
      viewer.replicateUnitCell(nx, ny, nz)
    }

    // Apply atom style.
    const styleConfig = STYLE_CONFIGS[style] ?? STYLE_CONFIGS['ball-stick']
    viewer.setStyle({}, styleConfig as $3Dmol.AtomStyleSpec)

    // Extract atom info for click matching and external consumption.
    const rawAtoms = viewer.selectedAtoms({})
    const atoms: AtomInfo[] = rawAtoms.map((raw, i) => ({
      index: i,
      element: raw.elem ?? '?',
      x: raw.x ?? 0,
      y: raw.y ?? 0,
      z: raw.z ?? 0,
    }))
    atomsRef.current = atoms
    onAtomsLoadedRef.current?.(atoms)

    // Set up click handler. Match by coordinate equality to find the
    // AtomInfo corresponding to the 3Dmol AtomSpec.
    viewer.setClickable({}, true, (rawAtom: $3Dmol.AtomSpec) => {
      const match = atomsRef.current.find(
        (a) =>
          a.x === (rawAtom.x ?? 0) &&
          a.y === (rawAtom.y ?? 0) &&
          a.z === (rawAtom.z ?? 0),
      )
      if (match) {
        onAtomClickRef.current?.(match)
      }
    })

    // Rebuild overlays (unit cell, axes, labels, highlight, measurements).
    const overlay = overlayInputsRef.current
    rebuildOverlays(viewer, {
      showUnitCell: overlay.showUnitCell,
      showAxes: overlay.showAxes,
      showElementLabels: overlay.showElementLabels,
      atoms,
      highlightedAtomIndex: overlay.highlightedAtomIndex,
      measurements: overlay.measurements,
    })

    viewer.zoomTo()
    viewer.render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cif, style, replication?.nx, replication?.ny, replication?.nz])

  return { hostRef, viewerRef, atomsRef }
}
