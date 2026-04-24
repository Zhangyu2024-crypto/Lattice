// Phase 3a · side-effect module: wires bespoke preview resolvers for the
// workspace_* agent tools into the shared preview registry. Imported from
// AgentCard (alongside register-spectrum-previews) so the side-effect fires
// exactly once at the AgentCard bundle load.

import { registerToolPreview } from '../preview-registry'
import { WorkspaceReadFilePreview } from './WorkspaceReadFileCardPreview'
import { WorkspaceGrepPreview } from './WorkspaceGrepCardPreview'
import { WorkspaceGlobPreview } from './WorkspaceGlobCardPreview'
import { WorkspaceBashPreview } from './WorkspaceBashCardPreview'
import { PlotSpectrumPreview } from './PlotSpectrumCardPreview'

registerToolPreview('workspace_read_file', WorkspaceReadFilePreview)
registerToolPreview('workspace_grep', WorkspaceGrepPreview)
registerToolPreview('workspace_glob', WorkspaceGlobPreview)
registerToolPreview('workspace_bash', WorkspaceBashPreview)
// plot_spectrum and compare_spectra share the same preview shape
// (WorkspaceWrite-style output with {outputRelPath, format, bytes, ...})
// — one resolver, two registrations.
registerToolPreview('plot_spectrum', PlotSpectrumPreview)
registerToolPreview('compare_spectra', PlotSpectrumPreview)
