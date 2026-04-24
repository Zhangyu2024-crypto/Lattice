"""Materials Project XRD phase database adapter.

Port of lattice-cli's `workflow/xrd-phase-id-standalone/src/database.py`.
Queries the ~155k-row `mp_xrd_database.db` SQLite file lattice-cli ships
with its standalone XRD workflow. The DB itself is NOT bundled into the
Electron dist (784 MB) — the user points at a local copy via the
``LATTICE_MP_XRD_DB_PATH`` environment variable or ``params.db_path``.

When the DB is unavailable, `xrd.search` falls back to the small bundled
`xrd_references.json` file so the workflow still works (just with a
thinner phase library). This module only handles the DB-present path.

Schema (reproduced from lattice-cli):
    materials(material_id PK, formula, elements (csv), nelements,
              e_above_hull, crystal_system, space_group, volume, density)
    xrd_peaks(id, material_id FK, two_theta, intensity, hkl)
    material_elements(material_id, element) — lookup-table index
"""

from __future__ import annotations

import math
import os
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class MaterialRecord:
    material_id: str
    formula: str
    elements: list[str]
    peaks: list[tuple[float, float]]  # (two_theta, intensity 0-100)
    crystal_system: str = ""
    space_group: str = ""


_DB_PATH_ENV = "LATTICE_MP_XRD_DB_PATH"
# The bundled SQLite file lives next to the reference JSONs under
# `worker/data/`. In dev that's `<repo>/worker/data/…`; in a packaged
# Electron build the `worker/` dir is shipped via `extraResources` so
# the same relative-to-worker-root path works both places.
_BUNDLED_DB_RELATIVE = "data/mp_xrd_database.db"


def _bundled_db_path() -> Path:
    """Path that the DB occupies when bundled with the app/worker."""
    return Path(__file__).resolve().parent.parent / _BUNDLED_DB_RELATIVE


def resolve_db_path(explicit: str | None = None) -> Path | None:
    """Resolve the MP DB path.

    Priority: explicit arg > `LATTICE_MP_XRD_DB_PATH` env var > bundled
    file under `worker/data/mp_xrd_database.db`. Returns `None` only
    when none of the three produce a readable file.

    Skipping the `.exists()` check for explicit/env-var paths is
    deliberate — it lets callers show a targeted "configured path not
    found" UX instead of silently falling back to the bundled DB.
    """
    candidate = explicit or os.environ.get(_DB_PATH_ENV)
    if candidate:
        return Path(candidate).expanduser()
    bundled = _bundled_db_path()
    if bundled.is_file():
        return bundled
    return None


def is_available(explicit: str | None = None) -> bool:
    """True iff the MP DB file exists and is readable."""
    path = resolve_db_path(explicit)
    if path is None:
        return False
    try:
        return path.is_file()
    except OSError:
        return False


