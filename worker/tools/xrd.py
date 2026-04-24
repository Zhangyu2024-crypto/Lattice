"""xrd.* tools — offline XRD phase search + approximate pattern fitting.

Self-contained Port §P4-β offline-v1. Replaces the last two lattice-cli
REST calls driving ``XrdProWorkbench`` (``xrd-search`` and
``xrd-refine``) with a repo-local worker implementation that has no
external database dependency, no ``pymatgen``, and no ``dara``.

- ``xrd.search``  — phase lookup against ``worker/data/xrd_references.json``.
                    Converts each reference's d-spacings to 2θ at the
                    user-supplied wavelength, greedy one-to-one matches
                    against observed peaks inside a tolerance window,
                    scores by summed reference-intensity weight matched.

- ``xrd.refine``  — approximate isotropic whole-pattern fit per phase:
                    a single lattice-scale + peak-scale + global
                    zero-shift, plus a linear baseline (b0 + b1·2θ) to
                    absorb residual background. Each phase fits
                    independently; no simultaneous multi-phase Rietveld.

The response for refine always sets ``analysis_method:
"approximate_isotropic_fit"`` so the renderer never claims full
Rietveld fidelity. The phase's ``confidence`` is ``1/max(Rwp, ε)`` and
``weight_pct`` is the peak_scale share across kept phases — both
presentation-only heuristics, not rigorous quantities.
"""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from scipy.optimize import least_squares, nnls

from . import dara_bridge, xrd_mp_db
from .common import validate_xy_arrays
from scipy.signal import find_peaks


_DATA_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "xrd_references.json"
)

DEFAULT_WAVELENGTH = "Cu"
DEFAULT_TOLERANCE_DEG = 0.3
DEFAULT_TOP_K = 30
DEFAULT_MAX_PHASES = 3
DEFAULT_FWHM_DEG = 0.15
FWHM_BOUNDS_DEG = (0.03, 1.5)
# η (eta) = pseudo-Voigt mixing. 0 = pure Gaussian, 1 = pure Lorentzian.
# Scherrer broadening is predominantly Gaussian for size effects;
# instrumental contributions lean Lorentzian. Middle of the legal range
# is a reasonable seed.
PSEUDO_VOIGT_ETA_SEED = 0.3
PSEUDO_VOIGT_ETA_BOUNDS = (0.0, 1.0)
LATTICE_BOUNDS = (0.97, 1.03)
ZERO_SHIFT_BOUNDS_DEG = (-0.3, 0.3)
# Method label emitted on the refine response. Upgraded from the earlier
# `approximate_isotropic_fit` now that the fit carries Pseudo-Voigt peak
# shapes with per-phase FWHM + η and a cubic baseline. Still short of
# Rietveld (no structure-factor calculation from space group), but the
# peak-shape + background treatment is no longer "approximate".
ANALYSIS_METHOD = "pseudo_voigt_multi_phase"

# Cu/Mo/Co/Fe/Cr/Ag K-α1 (Angstroms). Matches the renderer's
# `WAVELENGTH_TO_ANGSTROM` in src/lib/xrd-instruments.ts so round-trips
# use the same numeric constants on both sides.
WAVELENGTH_TO_ANGSTROM: dict[str, float] = {
    "Cu": 1.5406,
    "Mo": 0.7107,
    "Co": 1.7889,
    "Fe": 1.9373,
    "Cr": 2.2909,
    "Ag": 0.5594,
}

# Accept a handful of common aliases so the tool is forgiving of UI
# strings that may carry "CuKa1" / "cuka" / whitespace etc.
_WAVELENGTH_ALIASES: dict[str, str] = {
    "cu": "Cu", "cuka": "Cu", "cuka1": "Cu",
    "mo": "Mo", "moka": "Mo", "moka1": "Mo",
    "co": "Co", "coka": "Co", "coka1": "Co",
    "fe": "Fe", "feka": "Fe", "feka1": "Fe",
    "cr": "Cr", "crka": "Cr", "crka1": "Cr",
    "ag": "Ag", "agka": "Ag", "agka1": "Ag",
}


_reference_cache: list[dict[str, Any]] | None = None


def _load_references() -> list[dict[str, Any]]:
    """Lazy-load the reference table. Missing / malformed file raises a
    clear error so the caller sees something actionable instead of a
    silent "no matches" response."""
    global _reference_cache
    if _reference_cache is not None:
        return _reference_cache
    if not _DATA_PATH.exists():
        raise FileNotFoundError(
            f"xrd reference table not found at {_DATA_PATH}; "
            "reinstall or rebuild the worker package"
        )
    with _DATA_PATH.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list) or not data:
        raise ValueError(f"{_DATA_PATH} is empty or not a JSON list")
    _reference_cache = data
    return data


def _normalize_element(token: str) -> str:
    token = token.strip()
    if not token:
        return ""
    if len(token) == 1:
        return token.upper()
    return token[:1].upper() + token[1:].lower()


_NON_METAL_SET: frozenset[str] = frozenset({"O", "C", "N", "S", "F", "Cl", "Br", "I", "H", "P", "B", "Si"})


def generate_element_subsets(elements: list[str]) -> list[list[str]]:
    """Expand a user-supplied element list into a family of plausible
    query subsets, mirroring lattice-cli's multi-phase retrieval trick.

    Single- and two-element inputs just return themselves — there's no
    multi-phase story to tell. For three or more, we also emit:

      - each metal oxide pair when ``O`` is present
      - each metal-carbonate triple when ``{C, O}`` are both present
      - each metal-silicate triple when ``{Si, O}`` are both present
      - every two-cation + O triple when ``O`` is present and there are
        ≥ 2 cations

    The result is sorted (for stable hashing / dedup downstream) but is
    returned with the full set first so callers that only honour the
    first subset behave as "no expansion" by default.
    """
    if not elements:
        return []
    base = sorted({el.strip() for el in elements if el and el.strip()})
    subsets: list[list[str]] = [base]
    if len(base) < 3:
        return subsets

    element_set = set(base)
    cations = element_set - _NON_METAL_SET

    def add(subset: list[str]) -> None:
        s = sorted(subset)
        if s not in subsets:
            subsets.append(s)

    if "O" in element_set:
        for cation in cations:
            add([cation, "O"])

    if {"C", "O"}.issubset(element_set):
        # Drop non-metals that won't plausibly replace carbon/oxygen as
        # the "metal" end of a carbonate.
        metals = cations - {"Si", "P", "B"}
        for metal in metals:
            add([metal, "C", "O"])

    if {"Si", "O"}.issubset(element_set):
        metals = cations - {"Si"}
        for metal in metals:
            add([metal, "Si", "O"])

    if "O" in element_set and len(cations) >= 2:
        cation_list = sorted(cations)
        for i in range(len(cation_list)):
            for j in range(i + 1, len(cation_list)):
                add([cation_list[i], cation_list[j], "O"])

    return subsets


