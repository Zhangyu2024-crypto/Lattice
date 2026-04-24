// Curated catalog of "featured" scientific / utility Python packages for
// the Compute package manager (PM1). Designed to let new users discover
// domain-appropriate libraries without knowing the exact pip name. Each
// entry is lightweight metadata: name + one-sentence summary + category
// + install spec (may include extras or pins).
//
// Categories are stable — ordering below sets display order. Add new
// packages by appending to FEATURED_PACKAGES; the Categories are
// auto-derived.

export type FeaturedCategory =
  | 'ML & DL'
  | 'Chemistry & Materials'
  | 'Quantum / DFT'
  | 'Visualization'
  | 'Data & Analysis'
  | 'Utilities'

export interface FeaturedPackage {
  /** pip-install spec. May include extras (`name[extras]`) or pins. */
  spec: string
  /** Display name; defaults to `spec` without extras. */
  name: string
  /** One-sentence description shown on the card. */
  summary: string
  category: FeaturedCategory
  /** Optional home page link shown in the detail drawer. */
  homepage?: string
  /** Estimated size of the install (for user expectation, not enforced). */
  size?: 'small' | 'medium' | 'large'
}

export const FEATURED_PACKAGES: FeaturedPackage[] = [
  // ─── ML & DL ──────────────────────────────────────────────────────
  {
    spec: 'torch',
    name: 'PyTorch',
    summary: 'Deep-learning framework with GPU tensor ops and autograd.',
    category: 'ML & DL',
    homepage: 'https://pytorch.org',
    size: 'large',
  },
  {
    spec: 'tensorflow',
    name: 'TensorFlow',
    summary: 'Google\'s ML framework; Keras high-level API included.',
    category: 'ML & DL',
    size: 'large',
  },
  {
    spec: 'transformers',
    name: 'Transformers',
    summary:
      'HuggingFace: pretrained models for NLP, vision, audio.',
    category: 'ML & DL',
    size: 'medium',
  },
  {
    spec: 'scikit-learn',
    name: 'scikit-learn',
    summary: 'Classical ML: regression, classification, clustering.',
    category: 'ML & DL',
    size: 'medium',
  },
  {
    spec: 'xgboost',
    name: 'XGBoost',
    summary: 'Gradient-boosted trees. Fast, tabular-dominant.',
    category: 'ML & DL',
    size: 'medium',
  },
  {
    spec: 'lightgbm',
    name: 'LightGBM',
    summary: 'Microsoft\'s gradient-boosting framework; GPU capable.',
    category: 'ML & DL',
    size: 'medium',
  },
  {
    spec: 'jax[cpu]',
    name: 'JAX',
    summary: 'NumPy on steroids with autodiff + XLA jit.',
    category: 'ML & DL',
    size: 'medium',
  },

  // ─── Chemistry & Materials ───────────────────────────────────────
  {
    spec: 'rdkit',
    name: 'RDKit',
    summary:
      'Cheminformatics toolkit — SMILES, fingerprints, 2D/3D structures.',
    category: 'Chemistry & Materials',
    homepage: 'https://www.rdkit.org/',
    size: 'medium',
  },
  {
    spec: 'pymatgen',
    name: 'pymatgen',
    summary:
      'Materials Project toolkit — crystals, phase diagrams, XRD simulation.',
    category: 'Chemistry & Materials',
    size: 'medium',
  },
  {
    spec: 'ase',
    name: 'ASE',
    summary:
      'Atomic Simulation Environment — atoms, calculators, optimizers.',
    category: 'Chemistry & Materials',
    size: 'small',
  },
  {
    spec: 'mp-api',
    name: 'Materials Project API',
    summary: 'Query Materials Project data from Python.',
    category: 'Chemistry & Materials',
    size: 'small',
  },
  {
    spec: 'openbabel',
    name: 'OpenBabel',
    summary: 'Chemical format conversion + simple 3D ops.',
    category: 'Chemistry & Materials',
    size: 'medium',
  },
  {
    spec: 'MDAnalysis',
    name: 'MDAnalysis',
    summary: 'Analyze molecular dynamics trajectories.',
    category: 'Chemistry & Materials',
    size: 'medium',
  },

  // ─── Quantum / DFT ───────────────────────────────────────────────
  {
    spec: 'pyscf',
    name: 'PySCF',
    summary:
      'Python-based quantum chemistry framework (HF / DFT / post-HF).',
    category: 'Quantum / DFT',
    size: 'large',
  },
  {
    spec: 'phonopy',
    name: 'phonopy',
    summary: 'Phonon dispersion + thermal properties.',
    category: 'Quantum / DFT',
    size: 'small',
  },
  {
    spec: 'qiskit',
    name: 'Qiskit',
    summary: 'IBM quantum computing SDK — circuits, simulators, QPU.',
    category: 'Quantum / DFT',
    size: 'medium',
  },
  {
    spec: 'spglib',
    name: 'spglib',
    summary: 'Crystal symmetry finder (space groups, irreps).',
    category: 'Quantum / DFT',
    size: 'small',
  },

  // ─── Visualization ────────────────────────────────────────────────
  {
    spec: 'matplotlib',
    name: 'matplotlib',
    summary: 'The standard 2D plotting library.',
    category: 'Visualization',
    size: 'small',
  },
  {
    spec: 'plotly',
    name: 'Plotly',
    summary: 'Interactive plots in the browser (renders in notebook).',
    category: 'Visualization',
    size: 'medium',
  },
  {
    spec: 'seaborn',
    name: 'seaborn',
    summary:
      'Statistical visualization on top of matplotlib; nice defaults.',
    category: 'Visualization',
    size: 'small',
  },
  {
    spec: 'bokeh',
    name: 'Bokeh',
    summary: 'Interactive web-ready plots with streaming / dashboards.',
    category: 'Visualization',
    size: 'medium',
  },
  {
    spec: 'altair',
    name: 'Altair',
    summary: 'Declarative plotting via Vega-Lite grammar.',
    category: 'Visualization',
    size: 'small',
  },
  {
    spec: 'py3Dmol',
    name: 'py3Dmol',
    summary: '3D molecular viewer for notebooks.',
    category: 'Visualization',
    size: 'small',
  },

  // ─── Data & Analysis ──────────────────────────────────────────────
  {
    spec: 'pandas',
    name: 'pandas',
    summary: 'Data-frame manipulation; CSV / Excel / SQL.',
    category: 'Data & Analysis',
    size: 'medium',
  },
  {
    spec: 'polars',
    name: 'Polars',
    summary: 'Fast Rust-backed DataFrame; Arrow-native.',
    category: 'Data & Analysis',
    size: 'medium',
  },
  {
    spec: 'pyarrow',
    name: 'PyArrow',
    summary: 'Apache Arrow columnar format + Parquet IO.',
    category: 'Data & Analysis',
    size: 'medium',
  },
  {
    spec: 'duckdb',
    name: 'DuckDB',
    summary: 'Embedded analytics SQL database.',
    category: 'Data & Analysis',
    size: 'small',
  },
  {
    spec: 'statsmodels',
    name: 'statsmodels',
    summary: 'Statistical models, tests, and analysis.',
    category: 'Data & Analysis',
    size: 'medium',
  },
  {
    spec: 'sympy',
    name: 'SymPy',
    summary: 'Symbolic math in Python.',
    category: 'Data & Analysis',
    size: 'small',
  },

  // ─── Utilities ────────────────────────────────────────────────────
  {
    spec: 'tqdm',
    name: 'tqdm',
    summary: 'Smart progress bars for loops / iterators.',
    category: 'Utilities',
    size: 'small',
  },
  {
    spec: 'rich',
    name: 'Rich',
    summary: 'Pretty formatting for terminal output.',
    category: 'Utilities',
    size: 'small',
  },
  {
    spec: 'httpx',
    name: 'httpx',
    summary: 'Modern async HTTP client; requests replacement.',
    category: 'Utilities',
    size: 'small',
  },
  {
    spec: 'pydantic',
    name: 'Pydantic',
    summary: 'Data validation / settings via type hints.',
    category: 'Utilities',
    size: 'small',
  },
  {
    spec: 'ipython',
    name: 'IPython',
    summary: 'Interactive Python REPL with rich features.',
    category: 'Utilities',
    size: 'small',
  },
  {
    spec: 'jupyterlab',
    name: 'JupyterLab',
    summary: 'Web-based notebook IDE.',
    category: 'Utilities',
    size: 'large',
  },
]

/** Categories in declared order (empty ones removed). */
export function featuredCategories(): FeaturedCategory[] {
  const seen = new Set<FeaturedCategory>()
  const out: FeaturedCategory[] = []
  for (const p of FEATURED_PACKAGES) {
    if (seen.has(p.category)) continue
    seen.add(p.category)
    out.push(p.category)
  }
  return out
}

export function featuredByCategory(
  category: FeaturedCategory | 'all',
): FeaturedPackage[] {
  if (category === 'all') return FEATURED_PACKAGES
  return FEATURED_PACKAGES.filter((p) => p.category === category)
}

/** Strip extras / pins from a spec to get the installable package name. */
export function specToName(spec: string): string {
  const idx = spec.search(/[[<>=!~]/)
  return idx === -1 ? spec : spec.slice(0, idx)
}
