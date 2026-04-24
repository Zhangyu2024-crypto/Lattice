// Transform-pipeline handlers for the structure artifact card.
//
// Wraps the CIF transform pipeline in a hook so the main card file
// stays focused on layout + viewer state. The flow is always:
//
//   parseCif(cif) -> run(parsed) -> writeCif(next) -> onPatchPayload
//
// with a toast on either parse failure or transform failure. Each
// transform action opens a parameter dialog in the parent card; the
// parent calls the apply handler with user-chosen params. The custom
// surface handler returns a dedicated apply callback rather than
// dispatching through `handleTransformClick` because it needs the
// dialog's numbers.

import { useCallback } from 'react'
import type {
  StructureArtifactPayload,
  StructureTransform,
  StructureTransformKind,
} from '../../../../types/artifact'
import { toast } from '../../../../stores/toast-store'
import {
  computeFormula,
  computeLatticeParams,
  dope,
  oxygenVacancy,
  parseCif,
  slabHkl,
  supercell,
  writeCif,
  type ParsedCif,
} from '../../../../lib/cif'
import type { TransformRunInput } from './types'

interface Options {
  cif: string
  payload: StructureArtifactPayload
  transforms: StructureTransform[]
  onPatchPayload?: (nextPayload: StructureArtifactPayload) => void
  openSupercellDialog: () => void
  openDopeDialog: () => void
  openVacancyDialog: () => void
  openSurfaceDialog: () => void
}

export function useTransforms({
  cif,
  payload,
  transforms,
  onPatchPayload,
  openSupercellDialog,
  openDopeDialog,
  openVacancyDialog,
  openSurfaceDialog,
}: Options) {
  const applyTransform = useCallback(
    (input: TransformRunInput) => {
      let parsed: ParsedCif
      try {
        parsed = parseCif(cif)
      } catch (err) {
        toast.error(
          `CIF parse failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        )
        return
      }
      let next: ParsedCif
      try {
        next = input.run(parsed)
      } catch (err) {
        toast.error(
          `${input.kind} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        )
        return
      }
      const newCif = writeCif(next)
      const newFormula = computeFormula(next.sites)
      const newLattice = computeLatticeParams(next)
      const newTransform: StructureTransform = {
        id: `xfm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: input.kind,
        params: input.params,
        appliedAt: Date.now(),
        note: input.note,
      }
      const newPayload: StructureArtifactPayload = {
        ...payload,
        cif: newCif,
        formula: newFormula,
        spaceGroup: next.spaceGroup ?? 'P 1',
        latticeParams: newLattice,
        transforms: [...transforms, newTransform],
      }
      onPatchPayload?.(newPayload)
      toast.success(`${input.kind} applied: ${newFormula}`)
    },
    [cif, payload, transforms, onPatchPayload],
  )

  // ---- Parameterized apply handlers (called from dialogs) ----

  const handleSupercellApply = useCallback(
    (opts: { nx: number; ny: number; nz: number }) => {
      applyTransform({
        kind: 'supercell',
        params: { nx: opts.nx, ny: opts.ny, nz: opts.nz },
        note: `${opts.nx}x${opts.ny}x${opts.nz} cell`,
        run: (parsed) => supercell(parsed, opts.nx, opts.ny, opts.nz),
      })
    },
    [applyTransform],
  )

  const handleDopeApply = useCallback(
    (opts: { targetElement: string; dopant: string; fraction: number }) => {
      applyTransform({
        kind: 'dope',
        params: opts,
        note: `${(opts.fraction * 100).toFixed(1)}% ${opts.dopant} on ${opts.targetElement}`,
        run: (parsed) => dope(parsed, opts),
      })
    },
    [applyTransform],
  )

  const handleVacancyApply = useCallback(
    (opts: { element: string; count: number }) => {
      applyTransform({
        kind: 'defect',
        params: { element: opts.element, count: opts.count },
        note: `${opts.count} ${opts.element} vacanc${opts.count > 1 ? 'ies' : 'y'}`,
        run: (parsed) => {
          // Remove `count` atoms of the target element iteratively.
          let current = parsed
          for (let i = 0; i < opts.count; i++) {
            const idx = current.sites.findIndex((s) => s.element === opts.element)
            if (idx < 0) {
              throw new Error(
                `Only ${i} ${opts.element} atoms found (requested ${opts.count})`,
              )
            }
            current = oxygenVacancy(current, { siteIndex: idx })
          }
          return current
        },
      })
    },
    [applyTransform],
  )

  const handleSurfaceApply = useCallback(
    (opts: {
      h: number
      k: number
      l: number
      slabLayers: number
      vacuumAngstrom: number
    }) => {
      applyTransform({
        kind: 'surface',
        params: opts,
        note: `(${opts.h}${opts.k}${opts.l}) slab · ${opts.slabLayers} layers · ${opts.vacuumAngstrom}A vacuum`,
        run: (parsed) => slabHkl(parsed, opts),
      })
    },
    [applyTransform],
  )

  // ---- Routing: transform button click -> open correct dialog ----

  const handleTransformClick = useCallback(
    (id: StructureTransformKind) => {
      if (id === 'supercell') return openSupercellDialog()
      if (id === 'dope') return openDopeDialog()
      if (id === 'defect') return openVacancyDialog()
      if (id === 'surface') return openSurfaceDialog()
    },
    [openSupercellDialog, openDopeDialog, openVacancyDialog, openSurfaceDialog],
  )

  return {
    handleTransformClick,
    handleSupercellApply,
    handleDopeApply,
    handleVacancyApply,
    handleSurfaceApply,
  }
}
