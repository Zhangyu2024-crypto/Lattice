// Compute-overlay action handlers for the structure artifact card.
//
// Both "Simulate ▾" and "Export ▾" fan out to the compute overlay bus
// (`openComputeOverlay({ spawnCell: … })`). The only real work is
// building the template cell — which kind, which code, which title —
// and dispatching. Pulled into a hook so the main card file can stay
// focused on viewer + transform state.
//
// The slug derivation is duplicated across both handlers on purpose:
// it mirrors what `buildRunContext` injects into ACTIVE_CIFS, so the
// spawned cell's `load_structure('<slug>')` resolves to this artifact.
// Keep it in sync with `slugForCifKey`'s call site in the backend.

import { useCallback } from 'react'
import type { Artifact } from '../../../../types/artifact'
import { toast } from '../../../../stores/toast-store'
import { openComputeOverlay } from '../../../../lib/compute-overlay-bus'
import { slugForCifKey } from '../../../../lib/local-pro-compute'
import { parseCif } from '../../../../lib/cif'
import {
  buildSimulateTemplate,
  type SimulateKind,
} from '../../../../lib/compute-simulate-templates'
import {
  buildCp2kExportCell,
  buildLammpsExportCell,
} from '../../../../lib/compute-export-templates'
import { downloadTextFile } from '../../../../lib/pro-export'

interface Options {
  artifact: Artifact
  formula: string | undefined
  cif: string
}

export function useComputeActions({ artifact, formula, cif }: Options) {
  /**
   * Simulate ▾ — fires a spawn request over `compute-overlay-bus`. The
   * slug matches what `buildRunContext` injects into ACTIVE_CIFS (same
   * `slugForCifKey` on `artifact.title || formula || artifact.id`) so
   * `load_structure('<slug>')` in the spawned cell hits this structure.
   */
  const handleSimulate = useCallback(
    (kind: SimulateKind) => {
      const slugSource = artifact.title || formula || artifact.id
      const slug = slugForCifKey(slugSource)
      const tmpl = buildSimulateTemplate(kind, {
        slug,
        formula: formula || 'structure',
        parentStructureId: artifact.id,
      })
      openComputeOverlay({
        spawnCell: {
          kind: tmpl.cellKind,
          code: tmpl.code,
          title: tmpl.title,
          provenance: tmpl.provenance,
        },
      })
    },
    [artifact.title, artifact.id, formula],
  )

  /** Export ▾ — grab a runnable file / native engine cell for this
   *  structure. CIF path is the cheapest: the artifact already owns
   *  the CIF text, so we just downloadTextFile it. LAMMPS / CP2K build
   *  a compute cell and dispatch it through the overlay bus (same
   *  plumbing as Simulate ▾). */
  const handleExport = useCallback(
    (kind: 'cif' | 'lammps' | 'cp2k') => {
      const slugSource = artifact.title || formula || artifact.id
      const slug = slugForCifKey(slugSource)
      if (kind === 'cif') {
        const cifText = cif ?? ''
        if (!cifText.trim().startsWith('data_')) {
          toast.error('This structure has no valid CIF text to export.')
          return
        }
        downloadTextFile(`${slug}.cif`, cifText, 'chemical/x-cif')
        toast.success(`Saved ${slug}.cif`)
        return
      }
      let parsed
      try {
        parsed = parseCif(cif)
      } catch (err) {
        toast.error(
          `CIF parse failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        return
      }
      const template =
        kind === 'lammps'
          ? buildLammpsExportCell({
              slug,
              formula: formula || 'structure',
              parentStructureId: artifact.id,
              parsedCif: parsed,
            })
          : buildCp2kExportCell({
              slug,
              formula: formula || 'structure',
              parentStructureId: artifact.id,
              parsedCif: parsed,
            })
      openComputeOverlay({
        spawnCell: {
          kind: template.cellKind,
          code: template.code,
          title: template.title,
          provenance: template.provenance,
        },
      })
    },
    [artifact.title, artifact.id, formula, cif],
  )

  return { handleSimulate, handleExport }
}
