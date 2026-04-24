"""cif_db.* tools — CIF crystal-structure database queries.

Exposes the `cif_structures` table inside `mp_xrd_database.db` as
standalone worker tools so any part of the app (agent, workbench, compute
notebook) can retrieve CIF texts, search by formula / element / space-
group, or pull bulk batches for dara refinement — without coupling to the
XRD search pipeline.

The table holds ~155k entries imported from the Materials Project.

Available methods:
    cif_db.get        — fetch CIF text(s) by material_id(s)
    cif_db.search     — search materials with optional CIF inclusion
    cif_db.stats      — aggregate statistics about the CIF collection
"""

from __future__ import annotations

import re
from typing import Any

from .xrd_mp_db import get_shared_db, resolve_db_path


# ── helpers ──────────────────────────────────────────────────────────────

def _normalize_element(token: str) -> str:
    """Cs, o → Cs, O — standard element-symbol casing."""
    token = token.strip()
    if not token:
        return ""
    if len(token) == 1:
        return token.upper()
    return token[:1].upper() + token[1:].lower()


def _parse_elements(raw: Any) -> list[str]:
    """Accept a list or a comma/space-separated string of element symbols."""
    if isinstance(raw, list):
        return [_normalize_element(str(e)) for e in raw if str(e).strip()]
    if isinstance(raw, str) and raw.strip():
        return [_normalize_element(t) for t in re.split(r"[,\s]+", raw) if t.strip()]
    return []


def _coerce_int(raw: Any, default: int) -> int:
    try:
        return int(raw) if raw is not None else default
    except (TypeError, ValueError):
        return default


# ── cif_db.get ───────────────────────────────────────────────────────────

