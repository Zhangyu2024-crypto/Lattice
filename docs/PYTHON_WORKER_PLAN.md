---
title: Python Worker Plan (Self-contained Port §P4)
status: Draft v0.1
date: 2026-04-14
related:
  - docs/SELF_CONTAINED_PORT_PLAN_2026-04-13.md
  - docs/CHAT_PANEL_REDESIGN.md
---

# Python Worker Plan — Self-contained Port §P4

## 1. Why this exists

P0 / P1 / P2 / P3 finished the **renderer-side** self-contained migration:
LLM, Composer, Compute Pro, Batch, Library and Knowledge surfaces all run
without `lattice-cli`. The remaining gap is the **scientific computation
core** — XRD search / refinement, XPS fitting / quantification, Raman
identification, paper extraction. These are heavy Python algorithms that
can't be ported to TypeScript without rewriting an entire scientific
stack.

P4 is the channel that brings those algorithms back **inside the
repository** as a worker subprocess, so a fresh checkout can run them
without depending on a separate `lattice-cli` checkout on the user's
machine.

## 2. Architectural shape

```
┌─ Electron main ─────────────────────────────┐
│   `electron/worker-manager.ts`              │
│     spawn() / health() / call(method, args) │
│   IPC channels:                             │
│     'worker:call'  → dispatch to Python     │
│     'worker:event' → push from Python       │
└──────────┬──────────────────────────────────┘
           │ stdin/stdout JSON-RPC
┌──────────▼──────────────────────────────────┐
│  `worker/main.py` (bundled in repo)         │
│    JSON-RPC dispatch loop                   │
│    Tools: xrd / xps / raman / paper-extract │
│    Each tool = importable module under      │
│    `worker/tools/<name>.py`                 │
└─────────────────────────────────────────────┘
```

Same renderer surface as P0 / P1 / P2 / P3: a `local-pro-*` facade with
methods that map 1:1 to lattice-cli's REST endpoints; the facade routes
through the worker IPC instead of HTTP.

## 3. Why a worker (not Docker, not REST)

- **Docker** is already used for compute Pro (sandboxed user code). XRD
  / XPS / Raman pipelines are stable code we ship — no sandbox needed,
  and a 50ms cold start beats a fresh container per call.
- **REST** is what we're moving away from. A loopback HTTP server adds
  port allocation, auth tokens, CSP headache (already saw all of these
  with `lattice-cli`).
- **Long-lived subprocess + stdin/stdout JSON-RPC** is what `lattice-
  cli`'s `--standalone` mode does for compute, what JupyterLab / Pyright
  / black do for analogous problems, and is the smallest moving part.

## 4. Bundling Python

Three options, listed by progressively-more-self-contained:

| Approach | Pros | Cons |
|---|---|---|
| `python3` on PATH | zero new infra; matches today's compute path | user must already have Python + scientific deps |
| Per-repo `venv/` checked into git-ignore, populated by a `bootstrap.sh` step | reliable, no external dep version drift | first run is slow (`pip install`) |
| PyOxidizer / Briefcase / `python-build-standalone` shipped inside `release/` | true zero-install for end users | adds 60–100MB to installer; build pipeline gets harder |

**Recommendation for P4-α**: option 1 + a clear "the worker requires
Python ≥ 3.11 with numpy / scipy / scikit-learn" doc. Migrate to option 3
once the worker is feature-complete and a real installer ships.

## 5. JSON-RPC protocol (proposed)

Stdin: one request per line.
```json
{ "id": "<uuid>", "method": "xrd.search", "params": { "x": [...], "y": [...] } }
```

Stdout: one of
```json
{ "id": "<uuid>", "result": { "phases": [...] } }
{ "id": "<uuid>", "error": { "code": "VALIDATION", "message": "..." } }
{ "event": "progress", "id": "<uuid>", "phase": "rietveld", "fraction": 0.42 }
```

`worker-manager.ts` keeps a `Map<id, { resolve, reject }>` and dispatches
incoming lines accordingly. Progress events fan out to subscribed
listeners in the renderer via `wsClient.dispatch` (same channel the
existing batch runner / agent orchestrator already use).

## 6. Migration order

| Phase | Scope | Effort |
|---|---|---|
| **P4-α** | `worker-manager.ts` (spawn, health, JSON-RPC plumbing) + `worker/main.py` skeleton + one `echo` tool. End-to-end ping/pong wired into a hidden Settings panel. | M (~2 days) |
| **P4-β** | Migrate `xrd-search` + `xrd-refine` first (smallest scientific module; ~600 LOC of Python in `lattice_cli/pro/xrd.py`). Wire `useProApi.xrdSearch` / `xrdRefine` to the new worker via a `local-pro-xrd.ts` facade. | L (~3 days) |
| **P4-γ** | XPS (`xps-fit`, `xps-quantify`, `xps-lookup`, `charge-correct`). Largest mathematical surface; will likely need pseudo-Voigt / Tougaard background helpers ported as-is. | L (~4 days) |
| **P4-δ** | Raman identification (`raman-identify`). Depends on a vector store of reference spectra — bundle as data file. | M (~2 days) |
| **P4-ε** | Paper extraction (`paperExtractions`, `paperChains`, `extractSelection`, `saveChains`). This unblocks the Knowledge product (currently `ready: false` per local-pro-knowledge.ts). | XL (~5 days; depends on PDF parser choice) |
| **P4-ζ** | RAG (`askPaper`, `askMulti`). Needs an embedding store + LLM call wiring. | L (~4 days) |
| **P4-η** | DOI metadata fetcher (`addPaperByDoi`). Trivial (Crossref REST), but needs polite request headers + offline cache. | S (~0.5 days) |

Total estimate: ~3 weeks of focused work. None of P4-α through P4-η
block any P0–P3 functionality — they're additive.

## 7. Decision points

- **Q1** Should the worker run as one process or one process per tool?
  One process is simpler and matches lattice-cli; one-per-tool gives
  isolation but multiplies cold-start cost.
- **Q2** Do we ship pre-built reference spectra (RRUFF Raman, XPS BE
  tables) in the repo or fetch them on first run? Pro: shipped is
  reliable. Con: license terms vary by source.
- **Q3** Does the worker also pick up the current Compute Pro Docker
  runner (consolidating two Python channels)? Likely no — Compute Pro
  needs sandboxing (user code), the worker doesn't.

## 8. Out of scope for P4

- Cross-platform Python distribution (option 3 above). Defer to a
  separate "Installer" workstream.
- Re-implementing `lattice-cli`'s state-bridge and SQLite knowledge DB —
  the current `local-pro-library` JSON storage is intentionally simpler.
  When P4-ε ships extractions, store them in `userData/knowledge/` as
  JSON the same way Library does.
- GPU-accelerated routines (Rietveld via PyTorch, etc.). The worker is
  process-isolated; an optional GPU upgrade can land later without
  changing the IPC contract.

## 9. Acceptance gate

A single command starts the worker on a fresh clone:

```bash
npm run dev   # Vite + Electron
# → worker auto-spawns; user sees `XRD Pro` + `XPS Pro` + `Raman Pro`
#   tabs working without LATTICE_CLI_PATH set anywhere.
```

Until P4-α lands, the existing `LATTICE_CLI_PATH`-gated python-manager
remains as the legacy path for users who already have a `lattice-cli`
checkout — see `electron/main.ts:154`.
