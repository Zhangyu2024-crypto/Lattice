# Lattice

> AI-powered desktop workspace for materials science — spectroscopy, crystal structure modeling, and computational research, all running locally.

Lattice is an Electron + React + TypeScript application that brings together AI agents, scientific computing, and rich visualization in a single self-contained workspace. Designed for researchers working with XRD / XPS / Raman / FTIR data and crystal structures, it combines an LLM-driven agent orchestrator with a Python scientific worker and a bundled native compute environment (Python + LAMMPS + CP2K + phonopy + BGMN).

---

## Features

### Spectroscopy & analysis
- **XRD** — peak detection, phase identification against the Materials Project database, Rietveld-style refinement, multi-phase fitting
- **XPS** — Shirley/Tougaard background subtraction, peak fitting (Voigt / Gaussian / Lorentzian), charge correction, quantification with Scofield RSFs
- **Raman** — peak detection, baseline correction, library identification
- **FTIR & generic spectra** — parsing, plotting, peak detection, baseline operations

### Crystal structure & computation
- **Interactive 3D viewer** — 3Dmol.js-based structure visualization with editing tools
- **Compute workbench** — author and run Python / LAMMPS / CP2K scripts directly on the host using a bundled conda environment (no Docker required)
- **Materials Project integration** — bundled XRD database (~784 MB) for phase search

### Research & writing
- **AI agent** — multi-turn conversational orchestrator with 60+ local tools, native function-calling via Anthropic SDK
- **Literature** — Crossref / arXiv search, PDF ingestion, RAG-based retrieval over your library
- **Research report** — guided pipeline (outline → draft → refine → cite) producing publication-ready reports
- **LaTeX editor** — in-browser TeX compilation via `busytex` (WASM TeXLive)

### Workspace & sync
- **Virtual filesystem** — project-scoped artifact storage with JSON envelopes, persisted to IndexedDB or disk
- **Sync backends** — WebDAV and rclone for cross-device sharing
- **Bookmarks & sessions** — durable conversation/artifact history

---

## Project Structure

<details>
<summary>Directory tree</summary>