def get(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Retrieve CIF text(s) by one or more material_id(s).

    Parameters:
        material_id  (str):       a single id, e.g. "mp-149"
        material_ids (list[str]): multiple ids (batch mode)
        db_path      (str|None):  explicit DB path override
        include_lattice (bool):   also return a/b/c/alpha/beta/gamma/
                                  space_group/nsites (default True)

    Returns:
        {success, results: [{material_id, cif_text, a, b, c, ...}]}
    """
    db_path = params.get("db_path") if isinstance(params.get("db_path"), str) else None
    db = get_shared_db(db_path)
    if db is None:
        return {
            "success": False,
            "error": "CIF database not available — check LATTICE_MP_XRD_DB_PATH or bundled DB",
        }

    # Collect requested ids
    ids: list[str] = []
    single = params.get("material_id")
    if isinstance(single, str) and single.strip():
        ids.append(single.strip())
    multi = params.get("material_ids")
    if isinstance(multi, list):
        for item in multi:
            if isinstance(item, str) and item.strip():
                ids.append(item.strip())
    if not ids:
        return {"success": False, "error": "provide material_id or material_ids"}

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_ids: list[str] = []
    for mid in ids:
        if mid not in seen:
            seen.add(mid)
            unique_ids.append(mid)

    include_lattice = bool(params.get("include_lattice", True))
    conn = db._conn()

    results: list[dict[str, Any]] = []
    missing: list[str] = []
    batch_size = 900

    for i in range(0, len(unique_ids), batch_size):
        batch = unique_ids[i : i + batch_size]
        ph = ",".join("?" for _ in batch)

        if include_lattice:
            sql = (
                "SELECT c.material_id, c.cif_text, "
                "       c.a, c.b, c.c, c.alpha, c.beta, c.gamma, "
                "       c.space_group, c.nsites, "
                "       m.formula, m.crystal_system "
                "FROM cif_structures c "
                "LEFT JOIN materials m ON c.material_id = m.material_id "
                f"WHERE c.material_id IN ({ph})"
            )
        else:
            sql = (
                "SELECT material_id, cif_text "
                f"FROM cif_structures WHERE material_id IN ({ph})"
            )

        found_in_batch: set[str] = set()
        for row in conn.execute(sql, batch):
            mid = row["material_id"]
            found_in_batch.add(mid)
            entry: dict[str, Any] = {
                "material_id": mid,
                "cif_text": row["cif_text"],
            }
            if include_lattice:
                entry.update({
                    "formula": row["formula"],
                    "a": row["a"],
                    "b": row["b"],
                    "c": row["c"],
                    "alpha": row["alpha"],
                    "beta": row["beta"],
                    "gamma": row["gamma"],
                    "space_group": row["space_group"],
                    "crystal_system": row["crystal_system"],
                    "nsites": row["nsites"],
                })
            results.append(entry)
        missing.extend(mid for mid in batch if mid not in found_in_batch)

    return {
        "success": True,
        "results": results,
        "count": len(results),
        "missing": missing if missing else None,
    }


# ── cif_db.search ────────────────────────────────────────────────────────

def search(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Search materials by formula, elements, or space group.

    Parameters:
        formula      (str):       substring match on formula, e.g. "TiO2"
        elements     (list|str):  element-subset filter (same as xrd.search)
        space_group  (str):       exact or substring match on Hermann-Mauguin
        crystal_system (str):     exact match, e.g. "cubic"
        limit        (int):       max results (default 50, max 500)
        include_cif  (bool):      include cif_text in results (default False
                                  to keep payloads small — set True when you
                                  need the actual CIF content)
        db_path      (str|None):  explicit DB path override

    Returns:
        {success, results: [{material_id, formula, space_group, ...}]}
    """
    db_path = params.get("db_path") if isinstance(params.get("db_path"), str) else None
    db = get_shared_db(db_path)
    if db is None:
        return {
            "success": False,
            "error": "CIF database not available",
        }

    limit = min(max(_coerce_int(params.get("limit"), 50), 1), 500)
    include_cif = bool(params.get("include_cif", False))
    conn = db._conn()

    # Build WHERE clauses
    conditions: list[str] = []
    bind_params: list[Any] = []

    formula = params.get("formula")
    if isinstance(formula, str) and formula.strip():
        conditions.append("m.formula LIKE ?")
        bind_params.append(f"%{formula.strip()}%")

    space_group = params.get("space_group")
    if isinstance(space_group, str) and space_group.strip():
        conditions.append("c.space_group LIKE ?")
        bind_params.append(f"%{space_group.strip()}%")

    crystal_system = params.get("crystal_system")
    if isinstance(crystal_system, str) and crystal_system.strip():
        conditions.append("LOWER(m.crystal_system) = LOWER(?)")
        bind_params.append(crystal_system.strip())

    elements = _parse_elements(params.get("elements"))

    # Element-subset filter: material must contain ONLY elements from the
    # provided set (same anti-join pattern as xrd_mp_db).
    element_ids: set[str] | None = None
    if elements:
        el_ph = ",".join("?" for _ in elements)
        el_sql = (
            "SELECT DISTINCT me.material_id "
            "FROM material_elements me "
            f"WHERE me.element IN ({el_ph}) "
            "  AND me.material_id NOT IN ("
            "    SELECT material_id FROM material_elements "
            f"   WHERE element NOT IN ({el_ph})"
            ")"
        )
        el_params = list(elements) + list(elements)
        element_ids = {row[0] for row in conn.execute(el_sql, el_params)}
        if not element_ids:
            return {
                "success": True,
                "results": [],
                "count": 0,
                "total_matched": 0,
            }

    if not conditions and element_ids is None:
        return {
            "success": False,
            "error": "provide at least one filter: formula, elements, space_group, or crystal_system",
        }

    # Build final query
    select_cols = (
        "c.material_id, m.formula, m.elements, m.crystal_system, "
        "c.space_group, c.a, c.b, c.c, c.alpha, c.beta, c.gamma, c.nsites"
    )
    if include_cif:
        select_cols += ", c.cif_text"

    where_clause = " AND ".join(conditions) if conditions else "1=1"

    if element_ids is not None:
        # Inject pre-filtered element ids via a temp approach:
        # since the set can be very large, use IN-clause batching
        id_list = list(element_ids)
        if len(id_list) > 10000:
            id_list = id_list[:10000]  # safety cap

        id_ph = ",".join("?" for _ in id_list)
        where_clause += f" AND c.material_id IN ({id_ph})"
        bind_params.extend(id_list)

    sql = (
        f"SELECT {select_cols} "
        "FROM cif_structures c "
        "JOIN materials m ON c.material_id = m.material_id "
        f"WHERE {where_clause} "
        f"LIMIT ?"
    )
    bind_params.append(limit)

    results: list[dict[str, Any]] = []
    for row in conn.execute(sql, bind_params):
        entry: dict[str, Any] = {
            "material_id": row["material_id"],
            "formula": row["formula"],
            "elements": (
                [e for e in row["elements"].split(",") if e]
                if row["elements"] else []
            ),
            "crystal_system": row["crystal_system"] or "",
            "space_group": row["space_group"] or "",
            "a": row["a"],
            "b": row["b"],
            "c": row["c"],
            "alpha": row["alpha"],
            "beta": row["beta"],
            "gamma": row["gamma"],
            "nsites": row["nsites"],
        }
        if include_cif:
            entry["cif_text"] = row["cif_text"]
        results.append(entry)

    total_matched = len(element_ids) if element_ids is not None else None

    return {
        "success": True,
        "results": results,
        "count": len(results),
        "total_matched": total_matched,
    }


# ── cif_db.stats ─────────────────────────────────────────────────────────

def stats(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Return aggregate statistics about the CIF database.

    Parameters:
        db_path (str|None): explicit DB path override

    Returns:
        {success, total_materials, total_with_cif, crystal_systems, ...}
    """
    db_path = params.get("db_path") if isinstance(params.get("db_path"), str) else None
    db = get_shared_db(db_path)
    if db is None:
        return {"success": False, "error": "CIF database not available"}

    conn = db._conn()
    total_materials = conn.execute("SELECT COUNT(*) FROM materials").fetchone()[0]
    total_cif = conn.execute(
        "SELECT COUNT(*) FROM cif_structures WHERE cif_text IS NOT NULL AND cif_text != ''"
    ).fetchone()[0]

    # Crystal system distribution
    rows = conn.execute(
        "SELECT crystal_system, COUNT(*) AS cnt "
        "FROM materials "
        "WHERE crystal_system IS NOT NULL AND crystal_system != '' "
        "GROUP BY crystal_system ORDER BY cnt DESC"
    ).fetchall()
    crystal_systems = {row[0]: row[1] for row in rows}

    # Space group top-20
    rows = conn.execute(
        "SELECT space_group, COUNT(*) AS cnt "
        "FROM cif_structures "
        "WHERE space_group IS NOT NULL AND space_group != '' "
        "GROUP BY space_group ORDER BY cnt DESC LIMIT 20"
    ).fetchall()
    top_space_groups = {row[0]: row[1] for row in rows}

    # Element coverage
    total_elements = conn.execute(
        "SELECT COUNT(DISTINCT element) FROM material_elements"
    ).fetchone()[0]

    return {
        "success": True,
        "total_materials": total_materials,
        "total_with_cif": total_cif,
        "cif_coverage_pct": round(total_cif / max(total_materials, 1) * 100, 2),
        "crystal_systems": crystal_systems,
        "top_space_groups": top_space_groups,
        "total_elements": total_elements,
    }
