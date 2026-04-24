# AgentCard — preview + editor registries

Phase ε unified the tool-call card and the artifact-preview card into a
single `AgentCard` component. This directory owns three moving parts:

- `AgentCard.tsx` — the shell. Renders the header, body, and action bar.
- `preview-registry.tsx` — per-tool **and** per-artifact-kind preview
  resolvers. Drives the card body.
- `editor-registry.ts` — per-tool inline editor resolvers. Drives the
  editable approval slot (edit-mode only).

## CardMode contract

Every `LocalTool` has an optional `cardMode` field that controls how the
card renders once the tool has finished executing:

| Mode       | Action bar                      | Editor slot     | Orchestrator behaviour                                           |
| ---------- | ------------------------------- | --------------- | ---------------------------------------------------------------- |
| `'info'`   | Dismiss / Expand / Open-WB only | Suppressed      | Loop continues immediately; no gate.                             |
| `'review'` | Approve, Reject, Open-WB        | Suppressed      | Loop pauses on `approvalState: 'pending'`; raw output passes through on approve. |
| `'edit'`   | Approve, Reject, Open-WB        | Registered edit | Loop pauses; the editor's `onChange` payload replaces the raw output on approve. |

Defaults and back-compat:

- Omit `cardMode` and a tool is treated as `'info'`.
- A legacy tool that only sets `approvalPolicy: 'require'` is treated as
  `'edit'` — no per-tool migration required.
- `mode` is re-resolved **per render** from the step's `approvalState`;
  a step that isn't pending always renders as `'info'`, even if the
  catalog entry claims `'edit'`. (See `resolveStepCardMode` in
  `AgentCard.tsx`.)

## Preview resolution — three-tier fallback

The card body comes from `resolveStepPreview(step, artifact)` in
`preview-registry.tsx`:

1. **Tool-specific resolver** registered with `registerToolPreview(...)`
   — wins when the tool has a bespoke preview (e.g. `detect_peaks`,
   `xrd_search_phases`).
2. **Artifact-kind generic** — used when the step attached an artifact
   via `outputMentions` but no tool resolver is registered. This is how
   meta / RAG tools (`literature_search`, `paper_rag_ask`) get a useful
   preview for free when they produce a known artifact kind.
3. **Plain `step.outputSummary`** — last-resort fallback so the header
   never renders empty when the tool reported something.

## Adding a new preview

```tsx
// src/lib/agent-tools/register-<tool>-preview.ts
import { registerToolPreview } from '../../components/agent/cards/preview-registry'

registerToolPreview('my_tool', (step, artifact) => {
  const output = step.output as { summary?: string } | undefined
  return {
    oneLiner: output?.summary,
    compact: artifact ? <MyTinyPreview artifact={artifact} /> : undefined,
  }
})
```

Call the registration module once at app boot (typically from an
aggregator import in `src/lib/agent-tools/index.ts`). The resolver
receives the read-only `TaskStep` plus the primary artifact looked up
from `step.outputMentions`.

## Adding a new editor (edit-mode tools)

```ts
// src/components/agent/tool-cards/MyToolCardEditor.tsx
import type { ToolCardEditor } from './editor-registry'

const MyToolCardEditor: ToolCardEditor = ({ step, onChange }) => {
  // derive local state from `step.output`; call `onChange(editedPayload)`
  // whenever the user tweaks something.
  return <div>…</div>
}
export default MyToolCardEditor
```

```ts
// src/components/agent/tool-cards/editor-registry.ts
import MyToolCardEditor from './MyToolCardEditor'
// …
const REGISTRY: Record<string, ToolCardEditor> = {
  detect_peaks: DetectPeaksCardEditor,
  my_tool: MyToolCardEditor,
}
```

The payload the editor hands to `onChange` becomes `editedOutput` in
`setStepApproval(..., 'approved', editedOutput)` and replaces the raw
tool output in the orchestrator loop. Review-mode tools **must not**
register an editor — the orchestrator ignores `editedOutput` in that
mode, so any editor state would silently drop on the floor.
