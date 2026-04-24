# worker/

Repo-local Python worker. See `src/lib/local-pro-compute.ts` for the
Electron-side IPC bridge.

## Reference databases

| File | Source | Size | Notes |
|---|---|---|---|
| `data/xrd_references.json` | curated common phases | ~28 KB | 41 entries; bundled for zero-config use |
| `data/xps_lines.json` | lattice-cli `xps_binding_energies.json` (NIST SRD 20) | 79 KB | 502 BE entries for `xps.lookup` |
| `data/raman_references.json` | lattice-cli `raman_mineral_db.json` (RRUFF-derived) | 54 KB | 95 minerals with `characteristic_peaks` + `is_primary` weighting |

## Materials Project XRD database (bundled)

`xrd.search` consults a Materials Project SQLite database with
**154,879** phases out of the box. The DB ships as
`data/mp_xrd_database.db` (~784 MB) — that's the reason the packaged
build surfaces a bigger `release/` directory than a pure JS-only
Electron app would. In dev mode it's picked up directly from
`worker/data/`; in a packaged build it's shipped via `extraResources`
under `<app>/resources/worker/data/mp_xrd_database.db`.

Priority of path resolution (see `xrd_mp_db.resolve_db_path`):

1. `params.db_path` (explicit per-call override)
2. `LATTICE_MP_XRD_DB_PATH` env var
3. Bundled file at `worker/data/mp_xrd_database.db`

Override points 1 and 2 let power users swap in a refreshed DB (e.g.
re-exported from the upstream lattice-cli workflow) without replacing
the bundled file. When the user picks a non-Cu wavelength, the worker
falls back to the hand-curated `xrd_references.json` which stores d-
spacings (wavelength-independent) — the MP DB stores 2θ values at Cu Kα
only.

Source: identical to lattice-cli's
`workflow/xrd-phase-id-standalone/data/mp_xrd_database.db`. Refresh /
regen tooling lives in that workflow.

## BGMN Rietveld refinement (optional, external)

`xrd.refine_dara` is a sync HTTP bridge to an external **dara** Rietveld
service (the same one lattice-cli uses). Lattice-app does NOT bundle
BGMN — the user runs their own dara instance (Docker or standalone) and
points the worker at it:

```bash
export DARA_SERVICE_URL=http://localhost:8100
```

The default `xrd.refine` uses a bundled Pseudo-Voigt + cubic-baseline
fit (zero-config, works offline). `xrd.refine_dara` is for users who
need a real BGMN Rietveld fit and have the service available; when the
service is unreachable, the bridge returns `{success: false, error:...,
hint: ...}` and callers fall back to `xrd.refine` for the local fit.

## Dependencies

See `requirements.txt`.
