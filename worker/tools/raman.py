"""raman.* tools — library-free Raman mineral identification.

Self-contained Port §P4-δ — replaces lattice-cli's
``POST /api/pro/raman-identify``. Scores the user's peak list against a
compact reference table (``worker/data/raman_references.json``) using
greedy one-to-one positional matching inside a user-configurable
tolerance window. FTIR is deliberately *not* covered here — the frontend
already gates the button and a library curated for the 4000–400 cm⁻¹
range is a separate deliverable.

Scoring rationale: a pure "matched-count" score would favour reference
entries with a very short peak list (e.g. diamond's single peak), so we
normalise by ``max(len(ref), len(user))``. That penalises both under-
reporting by the user and over-fitting to a narrow reference.
"""

from __future__ import annotations

import json
import os
from typing import Any


_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "raman_references.json",
)

DEFAULT_TOLERANCE_CM1 = 8.0
MAX_RESULTS = 8
MIN_TOLERANCE_CM1 = 0.5
MAX_TOLERANCE_CM1 = 60.0


_reference_cache: list[dict[str, Any]] | None = None


def _load_references() -> list[dict[str, Any]]:
    """Lazy-load the reference table. Missing / malformed file raises a
    clear error rather than returning an empty list, which would silently
    score every request as "no match" and mask the real issue."""
    global _reference_cache
    if _reference_cache is not None:
        return _reference_cache
    if not os.path.exists(_DATA_PATH):
        raise FileNotFoundError(
            f"raman reference table not found at {_DATA_PATH}; "
            "reinstall or rebuild the worker package"
        )
    with open(_DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list) or not data:
        raise ValueError(f"{_DATA_PATH} is empty or not a JSON list")
    _reference_cache = data
    return data


