// StructureViewer — 3Dmol.js crystal structure renderer.
//
// Props + handle interfaces are consumed by StructureArtifactCard. This
// component owns the imperative viewer handle and the per-prop update
// effects (overlay rebuild, background color, auto-spin) while the heavy
// viewer lifecycle (mount / teardown + model rebuild) is delegated to
// `./structure-viewer/use-viewer-lifecycle.ts`.
//
// Implementation is split across `./structure-viewer/`:
//   - `constants.ts`             — style configs, host style, overlay label style
//   - `helpers.ts`               — overlay builders (unit cell, axes, labels,
//                                  highlight, measurements)
//   - `use-viewer-lifecycle.ts`  — 3Dmol mount / teardown + model rebuild

import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { HOST_STYLE } from './structure-viewer/constants'
import { rebuildOverlays } from './structure-viewer/helpers'
import { useViewerLifecycle } from './structure-viewer/use-viewer-lifecycle'

export type StructureStyleMode = 'stick' | 'ball-stick' | 'sphere'
export type ProjectionMode = 'perspective' | 'orthographic'

export interface AtomInfo {
  /** Stable index used to refer to this atom from measurement state. */
  index: number
  element: string
  /** Cartesian world coordinates. */
  x: number
  y: number
  z: number
}

export interface Measurement {
  id: string
  kind: 'distance' | 'angle'
  /** Indices into the atoms array returned by `onAtomsLoaded`. */
  atoms: number[]
  /** Distance in Angstrom for `kind === 'distance'`, degrees for `'angle'`. */
  value: number
}

export interface Replication {
  nx: number
  ny: number
  nz: number
}

export interface StructureViewerProps {
  cif: string
  style: StructureStyleMode
  showUnitCell: boolean
  autoSpin: boolean
  backgroundColor?: string
  projection?: ProjectionMode
  replication?: Replication
  showAxes?: boolean
  showElementLabels?: boolean
  /** Index (into `onAtomsLoaded` array) of the atom to highlight with a
   *  translucent yellow sphere. Pass `null` to clear. */
  highlightedAtomIndex?: number | null
  /** Measurements to overlay (lines + labels). */
  measurements?: Measurement[]
  /** Fired once after each model load. The shell uses this to populate
   *  the Atoms tab and to look up cartesian coords by index. */
  onAtomsLoaded?: (atoms: AtomInfo[]) => void
  /** Fired on every atom click. The shell decides what to do (open info,
   *  push into measurement selection buffer, etc.). */
  onAtomClick?: (atom: AtomInfo) => void
}

export interface StructureViewerHandle {
  resetView(): void
  screenshot(): string | null
  rerender(): void
}

const StructureViewer = forwardRef<
  StructureViewerHandle,
  StructureViewerProps
>(function StructureViewer(props, ref) {
  const {
    cif,
    style,
    showUnitCell,
    autoSpin,
    backgroundColor = '#1A1A1A',
    projection: _projection,
    replication,
    showAxes = false,
    showElementLabels = false,
    highlightedAtomIndex = null,
    measurements,
    onAtomsLoaded,
    onAtomClick,
  } = props

  // Owns the host div + 3Dmol viewer ref + last-loaded atoms array.
  const { hostRef, viewerRef, atomsRef, loading, error } = useViewerLifecycle({
    cif,
    style,
    backgroundColor,
    replication,
    showUnitCell,
    showAxes,
    showElementLabels,
    highlightedAtomIndex,
    measurements,
    onAtomsLoaded,
    onAtomClick,
  })

  // ── Overlay rebuild ────────────────────────────────────────────────
  //
  // Single shared effect for every overlay we draw. Cheaper to rebuild
  // all overlays on any change than to maintain individual handles.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    rebuildOverlays(viewer, {
      showUnitCell,
      showAxes,
      showElementLabels,
      atoms: atomsRef.current,
      highlightedAtomIndex,
      measurements,
    })
    viewer.render()
  }, [
    showUnitCell,
    showAxes,
    showElementLabels,
    highlightedAtomIndex,
    measurements,
    viewerRef,
    atomsRef,
  ])

  // ── Background color ───────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.setBackgroundColor(backgroundColor, 1)
  }, [backgroundColor, viewerRef])

  // ── Auto-spin loop ─────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (autoSpin) {
      viewer.spin('y')
    } else {
      viewer.spin(false)
    }
  }, [autoSpin, viewerRef])

  useImperativeHandle(
    ref,
    () => ({
      resetView() {
        const viewer = viewerRef.current
        if (!viewer) return
        viewer.zoomTo()
        viewer.render()
      },
      screenshot() {
        const viewer = viewerRef.current
        if (!viewer) return null
        try {
          return viewer.pngURI()
        } catch {
          return null
        }
      },
      rerender() {
        const viewer = viewerRef.current
        if (!viewer) return
        viewer.render()
      },
    }),
    [viewerRef],
  )

  return (
    <div style={HOST_STYLE}>
      <div ref={hostRef} className="structure-viewer-host" />
      {(loading || error) && (
        <div className="structure-viewer-status" role="status">
          {error ? 'Could not load 3D viewer.' : 'Loading 3D viewer…'}
        </div>
      )}
    </div>
  )
})

export default StructureViewer
