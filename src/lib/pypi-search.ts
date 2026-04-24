// Renderer-side helper for the install-box autocomplete (PM4).
//
// PyPI retired its public search RPC and the Warehouse JSON API has no
// "search by prefix" endpoint. Two realistic options remain:
//   1. Query the `pypi.org/pypi/<name>/json` endpoint for *exact* name
//      validation (one HTTP round-trip per candidate)
//   2. Maintain a local index of popular names and fuzzy-match locally
//
// We do **both**. The local index gives instant suggestions for the
// common scientific packages; pressing Enter (or selecting a suggestion
// that isn't in the index) triggers a validation fetch against the
// JSON endpoint to surface metadata before install. This keeps the
// flow snappy without a third-party proxy.

import { FEATURED_PACKAGES, specToName } from './compute-featured-packages'

/** Popular scientific / utility PyPI names. Hand-curated so "numpy", "torch",
 *  "rdkit" etc. autocomplete even when the user hasn't opened the Featured
 *  grid yet. Expanded by deduplicating with FEATURED_PACKAGES at module
 *  load. */
const CURATED_NAMES: string[] = [
  'numpy',
  'scipy',
  'matplotlib',
  'pandas',
  'polars',
  'pyarrow',
  'duckdb',
  'scikit-learn',
  'statsmodels',
  'sympy',
  'xgboost',
  'lightgbm',
  'catboost',
  'tensorflow',
  'torch',
  'torchvision',
  'torchaudio',
  'transformers',
  'datasets',
  'accelerate',
  'jax',
  'jaxlib',
  'flax',
  'optax',
  'equinox',
  'pymatgen',
  'ase',
  'spglib',
  'phonopy',
  'mp-api',
  'matminer',
  'openbabel',
  'MDAnalysis',
  'mdtraj',
  'rdkit',
  'pyscf',
  'qiskit',
  'pennylane',
  'networkx',
  'igraph',
  'py3Dmol',
  'nglview',
  'seaborn',
  'plotly',
  'bokeh',
  'altair',
  'pyvista',
  'vispy',
  'ipywidgets',
  'jupyterlab',
  'ipython',
  'notebook',
  'voila',
  'tqdm',
  'rich',
  'typer',
  'click',
  'httpx',
  'requests',
  'aiohttp',
  'pydantic',
  'sqlalchemy',
  'alembic',
  'fastapi',
  'uvicorn',
  'gunicorn',
  'pillow',
  'opencv-python',
  'scikit-image',
  'imageio',
  'h5py',
  'netcdf4',
  'zarr',
  'xarray',
  'biopython',
  'pyopenms',
  'astropy',
  'sunpy',
  'simpy',
  'pymoo',
  'deap',
  'hyperopt',
  'optuna',
  'wandb',
  'mlflow',
  'dvc',
  'joblib',
  'dask',
  'ray',
  'numba',
  'cython',
]

const ALL_NAMES: string[] = (() => {
  const set = new Set<string>()
  for (const name of CURATED_NAMES) set.add(name)
  for (const pkg of FEATURED_PACKAGES) set.add(specToName(pkg.spec))
  return Array.from(set).sort()
})()

export interface SuggestionHit {
  name: string
  /** Higher = more relevant. Prefix match beats substring match. */
  score: number
}

export function searchLocal(query: string, limit = 8): SuggestionHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SuggestionHit[] = []
  for (const name of ALL_NAMES) {
    const lower = name.toLowerCase()
    let score = 0
    if (lower === q) score = 100
    else if (lower.startsWith(q)) score = 80 - Math.max(0, lower.length - q.length)
    else if (lower.includes(q)) score = 40 - Math.max(0, lower.length - q.length)
    if (score > 0) hits.push({ name, score })
  }
  hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length)
  return hits.slice(0, limit)
}

export interface PyPiInfo {
  name: string
  version: string
  summary?: string
  homepage?: string
}

/** Look a name up against PyPI's JSON API. Returns `null` on 404 /
 *  network failure so the caller can just show "not found". */
export async function fetchPypiInfo(name: string): Promise<PyPiInfo | null> {
  try {
    const resp = await fetch(
      `https://pypi.org/pypi/${encodeURIComponent(name.trim())}/json`,
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as {
      info?: {
        name?: string
        version?: string
        summary?: string
        home_page?: string
      }
    }
    const info = data.info
    if (!info) return null
    return {
      name: info.name ?? name,
      version: info.version ?? '?',
      summary: info.summary,
      homepage: info.home_page,
    }
  } catch {
    return null
  }
}
