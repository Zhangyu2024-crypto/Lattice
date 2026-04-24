// Overlay drawing helpers for the StructureViewer 3Dmol renderer.
//
// These are pure with respect to React state — they take a 3Dmol viewer
// + an OverlayState snapshot and rebuild every overlay object (unit cell,
// axes, element labels, highlight sphere, measurements).
//
// All shapes / labels are cleared first so the caller can freely call
// `rebuildOverlays` on any prop change without accumulating stale
// geometry.

import type { GLViewer } from '3dmol'
import type { AtomInfo, Measurement } from '../StructureViewer'
import { AXIS_ARROWS, OVERLAY_LABEL_STYLE } from './constants'

export interface OverlayState {
  showUnitCell: boolean
  showAxes: boolean
  showElementLabels: boolean
  atoms: AtomInfo[]
  highlightedAtomIndex: number | null
  measurements?: Measurement[]
}

/**
 * Clear all shapes and labels from the viewer, then redraw every overlay
 * based on `state`. The caller must call `viewer.render()` afterwards.
 */
export function rebuildOverlays(viewer: GLViewer, state: OverlayState): void {
  viewer.removeAllShapes()
  viewer.removeAllLabels()

  // ── Unit cell ──────────────────────────────────────────────────────
  if (state.showUnitCell) {
    viewer.addUnitCell()
  }

  // ── Axes ───────────────────────────────────────────────────────────
  if (state.showAxes) {
    for (const [[dx, dy, dz], color, label] of AXIS_ARROWS) {
      const len = 2.5
      viewer.addArrow({
        start: { x: 0, y: 0, z: 0 },
        end: { x: dx * len, y: dy * len, z: dz * len },
        radius: 0.08,
        color,
      })
      viewer.addLabel(label, {
        ...OVERLAY_LABEL_STYLE,
        position: { x: dx * (len + 0.4), y: dy * (len + 0.4), z: dz * (len + 0.4) },
      })
    }
  }

  // ── Element labels ─────────────────────────────────────────────────
  if (state.showElementLabels && state.atoms.length > 0) {
    for (const atom of state.atoms) {
      viewer.addLabel(atom.element, {
        ...OVERLAY_LABEL_STYLE,
        position: { x: atom.x, y: atom.y, z: atom.z },
      })
    }
  }

  // ── Highlight sphere ───────────────────────────────────────────────
  if (
    state.highlightedAtomIndex != null &&
    state.atoms[state.highlightedAtomIndex]
  ) {
    const a = state.atoms[state.highlightedAtomIndex]
    viewer.addSphere({
      center: { x: a.x, y: a.y, z: a.z },
      radius: 0.55,
      color: 'yellow',
      opacity: 0.45,
    })
  }

  // ── Measurements ───────────────────────────────────────────────────
  if (state.measurements && state.measurements.length > 0) {
    for (const m of state.measurements) {
      drawMeasurement(viewer, state.atoms, m)
    }
  }
}

// ── Measurement helpers ──────────────────────────────────────────────

function drawMeasurement(
  viewer: GLViewer,
  atoms: AtomInfo[],
  m: Measurement,
): void {
  if (m.kind === 'distance' && m.atoms.length === 2) {
    const a = atoms[m.atoms[0]]
    const b = atoms[m.atoms[1]]
    if (!a || !b) return

    // Thin cylinder between the two atoms.
    viewer.addCylinder({
      start: { x: a.x, y: a.y, z: a.z },
      end: { x: b.x, y: b.y, z: b.z },
      radius: 0.04,
      color: '#C8C8C8',
      opacity: 0.85,
      fromCap: 'round',
      toCap: 'round',
    })

    // Midpoint label with the distance value.
    viewer.addLabel(`${m.value.toFixed(3)} \u00C5`, {
      ...OVERLAY_LABEL_STYLE,
      fontColor: '#C8C8C8',
      position: {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        z: (a.z + b.z) / 2,
      },
    })
  } else if (m.kind === 'angle' && m.atoms.length === 3) {
    const a = atoms[m.atoms[0]]
    const vertex = atoms[m.atoms[1]]
    const c = atoms[m.atoms[2]]
    if (!a || !vertex || !c) return

    // Two cylinders meeting at the vertex.
    const cylSpec = {
      radius: 0.04,
      color: '#909090',
      opacity: 0.85,
      fromCap: 'round' as const,
      toCap: 'round' as const,
    }
    viewer.addCylinder({
      start: { x: vertex.x, y: vertex.y, z: vertex.z },
      end: { x: a.x, y: a.y, z: a.z },
      ...cylSpec,
    })
    viewer.addCylinder({
      start: { x: vertex.x, y: vertex.y, z: vertex.z },
      end: { x: c.x, y: c.y, z: c.z },
      ...cylSpec,
    })

    // Label at the vertex.
    viewer.addLabel(`${m.value.toFixed(2)}\u00B0`, {
      ...OVERLAY_LABEL_STYLE,
      fontColor: '#909090',
      position: { x: vertex.x, y: vertex.y, z: vertex.z },
    })
  }
}
