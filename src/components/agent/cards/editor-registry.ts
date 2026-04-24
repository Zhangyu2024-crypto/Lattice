// Phase ε — per-tool inline editor registry for the unified AgentCard.
//
// Re-exports the Phase-α registry under the new `cards/` namespace so
// AgentCard and future tool contributors have a single import path.
// The underlying file still lives at `../tool-cards/editor-registry.ts`
// to keep the DetectPeaksCardEditor module path stable.

export {
  getToolCardEditor,
  type ToolCardEditor,
  type ToolCardEditorProps,
} from '../tool-cards/editor-registry'