def _coerce_elements(raw: Any) -> set[str] | None:
    """Parse a user-supplied or reference-side element list into a set of
    canonical symbols (``Ti``, ``Ca``, ...). Returns ``None`` when the
    caller did not pass one — used as a sentinel for "no filter"."""
    if raw is None:
        return None
    tokens: list[str] = []
    if isinstance(raw, str):
        tokens = re.split(r"[,\s]+", raw.strip())
    elif isinstance(raw, list):
        tokens = [str(item) for item in raw if isinstance(item, str)]
    normalized = {_normalize_element(token) for token in tokens if token.strip()}
    return normalized or None


def _coerce_wavelength(raw: Any) -> tuple[str, float]:
    """Return ``(key, λ_Å)`` for the requested wavelength. Unknown /
    empty input falls back to Cu Kα1, matching the UI default."""
    if isinstance(raw, str) and raw.strip():
        alias_key = re.sub(r"[^a-z0-9]+", "", raw.strip().lower())
        canonical = _WAVELENGTH_ALIASES.get(alias_key, DEFAULT_WAVELENGTH)
        return canonical, WAVELENGTH_TO_ANGSTROM[canonical]
    return DEFAULT_WAVELENGTH, WAVELENGTH_TO_ANGSTROM[DEFAULT_WAVELENGTH]


def _coerce_float(raw: Any, default: float) -> float:
    try:
        return float(raw) if raw is not None else default
    except (TypeError, ValueError):
        return default


def _coerce_int(raw: Any, default: int) -> int:
    try:
        return int(raw) if raw is not None else default
    except (TypeError, ValueError):
        return default


def _validate_xy_arrays(x_raw: Any, y_raw: Any) -> tuple[np.ndarray, np.ndarray]:
    # Guarantee monotonic-ascending x so later range filtering and
    # interpolation are safe; fits don't care which end the original
    # payload started from.
    return validate_xy_arrays(x_raw, y_raw, flip_descending=True, label="spectrum")


