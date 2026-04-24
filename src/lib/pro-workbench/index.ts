// Helpers for creating and managing Pro workbench artifacts.
//
// A workbench is a distinct ArtifactKind (xrd-pro / xps-pro / raman-pro /
// compute-pro) that carries its own editable params and intermediate state.
// Every entry point into a workbench — command palette, activity bar menu,
// "Open in Workbench" button on a legacy result card, drag-drop — funnels
// through this module to keep artifact creation consistent.
//
// Snapshot flow: when a user finishes a productive run, they can `save as
// snapshot` which clones the workbench's current state into one of the
// read-only result artifacts (xrd-analysis / xps-analysis / raman-id). The
// snapshot is a separate artifact with its own id, so the workbench keeps
// running and the snapshot is immutable.
//
// This file is a barrel: the implementation lives in sibling modules.
// Every import path (`@/lib/pro-workbench`, `../../lib/pro-workbench`,
// etc.) resolves here, so consumers don't need to change when we further
// refactor the internals.

export type { ProWorkbenchKind, CreateOpts } from './types'

export {
  defaultXrdProPayload,
  defaultXpsProPayload,
  defaultRamanProPayload,
  defaultCurveProPayload,
  defaultSpectrumProPayload,
  defaultComputeProPayload,
  curveSubStateFromDefault,
} from './defaults'

export {
  spectrumPayloadToProSpectrum,
  latestSpectrumFromSession,
} from './spectrum'

export { createProWorkbench } from './create'

export { snapshotXrdWorkbench } from './snapshot'

export { openProWorkbenchAndRunCommand } from './run-command'
