// Phase 3c · side-effect module: wires bespoke preview resolvers for the
// artifact navigation agent tools (`list_artifacts`, `get_artifact`,
// `focus_artifact`) into the shared preview registry. Imported from
// AgentCard alongside the Phase 3a/3b registrars so the side-effect fires
// exactly once at AgentCard bundle load.

import { registerToolPreview } from '../preview-registry'
import { ListArtifactsPreview } from './ListArtifactsCardPreview'
import { GetArtifactPreview } from './GetArtifactCardPreview'
import { FocusArtifactPreview } from './FocusArtifactCardPreview'

registerToolPreview('list_artifacts', ListArtifactsPreview)
registerToolPreview('get_artifact', GetArtifactPreview)
registerToolPreview('focus_artifact', FocusArtifactPreview)
