# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Lattice is an Electron + React + TypeScript desktop app for AI-assisted materials-science spectroscopy (XRD / XPS / Raman / FTIR) and crystal structure modeling. It runs **self-contained** — a local agent orchestrator, a Python worker process, and an optional Docker compute container handle all analysis without requiring the legacy `lattice-cli` backend.

The migration roadmap from `lattice-cli` (77 agent tools, 132 REST endpoints, 6 Pro-mode modules) lives in `docs/MIGRATION_PLAN.md`. The self-contained execution plan is in `docs/SELF_CONTAINED_PORT_PLAN_2026-04-13.md`.

## Commands

```bash
npm run dev           # Vite dev server (renderer only, no Electron shell)
npm run electron:dev  # Vite in electron mode — spawns the Electron main process
npm run typecheck     # tsc --noEmit — primary correctness check
npm test              # Vitest (unit + component + IPC). ~5s.
npm run test:watch    # same, watch mode
npm run build         # tsc + vite build + electron-builder → release/
```

Run a single test file: `npm test -- src/lib/agent-tools/compute-tools.test.ts`

Automated gates: `npm run typecheck` + `npm test`. No linter. End-to-end smoke is the human running `npm run dev` — see `docs/TESTING.md` for the three-tier Vitest layout (unit / component / IPC) and mock conventions.

## Architecture

### Execution model (self-contained)

Three local execution paths replace the legacy backend REST calls:

1. **Agent orchestrator** (`src/lib/agent-orchestrator.ts` + `src/lib/agent-orchestrator/`): multi-turn LLM loop that invokes local tools. Sends tool schemas to the LLM, executes tool calls locally, feeds results back. Events are dispatched via `wsClient.dispatch()` so the same TaskTimeline UI works offline.

2. **Python worker** (`worker/main.py` + `worker/tools/`): standalone process spawned by Electron, communicates via newline-delimited JSON over stdio. ~17 scientific tools: `spectrum.detect_peaks`, `xrd.search`, `xrd.refine`, `xps.fit`, `raman.identify`, `paper.read_pdf`, `rag.retrieve`, etc. Called from the renderer via `callWorker()` in `src/lib/worker-client.ts`.

3. **Compute container** (`src/lib/local-pro-compute.ts`): routes Python/LAMMPS/CP2K scripts to a Docker container (`lattice-compute`) via Electron IPC → `docker exec`. Session context (`ACTIVE_CIFS`, `CURRENT_SPECTRUM`, `WORKDIR`) is injected as env vars. Modes: `local` (Docker), `remote` (SSH), `disabled`. Config in `src/stores/compute-config-store.ts`.

The legacy `lattice-cli` backend path (REST + WebSocket) still works when `LATTICE_CLI_PATH` is set but is no longer required.

### Process model
- **Electron main** (`electron/main.ts`): window lifecycle, IPC handlers, compute container bridge, worker process management.
- **Preload** (`electron/preload.ts`): exposes `window.electronAPI`. Typed in `src/types/electron.d.ts`.
- **Renderer** (`src/`): React 19 + Zustand + ECharts + 3Dmol.js. Fully functional in plain Vite mode (no Electron) — `window.electronAPI` is optional and guarded everywhere.

### Store organization

| Store | File | Manages |
|-------|------|---------|
| **runtime-store** | `src/stores/runtime-store.ts` | Sessions, artifacts (30+ kinds), transcript, task steps, focused artifact, conversation mode, approval state. Persisted to IndexedDB. |
| **app-store** | `src/stores/app-store.ts` | Backend connection info (minimal, legacy path). |
| **workspace-store** | `src/stores/workspace-store.ts` | Virtual filesystem index, dirty buffer for streaming writes. |
| **modal-store** | `src/stores/modal-store.ts` | All overlay/modal open state (palette, settings, library, knowledge, compute overlay, creator overlay, artifact overlay, paper reader). Any component can open a modal without prop drilling. |
| **compute-config-store** | `src/stores/compute-config-store.ts` | Docker container config (mode, resources, timeout, SSH target). |

### Agent tool system

~60 tools registered in `src/lib/agent-tools/index.ts` → `LOCAL_TOOL_CATALOG`. Each tool implements `LocalTool` (`src/types/agent-tool.ts`):

- **`trustLevel`**: `safe` | `sandboxed` | `localWrite` | `hostExec` — gates execution approval.
- **`cardMode`**: `silent` | `info` | `review` | `edit` — controls how the tool result renders in the chat. `edit` mode shows an inline editor (registered in `src/components/agent/tool-cards/editor-registry.ts`).
- **`approvalPolicy`**: `require` pauses the orchestrator and waits for user Approve/Reject.

When adding a new tool: create `src/lib/agent-tools/<name>.ts`, add to `LOCAL_TOOL_CATALOG` in `index.ts`. If it needs an inline editor, register in `editor-registry.ts`. If it needs a preview card, register in `src/components/agent/cards/preview-registry.tsx`.

### Slash commands