```
Lattice-app/
├── electron/              # Main process: window lifecycle, IPC, native bridges
│   ├── main.ts                 # Entry point — window + handler registration
│   ├── preload.ts              # Exposes window.electronAPI to renderer
│   ├── ipc-compute.ts          # Native compute job bridge (spawn-based)
│   ├── ipc-llm.ts              # LLM proxy + streaming
│   ├── ipc-library.ts          # Paper library
│   ├── ipc-literature.ts       # Crossref / arXiv search
│   ├── ipc-research.ts         # Research pipeline orchestration
│   ├── ipc-mcp.ts              # Model Context Protocol bridge
│   ├── ipc-worker.ts           # Python worker process management
│   ├── ipc-workspace*.ts       # Virtual filesystem IPC
│   ├── ipc-sync.ts             # WebDAV / rclone sync
│   ├── sync/                   # Sync backend implementations
│   ├── compute-runner.ts       # Compute job execution
│   ├── conda-env-manager.ts    # Python environment management
│   ├── python-manager.ts       # Worker bootstrap
│   ├── literature-search.ts    # Crossref/arXiv clients
│   └── crossref-metadata.ts    # Citation metadata
│
├── worker/                # Python JSON-RPC subprocess
│   ├── main.py                 # stdio loop, dispatches tool calls
│   ├── requirements.txt        # numpy, scipy, pymatgen, etc.
│   ├── tools/
│   │   ├── spectrum.py         # Generic spectrum operations
│   │   ├── xrd.py              # XRD analysis & refinement
│   │   ├── xrd_mp_db.py        # Materials Project DB queries
│   │   ├── xps.py              # XPS fitting & quantification
│   │   ├── raman.py            # Raman analysis
│   │   ├── paper.py            # PDF parsing
│   │   ├── rag.py              # RAG retrieval
│   │   ├── library.py          # Local paper library
│   │   ├── cif_db.py           # CIF structure handling
│   │   ├── web.py              # Web fetching
│   │   └── dara_bridge.py      # DARA spectroscopy bridge
│   └── data/                   # Reference databases (JSON + SQLite)
│
├── src/                   # React 19 renderer
│   ├── App.tsx                 # VSCode-style shell layout
│   ├── main.tsx                # Renderer entry
│   │
│   ├── components/             # UI components
│   │   ├── agent/              # Chat panel, composer, tool cards, approvals
│   │   ├── canvas/             # Artifact rendering (30+ kinds)
│   │   │   ├── artifacts/          # Per-kind artifact cards
│   │   │   │   ├── pro/                # Pro workbenches (XRD/XPS/Raman/curve)
│   │   │   │   ├── paper/              # Paper reader tabs
│   │   │   │   └── research-report/    # Research report renderer
│   │   │   └── artifact-body/      # Kind-renderer dispatch
│   │   ├── compute/            # Compute notebook UI
│   │   ├── editor/             # CodeMirror-based file editors
│   │   ├── explorer/           # Workspace file tree
│   │   ├── inspector/          # Property panels
│   │   ├── layout/             # Activity bar, sidebar, status bar, settings modal
│   │   ├── library/            # Paper library modals
│   │   ├── llm/                # Model configuration
│   │   ├── pdf/                # PDF reader
│   │   ├── research/           # Research pipeline UI
│   │   └── ui/                 # Shared primitives
│   │
│   ├── stores/                 # Zustand state (persisted to IndexedDB)
│   │   ├── runtime-store.ts        # Sessions, artifacts, transcript, tasks
│   │   ├── workspace-store.ts      # Virtual filesystem index
│   │   ├── modal-store.ts          # Overlay/modal state
│   │   ├── compute-config-store.ts # Native compute settings (mode, resources, env)
│   │   ├── llm-config-store.ts     # LLM provider settings
│   │   └── …                       # session, library, prefs, etc.
│   │
│   ├── lib/                    # Business logic
│   │   ├── agent-orchestrator.ts   # Multi-turn LLM loop
│   │   ├── agent-orchestrator/     # Approval flow, envelope, helpers
│   │   ├── agent-tools/            # 60+ local tools (LOCAL_TOOL_CATALOG)
│   │   ├── slash-commands/         # /research, /help, /resume, …
│   │   ├── batch-executors/        # Parallel batch jobs
│   │   ├── compute-snippets/       # Built-in compute templates
│   │   ├── workspace/              # Virtual filesystem (memory + Electron)
│   │   ├── parsers/                # Spectrum file format parsers
│   │   └── llm-chat/               # Streaming LLM chat
│   │
│   ├── hooks/                  # Custom React hooks
│   ├── styles/                 # CSS (grayscale design system)
│   └── types/                  # TypeScript declarations
│
├── public/                # Static assets
│   ├── busytex/                # WASM TeXLive for in-browser LaTeX
│   └── fonts/                  # Inter font family
│
├── scripts/               # Tooling & data fetch
│   ├── download-data.sh        # Download large data assets from Releases
│   ├── fetch_mp_cifs.py        # Materials Project CIF fetcher
│   ├── pack-conda-env.sh       # Conda env packaging
│   └── check-bundled-data.mjs  # Bundled data validator
│
├── docs/                  # Architecture & design notes
├── electron-builder.yml   # Electron packaging config
├── vite.config.ts         # Vite + Electron plugin config
├── vitest.config.ts       # Test runner config
└── package.json
```

</details>

---

## Architecture

Lattice runs entirely on your machine in three coordinated processes:

```
┌───────────────────────────┐    IPC     ┌──────────────────────────┐
│  Renderer (React + Vite)  │ ◀────────▶ │  Electron main process   │
│  • UI / Zustand stores    │            │  • Window & lifecycle    │
│  • Agent orchestrator     │            │  • IPC handlers          │
│  • Artifact rendering     │            │  • Worker manager        │
└───────────────────────────┘            │  • Compute runner        │
                                         └────────────┬─────────────┘
                                                      │
                              ┌───────────────────────┴───────────────────────┐
                              │ stdio JSON-RPC                                │ child_process.spawn
                              ▼                                               ▼
              ┌────────────────────────────┐              ┌──────────────────────────────────┐
              │  Python worker             │              │  Native compute env              │
              │  • spectrum, xps, xrd      │              │  • Bundled conda: Python + LAMMPS│
              │  • raman, paper, rag       │              │    + CP2K + phonopy + BGMN       │
              │  • library, cif, web       │              │  • User scripts run on host      │
              └────────────────────────────┘              └──────────────────────────────────┘
```

> Earlier versions (≤ v4) routed compute jobs through a Docker container or SSH-to-remote-Docker. This was removed in v5 in favor of a bundled host-native conda environment, simplifying setup and eliminating the Docker dependency.

### Key abstractions

- **Agent tools** (`src/lib/agent-tools/`) — pluggable tool registry. Each tool declares `trustLevel` (`safe` / `sandboxed` / `localWrite` / `hostExec`), `cardMode` (`silent` / `info` / `review` / `edit`), and an optional approval policy.
- **Artifacts** (`src/types/artifact.ts`) — 30+ typed payloads (spectrum, structure, compute, research-report, paper, etc.) rendered through a kind-dispatch in `kind-renderers.tsx`.
- **Slash commands** (`src/lib/slash-commands/`) — `/research`, `/help`, `/resume` and friends; auto-registered into the command palette.
- **Modal stack** (`src/stores/modal-store.ts`) — single source of truth for all overlays, no prop drilling.