def _coerce_peaks(raw: Any) -> list[dict[str, float]]:
    """Pull ``{position, intensity?}`` pairs out of the request shape,
    tolerating both the legacy ``ProPeak`` dict and bare ``{pos}`` alias.
    Non-numeric positions are silently dropped — better a weaker score
    than a blown-up call."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, float]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        pos = item.get("position")
        if pos is None:
            pos = item.get("pos")
        try:
            pos_f = float(pos)
        except (TypeError, ValueError):
            continue
        intensity = item.get("intensity", 1.0)
        try:
            int_f = float(intensity) if intensity is not None else 1.0
        except (TypeError, ValueError):
            int_f = 1.0
        out.append({"position": pos_f, "intensity": int_f})
    out.sort(key=lambda p: p["position"])
    return out


def _coerce_tolerance(raw: Any) -> float:
    try:
        value = float(raw) if raw is not None else DEFAULT_TOLERANCE_CM1
    except (TypeError, ValueError):
        return DEFAULT_TOLERANCE_CM1
    if value < MIN_TOLERANCE_CM1:
        return MIN_TOLERANCE_CM1
    if value > MAX_TOLERANCE_CM1:
        return MAX_TOLERANCE_CM1
    return value


def _match_one(
    user_positions: list[float],
    ref_peaks: list[float],
    tolerance: float,
) -> tuple[int, list[tuple[float, float]]]:
    """Flat greedy match. Kept for the legacy `peaks_cm1` shape only —
    the richer `characteristic_peaks` scoring is in `_score_characteristic`.
    """
    if not user_positions or not ref_peaks:
        return 0, []
    used: set[int] = set()
    pairs: list[tuple[float, float]] = []
    for ref_pos in ref_peaks:
        best_idx = -1
        best_delta = tolerance + 1.0
        for i, up in enumerate(user_positions):
            if i in used:
                continue
            delta = abs(up - ref_pos)
            if delta <= tolerance and delta < best_delta:
                best_delta = delta
                best_idx = i
        if best_idx >= 0:
            used.add(best_idx)
            pairs.append((ref_pos, user_positions[best_idx]))
    return len(pairs), pairs


def _score_characteristic(
    user_positions: list[float],
    user_intensities: list[float],
    db_peaks: list[dict[str, Any]],
    tolerance: float,
    primary_weight: float,
) -> tuple[float, int, int, list[dict[str, Any]]]:
    """Lattice-cli scoring for a mineral whose reference is the rich
    `characteristic_peaks` shape. See
    `src/lattice_cli/tools/raman_database.py:identify_mineral`.

    Weight strategy:
      - Primary DB peaks count `primary_weight` × more than secondary.
      - Matched pair's contribution is `weight * int_sim` where
        `int_sim = max(0, 1 - |db_rel - user_rel|)`.
      - Final score = matched_score / total_weight, then multiplied by
        `0.5 + 0.5 * coverage` to penalise partial matches.
    """
    if not db_peaks or not user_positions:
        return 0.0, 0, len(db_peaks), []

    # Normalise user intensities to [0, 1] so `int_sim` is scale-invariant.
    max_int = max(user_intensities) if user_intensities else 0.0
    user_norm = (
        [i / max_int for i in user_intensities] if max_int > 0
        else [1.0] * len(user_positions)
    )

    matched_pairs: list[dict[str, Any]] = []
    total_weight = 0.0
    matched_score = 0.0

    for db_peak in db_peaks:
        try:
            db_pos = float(db_peak.get("position_cm"))
        except (TypeError, ValueError):
            continue
        db_int_raw = db_peak.get("rel_intensity", 1.0)
        try:
            db_int = float(db_int_raw)
        except (TypeError, ValueError):
            db_int = 1.0
        is_primary = bool(db_peak.get("is_primary", False))
        weight = primary_weight if is_primary else 1.0
        total_weight += weight

        best_idx = -1
        best_delta = tolerance + 1.0
        for i, exp_pos in enumerate(user_positions):
            delta = abs(exp_pos - db_pos)
            if delta <= tolerance and delta < best_delta:
                best_delta = delta
                best_idx = i

        if best_idx >= 0:
            int_sim = max(0.0, 1.0 - abs(db_int - user_norm[best_idx]))
            matched_score += weight * int_sim
            matched_pairs.append(
                {
                    "exp_position": user_positions[best_idx],
                    "db_position": db_pos,
                    "delta_cm": best_delta,
                    "rel_intensity": db_int,
                    "assignment": str(db_peak.get("assignment", "")),
                    "is_primary": is_primary,
                }
            )

    if total_weight <= 0:
        return 0.0, 0, len(db_peaks), matched_pairs
    raw = matched_score / total_weight
    coverage = len(matched_pairs) / len(db_peaks)
    # Coverage penalty: half credit at zero coverage, full at 100%.
    score = raw * (0.5 + 0.5 * coverage)
    return score, len(matched_pairs), len(db_peaks), matched_pairs


def identify(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Score the user's peak list against every reference and return top-k.

    Parameters (``params`` dict):
    - ``peaks``: ``list[{position, intensity?}]`` — user's detected peaks
      (positions in cm⁻¹).
    - ``tolerance`` (optional): match window in cm⁻¹, default 8.

    Returns (success):
        {
          "success": True,
          "data": {"matches": [...], "tolerance_cm1": <float>},
          "summary": "Top match: <name> (score=<x.xx>, <m>/<n> peaks)"
        }
    """
    peaks = _coerce_peaks(params.get("peaks"))
    if not peaks:
        return {
            "success": False,
            "error": "peaks list is empty; detect peaks first",
        }
    tolerance = _coerce_tolerance(params.get("tolerance"))
    primary_weight_raw = params.get("primary_weight")
    try:
        primary_weight = (
            float(primary_weight_raw) if primary_weight_raw is not None else 3.0
        )
    except (TypeError, ValueError):
        primary_weight = 3.0

    try:
        references = _load_references()
    except (FileNotFoundError, ValueError) as exc:
        return {"success": False, "error": str(exc)}

    user_positions = [float(p["position"]) for p in peaks]
    user_intensities = [float(p.get("intensity") or 1.0) for p in peaks]
    user_n = len(user_positions)

    scored: list[dict[str, Any]] = []
    for ref in references:
        # Prefer the richer `characteristic_peaks` shape (lattice-cli /
        # RRUFF). Fall back to the flat `peaks_cm1` shape for older
        # references. A reference missing both is silently skipped.
        rich = ref.get("characteristic_peaks")
        if isinstance(rich, list) and rich:
            score, matched_n, db_n, pairs = _score_characteristic(
                user_positions,
                user_intensities,
                [p for p in rich if isinstance(p, dict)],
                tolerance,
                primary_weight,
            )
            if matched_n == 0:
                continue
            scored.append({
                "rruff_id": ref.get("rruff_id"),
                "name": ref.get("name", "<unnamed>"),
                "formula": ref.get("formula"),
                "crystal_system": ref.get("crystal_system"),
                "space_group": ref.get("space_group"),
                "score": round(score, 4),
                "matched_peaks": matched_n,
                "total_db_peaks": db_n,
                "peak_matches": pairs,
                "reference_peaks": [
                    float(p["position_cm"])
                    for p in rich
                    if isinstance(p, dict) and isinstance(p.get("position_cm"), (int, float))
                ],
                "notes": ref.get("notes"),
            })
            continue

        ref_peaks_any = ref.get("peaks_cm1", [])
        if not isinstance(ref_peaks_any, list) or not ref_peaks_any:
            continue
        ref_peaks: list[float] = []
        for rp in ref_peaks_any:
            try:
                ref_peaks.append(float(rp))
            except (TypeError, ValueError):
                continue
        if not ref_peaks:
            continue

        matched, _pairs = _match_one(user_positions, ref_peaks, tolerance)
        if matched == 0:
            continue
        denom = max(len(ref_peaks), user_n)
        score = matched / denom if denom > 0 else 0.0
        scored.append({
            "name": ref.get("name", "<unnamed>"),
            "formula": ref.get("formula"),
            "score": round(score, 4),
            "matched_peaks": matched,
            "total_db_peaks": len(ref_peaks),
            "reference_peaks": ref_peaks,
            "notes": ref.get("notes"),
        })

    scored.sort(
        key=lambda m: (m["score"], m["matched_peaks"]),
        reverse=True,
    )
    top = scored[:MAX_RESULTS]

    if top:
        best = top[0]
        summary = (
            f"Top match: {best['name']} "
            f"(score={best['score']:.2f}, "
            f"{best['matched_peaks']}/{best.get('total_db_peaks', len(best.get('reference_peaks', [])))} peaks)"
        )
    else:
        summary = "No reference mineral matched within tolerance"

    return {
        "success": True,
        "data": {
            "matches": top,
            "tolerance_cm1": tolerance,
            "primary_weight": primary_weight,
        },
        "summary": summary,
    }