def _extract_spectrum(
    params: dict[str, Any],
    *,
    required: bool,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    spectrum = params.get("spectrum")
    if isinstance(spectrum, dict):
        return _validate_xy_arrays(spectrum.get("x"), spectrum.get("y"))
    if "x" in params or "y" in params:
        return _validate_xy_arrays(params.get("x"), params.get("y"))
    if required:
        raise ValueError("spectrum is required for this operation")
    return None, None


def _coerce_peaks(raw: Any) -> list[dict[str, float]]:
    """Pull ``{position, intensity}`` pairs from the user-supplied peak
    list. Non-numeric / missing positions are silently dropped; the
    caller can tell them apart by the resulting length delta."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, float]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        pos_raw = item.get("position")
        if pos_raw is None:
            continue
        try:
            position = float(pos_raw)
        except (TypeError, ValueError):
            continue
        try:
            intensity = float(item.get("intensity", 1.0) or 1.0)
        except (TypeError, ValueError):
            intensity = 1.0
        out.append({"position": position, "intensity": intensity})
    out.sort(key=lambda peak: peak["position"])
    return out


def _auto_detect_peaks(
    x: np.ndarray,
    y: np.ndarray,
    *,
    top_k: int,
) -> list[dict[str, float]]:
    """Fallback when the UI didn't pass peaks: same prominence heuristic
    as ``spectrum.detect_peaks`` so "search without detect first" still
    returns something sensible. We over-select (top_k * 3, at least 24)
    because the scorer re-ranks by matched reference weight anyway."""
    if x.size < 8:
        return []
    y_shifted = y - float(np.min(y))
    dynamic_range = float(np.max(y_shifted) - np.min(y_shifted))
    if dynamic_range <= 0:
        return []
    noise = float(np.std(np.diff(y_shifted))) if y_shifted.size > 2 else 0.0
    prominence = max(dynamic_range * 0.03, noise * 3.0, 1e-6)
    distance = max(int(round(x.size / 200.0)), 1)
    indices, props = find_peaks(y_shifted, prominence=prominence, distance=distance)
    if indices.size == 0:
        return []
    prominences = props.get("prominences", np.zeros_like(indices, dtype=float))
    keep = np.argsort(prominences)[::-1][: max(top_k * 3, 24)]
    selected = np.sort(indices[keep])
    return [
        {"position": float(x[idx]), "intensity": float(y[idx])}
        for idx in selected.tolist()
    ]


def _reference_raw_peaks(ref: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse a reference's ``peaks`` array into numeric dicts. Tolerates
    rows where ``peaks`` was left as a placeholder string or not a list:
    those simply yield an empty list, so the phase is skipped in search
    and reported as "unpopulated" in refine."""
    raw_peaks = ref.get("peaks")
    if not isinstance(raw_peaks, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw_peaks:
        if not isinstance(item, dict):
            continue
        try:
            d_a = float(item.get("d_A"))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(d_a) or d_a <= 0:
            continue
        try:
            rel_intensity = float(item.get("rel_intensity", 0.0) or 0.0)
        except (TypeError, ValueError):
            rel_intensity = 0.0
        hkl = item.get("hkl")
        out.append(
            {
                "d_A": d_a,
                "rel_intensity": max(rel_intensity, 0.0),
                "hkl": str(hkl) if hkl is not None else None,
            }
        )
    return out


def _two_theta_from_d(d_a: float, wavelength_a: float) -> float | None:
    """Bragg's law: 2θ = 2·asin(λ/2d). Returns ``None`` when the ratio
    falls outside the valid domain (sub-λ d-spacings or non-finite)."""
    if not math.isfinite(d_a) or d_a <= 0:
        return None
    ratio = wavelength_a / (2.0 * d_a)
    if ratio <= 0 or ratio >= 1:
        return None
    return float(2.0 * math.degrees(math.asin(ratio)))


def _reference_peaks_2theta(
    ref: dict[str, Any],
    *,
    wavelength_a: float,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for peak in _reference_raw_peaks(ref):
        position = _two_theta_from_d(float(peak["d_A"]), wavelength_a)
        if position is None:
            continue
        out.append(
            {
                "position": position,
                "rel_intensity": float(peak["rel_intensity"]),
                "d_A": float(peak["d_A"]),
                "hkl": peak.get("hkl"),
            }
        )
    return out


def _weighted_peak_match(
    user_peaks: list[dict[str, float]],
    ref_peaks: list[dict[str, Any]],
    *,
    tolerance_deg: float,
) -> tuple[float, list[dict[str, Any]]]:
    """Greedy one-to-one matching weighted by reference rel_intensity.

    Walking reference peaks in descending intensity order means strong
    peaks (which dominate a diagnostic fingerprint) claim their nearest
    observed peak first. Score = Σ matched_weight / Σ total_weight,
    bounded [0, 1]. Ties on distance break by iteration order, which
    mirrors the corresponding raman.identify behaviour.
    """
    if not user_peaks or not ref_peaks:
        return 0.0, []

    ordered_ref = sorted(
        ref_peaks,
        key=lambda peak: float(peak["rel_intensity"]),
        reverse=True,
    )[:8]
    total_weight = sum(float(peak["rel_intensity"]) for peak in ordered_ref)
    if total_weight <= 0:
        return 0.0, []

    used_user: set[int] = set()
    matches: list[dict[str, Any]] = []
    matched_weight = 0.0

    for ref_peak in ordered_ref:
        best_index = -1
        best_delta = tolerance_deg + 1.0
        for idx, user_peak in enumerate(user_peaks):
            if idx in used_user:
                continue
            delta = abs(user_peak["position"] - float(ref_peak["position"]))
            if delta <= tolerance_deg and delta < best_delta:
                best_delta = delta
                best_index = idx
        if best_index < 0:
            continue
        used_user.add(best_index)
        matched_weight += float(ref_peak["rel_intensity"])
        matches.append(
            {
                "ref_2theta": float(ref_peak["position"]),
                "obs_2theta": float(user_peaks[best_index]["position"]),
                "delta_2theta": float(best_delta),
                "rel_intensity": float(ref_peak["rel_intensity"]),
                "hkl": ref_peak.get("hkl"),
            }
        )

    raw_score = matched_weight / total_weight
    n = len(ordered_ref)
    penalty = 1.0 if n >= 3 else (0.5 if n == 2 else 0.3)
    position_score = raw_score * penalty

    # Intensity correlation bonus: compare normalised user vs reference
    # intensities for matched pairs. A good match in both position AND
    # relative intensity is more diagnostic than position alone.
    if len(matches) >= 2:
        user_max = max(
            (float(user_peaks[idx]["intensity"]) for idx in used_user),
            default=1.0,
        ) or 1.0
        ref_intensities = []
        obs_intensities = []
        for m in matches:
            ref_intensities.append(float(m["rel_intensity"]) / 100.0)
            obs_idx = next(
                (i for i in range(len(user_peaks))
                 if abs(user_peaks[i]["position"] - m["obs_2theta"]) < 1e-6),
                None,
            )
            if obs_idx is not None:
                obs_intensities.append(
                    float(user_peaks[obs_idx]["intensity"]) / user_max,
                )
            else:
                obs_intensities.append(0.0)
        if len(ref_intensities) >= 2:
            ref_arr = np.array(ref_intensities)
            obs_arr = np.array(obs_intensities)
            denom = np.linalg.norm(ref_arr) * np.linalg.norm(obs_arr)
            if denom > 1e-12:
                cosine = float(np.dot(ref_arr, obs_arr) / denom)
                position_score *= 0.7 + 0.3 * max(0.0, cosine)

    return position_score, matches


def search(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Phase search against the bundled internal reference table.

    Parameters (``params`` dict):
    - ``spectrum`` (optional): ``{x, y}`` — used for auto peak detection
      when ``peaks`` is empty.
    - ``peaks`` (optional): ``[{position, intensity}]`` — the user's
      detected peaks in 2θ degrees. Preferred over auto-detect.
    - ``wavelength`` (optional): one of ``Cu | Mo | Co | Fe | Cr | Ag``.
    - ``elements`` (**required**): list or comma-separated string. We use it
      both to filter references and to seed the multi-phase subset
      expansion (Fe+Ti+O → also queries {Fe,O}, {Ti,O}, {Fe,Ti,O}, …).
      Empty elements returns an error — without the filter the 155k-row
      MP DB produces noise and even the bundled JSON is too broad to be
      diagnostic.
    - ``top_k`` (optional, default 10): max candidates to return.
    - ``tolerance`` (optional, default 0.1 deg): 2θ match window.
    - ``expand_subsets`` (optional, default true): when true, queries
      every subset generated by ``generate_element_subsets`` and merges
      the results. Set false for a single-shot query on the exact element
      set the caller supplied.
    """
    wavelength_key, wavelength_a = _coerce_wavelength(params.get("wavelength"))
    tolerance_deg = max(
        _coerce_float(params.get("tolerance"), DEFAULT_TOLERANCE_DEG), 1e-6,
    )
    top_k = max(_coerce_int(params.get("top_k"), DEFAULT_TOP_K), 1)
    user_elements = _coerce_elements(params.get("elements"))

    peaks = _coerce_peaks(params.get("peaks"))
    if not peaks:
        try:
            x, y = _extract_spectrum(params, required=False)
        except ValueError as exc:
            return {"success": False, "error": str(exc)}
        if x is not None and y is not None:
            peaks = _auto_detect_peaks(x, y, top_k=top_k)
    if not peaks:
        return {
            "success": False,
            "error": (
                "no peaks supplied — detect peaks first or pass a spectrum "
                "so the worker can auto-extract them"
            ),
        }

    expand_subsets = bool(params.get("expand_subsets", True))
    element_subsets: list[list[str]]
    if user_elements and expand_subsets:
        element_subsets = generate_element_subsets(sorted(user_elements))
    elif user_elements:
        element_subsets = [sorted(user_elements)]
    else:
        element_subsets = []

    # Materials Project fast path — requires elements for SQL filtering.
    mp_path = params.get("db_path") if isinstance(params.get("db_path"), str) else None
    if user_elements and wavelength_key == "Cu" and xrd_mp_db.is_available(mp_path):
        merged = _search_via_mp_db_multi(
            peaks=peaks,
            element_subsets=element_subsets,
            tolerance_deg=tolerance_deg,
            top_k=top_k,
            wavelength_key=wavelength_key,
            explicit_path=mp_path,
        )
        if merged is not None:
            return merged

    try:
        references = _load_references()
    except (FileNotFoundError, ValueError) as exc:
        return {"success": False, "error": str(exc)}

    candidates: list[dict[str, Any]] = []
    usable_reference_count = 0

    for ref in references:
        phase_elements = _coerce_elements(ref.get("elements"))
        if user_elements and phase_elements and not phase_elements.issubset(
            user_elements
        ):
            continue

        ref_peaks = _reference_peaks_2theta(ref, wavelength_a=wavelength_a)
        if not ref_peaks:
            continue
        usable_reference_count += 1

        score, matches = _weighted_peak_match(
            peaks, ref_peaks, tolerance_deg=tolerance_deg,
        )
        if score <= 0:
            continue

        deltas = [float(m["delta_2theta"]) for m in matches]
        # Ship the reference peak list (position + relative intensity) so the
        # frontend can overlay it onto the observed pattern as a visual
        # sanity check — standard in TOPAS / HighScore. Payload is tiny
        # (≤ ~60 entries × 2 floats per candidate) and the data is already
        # computed above; previously we dropped it on the floor.
        ref_peaks_wire = [
            {
                "two_theta": round(float(p["position"]), 4),
                "rel_intensity": round(float(p["rel_intensity"]), 4),
            }
            for p in ref_peaks
        ]
        candidates.append(
            {
                "material_id": ref.get("id"),
                "formula": ref.get("formula"),
                "space_group": ref.get("space_group"),
                "name": ref.get("name"),
                "score": round(score, 4),
                "matched_peaks": len(matches),
                "reference_peaks": len(ref_peaks),
                "ref_peaks": ref_peaks_wire,
                "mean_abs_delta_2theta": (
                    round(float(np.mean(deltas)), 4) if deltas else None
                ),
            }
        )

    if usable_reference_count == 0:
        return {
            "success": False,
            "error": (
                "xrd reference table contains no populated peak lists; "
                "fill worker/data/xrd_references.json with d_A / rel_intensity peaks"
            ),
        }

    candidates.sort(
        key=lambda cand: (
            float(cand["score"]),
            int(cand["matched_peaks"]),
            -(float(cand["mean_abs_delta_2theta"] or 999.0)),
        ),
        reverse=True,
    )
    top = candidates[:top_k]

    return {
        "success": True,
        "source": "internal_db",
        "data": {
            "candidates": top,
            "count": len(top),
            "wavelength": wavelength_key,
        },
    }


def _write_tmp_xy(spectrum: dict[str, Any]) -> str:
    """Serialise an inline spectrum `{x: [], y: []}` to a temporary two-
    column `.xy` file and return its path. Caller (refine_dara) removes
    the file once dara_bridge finishes. Kept simple — two-column ASCII
    is the lowest-common-denominator format dara reads; no whitespace /
    trailing-newline finicking required."""
    xs_raw = spectrum.get("x")
    ys_raw = spectrum.get("y")
    if not isinstance(xs_raw, list) or not isinstance(ys_raw, list):
        raise ValueError("inline spectrum must contain numeric x[] and y[]")
    if len(xs_raw) != len(ys_raw) or len(xs_raw) < 2:
        raise ValueError("inline spectrum x / y must be equal-length (≥2)")
    fd, path = tempfile.mkstemp(suffix=".xy", prefix="lattice-dara-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            for x, y in zip(xs_raw, ys_raw):
                fh.write(f"{float(x)} {float(y)}\n")
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise
    return path


def refine_dara(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Call an external dara Rietveld service for a real BGMN-backed fit.

    This is the high-fidelity counterpart to `refine` (pseudo-Voigt fit).
    Requires the user to be running a dara service (Docker or standalone)
    and to have set `DARA_SERVICE_URL` in the environment. BGMN itself is
    NOT bundled with Lattice-app; this port mirrors lattice-cli's exact
    bridge pattern so users who already run dara for lattice-cli get the
    same capability from the Electron app.

    Parameters:
      - `spectrum: {x: [], y: []}` OR `xy_path`: spectrum source. When
        `spectrum` is supplied we serialise to a tmp `.xy` file; when
        `xy_path` is supplied we forward as-is. One or the other is
        required.
      - `cif_paths` or `cif_texts`: the phase candidates. See
        `dara_bridge.call_refinement` for shape.
      - `instrument_profile`, `wmin`, `wmax`: passed through.

    Returns:
      On success — `{success: True, source: 'dara', data: <dara response>}`.
      On transport failure — `{success: False, error: <message>,
      hint: 'set DARA_SERVICE_URL and ensure the service is running'}`.
      Callers fall back to `xrd.refine` themselves if they want the
      bundled fit as a safety net.
    """
    spectrum = params.get("spectrum")
    xy_path_param = params.get("xy_path")
    tmp_cleanup: str | None = None
    if isinstance(spectrum, dict):
        try:
            xy_path = _write_tmp_xy(spectrum)
        except ValueError as exc:
            return {"success": False, "error": str(exc)}
        tmp_cleanup = xy_path
    elif isinstance(xy_path_param, str) and xy_path_param:
        xy_path = xy_path_param
    else:
        return {
            "success": False,
            "error": "provide `spectrum: {x, y}` or `xy_path` (filesystem path)",
        }
    cif_paths = params.get("cif_paths") if isinstance(params.get("cif_paths"), list) else None
    cif_texts = params.get("cif_texts") if isinstance(params.get("cif_texts"), list) else None
    if not cif_paths and not cif_texts:
        if tmp_cleanup:
            try:
                os.unlink(tmp_cleanup)
            except OSError:
                pass
        return {
            "success": False,
            "error": "supply cif_paths or cif_texts (at least one candidate phase)",
        }
    try:
        response = dara_bridge.call_refinement(
            xy_path,
            cif_paths=cif_paths,
            cif_texts=cif_texts,
            instrument_profile=params.get("instrument_profile")
            if isinstance(params.get("instrument_profile"), str) else None,
            wmin=params.get("wmin") if isinstance(params.get("wmin"), (int, float)) else None,
            wmax=params.get("wmax") if isinstance(params.get("wmax"), (int, float)) else None,
            base_url=params.get("base_url") if isinstance(params.get("base_url"), str) else None,
        )
    except Exception as exc:
        return {
            "success": False,
            "error": f"dara bridge failed: {exc}",
            "hint": "set DARA_SERVICE_URL and ensure the dara service is reachable",
        }
    finally:
        if tmp_cleanup:
            try:
                os.unlink(tmp_cleanup)
            except OSError:
                pass
    return {"success": True, "source": "dara", "data": response}


def _search_via_mp_db_multi(
    *,
    peaks: list[dict[str, float]],
    element_subsets: list[list[str]],
    tolerance_deg: float,
    top_k: int,
    wavelength_key: str,
    explicit_path: str | None,
) -> dict[str, Any] | None:
    """Run ``_search_via_mp_db`` once per element subset and merge. Returns
    ``None`` on infrastructure failures (DB unavailable / every subset
    hit an exception) so the caller falls back to the bundled JSON path.

    Dedup is by ``material_id``; if the same material surfaces for
    multiple subsets we keep the entry with the highest peak-match score,
    since peak matching is the same regardless of which subset gated it
    in. The merged candidate list is sorted by score and truncated to
    ``top_k``.
    """
    db = xrd_mp_db.get_shared_db(explicit_path)
    if db is None:
        return None
    if not element_subsets:
        return None
    seen: dict[str, dict[str, Any]] = {}
    saw_infrastructure_ok = False
    for subset in element_subsets:
        sub_result = _search_via_mp_db(
            peaks=peaks,
            user_elements=set(subset),
            tolerance_deg=tolerance_deg,
            top_k=top_k,
            wavelength_key=wavelength_key,
            explicit_path=explicit_path,
        )
        if sub_result is None:
            continue
        saw_infrastructure_ok = True
        if not sub_result.get("success"):
            continue
        for cand in sub_result.get("data", {}).get("candidates", []):
            mid = cand.get("material_id")
            if not isinstance(mid, str) or not mid:
                continue
            prev = seen.get(mid)
            if prev is None or float(cand.get("score", 0.0)) > float(prev.get("score", 0.0)):
                seen[mid] = cand
    if not saw_infrastructure_ok:
        return None
    merged = sorted(
        seen.values(),
        key=lambda c: (float(c.get("score", 0.0)), int(c.get("matched_peaks", 0))),
        reverse=True,
    )[:top_k]
    return {
        "success": True,
        "source": "mp_db",
        "data": {
            "candidates": merged,
            "count": len(merged),
            "wavelength": wavelength_key,
            "db_size": db.count() if hasattr(db, "count") else None,
            "subsets_queried": len(element_subsets),
        },
    }


def _search_via_mp_db(
    *,
    peaks: list[dict[str, float]],
    user_elements: set[str] | None,
    tolerance_deg: float,
    top_k: int,
    wavelength_key: str,
    explicit_path: str | None,
) -> dict[str, Any] | None:
    """MP DB-backed three-stage search (mirrors lattice-cli):
    1. Element filter (SQL subset match)
    2. Peak prefilter (SQL proximity on strong experimental peaks)
    3. Batch load + greedy one-to-one scoring
    Returns `None` on infrastructure failures so the caller falls back to
    the bundled JSON path."""
    db = xrd_mp_db.get_shared_db(explicit_path)
    if db is None:
        return None
    if not user_elements:
        return None
    try:
        candidate_ids = db.filter_by_elements(sorted(user_elements))
    except Exception:
        return None
    if not candidate_ids:
        return {
            "success": True,
            "source": "mp_db",
            "data": {
                "candidates": [],
                "count": 0,
                "wavelength": wavelength_key,
                "db_size": db.count() if hasattr(db, "count") else None,
            },
        }
    filtered_count = len(candidate_ids)

    # Stage 2: SQL-level peak prefilter on strong experimental peaks
    exp_peaks = [(float(p["position"]), float(p.get("intensity") or 100.0)) for p in peaks]
    strong_positions = sorted(
        [pos for pos, inten in exp_peaks if inten >= 30],
        key=lambda x: -next((inten for pos, inten in exp_peaks if pos == x), 0),
    )[:8]
    if strong_positions:
        try:
            candidate_ids = db.peak_prefilter(
                candidate_ids, strong_positions, 0.5,
            )
        except Exception:
            pass
    if not candidate_ids:
        return {
            "success": True,
            "source": "mp_db",
            "data": {
                "candidates": [],
                "count": 0,
                "wavelength": wavelength_key,
                "db_size": db.count() if hasattr(db, "count") else None,
                "filtered_count": filtered_count,
            },
        }

    # Stage 3: batch load + score
    try:
        candidates = db.get_materials_batch(candidate_ids)
    except Exception:
        return None
    scored: list[dict[str, Any]] = []
    for mat in candidates:
        result = xrd_mp_db.score_peak_match(exp_peaks, mat.peaks, tolerance_deg)
        score = float(result["score"])
        if score <= 0:
            continue
        ref_peaks_wire = [
            {"two_theta": round(tt, 4), "rel_intensity": round(ri, 4)}
            for tt, ri in mat.peaks
        ]
        scored.append({
            "material_id": mat.material_id,
            "formula": mat.formula,
            "space_group": mat.space_group,
            "crystal_system": mat.crystal_system,
            "name": mat.formula,
            "score": round(score, 4),
            "matched_peaks": int(result["matched"]),
            "reference_peaks": int(result["total"]),
            "ref_peaks": ref_peaks_wire,
        })
    scored.sort(
        key=lambda cand: (float(cand["score"]), int(cand["matched_peaks"])),
        reverse=True,
    )
    return {
        "success": True,
        "source": "mp_db",
        "data": {
            "candidates": scored[:top_k],
            "count": len(scored[:top_k]),
            "wavelength": wavelength_key,
            "db_size": db.count(),
            "filtered_count": filtered_count,
            "prefilter_count": len(candidate_ids),
        },
    }


def _filter_two_theta_range(
    x: np.ndarray,
    y: np.ndarray,
    two_theta_min: Any,
    two_theta_max: Any,
) -> tuple[np.ndarray, np.ndarray]:
    lo = _coerce_float(two_theta_min, float(x[0]))
    hi = _coerce_float(two_theta_max, float(x[-1]))
    if lo > hi:
        lo, hi = hi, lo
    mask = (x >= lo) & (x <= hi)
    if not np.any(mask):
        raise ValueError(
            f"no spectrum points inside requested 2θ window {lo:.3f}–{hi:.3f}"
        )
    return x[mask], y[mask]


_FWHM_TO_SIGMA = 1.0 / (2.0 * math.sqrt(2.0 * math.log(2.0)))


def _pseudo_voigt_profile(
    x: np.ndarray, center: float, fwhm_deg: float, eta: float
) -> np.ndarray:
    """Pseudo-Voigt: (1-η)·Gaussian + η·Lorentzian, both normalised to unit
    height at the center. η ∈ [0, 1] captures how Lorentzian the shape
    is; a pure Gaussian is η=0, pure Lorentzian is η=1."""
    # Gaussian component
    sigma = max(fwhm_deg, 1e-6) * _FWHM_TO_SIGMA
    z = (x - center) / sigma
    gauss = np.exp(-0.5 * z * z)
    # Lorentzian component
    gamma = max(fwhm_deg, 1e-6) / 2.0
    lorentz = 1.0 / (1.0 + ((x - center) / gamma) ** 2)
    eta_c = min(max(eta, 0.0), 1.0)
    return (1.0 - eta_c) * gauss + eta_c * lorentz


def _phase_only_profile(
    x: np.ndarray,
    raw_peaks: list[dict[str, Any]],
    *,
    wavelength_a: float,
    lattice_scale: float,
    peak_scale: float,
    zero_shift: float,
    fwhm_deg: float = DEFAULT_FWHM_DEG,
    eta: float = PSEUDO_VOIGT_ETA_SEED,
) -> np.ndarray:
    """Pseudo-Voigt peaks stacked on the scaled lattice. Intensity is
    normalised to the reference's strongest peak so ``peak_scale``
    reflects the observed strongest-peak counts directly — a simple,
    interpretable knob for the UI."""
    if not raw_peaks or peak_scale <= 0:
        return np.zeros_like(x)

    max_intensity = max(float(peak["rel_intensity"]) for peak in raw_peaks) or 1.0
    out = np.zeros_like(x)

    for peak in raw_peaks:
        scaled_d = float(peak["d_A"]) * lattice_scale
        center = _two_theta_from_d(scaled_d, wavelength_a)
        if center is None:
            continue
        center += zero_shift
        rel = float(peak["rel_intensity"]) / max_intensity
        if rel <= 0:
            continue
        out += peak_scale * rel * _pseudo_voigt_profile(x, center, fwhm_deg, eta)

    return out


def _rwp_percent(y_obs: np.ndarray, y_calc: np.ndarray) -> float:
    """Approximate Rwp = 100·√(Σw·(y_obs-y_calc)² / Σw·y_obs²) with
    weights w = 1/max(y_obs, 1). Not normalised by the full Rietveld
    profile but usable as a quality knob in the UI."""
    weights = 1.0 / np.maximum(y_obs, 1.0)
    numerator = float(np.sum(weights * np.square(y_obs - y_calc)))
    denominator = float(np.sum(weights * np.square(y_obs)))
    if denominator <= 0:
        return float("inf")
    return 100.0 * math.sqrt(numerator / denominator)


def _scaled_numeric(value: Any, scale: float) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return float(value) * scale


def _phase_ids_from_params(params: dict[str, Any]) -> list[str]:
    """Collect + dedupe phase ids from either ``phases: [{material_id}]``
    or ``material_ids: [...]``. Renderer uses the latter shape, but
    tests may hand us the former — accept both."""
    phase_ids: list[str] = []
    phases = params.get("phases")
    if isinstance(phases, list):
        for item in phases:
            if isinstance(item, dict):
                material_id = item.get("material_id")
                if isinstance(material_id, str) and material_id:
                    phase_ids.append(material_id)
    material_ids = params.get("material_ids")
    if isinstance(material_ids, list):
        for material_id in material_ids:
            if isinstance(material_id, str) and material_id:
                phase_ids.append(material_id)
    seen: set[str] = set()
    out: list[str] = []
    for material_id in phase_ids:
        if material_id in seen:
            continue
        seen.add(material_id)
        out.append(material_id)
    return out


def _cubic_baseline(x: np.ndarray, b0: float, b1: float, b2: float, b3: float) -> np.ndarray:
    """Polynomial baseline up to cubic order, centred on the window
    midpoint so the coefficients stay well-conditioned regardless of the
    absolute 2θ range."""
    x_c = x - (x[0] + x[-1]) * 0.5
    return b0 + b1 * x_c + b2 * x_c * x_c + b3 * x_c * x_c * x_c


def _fit_single_phase(
    x_obs: np.ndarray,
    y_obs: np.ndarray,
    ref: dict[str, Any],
    *,
    wavelength_a: float,
) -> dict[str, Any]:
    """Fit lattice_scale, peak_scale, zero_shift, per-phase FWHM, η
    (pseudo-Voigt Gaussian/Lorentzian mix), and a cubic baseline so an
    uncorrected background doesn't poison Rwp. Baseline curvature handles
    the common amorphous-hump case without forcing a separate pre-step."""
    raw_peaks = _reference_raw_peaks(ref)
    baseline0 = float(np.percentile(y_obs, 10))
    slope0 = (
        float((y_obs[-1] - y_obs[0]) / (x_obs[-1] - x_obs[0]))
        if x_obs.size > 1 and x_obs[-1] != x_obs[0]
        else 0.0
    )
    peak_scale0 = max(float(np.max(y_obs) - baseline0), 1.0)

    # Parameter order:
    #   0: lattice_scale
    #   1: peak_scale
    #   2: zero_shift (deg)
    #   3: fwhm (deg)           — per-phase Scherrer-ish width
    #   4: eta (0..1)           — pseudo-Voigt mixing
    #   5: b0 (constant)
    #   6: b1 (deg⁻¹)
    #   7: b2 (deg⁻²)
    #   8: b3 (deg⁻³)
    x0 = np.asarray(
        [1.0, peak_scale0, 0.0, DEFAULT_FWHM_DEG, PSEUDO_VOIGT_ETA_SEED,
         baseline0, slope0, 0.0, 0.0],
        dtype=np.float64,
    )
    lower = np.asarray(
        [
            LATTICE_BOUNDS[0], 0.0, ZERO_SHIFT_BOUNDS_DEG[0],
            FWHM_BOUNDS_DEG[0], PSEUDO_VOIGT_ETA_BOUNDS[0],
            -np.inf, -np.inf, -np.inf, -np.inf,
        ],
        dtype=np.float64,
    )
    upper = np.asarray(
        [
            LATTICE_BOUNDS[1], np.inf, ZERO_SHIFT_BOUNDS_DEG[1],
            FWHM_BOUNDS_DEG[1], PSEUDO_VOIGT_ETA_BOUNDS[1],
            np.inf, np.inf, np.inf, np.inf,
        ],
        dtype=np.float64,
    )
    sqrt_weights = 1.0 / np.sqrt(np.maximum(y_obs, 1.0))

    def model(theta: np.ndarray) -> np.ndarray:
        (lattice_scale, peak_scale, zero_shift, fwhm, eta,
         b0, b1, b2, b3) = theta.tolist()
        phase_only = _phase_only_profile(
            x_obs,
            raw_peaks,
            wavelength_a=wavelength_a,
            lattice_scale=lattice_scale,
            peak_scale=peak_scale,
            zero_shift=zero_shift,
            fwhm_deg=fwhm,
            eta=eta,
        )
        return phase_only + _cubic_baseline(x_obs, b0, b1, b2, b3)

    def residuals(theta: np.ndarray) -> np.ndarray:
        return sqrt_weights * (y_obs - model(theta))

    result = least_squares(residuals, x0, bounds=(lower, upper), max_nfev=3000)
    (lattice_scale, peak_scale, zero_shift, fwhm, eta,
     b0, b1, b2, b3) = result.x.tolist()
    phase_only = _phase_only_profile(
        x_obs,
        raw_peaks,
        wavelength_a=wavelength_a,
        lattice_scale=lattice_scale,
        peak_scale=max(peak_scale, 0.0),
        zero_shift=zero_shift,
        fwhm_deg=fwhm,
        eta=eta,
    )
    y_calc = phase_only + _cubic_baseline(x_obs, b0, b1, b2, b3)
    return {
        "ref": ref,
        "material_id": ref.get("id"),
        "lattice_scale": float(lattice_scale),
        "peak_scale": float(max(peak_scale, 0.0)),
        "zero_shift": float(zero_shift),
        "fwhm_deg": float(fwhm),
        "eta": float(min(max(eta, 0.0), 1.0)),
        "b0": float(b0),
        "b1": float(b1),
        "b2": float(b2),
        "b3": float(b3),
        "phase_only": phase_only,
        "y_calc": y_calc,
        "rwp": float(_rwp_percent(y_obs, y_calc)),
        "converged": bool(result.success),
    }


def refine(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Approximate whole-pattern fit across one or more phases.

    Parameters:
    - ``spectrum``: ``{x, y}`` (required) — observed pattern (2θ degrees).
    - ``phases`` or ``material_ids``: list of reference ids to include.
    - ``wavelength`` (optional): radiation label. Defaults to Cu Kα1.
    - ``two_theta_min`` / ``two_theta_max`` (optional): restrict fit window.
    - ``max_phases`` (optional, default 3): keep at most this many after
      ranking by Rwp (lower is better).
    """
    import sys
    print(f"[xrd.refine] called, phase_ids={_phase_ids_from_params(params)}", file=sys.stderr, flush=True)
    try:
        x, y = _extract_spectrum(params, required=True)
        assert x is not None and y is not None
        x_obs, y_obs = _filter_two_theta_range(
            x, y, params.get("two_theta_min"), params.get("two_theta_max"),
        )
    except ValueError as exc:
        return {"success": False, "error": str(exc)}

    phase_ids = _phase_ids_from_params(params)
    if not phase_ids:
        return {
            "success": False,
            "error": "no phases selected — choose one or more search candidates first",
        }

    wavelength_key, wavelength_a = _coerce_wavelength(params.get("wavelength"))
    max_phases = max(_coerce_int(params.get("max_phases"), DEFAULT_MAX_PHASES), 1)

    try:
        references = _load_references()
    except (FileNotFoundError, ValueError) as exc:
        return {"success": False, "error": str(exc)}

    refs_by_id: dict[str, dict[str, Any]] = {}
    for ref in references:
        if isinstance(ref, dict):
            ref_id = ref.get("id")
            if isinstance(ref_id, str) and ref_id:
                refs_by_id[ref_id] = ref

    # MP DB fallback — resolve any phase_ids not found in the JSON.
    still_missing: list[str] = [
        mid for mid in phase_ids
        if mid not in refs_by_id or not _reference_raw_peaks(refs_by_id[mid])
    ]
    if still_missing:
        db = xrd_mp_db.get_shared_db(
            params.get("db_path") if isinstance(params.get("db_path"), str) else None,
        )
        if db is not None:
            try:
                mp_refs = db.get_reference_dicts(still_missing, wavelength_a=wavelength_a)
                refs_by_id.update(mp_refs)
            except Exception:
                pass

    fits: list[dict[str, Any]] = []
    missing: list[str] = []

    print(f"[xrd.refine] refs_by_id keys={list(refs_by_id.keys())[:10]}, phase_ids={phase_ids}", file=sys.stderr, flush=True)

    for material_id in phase_ids:
        ref = refs_by_id.get(material_id)
        if ref is None or not _reference_raw_peaks(ref):
            missing.append(material_id)
            continue
        fits.append(_fit_single_phase(x_obs, y_obs, ref, wavelength_a=wavelength_a))

    print(f"[xrd.refine] fits={len(fits)}, missing={missing}", file=sys.stderr, flush=True)

    if not fits:
        suffix = f" Requested ids: {', '.join(missing)}." if missing else ""
        return {
            "success": False,
            "error": (
                "none of the requested phases have populated reference peaks "
                "in worker/data/xrd_references.json or the MP database." + suffix
            ),
        }

    fits.sort(key=lambda fit: fit["rwp"])
    kept = fits[:max_phases]

    # Per-phase fits are independent, so simply summing `phase_only`
    # double-counts intensity whenever two kept phases claim the same
    # peak. Re-solve amplitudes jointly with an NNLS linear combination
    # over the unit-scaled profiles; a pre-fit linear baseline is
    # subtracted first so NNLS only has to assign nonnegative phase
    # weights, not also absorb background.
    unit_profiles: list[np.ndarray] = []
    for fit in kept:
        peak_scale = float(max(fit["peak_scale"], 1e-6))
        unit = np.asarray(fit["phase_only"], dtype=np.float64) / peak_scale
        unit_profiles.append(np.clip(unit, 0.0, None))

    baseline_b0 = float(np.average([float(fit["b0"]) for fit in kept]))
    baseline_b1 = float(np.average([float(fit["b1"]) for fit in kept]))
    baseline_b2 = float(np.average([float(fit["b2"]) for fit in kept]))
    baseline_b3 = float(np.average([float(fit["b3"]) for fit in kept]))
    baseline = _cubic_baseline(
        x_obs, baseline_b0, baseline_b1, baseline_b2, baseline_b3,
    )
    y_resid = np.clip(y_obs - baseline, 0.0, None)

    design = np.column_stack(unit_profiles)
    try:
        amplitudes, _ = nnls(design, y_resid, maxiter=200)
    except RuntimeError:
        # NNLS rarely fails, but if it does fall back to per-phase
        # peak_scale — at least the combined curve is internally
        # consistent per fit even if it overcounts.
        amplitudes = np.asarray(
            [float(max(fit["peak_scale"], 0.0)) for fit in kept],
            dtype=np.float64,
        )

    if float(np.sum(amplitudes)) <= 0:
        amplitudes = np.ones(len(kept), dtype=np.float64)
    normalized_weights = amplitudes / float(np.sum(amplitudes))

    y_calc = baseline.copy()
    for amp, unit in zip(amplitudes, unit_profiles):
        y_calc = y_calc + amp * unit
    y_diff = y_obs - y_calc
    final_rwp = float(_rwp_percent(y_obs, y_calc))

    phases: list[dict[str, Any]] = []
    for idx, fit in enumerate(kept):
        ref = fit["ref"]
        lattice_scale = float(fit["lattice_scale"])
        rwp = float(fit["rwp"])
        phases.append(
            {
                "material_id": fit["material_id"],
                "phase_name": (
                    ref.get("name") or ref.get("formula") or fit["material_id"]
                ),
                # Formula is the RIR-table join key the frontend uses for
                # quantitative phase analysis (see src/lib/xrd-rir.ts).
                # Safe to pass through unchanged — users edit the local
                # xrd_references.json when they need alt conventions.
                "formula": ref.get("formula"),
                "hermann_mauguin": ref.get("space_group"),
                "a": _scaled_numeric(ref.get("a"), lattice_scale),
                "b": _scaled_numeric(ref.get("b"), lattice_scale),
                "c": _scaled_numeric(ref.get("c"), lattice_scale),
                # Isotropic scaling preserves cell angles — pass through.
                "alpha": (
                    float(ref["alpha"])
                    if isinstance(ref.get("alpha"), (int, float))
                    else None
                ),
                "beta": (
                    float(ref["beta"])
                    if isinstance(ref.get("beta"), (int, float))
                    else None
                ),
                "gamma": (
                    float(ref["gamma"])
                    if isinstance(ref.get("gamma"), (int, float))
                    else None
                ),
                "refined_lattice_scale": round(lattice_scale, 6),
                "refined_zero_shift": round(float(fit["zero_shift"]), 6),
                "weight_pct": round(float(normalized_weights[idx] * 100.0), 3),
                "confidence": round(1.0 / max(rwp, 1e-6), 6),
                "analysis_method": ANALYSIS_METHOD,
            }
        )

    summary = (
        f"Approximate isotropic fit over {len(kept)} phase(s) at "
        f"{wavelength_key} λ, Rwp={final_rwp:.2f}%"
    )
    return {
        "success": True,
        "summary": summary,
        "data": {
            "analysis_method": ANALYSIS_METHOD,
            "phases": phases,
            "rwp": final_rwp,
            "gof": final_rwp,
            "converged": all(bool(fit["converged"]) for fit in kept),
            "x": x_obs.tolist(),
            "y_obs": y_obs.tolist(),
            "y_calc": y_calc.tolist(),
            "y_diff": y_diff.tolist(),
        },
    }
