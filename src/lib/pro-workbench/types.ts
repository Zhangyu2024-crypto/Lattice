// Shared types for the Pro workbench module.
//
// Kept separate from the factory/defaults so unit tests and lightweight
// consumers (e.g. `ProLauncherMenu`, agent tool metadata) can import the
// type-only surface without pulling in the runtime store.

import type {
  ArtifactId,
  ProWorkbenchSpectrum,
  SpectrumTechnique,
  XrdSubState,
  XpsProPeakDef,
} from '../../types/artifact'

export type ProWorkbenchKind =
  | 'xrd-pro'
  | 'xps-pro'
  | 'raman-pro'
  | 'curve-pro'
  | 'spectrum-pro'
  | 'compute-pro'

export interface InitialXrdState {
  params?: Partial<XrdSubState['params']> & {
    peakDetect?: Partial<XrdSubState['params']['peakDetect']>
    phaseSearch?: Partial<XrdSubState['params']['phaseSearch']>
    refinement?: Partial<XrdSubState['params']['refinement']>
    scherrer?: Partial<XrdSubState['params']['scherrer']>
  }
  peaks?: XrdSubState['peaks']
  uploadedCifs?: XrdSubState['uploadedCifs']
  candidates?: XrdSubState['candidates']
  identification?: XrdSubState['identification']
  refineResult?: XrdSubState['refineResult']
  patternOverlays?: XrdSubState['patternOverlays']
  runHistory?: XrdSubState['runHistory']
}

/** Options accepted by `createProWorkbench`. */
export interface CreateOpts {
  sessionId: string
  kind: ProWorkbenchKind
  title?: string
  spectrum?: ProWorkbenchSpectrum | null
  /**
   * When true (Electron dedicated window), the main canvas keeps its previous
   * focus instead of switching to this workbench tab.
   */
  openInNewWindow?: boolean
  sourceArtifactId?: ArtifactId
  ramanMode?: 'raman' | 'ftir'
  /** spectrum-pro only — which technique to open with. */
  technique?: SpectrumTechnique
  /** xps-pro only — pre-populate the peak-definitions table so the user can
   *  refit an existing XPS analysis artifact without retyping peaks. */
  initialPeaks?: XpsProPeakDef[]
  /** xps-pro only — set the energy window from a source analysis artifact. */
  initialEnergyWindow?: { min: number; max: number }
  /** xrd-pro / spectrum-pro(xrd) only — seed candidates / refine state when
   *  opening the lab from an existing XRD result card. */
  initialXrdState?: InitialXrdState
}
