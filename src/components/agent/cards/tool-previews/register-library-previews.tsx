// Side-effect module: wires the library agent-tool preview resolvers
// (currently just `auto_tag_paper`) into the shared preview registry.
// Imported from AgentCard alongside the other register-* files so the
// side-effect fires exactly once at AgentCard bundle load.

import { registerToolPreview } from '../preview-registry'

// ─── auto_tag_paper ───────────────────────────────────────────────────

interface AutoTagOut {
  success?: boolean
  suggestedTags?: string[]
  reasoning?: string
  summary?: string
}

registerToolPreview('auto_tag_paper', (step) => {
  const out = (step.output ?? {}) as AutoTagOut
  if (out.success === false) {
    return { oneLiner: out.summary ?? 'Auto-tag failed' }
  }
  const tags = out.suggestedTags ?? []
  return {
    oneLiner: tags.length > 0
      ? `${tags.length} tag${tags.length === 1 ? '' : 's'}: ${tags.slice(0, 5).join(', ')}`
      : 'No tags suggested',
    compact: out.reasoning,
  }
})