User-invocable `/cmd` dispatch lives in `src/lib/slash-commands/`. Shape ported from Claude Code's command registry, minus CLI-only concepts. Three command types:
- **`local`** — handler returns text; appended to the transcript as a system message.
- **`overlay`** — handler opens a modal via `modal-store`; may return a `prefill` payload.
- **`prompt`** — handler returns a scaffold string; submitted via `submitAgentPrompt` (default) or delivered to the composer via `dispatchComposerPrefill` when `submit: false`.

The composer's `handleSend` parses `/cmd` at column 0 before any other branch. A command with `paletteGroup` set auto-registers into the Ctrl+Shift+P palette (single source of truth). To add one: drop a file under `src/lib/slash-commands/builtin/<name>.ts` and append to `BUILTIN_COMMANDS`. Skills and plugins have stub loaders for future expansion.

### Artifact system

30+ artifact kinds defined in `src/types/artifact.ts` (`ArtifactKind` union). Key categories:
- **Spectrum analysis**: `spectrum`, `peak-fit`, `xrd-analysis`, `xps-analysis`, `raman-id`
- **Pro workbenches**: `xrd-pro`, `xps-pro`, `raman-pro`, `curve-pro`, `spectrum-pro`
- **Structure**: `structure` (3Dmol.js viewer + ToolSidebar + PropertyPanel)
- **Compute**: `compute` (Python/LAMMPS/CP2K code + execution results)
- **Documents**: `research-report`, `latex-document`, `paper`, `hypothesis`
- **Charts**: `plot` (interactive ECharts)

Artifacts render on the canvas via `src/components/canvas/artifact-body.tsx` → `kind-renderers.tsx` which dispatches each kind to its card component. New artifact kinds must be added to both the `ArtifactKind` union and the kind-renderer dispatch.

### Workspace filesystem

Dual implementation in `src/lib/workspace/fs/`:
- `MemoryWorkspaceFs` — in-memory for Vite dev mode
- `ElectronWorkspaceFs` — real disk access via IPC for production

Artifacts are persisted as JSON envelopes (`src/lib/workspace/envelope.ts`) with `schemaVersion`, `kind`, `payload`, `meta`. The workspace store hydrates on session load and watches for changes.

### Overlay pattern

Three full-screen overlays defined in `App.tsx`, controlled by `modal-store`:
- **CreatorOverlay** — LaTeX document editor
- **ComputeOverlay** — notebook-style compute workbench
- **ArtifactOverlay** — generic artifact viewer (structure 3D, compute code, etc.)

All share the `creator-overlay` CSS class. Opened by any component via `useModalStore.getState().setArtifactOverlay(...)`.

### UI shell (`src/App.tsx`)

VSCode-style layout: `ActivityBar | Sidebar | EditorArea (+ BottomPanel) | ChatPanel`, with `StatusBar` across the bottom. App.tsx owns:
- `activeView` (sidebar view) and `editorTabs` / `activeEditorTab` (MRU tab strip).
- Split between **sidebar views** (`explorer`, `search`, `analysis`, `settings`) and **module tabs** in the editor area. `toggleSidebar` routes view changes — preserve this split when adding new views.
- Heavy modules are `lazy()` imports rendered inside `<LazyPanel>`.
- Keyboard shortcuts (`Ctrl+Shift+P`, `Ctrl+B/L/J/O`) in a single `useEffect`.

Path alias: `@/*` → `src/*` (configured in `tsconfig.json` and `vite.config.ts`).

## Conventions to preserve

- **No new `fetch` calls in components** — go through `useApi` (legacy backend) or agent tools (self-contained).
- **No direct WebSocket access** — subscribe through `useWebSocket` / the store.
- **Guard `window.electronAPI`** with optional chaining; never assume Electron context.
- Module tabs that live in the editor area must be added to *both* the `EditorTab` union and the `isModuleTab` allowlist in `App.tsx`.
- **Font discipline**: only `--font-sans` / `--font-mono` + `--text-*` / `TYPO.*`. Weight cap 600. Use `--font-mono` only for code blocks, terminal output, and editors — never for UI labels or data display.
- **Grayscale design system**: no saturated colors. Reuse `.sidebar-header` / `.session-mini-btn` / `.label-caps`. Buttons cap at 6px border-radius.
- **Agent tools**: prefer `cardMode: 'edit'` with a registered editor for tools that produce editable output. Use `ctx.ui.askUser()` when user input is required mid-execution.

## Working style

- After substantive work: **just run** `npm run typecheck` + `npm test`, then a boot smoke (start the dev server, confirm it boots without errors). Don't ask permission — these are the default close-out.
- When you touch `src/lib/*` or `src/stores/*`, re-run the narrow Vitest suite for that file: `npm test -- <filename>`.
- Don't end responses with "shall I…?" / "want me to…?" / "要不要…?" style questions. If the next step is obvious continuation, just do it.
- Use questions only when there is a real fork: multiple viable approaches, irreversible side-effects, or missing requirements.
- Smoke test scope: verify compile + boot + no startup errors. End-to-end UI clicks require the user — call them out explicitly as "please verify in browser".
- **Post-change functional check**: After any CSS or layout change, boot the app (`npm run dev`) and verify: (1) the composer textarea accepts input, (2) the target feature works, (3) no visible layout regressions. Kill the dev server after verification.
