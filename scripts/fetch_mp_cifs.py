"""Batch-download CIF texts from Materials Project and store in the local DB.

Usage:
    python scripts/fetch_mp_cifs.py [--db PATH] [--batch-size 200] [--max-workers 4]

Adds a `cif_text` column to the `materials` table (if absent) and
populates it for every material_id that doesn't already have one.
Uses the MP v2 REST bulk endpoint with pagination to avoid per-material
round-trips. Resumes on restart — only fetches rows where `cif_text IS NULL`.

Requires:
    MP_API_KEY env var or --api-key flag.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_DB = str(Path(__file__).resolve().parent.parent / "worker" / "data" / "mp_xrd_database.db")
MP_BASE = "https://api.materialsproject.org"
BATCH_SIZE = 200
MAX_RETRIES = 3
RETRY_DELAY = 5


def ensure_cif_column(db: sqlite3.Connection) -> None:
    cols = {row[1] for row in db.execute("PRAGMA table_info(materials)").fetchall()}
    if "cif_text" not in cols:
        db.execute("ALTER TABLE materials ADD COLUMN cif_text TEXT")
        db.commit()
        print("[schema] Added cif_text column to materials table")


def get_missing_ids(db: sqlite3.Connection, limit: int = 0) -> list[str]:
    q = "SELECT material_id FROM materials WHERE cif_text IS NULL ORDER BY material_id"
    if limit > 0:
        q += f" LIMIT {limit}"
    return [row[0] for row in db.execute(q).fetchall()]


def fetch_cifs_batch(material_ids: list[str], api_key: str) -> dict[str, str]:
    """Fetch CIF texts for a batch of material_ids from MP v2 API."""
    ids_param = ",".join(material_ids)
    url = (
        f"{MP_BASE}/materials/summary/"
        f"?material_ids={ids_param}"
        f"&_fields=material_id,structure"
        f"&_limit={len(material_ids)}"
    )
    req = urllib.request.Request(url, headers={
        "X-API-KEY": api_key,
        "Accept": "application/json",
    })

    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            break
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            if attempt < MAX_RETRIES - 1:
                wait = RETRY_DELAY * (attempt + 1)
                print(f"  [retry] attempt {attempt+1} failed ({exc}), waiting {wait}s…")
                time.sleep(wait)
            else:
                print(f"  [error] batch failed after {MAX_RETRIES} attempts: {exc}")
                return {}

    result: dict[str, str] = {}
    data = body.get("data", [])
    for doc in data:
        mid = doc.get("material_id")
        cif = None
        struct = doc.get("structure")
        if isinstance(struct, dict):
            cif = struct.get("cif")
        if isinstance(struct, str):
            cif = struct
        if mid and isinstance(cif, str) and cif.strip():
            result[mid] = cif
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch CIF texts from Materials Project")
    parser.add_argument("--db", default=DEFAULT_DB, help="Path to mp_xrd_database.db")
    parser.add_argument("--api-key", default=None, help="MP API key (or set MP_API_KEY env)")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("MP_API_KEY")
    if not api_key:
        print("ERROR: Set MP_API_KEY environment variable or pass --api-key")
        sys.exit(1)

    db_path = Path(args.db)
    if not db_path.is_file():
        print(f"ERROR: DB not found at {db_path}")
        sys.exit(1)

    db = sqlite3.connect(str(db_path))
    db.execute("PRAGMA journal_mode=WAL")
    ensure_cif_column(db)

    missing = get_missing_ids(db)
    total = len(missing)
    print(f"[start] {total} materials missing CIF text")

    if args.dry_run:
        print("[dry-run] Would fetch CIFs in batches of", args.batch_size)
        return

    fetched = 0
    failed = 0
    t0 = time.time()

    for i in range(0, total, args.batch_size):
        batch = missing[i : i + args.batch_size]
        cifs = fetch_cifs_batch(batch, api_key)

        if cifs:
            updates = [(cif, mid) for mid, cif in cifs.items()]
            db.executemany("UPDATE materials SET cif_text = ? WHERE material_id = ?", updates)
            db.commit()
            fetched += len(cifs)
            failed += len(batch) - len(cifs)
        else:
            failed += len(batch)

        elapsed = time.time() - t0
        done = i + len(batch)
        rate = done / elapsed if elapsed > 0 else 0
        eta = (total - done) / rate if rate > 0 else 0
        print(
            f"  [{done}/{total}] fetched={fetched} failed={failed} "
            f"rate={rate:.1f}/s ETA={eta/60:.0f}min"
        )

        # Rate limit: ~2 req/s is safe for MP
        time.sleep(0.5)

    elapsed = time.time() - t0
    print(f"\n[done] {fetched} CIFs downloaded, {failed} failed, {elapsed:.0f}s elapsed")
    db.close()


if __name__ == "__main__":
    main()
