#!/usr/bin/env bash
# Pack a conda environment for embedding into the Lattice Electron app.
#
# Usage:
#   ./scripts/pack-conda-env.sh [--platform linux-64|win-64]
#
# Prerequisites:
#   - micromamba (or mamba/conda) on PATH
#   - conda-pack: pip install conda-pack
#
# Output:
#   resources/conda-env/   (ready for electron-builder extraResources)
#
# Run this on each target platform (or in CI with matrix builds).
# The output is NOT committed to git — it's ~800MB unpacked.

set -euo pipefail

ENV_NAME="lattice-compute-env"
PLATFORM="${1:---platform}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$REPO_ROOT/resources/conda-env"

# ─── Create conda environment ─────────────────────────────────────
echo "▸ Creating conda environment: $ENV_NAME"
micromamba create -n "$ENV_NAME" -c conda-forge -y \
  python=3.12 \
  numpy scipy matplotlib pandas scikit-learn \
  pymatgen ase spglib phonopy \
  lammps cp2k \
  pyscf \
  rdkit \
  pdfplumber \
  conda-pack

# pip-only packages (not on conda-forge or need specific versions)
echo "▸ Installing pip packages"
micromamba run -n "$ENV_NAME" pip install --no-cache-dir \
  dara-xrd>=1.1.0 \
  pydantic \
  tqdm

# ─── Pack into tarball ─────────────────────────────────────────────
TARBALL="/tmp/${ENV_NAME}.tar.gz"
echo "▸ Packing environment to $TARBALL"
conda-pack -n "$ENV_NAME" -o "$TARBALL" --ignore-missing-files

# ─── Extract to resources/conda-env/ ──────────────────────────────
echo "▸ Extracting to $OUTPUT_DIR"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
tar -xzf "$TARBALL" -C "$OUTPUT_DIR"

# ─── Run conda-unpack to fix prefixes ─────────────────────────────
echo "▸ Running conda-unpack"
if [[ -f "$OUTPUT_DIR/bin/conda-unpack" ]]; then
  "$OUTPUT_DIR/bin/conda-unpack"
elif [[ -f "$OUTPUT_DIR/Scripts/conda-unpack.exe" ]]; then
  "$OUTPUT_DIR/Scripts/conda-unpack.exe"
fi

# ─── Cleanup ──────────────────────────────────────────────────────
rm -f "$TARBALL"
echo "▸ Done. Conda env at: $OUTPUT_DIR"
echo "  Python: $(ls "$OUTPUT_DIR"/bin/python3 "$OUTPUT_DIR"/python.exe 2>/dev/null | head -1)"
du -sh "$OUTPUT_DIR"