class MaterialDatabase:
    """Read-only, thread-safe wrapper over the MP XRD SQLite file.

    Adapted from lattice-cli's `MaterialDatabase`, narrowed to **pure
    read-only** so the same code works whether the DB lives in a user-
    writable location (dev) or inside a code-signed immutable app
    bundle (packaged macOS / Windows builds). Opening via the SQLite
    `file:<path>?mode=ro&immutable=1` URI form:

      - skips the journal/WAL machinery (no sidecar writes next to the
        DB, which is what crashes packaged builds with "attempt to
        write a readonly database"),
      - lets SQLite aggressively mmap,
      - is explicit about our intent — any stray INSERT from a future
        refactor fails at the API boundary instead of silently landing
        on disk.

    Still thread-safe via a per-thread connection in `_conn`.
    """

    def __init__(self, db_path: str | os.PathLike[str]):
        self.db_path = str(db_path)
        self._local = threading.local()

    def _uri(self) -> str:
        # `immutable=1` tells SQLite "nobody's writing to this file" so
        # it skips WAL/shm creation entirely. Safe for our bundled DB —
        # refresh tooling lives upstream in lattice-cli.
        return f"file:{self.db_path}?mode=ro&immutable=1"

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(
                self._uri(),
                uri=True,
                check_same_thread=False,
                timeout=30,
            )
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA mmap_size=268435456")  # 256 MB
            conn.execute("PRAGMA cache_size=-64000")    # 64 MB
            self._local.conn = conn
        return conn

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            finally:
                self._local.conn = None

    # ── Queries ────────────────────────────────────────────────────────

    def count(self) -> int:
        cur = self._conn().execute("SELECT COUNT(*) FROM materials")
        return int(cur.fetchone()[0])

    def filter_by_elements(self, elements: list[str]) -> list[str]:
        """SQL-level filter: materials whose full element set is a subset
        of ``elements``.

        The earlier anti-join shape (`NOT IN (SELECT ... NOT IN ...)`)
        forced SQLite to scan `material_elements` in the subquery and
        build a temp B-tree for `DISTINCT`, which dominated XRD search
        latency for common systems like Si/O. A grouped HAVING query
        can walk the covering PK index once and evaluate the same subset
        predicate in aggregate form:

          - no element outside the allowed set
          - at least one allowed element present

        On the bundled ~155k-row MP DB this drops the hot-path element
        filter from ~240 ms to ~85 ms for `['Si', 'O']`.
        """
        if not elements:
            return []
        placeholders = ",".join("?" for _ in elements)
        sql = (
            "SELECT material_id "
            "FROM material_elements "
            "GROUP BY material_id "
            f"HAVING SUM(CASE WHEN element NOT IN ({placeholders}) THEN 1 ELSE 0 END) = 0 "
            f"   AND SUM(CASE WHEN element IN ({placeholders}) THEN 1 ELSE 0 END) > 0"
        )
        params = list(elements) + list(elements)
        cur = self._conn().execute(sql, params)
        return [row[0] for row in cur.fetchall()]

    def get_materials_batch(
        self, material_ids: list[str],
    ) -> list[MaterialRecord]:
        """Batch JOIN-loader. Splits around SQLite's ~999 placeholder cap."""
        if not material_ids:
            return []
        conn = self._conn()
        batch_size = 900
        records: dict[str, MaterialRecord] = {}
        for i in range(0, len(material_ids), batch_size):
            batch = material_ids[i : i + batch_size]
            placeholders = ",".join("?" for _ in batch)
            sql = (
                "SELECT m.material_id, m.formula, m.elements, "
                "       m.crystal_system, m.space_group, "
                "       p.two_theta, p.intensity "
                "FROM materials m "
                "LEFT JOIN xrd_peaks p ON m.material_id = p.material_id "
                f"WHERE m.material_id IN ({placeholders}) "
                "ORDER BY m.material_id, p.intensity DESC"
            )
            cur = conn.execute(sql, batch)
            for row in cur:
                mid = row["material_id"]
                if mid not in records:
                    records[mid] = MaterialRecord(
                        material_id=mid,
                        formula=row["formula"],
                        elements=(
                            [e for e in row["elements"].split(",") if e]
                            if row["elements"] else []
                        ),
                        peaks=[],
                        crystal_system=row["crystal_system"] or "",
                        space_group=row["space_group"] or "",
                    )
                if row["two_theta"] is not None:
                    records[mid].peaks.append(
                        (float(row["two_theta"]), float(row["intensity"]))
                    )
        return [records[mid] for mid in material_ids if mid in records]

    def peak_prefilter(
        self,
        candidate_ids: list[str],
        strong_positions: list[float],
        tolerance: float = 0.5,
    ) -> list[str]:
        """SQL-level peak proximity filter — keeps only candidates that have
        at least one peak within ``tolerance`` of any strong experimental
        position. Ported from lattice-cli; cuts ~90 % of candidates before
        the expensive batch-load + scoring step."""
        if not candidate_ids or not strong_positions:
            return candidate_ids
        conn = self._conn()
        peak_clauses = " OR ".join(
            "(xp.two_theta BETWEEN ? AND ?)" for _ in strong_positions
        )
        peak_params: list[float] = []
        for pos in strong_positions:
            peak_params.extend([pos - tolerance, pos + tolerance])
        matched: set[str] = set()
        batch_size = 400
        for i in range(0, len(candidate_ids), batch_size):
            batch = candidate_ids[i : i + batch_size]
            ph = ",".join("?" for _ in batch)
            sql = (
                f"SELECT DISTINCT xp.material_id FROM xrd_peaks xp "
                f"WHERE xp.material_id IN ({ph}) AND ({peak_clauses})"
            )
            for row in conn.execute(sql, batch + peak_params):
                matched.add(row[0])
        return list(matched)

    def get_reference_dicts(
        self,
        material_ids: list[str],
        wavelength_a: float = 1.5406,
    ) -> dict[str, dict[str, Any]]:
        """Load materials from the DB and return dicts compatible with
        ``xrd_references.json`` format (``peaks`` as ``d_A`` +
        ``rel_intensity``, plus lattice params from ``cif_structures``).

        The DB stores peaks as two_theta (generated at Cu Kα). We convert
        back to d-spacing via Bragg's law so the ``refine`` pipeline's
        ``_reference_raw_peaks`` path works unchanged.
        """
        if not material_ids:
            return {}
        conn = self._conn()
        batch_size = 900
        out: dict[str, dict[str, Any]] = {}
        for i in range(0, len(material_ids), batch_size):
            batch = material_ids[i : i + batch_size]
            ph = ",".join("?" for _ in batch)
            sql = (
                "SELECT m.material_id, m.formula, m.elements, "
                "       m.crystal_system, m.space_group, "
                "       c.a, c.b, c.c, c.alpha, c.beta, c.gamma "
                "FROM materials m "
                "LEFT JOIN cif_structures c ON m.material_id = c.material_id "
                f"WHERE m.material_id IN ({ph})"
            )
            for row in conn.execute(sql, batch):
                mid = row["material_id"]
                out[mid] = {
                    "id": mid,
                    "name": row["formula"],
                    "formula": row["formula"],
                    "elements": (
                        [e for e in row["elements"].split(",") if e]
                        if row["elements"] else []
                    ),
                    "space_group": row["space_group"] or "",
                    "crystal_system": row["crystal_system"] or "",
                    "a": row["a"],
                    "b": row["b"],
                    "c": row["c"],
                    "alpha": row["alpha"],
                    "beta": row["beta"],
                    "gamma": row["gamma"],
                    "peaks": [],
                }
            peak_sql = (
                "SELECT material_id, two_theta, intensity, hkl "
                "FROM xrd_peaks "
                f"WHERE material_id IN ({ph}) "
                "ORDER BY material_id, intensity DESC"
            )
            for row in conn.execute(peak_sql, batch):
                mid = row["material_id"]
                if mid not in out:
                    continue
                two_theta = float(row["two_theta"])
                theta_rad = math.radians(two_theta / 2.0)
                sin_val = math.sin(theta_rad)
                if sin_val <= 0:
                    continue
                d_a = wavelength_a / (2.0 * sin_val)
                out[mid]["peaks"].append({
                    "d_A": round(d_a, 4),
                    "rel_intensity": float(row["intensity"]),
                    "hkl": row["hkl"],
                })
        return out

    def get_cif_text(self, material_id: str) -> str | None:
        """Return the CIF text for a single material, or None."""
        row = self._conn().execute(
            "SELECT cif_text FROM cif_structures WHERE material_id = ?",
            (material_id,),
        ).fetchone()
        return row["cif_text"] if row else None

    def search_by_element_subset(
        self, elements: list[str],
    ) -> list[MaterialRecord]:
        """Element filter + batch peak load. Returns subset-matching
        materials with their full peak lists attached."""
        ids = self.filter_by_elements(elements)
        if not ids:
            return []
        return self.get_materials_batch(ids)


