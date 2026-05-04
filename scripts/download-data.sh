#!/usr/bin/env bash
set -euo pipefail

REPO="Zhangyu2024-crypto/Lattice"
TAG="v0.1.0-data"
BASE_URL="https://github.com/$REPO/releases/download/$TAG"
BUSYTEX_TAG="build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1"
BUSYTEX_BASE_URL="https://github.com/busytex/busytex/releases/download/$BUSYTEX_TAG"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT_DIR/worker/data"
BUSYTEX_DEST_DIR="$ROOT_DIR/public/busytex"
mkdir -p "$DEST_DIR" "$BUSYTEX_DEST_DIR"

download() {
  local name="$1"
  local dest="$DEST_DIR/$name"

  if [ -f "$dest" ]; then
    echo "[skip] $name already exists"
    return
  fi

  echo "[download] $name -> $dest"
  curl -L --fail --progress-bar -o "$dest" "$BASE_URL/$name"
  echo "[done] $name"
}

download "mp_xrd_database.db"

download_busytex() {
  local name="$1"
  local dest="$BUSYTEX_DEST_DIR/$name"

  if [ -f "$dest" ]; then
    echo "[skip] busytex/$name already exists"
    return
  fi

  echo "[download] busytex/$name -> $dest"
  curl -L --fail --progress-bar -o "$dest" "$BUSYTEX_BASE_URL/$name"
  echo "[done] busytex/$name"
}

download_busytex "busytex.wasm"
download_busytex "texlive-basic.data"
download_busytex "ubuntu-texlive-latex-base.data"
download_busytex "ubuntu-texlive-fonts-recommended.data"
download_busytex "ubuntu-texlive-latex-recommended.data"
download_busytex "ubuntu-texlive-latex-extra.data"
download_busytex "ubuntu-texlive-science.data"

echo ""
echo "All data assets are in place."
