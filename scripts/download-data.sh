#!/usr/bin/env bash
set -euo pipefail

REPO="Zhangyu2024-crypto/Lattice"
TAG="v0.1.0-data"
BASE_URL="https://github.com/$REPO/releases/download/$TAG"

DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/worker/data"
mkdir -p "$DEST_DIR"

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

echo ""
echo "All data assets are in place."
