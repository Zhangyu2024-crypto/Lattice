// Phase 3b · side-effect module: wires bespoke preview resolvers for the
// literature agent tools into the shared preview registry. Imported from
// AgentCard (alongside register-workspace-previews) so the side-effect
// fires exactly once at the AgentCard bundle load.

import { registerToolPreview } from '../preview-registry'
import { PaperRagAskPreview } from './PaperRagAskCardPreview'
import { LiteratureSearchPreview } from './LiteratureSearchCardPreview'
import { ListPapersPreview } from './ListPapersCardPreview'

registerToolPreview('paper_rag_ask', PaperRagAskPreview)
registerToolPreview('literature_search', LiteratureSearchPreview)
registerToolPreview('list_papers', ListPapersPreview)
