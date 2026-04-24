// Tiny bus for "open the Compute overlay" requests from deep in the tree
// (artifact-body, file-tree editor, agent tool results). App.tsx owns the
// overlay's `open` state and subscribes here; callers just dispatch the
// event without having to thread a prop down through the UI.
//
// Mirrors the shape of `composer-bus.ts`. Kept deliberately narrow — one
// event, one optional payload. Promote to a real pub-sub if the overlay
// grows additional external triggers.

import { useEffect } from 'react'
import type {
  ComputeCellKind,
  ComputeCellProvenance,
} from '../types/artifact'

const EVENT = 'lattice:compute-overlay-open'

export interface OpenComputeOverlayRequest {
  /** Optional cell id to focus on open. Used when a deep-linked click
   *  wants to land on a specific cell (e.g. a tool card that references
   *  a run). Absent → focus whatever the artifact's `focusedCellId` was
   *  last persisted as. */
  focusCellId?: string
  /** If set, the notebook spawns a new cell with this shape right after
   *  the overlay opens (and before the user interacts). One-shot: the
   *  consumer clears the pending spawn after applying it so HMR /
   *  re-renders don't re-create the same cell. Used by
   *  StructureArtifactCard's "Simulate ▾" menu. */
  spawnCell?: {
    kind: ComputeCellKind
    code: string
    title?: string
    provenance?: ComputeCellProvenance
  }
}

export function openComputeOverlay(req: OpenComputeOverlayRequest = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<OpenComputeOverlayRequest>(EVENT, { detail: req }),
  )
}

export function useComputeOverlayListener(
  handler: (req: OpenComputeOverlayRequest) => void,
): void {
  useEffect(() => {
    const onEvent = (e: Event) => {
      const custom = e as CustomEvent<OpenComputeOverlayRequest>
      handler(custom.detail ?? {})
    }
    window.addEventListener(EVENT, onEvent as EventListener)
    return () => {
      window.removeEventListener(EVENT, onEvent as EventListener)
    }
  }, [handler])
}