# ── Process-level cache so repeated searches reuse the WAL handle ──

_shared_db: MaterialDatabase | None = None
_shared_db_path: str | None = None
_shared_db_lock = threading.Lock()


def get_shared_db(explicit: str | None = None) -> MaterialDatabase | None:
    """Return a process-level shared `MaterialDatabase` or `None`.

    Reopens when the resolved path changes (first call or env-var swap),
    otherwise reuses so WAL + mmap pragmas don't need re-applying on
    every request. Thread-safe.
    """
    global _shared_db, _shared_db_path
    path = resolve_db_path(explicit)
    if path is None:
        return None
    if not path.is_file():
        return None
    with _shared_db_lock:
        path_str = str(path)
        if _shared_db is not None and _shared_db_path == path_str:
            return _shared_db
        if _shared_db is not None:
            try:
                _shared_db.close()
            except Exception:
                pass
        _shared_db = MaterialDatabase(path_str)
        _shared_db_path = path_str
        return _shared_db


def score_peak_match(
    exp_peaks: list[tuple[float, float]],
    candidate_peaks: list[tuple[float, float]],
    tolerance: float,
    max_two_theta: float = 50.0,
) -> dict[str, Any]:
    """Coverage-weighted peak-match score with greedy one-to-one matching.

    Candidate's strongest 8 peaks (≤ ``max_two_theta``) contribute by their
    relative intensity (as a weight). Matching is greedy one-to-one: strong
    reference peaks claim the closest experimental peak first, and each
    experimental peak can only be claimed once. This prevents inflated scores
    when multiple reference peaks cluster near a single experimental peak.

    Score = matched_weight / total_weight ∈ [0, 1].
    """
    if not exp_peaks or not candidate_peaks:
        return {"score": 0.0, "matched": 0, "total": 0}
    cand_filtered = [
        (t, i) for t, i in candidate_peaks if t <= max_two_theta
    ]
    if not cand_filtered:
        return {"score": 0.0, "matched": 0, "total": 0}
    cand_sorted = sorted(cand_filtered, key=lambda p: -p[1])[:8]
    total_weight = sum(max(ci, 0.0) / 100.0 for _, ci in cand_sorted)
    if total_weight <= 0:
        return {"score": 0.0, "matched": 0, "total": len(cand_sorted)}
    used_exp: set[int] = set()
    matched = 0
    matched_weight = 0.0
    for cand_theta, cand_intensity in cand_sorted:
        weight = max(float(cand_intensity), 0.0) / 100.0
        best_idx = -1
        best_delta = tolerance + 1.0
        for idx, (exp_theta, _) in enumerate(exp_peaks):
            if idx in used_exp:
                continue
            delta = abs(exp_theta - cand_theta)
            if delta <= tolerance and delta < best_delta:
                best_delta = delta
                best_idx = idx
        if best_idx >= 0:
            used_exp.add(best_idx)
            matched += 1
            matched_weight += weight
    raw_score = matched_weight / total_weight
    n = len(cand_sorted)
    penalty = 1.0 if n >= 3 else (0.5 if n == 2 else 0.3)
    score = raw_score * penalty
    return {
        "score": float(score),
        "matched": int(matched),
        "total": n,
    }
