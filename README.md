# Lattice

AI-assisted materials-science spectroscopy and crystal structure modeling — a self-contained desktop application.

## What is Lattice?

Lattice is an Electron + React + TypeScript desktop app designed for researchers and engineers working with spectroscopic data (XRD, XPS, Raman, FTIR) and crystal structures. It combines an intelligent agent orchestrator with scientific computing tools to streamline materials characterization workflows.

### Key capabilities

- **Spectral analysis** — peak detection, fitting, phase identification, and refinement for XRD, XPS, Raman, and FTIR data
- **Crystal structure modeling** — interactive 3D visualization and property calculation powered by 3Dmol.js
- **AI agent** — multi-turn LLM orchestrator with 60+ local tools for automated analysis pipelines
- **Compute workbench** — run Python, LAMMPS, and CP2K scripts via a local Docker container or remote SSH target
- **Research assistant** — PDF reading, literature search, RAG-based retrieval, and research report generation

## Architecture

Lattice runs entirely on your machine — no cloud backend required.

| Layer | Description |
|-------|-------------|
| **Electron main** | Window lifecycle, IPC handlers, compute bridge, worker process management |
| **React renderer** | React 19 + Zustand + ECharts + 3Dmol.js — also works in plain Vite mode |
| **Agent orchestrator** | Multi-turn LLM loop that invokes local tools and dispatches events to the UI |
| **Python worker** | Standalone process with ~17 scientific tools, communicating via JSON over stdio |
| **Compute container** | Docker-based execution for Python/LAMMPS/CP2K with session context injection |

## Getting Started

### Prerequisites

- Node.js >= 18
- Python >= 3.10 (for the worker process)
- Docker (optional, for compute workbench)

### Install & Run

```bash
# Install dependencies
npm install

# Download large data assets (~784 MB, one-time)
npm run setup

# Development (renderer only, no Electron shell)
npm run dev

# Development with Electron
npm run electron:dev

# Build for production
npm run build
```

> **Note:** `npm run setup` downloads the Materials Project XRD database from [GitHub Releases](https://github.com/Zhangyu2024-crypto/Lattice/releases/tag/v0.1.0-data) into `worker/data/`. This is required for XRD phase search functionality. The script skips files that already exist, so it's safe to run multiple times.

### Verify

```bash
npm run typecheck   # TypeScript type checking
npm test            # Unit + component + IPC tests
```

## Bundled Data

The app packages scientific reference databases via `electron-builder.yml` `extraResources`:

| Data | Location | Size | Source |
|------|----------|------|--------|
| XPS reference lines & Scofield RSFs | `worker/data/xps_*.json` | ~110 KB | In repo |
| XRD reference patterns | `worker/data/xrd_references.json` | ~28 KB | In repo |
| Raman reference spectra | `worker/data/raman_references.json` | ~54 KB | In repo |
| Materials Project XRD database | `worker/data/mp_xrd_database.db` | ~784 MB | [GitHub Release](https://github.com/Zhangyu2024-crypto/Lattice/releases/tag/v0.1.0-data) |

Large files (> 100 MB) are hosted as GitHub Release assets instead of being tracked in Git. Run `npm run setup` to download them automatically.

## Contributing

We welcome contributions! To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes
4. Push to the branch and open a Pull Request

### Adding collaborators

Repository owner can invite collaborators via **Settings > Collaborators** on GitHub.

Areas where contributions are especially welcome:

- Expanding scientific reference databases
- Improving XPS / XRD / Raman analysis workflows
- Adding tests and smoke checks
- Building new agent tools for materials characterization
- Improving packaged Python environment support

## Authors

- **Zhangyu2024-crypto** — creator and maintainer

## License

All rights reserved. License details to be finalized.

---

*Built for the materials science community.*
