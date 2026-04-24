# Testing

Lattice-app runs on a three-tier Vitest stack. `npm test` is the
day-to-day command. Boot smoke (starting Electron and clicking
through) is a human task — we deliberately do not run end-to-end tests
because Playwright-Electron is flaky on WSL2 and the maintenance cost
of a real E2E layer outweighs its benefit for a single-developer
workflow.

## Commands

| Command | Scope | Time |
|---|---|---|
| `npm test` | all three tiers (unit, component, IPC) | ~2 s |
| `npm run test:watch` | same, watch mode | — |
| `npm run test:ui` | Vitest UI (browser) | — |
| `npm run test:coverage` | Vitest + V8 coverage | ~3 s |
| `npm run typecheck` | `tsc --noEmit` — unchanged gate | ~2 s |

## Tier 1 · Unit

Pure functions + Zustand reducers. File naming: `*.test.ts` next to the
module under test.

**Where to put tests:**

- `src/lib/*.test.ts` — parsers (`cif.ts`), template builders
  (`compute-simulate-templates.ts`, `compute-tweak-templates.ts`), agent
  submission gates (`agent-submit.ts`), slug + anchor helpers.
- `src/stores/*.test.ts` — transcript reducers, artifact upsert/patch,
  session lifecycle.
- `src/types/*.test.ts` — anchor / mention helpers that live alongside
  types.

**Conventions:**

- Default env is jsdom. Opt into node env with the first-line pragma:
  `// @vitest-environment node` — use this for pure-algo suites to skip
  jsdom setup (faster, less noisy).
- Reset `useRuntimeStore` / `useLLMConfigStore` / etc. in `beforeEach`
  using `useFoo.setState(initialState)`.
- Mock downstream modules with `vi.mock('./foo', () => ({...}))` at
  top-of-file (declarations are hoisted).

## Tier 2 · Component

React + `@testing-library/react` + jsdom. Test behaviour, not markup
identity.

**Where to put tests:**

- Alongside the component: `Component.test.tsx` next to `Component.tsx`.
- Use `render`, `screen.getByRole(...)`, `fireEvent` / `userEvent`.
  Avoid `getByClassName` — class names churn freely.

**Conventions:**

- `window.electronAPI` is stubbed out in `src/test/setup.ts`; override
  per-test when you need a specific IPC response:
  `window.electronAPI = { ...window.electronAPI, computeRun: vi.fn(...) }`
- Zustand stores: load fixture state directly via `useStore.setState(...)`.
  Don't mock the hook.
- Heavy / WebGL-dependent renderers (3Dmol, CodeMirror) must be
  `vi.mock`'d — jsdom has no WebGL.
- `src/test/setup.ts` polyfills `ResizeObserver`, `matchMedia`, and
  `scrollIntoView`. Need another DOM API? Add it there.

## Tier 3 · IPC / Main

Electron main-process handlers. `vi.mock('electron')` replaces
`ipcMain` / `shell` / `clipboard` with an in-memory registry so the
handler logic can run under node.

**Where to put tests:**

- `electron/*.test.ts`.
- Use the recorded `handlers` Map pattern from
  `electron/ipc-compute-workspace.test.ts` as a template — call
  `registerXxxIpc()` and invoke handlers by name.

**Conventions:**

- Use the node env pragma: `// @vitest-environment node`.
- Real FS calls are fine — use `node:fs/promises.mkdtemp` + a temp dir
  to exercise the actual path-containment + cap logic.
- Always clean up tmp dirs in `afterEach` (`rm -rf`).

## Human smoke

There is no Tier 4 (E2E). After substantive renderer / main-process
changes, run `npm run electron:dev` and click through the affected
flow. The automated stack does not replace this — it supplements it.

## What not to test

- **LLM provider SDKs.** Trust Anthropic / OpenAI.
- **Docker.** Tests mock the container; do not spawn a real
  `lattice-compute` instance.
- **3Dmol / CodeMirror internals.** Black boxes — test at their boundaries.
- **Pixel-perfect layout.** Classes and px values shift too often;
  use ARIA roles + semantic queries instead.

## When to write which tier

| I'm writing… | Write a test at tier |
|---|---|
| Pure function / reducer / helper | **Tier 1** |
| React component behaviour / event handling | **Tier 2** |
| IPC path-escape / cap / error handling | **Tier 3** |
| "App booted + I can click through A→B→C" | **Human smoke** (`npm run electron:dev`) |
| LLM / Docker / 3Dmol output | **Don't** — out of scope |

## Debugging a red test

1. `npm run test:watch -- <filename>` narrows to one file.
2. `console.log(screen.debug())` in a component test prints the rendered
   DOM tree.