---

## Getting Started

### 1. System requirements

| Tool | Version | Required for |
|------|---------|--------------|
| **Node.js** | ≥ 18 | Renderer + Electron main process |
| **npm** | ≥ 9 | Package manager (bundled with Node) |
| **Python** | ≥ 3.10 | Scientific worker (XRD / XPS / Raman / RAG / PDF) |
| **pip** | latest | Python package manager |
| **conda / mamba** | latest | *(Optional)* Bundle the compute env with LAMMPS / CP2K / phonopy / BGMN |
| **Git LFS** | — | Not required — large data fetched via `npm run setup` |

> **No Docker required.** The compute workbench runs user scripts directly on the host through a bundled conda environment. Docker / SSH execution paths from earlier versions have been removed.

### 2. Clone & install

> **Tip:** use a virtual environment for Python dependencies:
>
> **venv**
> ```bash
> python3 -m venv .venv
> source .venv/bin/activate    # Windows: .venv\Scripts\activate
> pip install -r worker/requirements.txt
> ```
>
> **conda**
> ```bash
> conda create -n lattice python=3.11
> conda activate lattice
> pip install -r worker/requirements.txt
> ```

```bash
# Clone the repository
git clone https://github.com/Zhangyu2024-crypto/Lattice.git
cd Lattice

# Install Node dependencies (React, Electron, ECharts, 3Dmol, etc.)
npm install

# Install Python worker dependencies (numpy, scipy, scikit-learn, pdfplumber, dara-xrd)
pip install -r worker/requirements.txt

# Download large data assets (~784 MB Materials Project XRD database)
npm run setup
```

### 3. Dependency overview

**Node — runtime (`package.json` `dependencies`)**
- `react` 19, `react-dom` — UI framework
- `zustand` — state management
- `echarts`, `echarts-for-react` — charts
- `3dmol`, `three` — 3D structure visualization
- `@anthropic-ai/sdk` — LLM client
- `@modelcontextprotocol/sdk` — MCP integration
- `webdav` — sync backend
- `pdfjs-dist` — PDF rendering
- `codemirror` — in-browser code editor

**Node — dev (`package.json` `devDependencies`)**
- `electron`, `electron-builder` — desktop packaging
- `vite`, `vite-plugin-electron` — bundler
- `vitest`, `@testing-library/react` — test runner
- `typescript`, `tailwindcss` — build tooling

**Python — worker (`worker/requirements.txt`)**
- `numpy ≥ 1.23`, `scipy ≥ 1.10` — numerical computation
- `scikit-learn ≥ 1.3` — TF-IDF / cosine similarity for RAG retrieval
- `pdfplumber ≥ 0.10` — PDF full-text extraction *(optional, gracefully degrades)*
- `dara-xrd ≥ 1.1.0` — BGMN-based Rietveld refinement

### 4. Run

```bash
npm run dev           # Vite dev server only (browser preview, no Electron)
npm run electron:dev  # Full Electron app in dev mode
npm run electron:dev:wsl  # WSL2/WSLg fallback if the Electron window is blank
npm run build         # Production build + electron-builder → release/
```

On WSL2/WSLg, Chromium's GPU process can fail and leave Electron showing only a
blank dark window. `npm run electron:dev:wsl` sets `LATTICE_DISABLE_GPU=1`, which
keeps software rasterization enabled while bypassing the broken GPU path.

### 5. Verify

```bash
npm run typecheck     # tsc --noEmit (primary correctness gate)
npm test              # Vitest (unit + component + IPC, ~5s)
npm run check:data    # Validate bundled scientific databases
```

---

## Bundled Data

| Data | Location | Size | Source |
|------|----------|------|--------|
| XPS reference lines + Scofield RSFs | `worker/data/xps_*.json` | ~110 KB | In repo |
| XRD reference patterns | `worker/data/xrd_references.json` | ~28 KB | In repo |
| Raman reference spectra | `worker/data/raman_references.json` | ~54 KB | In repo |
| Materials Project XRD database | `worker/data/mp_xrd_database.db` | ~784 MB | [Release v0.1.0-data](https://github.com/Zhangyu2024-crypto/Lattice/releases/tag/v0.1.0-data) |

Files larger than 100 MB are hosted as GitHub Release assets and downloaded via `npm run setup`.

---

## Contributing

Areas where contributions are especially welcome:
- New agent tools for materials characterization workflows
- Expanding the bundled reference databases
- Pro-mode workbenches for additional spectroscopy techniques
- Tests, smoke checks, and documentation

## License

All rights reserved. License details to be finalized.

---

*Built for the materials science community.*
