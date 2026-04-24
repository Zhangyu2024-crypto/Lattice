// Atom selection + measurement state for the structure artifact card.
//
// Encapsulates four bits of state that are all driven by atom clicks:
//
//   - `atoms`                → last set delivered from the viewer
//   - `highlightedAtomIndex` → which atom glows / is pinned in the
//                              property panel
//   - `measurements`         → committed distance / angle measurements
//   - `selectionBuffer`      → indices accumulated since the last
//                              committed measurement (2 → distance,
//                              3 → angle, then cleared)
//
// Kept as a hook so the card can wire these to the viewer + tool
// sidebar + property panel without inlining the whole click-and-commit
// state machine. The click handler closes over `atoms` so stale-index
// resolution is always against the latest frame.

import { useCallback, useState } from 'react'
import {
  angle as computeAngle,
  distance as computeDistance,
  genMeasurementId,
} from '../../../../lib/structure/geometry'
import type {
  AtomInfo,
  Measurement,
} from '../structure/StructureViewer'

export interface AtomInteractions {
  atoms: AtomInfo[]
  highlightedAtomIndex: number | null
  measurements: Measurement[]
  selectionBuffer: number[]
  measureMode: boolean

  setHighlightedAtomIndex: (next: number | null) => void

  handleAtomsLoaded: (next: AtomInfo[]) => void
  handleAtomClick: (atom: AtomInfo) => void
  handleToggleMeasureMode: () => void
  handleClearMeasurements: () => void
  handleDeleteMeasurement: (id: string) => void
}

export function useAtomInteractions(): AtomInteractions {
  const [atoms, setAtoms] = useState<AtomInfo[]>([])
  const [highlightedAtomIndex, setHighlightedAtomIndex] = useState<
    number | null
  >(null)
  const [measureMode, setMeasureMode] = useState(false)
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  // Indices accumulated since the last measurement was committed. 2 →
  // distance, 3 → angle (then cleared). Cleared on measureMode toggle
  // so a stale half-selection doesn't leak between sessions.
  const [selectionBuffer, setSelectionBuffer] = useState<number[]>([])

  const handleAtomsLoaded = useCallback((next: AtomInfo[]) => {
    setAtoms(next)
    // Loading a fresh model invalidates indices held in highlight /
    // measurements / selection buffer — clear them so we don't point
    // at stale atoms from the previous structure or replication tier.
    setHighlightedAtomIndex(null)
    setSelectionBuffer([])
    setMeasurements([])
  }, [])

  const handleAtomClick = useCallback(
    (atom: AtomInfo) => {
      if (!measureMode) {
        // Out-of-measure clicks just toggle highlight on the clicked
        // atom and surface its info in the right panel.
        setHighlightedAtomIndex((cur) =>
          cur === atom.index ? null : atom.index,
        )
        return
      }
      // Measure mode: append to buffer, commit a measurement when the
      // buffer reaches 2 (distance) or 3 (angle).
      setSelectionBuffer((buf) => {
        const next = [...buf, atom.index]
        if (next.length === 2) {
          const a = atoms[next[0]]
          const b = atoms[next[1]]
          if (a && b) {
            const m: Measurement = {
              id: genMeasurementId(),
              kind: 'distance',
              atoms: next,
              value: computeDistance(a, b),
            }
            setMeasurements((prev) => [...prev, m])
          }
        } else if (next.length === 3) {
          const [iA, iB, iC] = next
          const a = atoms[iA]
          const b = atoms[iB]
          const c = atoms[iC]
          if (a && b && c) {
            const m: Measurement = {
              id: genMeasurementId(),
              kind: 'angle',
              atoms: next,
              value: computeAngle(a, b, c),
            }
            setMeasurements((prev) => [...prev, m])
          }
          // Reset after 3 — keeps the cycle predictable (1 click, 2
          // clicks = distance, 3 clicks = angle, then clear).
          return []
        }
        return next
      })
      // While measuring we also visually highlight the most-recently
      // clicked atom so the user can see what's in the selection
      // buffer without inferring from the count.
      setHighlightedAtomIndex(atom.index)
    },
    [measureMode, atoms],
  )

  const handleToggleMeasureMode = useCallback(() => {
    setMeasureMode((v) => {
      const next = !v
      // Toggling clears the in-progress buffer (don't want a stale
      // pair carried across mode flips); committed measurements stay.
      if (!next) setSelectionBuffer([])
      return next
    })
  }, [])

  const handleClearMeasurements = useCallback(() => {
    setMeasurements([])
    setSelectionBuffer([])
  }, [])

  const handleDeleteMeasurement = useCallback((id: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return {
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
  }
}
