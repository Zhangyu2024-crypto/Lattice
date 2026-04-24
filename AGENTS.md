# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React 19 renderer: `components/` for UI, `stores/` for Zustand state, `hooks/` for shared behavior, and `lib/` for parsing, orchestration, and domain logic. `electron/` holds the main-process, preload, IPC, and worker/bootstrap code. `worker/` is the repo-local Python JSON-RPC subprocess used for scientific and metadata tasks. Static assets live in `public/`, packaging resources in `resources/compute-env/`, and longer design notes in `docs/`. Treat `dist/`, `dist-electron/`, `release/`, and `node_modules/` as generated output.

## Build, Test, and Development Commands
`npm run dev` starts the Vite renderer only.
`npm run electron:dev` runs the app in Electron during development.
`npm run typecheck` runs `tsc --noEmit`; this is the primary automated gate.
`npm run build` compiles the renderer and Electron entrypoints, then packages to `release/`.
`pip install -r worker/requirements.txt` installs optional Python worker dependencies.
`python3 -u worker/main.py` smoke-tests the worker protocol manually.

## Coding Style & Naming Conventions
Use TypeScript with `strict` mode and the `@/` path alias for `src/*`. Follow the existing style: 2-space indentation, single quotes, semicolons omitted, and concise comments only where logic is non-obvious. Use `PascalCase` for React components, `camelCase` for functions/hooks, and kebab-case filenames for utility modules such as `compute-run.ts`. Do not add direct `fetch` or WebSocket usage inside components; route REST through shared hooks/store utilities.

## Testing Guidelines
There is no Jest, Vitest, or ESLint setup in this repository. Run `npm run typecheck` after non-trivial changes. For targeted regressions, use the Node smoke scripts in `src/__smoke__/`, for example `npx tsx src/__smoke__/approval-gate-smoke.ts`. Follow the existing `*-smoke.ts` naming pattern and add manual verification notes when UI behavior cannot be covered in Node.

## Commit & Pull Request Guidelines
Git history is not included in this workspace export, so preserve a simple, imperative commit style such as `renderer: guard optional electron API`. Keep commits focused and easy to review. PRs should describe user-visible impact, list verification steps, link relevant docs/issues, and include screenshots or recordings for UI changes. Call out backend dependencies when a change assumes `lattice-cli` behavior outside this repo.
