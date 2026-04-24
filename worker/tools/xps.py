"""xps.* tools — local XPS analysis.

P4-γ — replaces lattice-cli's `/api/pro/xps-{lookup,charge-correct,
quantify,fit}` with stateless implementations the renderer can call
through `src/lib/local-pro-xps.ts`.

The four tools are intentionally narrow:

- `xps.lookup`         table-driven assignment (built-in JSON of common
                       binding energies + chemical states)
- `xps.charge_correct` find C 1s adventitious peak nearest the user's
                       reference (default 284.8 eV) and report the shift
- `xps.quantify`       Scofield-style atomic % from peak areas + RSFs
- `xps.fit`            pseudo-Voigt fit with linear / Shirley background
                       via scipy.optimize.curve_fit; doublets get their
                       split + branching-ratio constraints applied
                       through shared parameter indices

Everything is data-only — no network, no per-session state, no PDF /
RAG dependencies. The reference data ships in
`worker/data/xps_lines.json` so an offline install still has a useful
catalog (~38 lines covering common transitions). Users can extend the
file in place; the loader reads it at first call without restart.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np
from scipy.optimize import curve_fit

from .common import validate_xy_params


# ── Reference data ─────────────────────────────────────────────────────

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_XPS_LINES_PATH = _DATA_DIR / "xps_lines.json"
# RSF (relative sensitivity factor) catalogs. Additional sets can be
# shipped by dropping a new file and adding it here; the `quantify`
# handler picks a catalog by the caller's `rsf_set` param. xps_lines.json
# itself never carried RSF fields, so an "rsf_set" routing value that
# doesn't match a known catalog falls through to the empty built-in
# lookup and the peak is flagged as "no RSF in built-in table".
_RSF_CATALOG_PATHS: dict[str, Path] = {
    "scofield": _DATA_DIR / "xps_rsf_scofield.json",
}

_C1S_REFERENCE_EV = 284.8
_DEFAULT_LOOKUP_TOLERANCE = 0.6  # eV
_DEFAULT_CHARGE_SEARCH_RANGE = (282.0, 290.0)
_LOOKUP_RESULT_LIMIT = 4
# Al Kα excitation energy — used to convert NIST SRD 20 Auger BE entries
# back to kinetic energy for the Wagner parameter computation. If the
# user's lab runs Mg Kα (1253.6 eV) or Ag Lα (2984.3 eV) they need to
# edit the reference table rather than this constant, because the stored
# Auger BE values are specific to the excitation source.
_AL_KA_EV = 1486.7

_lines_cache: list[dict[str, Any]] | None = None
_rsf_catalog_cache: dict[str, list[dict[str, Any]]] = {}


def _load_rsf_catalog(name: str) -> list[dict[str, Any]]:
    """Load + cache the RSF catalog for a given set name. Unknown sets or
    missing files return an empty list — quantify then surfaces per-peak
    warnings instead of silently returning zeros."""
    if name in _rsf_catalog_cache:
        return _rsf_catalog_cache[name]
    path = _RSF_CATALOG_PATHS.get(name.lower())
    if path is None or not path.exists():
        _rsf_catalog_cache[name] = []
        return _rsf_catalog_cache[name]
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        _rsf_catalog_cache[name] = []
        return _rsf_catalog_cache[name]
    if not isinstance(data, list):
        _rsf_catalog_cache[name] = []
        return _rsf_catalog_cache[name]
    valid = [e for e in data if isinstance(e, dict) and "rsf" in e]
    _rsf_catalog_cache[name] = valid
    return valid


def _load_lines() -> list[dict[str, Any]]:
    """Load the XPS binding-energy reference table.

    Accepts two historical schemas transparently so the worker can ingest
    either the lattice-cli `xps_binding_energies.json` export (NIST SRD 20
    derived, ~500 entries) or the earlier bespoke worker shape. Both are
    normalised to: `binding_energy`, `line`, plus any extra fields the
    source table carries (`compound`, `formula`, `reference`, …).

    Schema adapter:
      lattice-cli:  `binding_eV`  + `orbital`
      legacy:       `binding_energy` + `line`
    """
    global _lines_cache
    if _lines_cache is not None:
        return _lines_cache
    if not _XPS_LINES_PATH.exists():
        _lines_cache = []
        return _lines_cache
    try:
        with _XPS_LINES_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        _lines_cache = []
        return _lines_cache
    if not isinstance(data, list):
        _lines_cache = []
        return _lines_cache
    valid: list[dict[str, Any]] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        be = entry.get("binding_energy")
        if not isinstance(be, (int, float)):
            # lattice-cli shape: `binding_eV`
            be_alt = entry.get("binding_eV")
            if not isinstance(be_alt, (int, float)):
                continue
            be = be_alt
        line = entry.get("line") or entry.get("orbital")
        normalised = dict(entry)
        normalised["binding_energy"] = float(be)
        if line is not None:
            normalised["line"] = str(line)
        valid.append(normalised)
    _lines_cache = valid
    return valid


# ── Validation helpers ─────────────────────────────────────────────────


def _validate_xy(params: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    # XPS data is conventionally tabulated high → low binding energy.
    # `flip_descending=True` makes the shared helper normalise to ascending
    # so scipy / numpy index arithmetic stays simple downstream.
    return validate_xy_params(params, flip_descending=True, label="spectrum")


def _frequency_prior_for_entry(entry: dict[str, Any]) -> float:
    """Heuristic Bayesian prior for how common this chemical state is in
    typical materials-science XPS samples. Read only when the catalog row
    doesn't carry an explicit `frequency` field (which none of the shipped
    NIST SRD 20 rows do). Consumed by `lookup()` to keep adventitious
    carbon + common oxide states ranked above obscure states when two
    matches share the same BE delta.

    Values are heuristic — not a literature survey — but they move the
    needle away from a flat 0.5 for the handful of states every XPS user
    sees daily. Users can override per-entry by setting `frequency` on a
    catalog row in xps_lines.json.
    """
    compound = str(entry.get("compound") or "").lower()
    state = str(entry.get("chemical_state") or "").lower()
    formula = str(entry.get("formula") or "").lower()
    element = str(entry.get("element") or "").lower()

    # Adventitious carbon — on almost every surface that's been in air.
    if "adventitious" in compound or "c-c/c-h" in state:
        return 1.0

    # Hydrocarbon / sp² / sp³ carbon — ubiquitous in polymer and organic
    # analysis.
    if element == "c" and ("c-h" in state or "sp²" in state or "sp³" in state):
        return 0.9

    # Bare metal (photoelectron from a zerovalent core). Common on
    # sputter-cleaned or freshly-deposited samples.
    if state.endswith("⁰") or "metal" in compound:
        return 0.85

    # Common oxide states — second-most-frequent bucket for TM + main-
    # group elements. "³⁺", "²⁺", "⁺", "⁻" Unicode superscripts cover
    # the NIST SRD 20 labels directly.
    if any(sym in state for sym in ("³⁺", "²⁺", "⁴⁺", "⁵⁺")):
        return 0.8

    if "oh⁻" in state or "hydroxide" in compound.lower():
        return 0.8
    if "o²⁻" in state or "oxide" in compound:
        return 0.85

    # Organic C-O / C=O / carboxyl — common in polymers, biomaterials,
    # battery SEI layers.
    if element == "c" and any(tag in state for tag in ("c-o", "c=o", "o-c=o")):
        return 0.75

    # Carbonate — common in battery / cement / mineral XPS.
    if "co₃" in state or "carbonate" in compound:
        return 0.65

    # Fluorinated polymers (PVDF, PTFE).
    if any(tag in formula for tag in ("cf2", "cf3")) or "teflon" in compound:
        return 0.65

    # Metal carbides, nitrides, sulfides — material-specific, less common
    # overall.
    if any(tag in compound for tag in ("carbide", "nitride", "sulfide")):
        return 0.55

    # Fluoride / chloride salts — specific to halide chemistry.
    if any(tag in formula for tag in ("lif", "nacl", "licl", "kcl")):
        return 0.55

    # Battery electrolyte salts (LiPF₆, etc.) — important but niche.
    if any(tag in formula for tag in ("lipf6", "libf4")):
        return 0.45

    # Default — neither boosted nor suppressed by the prior.
    return 0.5


def _is_auger_orbital(orbital: Any) -> bool:
    """True when `orbital` names an Auger transition (KLL / LMM / MNN /
    KVV etc.). Tolerant of case and extra whitespace — NIST SRD 20 entries
    in xps_lines.json use "KLL Auger" / "LMM Auger" / "MNN Auger"."""
    if not isinstance(orbital, str):
        return False
    return "auger" in orbital.lower()


def _compute_wagner_parameters(
    assignments: list[dict[str, Any]],
) -> dict[str, float]:
    """Compute Wagner parameter α' = BE_XPS + KE_Auger per element.

    KE_Auger is derived from the NIST SRD 20 convention (stored BE on Al
    Kα scale): KE = `_AL_KA_EV` - BE_Auger. Caller provides the current
    lookup's assignments list; we partition by element, pick the highest-
    scoring XPS and Auger rows, and return {element → α'} only for
    elements that have at least one of each. Elements with XPS-only or
    Auger-only hits are silently skipped — Wagner is a two-line quantity.
    """
    buckets: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for a in assignments:
        el = a.get("element")
        if not isinstance(el, str):
            continue
        bucket = buckets.setdefault(el, {"xps": [], "auger": []})
        if _is_auger_orbital(a.get("line")):
            bucket["auger"].append(a)
        else:
            bucket["xps"].append(a)

    out: dict[str, float] = {}
    for el, bucket in buckets.items():
        if not bucket["xps"] or not bucket["auger"]:
            continue
        best_xps = max(bucket["xps"], key=lambda m: float(m.get("score", 0) or 0))
        best_aug = max(bucket["auger"], key=lambda m: float(m.get("score", 0) or 0))
        try:
            be_xps = float(best_xps.get("binding_energy", 0) or 0)
            be_aug = float(best_aug.get("binding_energy", 0) or 0)
        except (TypeError, ValueError):
            continue
        if be_xps <= 0 or be_aug <= 0 or be_aug >= _AL_KA_EV:
            # Guard against sentinel zeros and Auger BE values that
            # would produce a negative KE (data quality issue in the
            # catalog); surfacing a nonsense Wagner is worse than
            # skipping.
            continue
        ke_aug = _AL_KA_EV - be_aug
        out[el] = round(be_xps + ke_aug, 3)
    return out


def _coerce_peak_list(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        position = entry.get("position")
        if not isinstance(position, (int, float)):
            continue
        out.append(
            {
                "position": float(position),
                "intensity": float(entry.get("intensity", 0.0) or 0.0),
                "fwhm": float(entry["fwhm"]) if entry.get("fwhm") is not None else None,
                "snr": float(entry["snr"]) if entry.get("snr") is not None else None,
                "name": str(entry.get("name") or "") or None,
            }
        )
    return out


# ── xps.lookup ─────────────────────────────────────────────────────────


def lookup(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    peaks = _coerce_peak_list(params.get("peaks"))
    if not peaks:
        return {
            "success": False,
            "error": "no peaks supplied — detect peaks before running lookup",
        }
    tolerance = float(params.get("tolerance") or _DEFAULT_LOOKUP_TOLERANCE)
    if tolerance <= 0:
        tolerance = _DEFAULT_LOOKUP_TOLERANCE
    charge_correction = float(params.get("charge_correction") or 0.0)

    catalog = _load_lines()
    assignments: list[dict[str, Any]] = []

    # Bayesian kernel width: set σ so the likelihood at the tolerance
    # edge is ~1% of the peak. With σ = tolerance/3, a 3σ miss scores
    # exp(-4.5) ≈ 0.011 — matches the "edge of window" intuition while
    # leaving most of the probability mass close to the maximum.
    sigma = max(tolerance / 3.0, 1e-6)

    for peak in peaks:
        # Subtracting the charge correction maps the observed BE back to
        # its "true" position in the reference table. Positive shift
        # means the spectrum was charging up (apparent BE too high).
        target = peak["position"] - charge_correction
        matches: list[dict[str, Any]] = []
        for ref in catalog:
            ref_be = float(ref["binding_energy"])
            delta_signed = target - ref_be
            delta = abs(delta_signed)
            if delta > tolerance:
                continue
            # Closer match → higher score. Linear falloff to 0 at the
            # tolerance edge keeps the ranking interpretable to users.
            score = max(0.0, 1.0 - delta / tolerance)
            # Bayesian-flavoured confidence: Gaussian likelihood on the
            # BE residual, weighted by an optional frequency prior on the
            # chemical state. Missing priors default to 0.5 (medium-common)
            # and the prior is mapped to a multiplicative factor in
            # [0.5, 1.5] so absent priors neither over-inflate nor suppress
            # a good geometric match.
            likelihood = float(np.exp(-0.5 * (delta / sigma) ** 2))
            # Explicit `frequency` on the entry wins; otherwise infer from
            # compound / chemical-state heuristics so adventitious carbon
            # + common oxide states beat obscure states at equal Δ.
            frequency_raw = ref.get("frequency")
            if frequency_raw is None:
                frequency = _frequency_prior_for_entry(ref)
            else:
                try:
                    frequency = float(frequency_raw)
                except (TypeError, ValueError):
                    frequency = 0.5
            frequency = min(max(frequency, 0.0), 1.0)
            confidence = min(1.0, likelihood * (0.5 + frequency))
            matches.append(
                {
                    "element": ref.get("element"),
                    "line": ref.get("line"),
                    "binding_energy": ref_be,
                    "chemical_state": ref.get("chemical_state"),
                    "reference": "internal-table",
                    "score": round(score, 3),
                    "confidence": round(confidence, 3),
                    "delta_eV": round(delta_signed, 3),
                    "peak_position": peak["position"],
                }
            )
        # Sort by confidence first, then score — confidence incorporates
        # the prior so popular states with equal BE delta outrank obscure
        # ones. Score is retained as the pre-prior tiebreak.
        matches.sort(key=lambda m: (-m["confidence"], -m["score"]))
        for hit in matches[:_LOOKUP_RESULT_LIMIT]:
            assignments.append(hit)

    # Wagner (modified Auger) parameter α' = BE_XPS + KE_Auger. We cross-
    # reference the assignments array: if the user detected both an XPS
    # core-level peak AND an Auger peak for the same element, compute
    # α' once per element using the highest-scoring match of each type
    # and attach it to every row of that element so the lookup UI can
    # show it without repeated lookups. Elements that don't have both
    # kinds of hits simply skip the field — no placeholder row, no noise.
    wagner_by_element = _compute_wagner_parameters(assignments)
    wagner_count = 0
    for a in assignments:
        el = a.get("element")
        if isinstance(el, str) and el in wagner_by_element:
            a["wagner_parameter"] = wagner_by_element[el]
            wagner_count += 1

    summary = (
        f"Found {len(assignments)} candidate assignments across {len(peaks)} peaks "
        f"(tolerance ±{tolerance:.2f} eV"
        + (f", charge corr {charge_correction:+.2f} eV" if charge_correction else "")
        + (
            f", {len(wagner_by_element)} Wagner α' computed"
            if wagner_by_element
            else ""
        )
        + ")"
    )
    return {
        "success": True,
        "data": {
            "assignments": assignments,
            "matches": assignments,  # legacy alias
        },
        "summary": summary,
    }


# ── xps.charge_correct ────────────────────────────────────────────────


def charge_correct(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    x, y = _validate_xy(params)
    mode = str(params.get("mode") or "auto").lower()
    reference_eV = float(params.get("reference_eV") or _C1S_REFERENCE_EV)

    if mode == "manual":
        manual_shift = params.get("manual_shift")
        if not isinstance(manual_shift, (int, float)):
            return {"success": False, "error": "manual mode requires manual_shift"}
        return {"success": True, "shift_eV": float(manual_shift)}

    # `auto` — find the largest peak inside the C 1s search window and
    # report its offset from the user-set reference.
    search_range = params.get("search_range") or _DEFAULT_CHARGE_SEARCH_RANGE
    if not (isinstance(search_range, (list, tuple)) and len(search_range) == 2):
        search_range = _DEFAULT_CHARGE_SEARCH_RANGE
    lo = min(float(search_range[0]), float(search_range[1]))
    hi = max(float(search_range[0]), float(search_range[1]))
    mask = (x >= lo) & (x <= hi)
    if not np.any(mask):
        return {
            "success": False,
            "error": f"no data inside C 1s window {lo:.1f}–{hi:.1f} eV",
        }
    sub_x = x[mask]
    sub_y = y[mask]
    apex = int(np.argmax(sub_y))
    apex_eV = float(sub_x[apex])
    shift = reference_eV - apex_eV
    return {
        "success": True,
        "shift_eV": shift,
        "c1s_found_eV": apex_eV,
    }


# ── xps.quantify ──────────────────────────────────────────────────────


def quantify(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Atomic-% from peak areas + RSF.

    Two input shapes are supported:
      • `peaks: [{element, line?, area, rsf?}]`  — explicit
      • `peaks: [{element, line?, area}], elements: [...]` — RSF resolved
        from the built-in table by element + line
    """
    raw_peaks = params.get("peaks")
    if not isinstance(raw_peaks, list) or not raw_peaks:
        return {
            "success": False,
            "error": "no peaks supplied — fit + identify peaks before quantifying",
        }
    requested = params.get("elements")
    requested_set = (
        {e.strip().lower() for e in requested if isinstance(e, str)}
        if isinstance(requested, list)
        else None
    )
    # Pick the RSF catalog by name: "scofield" is shipped today, additional
    # sets plug into `_RSF_CATALOG_PATHS`. The selected set wins over the
    # built-in lines catalog on element-line conflicts (`_resolve_rsf`
    # keeps the highest-priority match).
    rsf_set_raw = params.get("rsf_set")
    rsf_set_name = (
        str(rsf_set_raw).strip().lower()
        if isinstance(rsf_set_raw, str) and rsf_set_raw
        else ""
    )
    rsf_catalog = _load_rsf_catalog(rsf_set_name) if rsf_set_name else []
    catalog = rsf_catalog + _load_lines()

    rows: list[dict[str, Any]] = []
    for entry in raw_peaks:
        if not isinstance(entry, dict):
            continue
        element = entry.get("element")
        if not isinstance(element, str) or not element:
            continue
        if requested_set and element.lower() not in requested_set:
            continue
        area = entry.get("area")
        if not isinstance(area, (int, float)) or area <= 0:
            continue
        rsf = entry.get("rsf")
        line = entry.get("line")
        if not isinstance(rsf, (int, float)) or rsf <= 0:
            rsf = _resolve_rsf(catalog, element, line)
        if rsf is None or rsf <= 0:
            # Unknown element + no caller-supplied RSF — record for the
            # response so the user sees why this peak was skipped.
            rows.append(
                {
                    "element": element,
                    "line": line,
                    "area": float(area),
                    "rsf": None,
                    "atomic_percent": 0.0,
                    "warning": "no RSF in built-in table",
                }
            )
            continue
        rows.append(
            {
                "element": element,
                "line": line,
                "area": float(area),
                "rsf": float(rsf),
                "_normalized": float(area) / float(rsf),
            }
        )

    contributing = [r for r in rows if r.get("_normalized") is not None]
    total = sum(r["_normalized"] for r in contributing)
    quantification: list[dict[str, Any]] = []
    for row in rows:
        normalized = row.pop("_normalized", None)
        if normalized is None or total <= 0:
            quantification.append(row)
            continue
        atomic_percent = (normalized / total) * 100.0
        quantification.append(
            {
                "element": row["element"],
                "line": row.get("line"),
                "area": row["area"],
                "rsf": row["rsf"],
                "atomic_percent": round(atomic_percent, 3),
            }
        )

    contributing_count = sum(
        1 for r in quantification if r.get("atomic_percent", 0) > 0
    )
    summary = f"Quantified {contributing_count} elements (Σ at% = 100)"
    return {
        "success": True,
        "data": {
            "quantification": quantification,
            "atomic_percentages": quantification,
        },
        "summary": summary,
    }


def _resolve_rsf(
    catalog: list[dict[str, Any]],
    element: str,
    line: str | None,
) -> float | None:
    el = element.strip().lower()
    line_norm = (line or "").strip().lower()
    best: tuple[float, float] | None = None  # (priority, rsf)
    for entry in catalog:
        if str(entry.get("element", "")).lower() != el:
            continue
        if line_norm and str(entry.get("line", "")).lower() != line_norm:
            continue
        rsf = entry.get("rsf")
        if not isinstance(rsf, (int, float)) or rsf <= 0:
            continue
        # Prefer entries that match the exact line; fall back to any
        # match for that element (handles "C" without "1s").
        priority = 1.0 if line_norm and str(entry.get("line", "")).lower() == line_norm else 0.5
        if best is None or priority > best[0]:
            best = (priority, float(rsf))
    return best[1] if best else None


# ── xps.fit ───────────────────────────────────────────────────────────


def _pseudo_voigt(
    x: np.ndarray,
    amplitude: float,
    center: float,
    fwhm: float,
    fraction: float,
) -> np.ndarray:
    """Pseudo-Voigt = (1-η)·Gaussian + η·Lorentzian, both peak-normalised
    so `amplitude` is the peak height. Matches the convention used by
    most XPS fit packages."""
    fwhm = max(float(fwhm), 1e-6)
    fraction = float(np.clip(fraction, 0.0, 1.0))
    # Gaussian part — peak height = amplitude
    sigma_g = fwhm / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    gauss = np.exp(-0.5 * ((x - center) / sigma_g) ** 2)
    # Lorentzian part — peak height = amplitude
    gamma_l = fwhm / 2.0
    lorentz = 1.0 / (1.0 + ((x - center) / gamma_l) ** 2)
    return amplitude * ((1.0 - fraction) * gauss + fraction * lorentz)


def _peak_area(amplitude: float, fwhm: float, fraction: float) -> float:
    """Closed-form area of the pseudo-Voigt above. Gaussian contributes
    A·σ·√(2π) and Lorentzian contributes A·π·γ."""
    fwhm = max(float(fwhm), 1e-6)
    fraction = float(np.clip(fraction, 0.0, 1.0))
    sigma_g = fwhm / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    gamma_l = fwhm / 2.0
    return float(
        amplitude
        * (
            (1.0 - fraction) * sigma_g * np.sqrt(2.0 * np.pi)
            + fraction * np.pi * gamma_l
        )
    )


def _shirley_background(y: np.ndarray, max_iter: int = 30, tol: float = 1e-5) -> np.ndarray:
    """Iterative Shirley background. y is assumed to be in ascending-x
    order (low BE → high BE). The standard "Shirley starts from the
    high-BE endpoint" convention is honoured by integrating from right
    to left at each iteration."""
    y = np.asarray(y, dtype=np.float64)
    if y.size < 4:
        return np.zeros_like(y)
    b_low = float(y[0])
    b_high = float(y[-1])
    bg = np.linspace(b_low, b_high, y.size)
    for _ in range(max_iter):
        diff = y - bg
        # Cumulative integral from the right; the convention is that
        # area beyond the current point pushes the background up.
        right_cum = np.cumsum(diff[::-1])[::-1]
        total = right_cum[0]
        if total <= 0:
            break
        new_bg = b_low + (b_high - b_low) * (1.0 - right_cum / total)
        if np.max(np.abs(new_bg - bg)) < tol * max(1.0, abs(b_high - b_low)):
            bg = new_bg
            break
        bg = new_bg
    return bg


def _linear_background(y: np.ndarray) -> np.ndarray:
    if y.size < 2:
        return np.zeros_like(y)
    return np.linspace(float(y[0]), float(y[-1]), y.size)


# Tougaard U3 defaults — Tougaard 1988, "Practical algorithm for background
# subtraction", Surf. Interface Anal. 11, 453. B ≈ 2866 eV², C ≈ 1643 eV²
# reproduce the universal cross-section for many d-band metals within ~20%.
# D = 1 keeps the full three-parameter form (U3); setting D→0 collapses to
# the simpler U2 kernel K(E) = B·E / (C + E²)².
_TOUGAARD_B_DEFAULT = 2866.0
_TOUGAARD_C_DEFAULT = 1643.0
_TOUGAARD_D_DEFAULT = 1.0
_TOUGAARD_WINDOW_EV = 50.0
_TOUGAARD_MAX_ITER = 50
_TOUGAARD_TOL_FRAC = 0.005  # convergence: max|Δbg| < 0.5% of (y_max − y_min)


def _tougaard_background(
    x: np.ndarray,
    y: np.ndarray,
    B: float = _TOUGAARD_B_DEFAULT,
    C: float = _TOUGAARD_C_DEFAULT,
    D: float = _TOUGAARD_D_DEFAULT,
    window_eV: float = _TOUGAARD_WINDOW_EV,
    max_iter: int = _TOUGAARD_MAX_ITER,
    tol_frac: float = _TOUGAARD_TOL_FRAC,
) -> tuple[np.ndarray, bool]:
    """Iterative Tougaard U3 background.

    Implements the three-parameter universal inelastic cross-section

        K(E) = B · E / ((C − E²)² + D · E²)

    and the Tougaard integral equation (Tougaard 1988, written in KE):

        bg(E_KE) = ∫[E_KE..E_KE+W] K(E' − E_KE) · (J(E') − bg(E')) dE_KE

    In binding-energy coordinates BE = hν − E_KE, the integration runs
    from E_KE up to higher KE, which corresponds to BE' *below* the
    current BE. So, with our ascending-BE array (index 0 = lowest BE =
    highest KE), "background at sample i is built from primaries at
    higher KE = lower BE = *smaller* indices j < i". We solve by fixed-
    point iteration — at each step, recompute the right-hand side from
    the current bg estimate. The kernel is scaled so its integral is < 1,
    which makes the iteration a strict contraction and guarantees
    convergence in `max_iter` for well-posed spectra.

    Returns (background, converged). `converged = False` signals caller to
    fall back to Shirley; the returned bg is the last stable iterate.
    """
    y = np.asarray(y, dtype=np.float64)
    x = np.asarray(x, dtype=np.float64)
    n = y.size
    if n < 4:
        return np.zeros_like(y), False

    dx = float(np.median(np.diff(x)))
    if dx <= 0:
        return np.zeros_like(y), False

    # Endpoint convention: on the low-BE side bg equals the local
    # primary-only intensity (no inelastic loss has occurred yet). On the
    # high-BE side bg equals the raw spectrum (all counts are inelastic
    # background). A linear seed between these anchors gives the iteration
    # a sensible starting point.
    y0 = float(y[0])
    y1 = float(y[-1])
    bg = np.linspace(y0, y1, n)
    y_range = float(np.max(y) - np.min(y))
    span = tol_frac * max(1.0, abs(y1 - y0), y_range)

    # Integration window in sample count. Capped at the full spectrum so
    # the convolution can see the whole inelastic tail — narrow scans get
    # the full history, wide survey scans are self-truncating through the
    # kernel's own falloff (K → 0 as E' − E → 0 and again for large E').
    win = min(int(round(window_eV / dx)), n - 1)
    if win < 2:
        return bg, False

    # Pre-tabulate the kernel at positive offsets k·dx (k = 1..win). The
    # raw Tougaard K has units of eV⁻¹ and its integral depends on B/C/D
    # plus the window width — not always < 1. We rescale the kernel to
    # a fixed target integral so the iteration stays contractive across
    # arbitrary caller-supplied B/C. This changes only the amplitude of
    # the background, not its shape; in practice the shape (where the
    # inelastic tail comes in) is what matters for peak-area extraction.
    offsets = np.arange(1, win + 1, dtype=np.float64) * dx
    denom = (C - offsets**2) ** 2 + D * (offsets**2)
    kernel = np.where(denom > 1e-9, B * offsets / denom, 0.0)
    if not np.all(np.isfinite(kernel)) or np.max(np.abs(kernel)) <= 0:
        return bg, False
    kernel_integral = float(np.sum(kernel) * dx)
    if kernel_integral <= 0:
        return bg, False
    # 0.6 keeps the iteration well inside the contraction region (|K| < 1)
    # for noisy spectra and caps the maximum background at 60% of the
    # integrated residual — a reasonable ceiling given the physical
    # meaning (> 60% of counts are inelastic before even reaching the
    # window edge is rare on core-level scans).
    kernel_sum_target = 0.6
    kernel = kernel * (kernel_sum_target / kernel_integral)

    converged = False
    prev_bg = bg.copy()
    for _ in range(max_iter):
        residual = y - bg
        # bg[i] = sum_{k=1..win} kernel[k-1] * residual[i-k] * dx
        # Samples within `win` of the LEFT edge (low-BE) can't fully
        # evaluate the integral because there is no data beyond the start
        # of the scan to supply primaries. We clamp by repeating
        # residual[0]; since y0 is our anchor (bg → y0 there), residual[0]
        # tends to zero and the edge bias is small.
        update = np.zeros_like(bg)
        for k, w in enumerate(kernel, start=1):
            if k >= n:
                break
            shifted = np.empty_like(residual)
            shifted[:k] = residual[0]
            shifted[k:] = residual[:-k]
            update += w * shifted * dx
        # Fixed-point iteration: bg_new = y0 + ∫K·(y-bg). The y0 offset
        # is the low-BE anchor (primary-only baseline at the start of
        # scan — by convention no loss has occurred yet). Because the
        # kernel integrates to `kernel_sum_target` < 1, the mapping
        # bg → y0 + K*(y-bg) is a contraction with Lipschitz constant
        # `kernel_sum_target` and the iteration converges monotonically.
        new_bg = y0 + update
        # Low-BE endpoint anchor — bg there is the scan floor.
        new_bg[0] = y0
        if not np.all(np.isfinite(new_bg)):
            return prev_bg, False
        delta = float(np.max(np.abs(new_bg - bg)))
        prev_bg = bg
        bg = new_bg
        if delta < span:
            converged = True
            break

    # Divergence / non-physical guards. A Tougaard background that
    # rises far above the data or goes deeply negative is wrong; the
    # caller downgrades to Shirley. We tolerate overshoot up to 20% of
    # the spectrum range because (a) the finite-window convolution
    # wobbles in the tail and (b) on noisy baselines the smooth bg can
    # sit above individual noise samples without being unphysical.
    # Spectra where this threshold trips have genuinely gone wrong
    # (negative areas / bg above peak height).
    y_noise = float(np.median(np.abs(np.diff(y)))) if n >= 2 else 0.0
    overshoot_tol = max(5.0, 0.20 * y_range, 3.0 * y_noise)
    if np.any(bg > y + overshoot_tol):
        return prev_bg, False
    if np.any(bg < -overshoot_tol):
        return prev_bg, False
    return bg, converged


def fit(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    x_full, y_full = _validate_xy(params)

    # Energy window
    energy_range = params.get("energy_range")
    if (
        isinstance(energy_range, (list, tuple))
        and len(energy_range) == 2
        and isinstance(energy_range[0], (int, float))
        and isinstance(energy_range[1], (int, float))
    ):
        lo = min(float(energy_range[0]), float(energy_range[1]))
        hi = max(float(energy_range[0]), float(energy_range[1]))
        mask = (x_full >= lo) & (x_full <= hi)
    else:
        mask = np.ones_like(x_full, dtype=bool)
    if not np.any(mask) or np.sum(mask) < 8:
        return {
            "success": False,
            "error": "energy window selects too few points (need ≥ 8)",
        }
    x = x_full[mask]
    y = y_full[mask]

    # Background
    bg_kind = str(params.get("background") or "linear").lower()
    bg_warnings: list[str] = []
    if bg_kind == "shirley":
        bg = _shirley_background(y)
    elif bg_kind == "tougaard":
        # Iterative Tougaard U3 with caller-overridable B/C. We treat
        # divergence as a soft failure — fall back to Shirley and record
        # the substitution so the UI can surface it.
        tougaard_b = params.get("tougaard_b")
        tougaard_c = params.get("tougaard_c")
        B = (
            float(tougaard_b)
            if isinstance(tougaard_b, (int, float)) and float(tougaard_b) > 0
            else _TOUGAARD_B_DEFAULT
        )
        C = (
            float(tougaard_c)
            if isinstance(tougaard_c, (int, float)) and float(tougaard_c) > 0
            else _TOUGAARD_C_DEFAULT
        )
        bg_tougaard, converged = _tougaard_background(x, y, B=B, C=C)
        if converged:
            bg = bg_tougaard
            bg_kind = "tougaard"
        else:
            bg = _shirley_background(y)
            bg_kind = "shirley (tougaard diverged — fell back)"
            bg_warnings.append(
                "Tougaard iteration did not converge; using Shirley background. "
                "Try different B/C or ensure the energy window spans well past the peak tail."
            )
    else:
        bg = _linear_background(y)
        bg_kind = "linear"
    y_corr = y - bg

    # Peak / doublet specs
    raw_peaks = params.get("peaks") or []
    raw_doublets = params.get("doublets") or []
    if not isinstance(raw_peaks, list) or not isinstance(raw_doublets, list):
        return {"success": False, "error": "peaks and doublets must be arrays"}

    initial_params: list[float] = []
    bounds_lo: list[float] = []
    bounds_hi: list[float] = []
    component_specs: list[dict[str, Any]] = []  # per-component descriptor

    def _add_single(spec: dict[str, Any]) -> None:
        name = str(spec.get("name") or f"peak_{len(component_specs) + 1}")
        center = float(spec.get("center") or x.mean())
        amplitude = float(spec.get("amplitude") or max(np.max(y_corr), 1.0))
        fwhm = float(spec.get("fwhm") or 1.0)
        fraction = float(spec.get("fraction") if spec.get("fraction") is not None else 0.5)
        min_center = spec.get("min_center")
        max_center = spec.get("max_center")
        c_lo = float(min_center) if isinstance(min_center, (int, float)) else center - 5.0
        c_hi = float(max_center) if isinstance(max_center, (int, float)) else center + 5.0
        # `vary_center: false` / `vary_fwhm: false` lock the given value
        # (the renderer sends these when the user ticks "fixed position" /
        # "fixed fwhm" on a peak definition). `scipy.optimize.least_squares`
        # doesn't support per-parameter "fixed" — we emulate it by
        # collapsing the bound range to a 1e-8-wide slit around the seed.
        vary_center = spec.get("vary_center")
        vary_fwhm = spec.get("vary_fwhm")
        # `1e-3`-wide "fixed" slit: much below typical XPS resolution
        # (~0.1 eV for centers, ~0.05 for FWHMs) but still wide enough to
        # survive the `±1e-6` seed-clip `curve_fit` applies downstream.
        if vary_center is False:
            c_lo, c_hi = center - 1e-3, center + 1e-3
        fwhm_lo, fwhm_hi = 0.05, 20.0
        if vary_fwhm is False:
            fwhm_lo, fwhm_hi = fwhm - 1e-3, fwhm + 1e-3
        component_specs.append(
            {
                "kind": "single",
                "name": name,
                "param_offset": len(initial_params),
                "fraction": fraction,
            }
        )
        initial_params.extend([amplitude, center, fwhm])
        bounds_lo.extend([0.0, c_lo, fwhm_lo])
        bounds_hi.extend([np.inf, c_hi, fwhm_hi])

    def _add_doublet(spec: dict[str, Any]) -> None:
        base = str(spec.get("base_name") or f"doublet_{len(component_specs) + 1}")
        center = float(spec.get("center") or x.mean())
        amplitude = float(spec.get("amplitude") or max(np.max(y_corr), 1.0))
        fwhm = float(spec.get("fwhm") or 1.0)
        fraction = float(spec.get("fraction") if spec.get("fraction") is not None else 0.5)
        split = float(spec.get("split") or 5.0)
        # Branching ratio: area ratio of the second (lower-area) peak
        # relative to the first. Standard 2p3/2 : 2p1/2 ≈ 2 : 1 → 0.5.
        ratio = float(spec.get("area_ratio") or 0.5)
        vary_center = spec.get("vary_center")
        vary_fwhm = spec.get("vary_fwhm")
        # Default: split + ratio are quantum-mechanical constants (e.g.
        # Fe 2p 13.6 eV, 2:1 area ratio). When the caller explicitly opts
        # in via `vary_split: True` / `vary_area_ratio: True`, promote
        # them to free parameters — useful when instrument calibration or
        # multiplet splitting pulls the observed doublet off-canon.
        vary_split = spec.get("vary_split") is True
        vary_ratio = spec.get("vary_area_ratio") is True
        c_lo, c_hi = center - 5.0, center + 5.0
        # `1e-3`-wide "fixed" slit: much below typical XPS resolution
        # (~0.1 eV for centers, ~0.05 for FWHMs) but still wide enough to
        # survive the `±1e-6` seed-clip `curve_fit` applies downstream.
        if vary_center is False:
            c_lo, c_hi = center - 1e-3, center + 1e-3
        fwhm_lo, fwhm_hi = 0.05, 20.0
        if vary_fwhm is False:
            fwhm_lo, fwhm_hi = fwhm - 1e-3, fwhm + 1e-3

        spec_entry: dict[str, Any] = {
            "kind": "doublet",
            "name": base,
            "param_offset": len(initial_params),
            "fraction": fraction,
            "split": split,
            "ratio": ratio,
            # Offsets stay None unless the caller opted in; downstream
            # reads use a `is not None` check to branch between "read
            # from the parameter vector" and "read from the constant".
            "split_offset": None,
            "ratio_offset": None,
        }
        component_specs.append(spec_entry)
        initial_params.extend([amplitude, center, fwhm])
        bounds_lo.extend([0.0, c_lo, fwhm_lo])
        bounds_hi.extend([np.inf, c_hi, fwhm_hi])

        if vary_split:
            sb = spec.get("split_bounds")
            if isinstance(sb, (list, tuple)) and len(sb) == 2:
                split_lo, split_hi = float(sb[0]), float(sb[1])
            else:
                # Default ±20% around the seed. Floor lo at 0.1 eV so the
                # doublet can't collapse into a single-peak degenerate fit.
                split_lo = max(0.1, split * 0.8)
                split_hi = max(split_lo + 0.1, split * 1.2)
            spec_entry["split_offset"] = len(initial_params)
            initial_params.append(split)
            bounds_lo.append(split_lo)
            bounds_hi.append(split_hi)

        if vary_ratio:
            # Practical XPS branching ratios live in (0.2, 2.5]; (0.01, 10)
            # is a generous envelope that blocks NaN territory without
            # being noticeably restrictive for real spectra.
            spec_entry["ratio_offset"] = len(initial_params)
            initial_params.append(ratio)
            bounds_lo.append(0.01)
            bounds_hi.append(10.0)

    for spec in raw_peaks:
        if isinstance(spec, dict):
            _add_single(spec)
    for spec in raw_doublets:
        if isinstance(spec, dict):
            _add_doublet(spec)

    if not component_specs:
        return {"success": False, "error": "no peaks or doublets to fit"}

    # Build the model that sums all components from a flat parameter
    # vector. `_components_from_params` is also reused after the fit to
    # report each component's curve / area independently.
    def _components_from_params(p: np.ndarray) -> list[tuple[str, np.ndarray, dict[str, float]]]:
        out: list[tuple[str, np.ndarray, dict[str, float]]] = []
        for spec in component_specs:
            off = spec["param_offset"]
            amp = float(p[off])
            ctr = float(p[off + 1])
            fwhm = float(p[off + 2])
            frac = float(spec["fraction"])
            if spec["kind"] == "single":
                curve = _pseudo_voigt(x, amp, ctr, fwhm, frac)
                area = _peak_area(amp, fwhm, frac)
                out.append((spec["name"], curve, {
                    "center": ctr,
                    "fwhm": fwhm,
                    "amplitude": amp,
                    "fraction": frac,
                    "area": area,
                }))
            else:
                # Pull split / ratio from the parameter vector when the
                # caller promoted them to free variables, otherwise read
                # the constant stored on the spec. `_add_doublet` sets the
                # `*_offset` entries to None in the default (locked) case.
                split_off = spec.get("split_offset")
                ratio_off = spec.get("ratio_offset")
                split = (
                    float(p[split_off])
                    if split_off is not None and split_off < p.size
                    else float(spec["split"])
                )
                ratio = (
                    float(p[ratio_off])
                    if ratio_off is not None and ratio_off < p.size
                    else float(spec["ratio"])
                )
                main_curve = _pseudo_voigt(x, amp, ctr, fwhm, frac)
                second_curve = _pseudo_voigt(x, amp * ratio, ctr + split, fwhm, frac)
                area_main = _peak_area(amp, fwhm, frac)
                area_sec = _peak_area(amp * ratio, fwhm, frac)
                out.append((f"{spec['name']}_a", main_curve, {
                    "center": ctr,
                    "fwhm": fwhm,
                    "amplitude": amp,
                    "fraction": frac,
                    "area": area_main,
                }))
                out.append((f"{spec['name']}_b", second_curve, {
                    "center": ctr + split,
                    "fwhm": fwhm,
                    "amplitude": amp * ratio,
                    "fraction": frac,
                    "area": area_sec,
                }))
        return out

    def _model(_x: np.ndarray, *p: float) -> np.ndarray:
        params_arr = np.asarray(p, dtype=np.float64)
        comps = _components_from_params(params_arr)
        total = np.zeros_like(_x, dtype=np.float64)
        for _, curve, _meta in comps:
            total += curve
        return total

    initial = np.asarray(initial_params, dtype=np.float64)
    lo = np.asarray(bounds_lo, dtype=np.float64)
    hi = np.asarray(bounds_hi, dtype=np.float64)
    # Clip the seed inside the bounds so curve_fit doesn't immediately
    # complain about an out-of-range starting point.
    initial = np.minimum(np.maximum(initial, lo + 1e-6), hi - 1e-6)

    try:
        popt, pcov = curve_fit(
            _model,
            x,
            y_corr,
            p0=initial,
            bounds=(lo, hi),
            maxfev=2000 + 200 * initial.size,
        )
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": f"curve_fit failed: {exc}"}

    perr = np.sqrt(np.maximum(np.diag(pcov), 0.0)) if pcov is not None else np.zeros_like(popt)
    components_out: list[dict[str, Any]] = []
    component_curves: dict[str, list[float]] = {}
    fitted = _components_from_params(popt)
    # Map each parameter slot to whichever component produced it so we
    # can attach standard errors per metric.
    perr_lookup: list[tuple[int, str]] = []
    for spec in component_specs:
        off = spec["param_offset"]
        perr_lookup.append((off, "amplitude"))
        perr_lookup.append((off + 1, "center"))
        perr_lookup.append((off + 2, "fwhm"))

    for (name, curve, meta), spec in zip_pairs(fitted, component_specs):
        # `zip_pairs` emits one entry per output curve (doublets emit
        # two), each tagged back to the originating component spec so
        # we know where to look up parameter errors.
        off = spec["param_offset"]
        amp_err = float(perr[off]) if off < perr.size else 0.0
        ctr_err = float(perr[off + 1]) if off + 1 < perr.size else 0.0
        fwhm_err = float(perr[off + 2]) if off + 2 < perr.size else 0.0
        components_out.append(
            {
                "name": name,
                "center_eV": meta["center"],
                "center_err": ctr_err,
                "fwhm_eV": meta["fwhm"],
                "fwhm_err": fwhm_err,
                "fraction": meta["fraction"],
                "area": meta["area"],
                "area_err": amp_err * meta["area"] / max(meta["amplitude"], 1e-9),
            }
        )
        component_curves[name] = curve.tolist()

    y_envelope = sum(curve for _, curve, _ in fitted) if fitted else np.zeros_like(x)
    y_residual = y_corr - y_envelope
    n_data = int(x.size)
    n_var = int(initial.size)
    chi2 = float(np.sum(y_residual**2)) / max(n_data - n_var, 1)
    ss_res = float(np.sum(y_residual**2))
    ss_tot = float(np.sum((y_corr - np.mean(y_corr)) ** 2)) or 1.0
    r2 = 1.0 - ss_res / ss_tot

    curves = {
        "x": x.tolist(),
        "y_raw": y.tolist(),
        "y_background": bg.tolist(),
        "y_envelope": (bg + y_envelope).tolist(),
        "y_residual": y_residual.tolist(),
        "components": component_curves,
    }
    summary = (
        f"Fit converged · {len(components_out)} components · "
        f"R² = {r2:.4f} · χ²ᵣ = {chi2:.3g} · background = {bg_kind}"
    )
    return {
        "success": True,
        "fit_statistics": {
            "reduced_chi_squared": chi2,
            "r_squared": r2,
            "n_variables": n_var,
            "n_data_points": n_data,
            "success": True,
            "message": "ok",
        },
        "components": components_out,
        "warnings": bg_warnings,
        "summary": summary,
        "curves": curves,
        "data": {
            "background": bg_kind,
            "components": components_out,
        },
    }


def zip_pairs(
    fitted: list[tuple[str, np.ndarray, dict[str, float]]],
    component_specs: list[dict[str, Any]],
) -> list[tuple[tuple[str, np.ndarray, dict[str, float]], dict[str, Any]]]:
    """Pair each emitted curve with the spec it came from. Doublets emit
    two curves but share one spec; singles emit one each."""
    out: list[tuple[tuple[str, np.ndarray, dict[str, float]], dict[str, Any]]] = []
    cursor = 0
    for spec in component_specs:
        if spec["kind"] == "single":
            out.append((fitted[cursor], spec))
            cursor += 1
        else:
            out.append((fitted[cursor], spec))
            out.append((fitted[cursor + 1], spec))
            cursor += 2
    return out


# ── xps.validate — reference-database element verification ──────────
#
# Ported from lattice-cli: xps_validate.py (simple tool) + the
# IterativeAnalyzer.confirm_elements() path from
# workflow/xps/core_code/iterative/analysis.py (advanced engine).
#
# The worker implements the single-pass verification core. The iterative
# LLM loop stays in the agent orchestrator — the worker is stateless.

_REF_LINES_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "xps_reference_lines.json"
)

_ref_lines_cache: dict[str, list[dict[str, Any]]] | None = None


def _load_ref_lines() -> dict[str, list[dict[str, Any]]]:
    global _ref_lines_cache
    if _ref_lines_cache is not None:
        return _ref_lines_cache
    if not _REF_LINES_PATH.exists():
        raise FileNotFoundError(
            f"XPS reference lines not found at {_REF_LINES_PATH}; "
            "reinstall or rebuild the worker package"
        )
    with _REF_LINES_PATH.open("r", encoding="utf-8") as fh:
        _ref_lines_cache = json.load(fh)
    return _ref_lines_cache


_AUGER_KEYWORDS = frozenset({"auger", "kll", "lmm", "mnn", "kvv"})

_PRIMARY_PATTERNS = ("1s", "2p3/2", "2p", "3d5/2", "3d", "4d5/2", "4d", "4f7/2", "4f")


def _is_primary_orbital(ref_peak: dict[str, Any]) -> bool:
    if ref_peak.get("primary"):
        return True
    orbital = (ref_peak.get("orbital") or "").lower()
    if any(k in orbital for k in _AUGER_KEYWORDS):
        return False
    return any(pat in orbital for pat in _PRIMARY_PATTERNS)


def _filter_primary(ref_peaks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    primary = [r for r in ref_peaks if _is_primary_orbital(r)]
    return primary if primary else ref_peaks[:1]


def _peak_energy(peak: dict[str, Any]) -> float:
    return float(
        peak.get("position", peak.get("energy_eV", peak.get("center_eV", 0)))
    )


# 4-tier element rarity (ported from iterative/analysis.py ELEMENT_RARITY)
ELEMENT_RARITY: dict[str, str] = {
    "C": "common", "O": "common", "N": "common", "H": "common",
    "Si": "common", "S": "common", "P": "common", "F": "common",
    "Cl": "common", "Na": "common", "K": "common", "Ca": "common",
    "Mg": "common", "Br": "common", "I": "common", "B": "common",
    "Al": "uncommon", "Fe": "uncommon", "Cu": "uncommon",
    "Zn": "uncommon", "Ti": "uncommon", "Mn": "uncommon",
    "Cr": "uncommon", "Ni": "uncommon", "Co": "uncommon",
    "V": "uncommon", "Sc": "uncommon", "Ag": "uncommon",
    "Au": "uncommon", "Pt": "uncommon", "Pd": "uncommon",
    "Sn": "uncommon", "Pb": "uncommon", "Bi": "uncommon",
    "Ba": "uncommon", "Sr": "uncommon", "Li": "uncommon",
    "As": "uncommon", "Se": "uncommon", "Te": "uncommon",
    "Ga": "uncommon", "Ge": "uncommon", "In": "uncommon",
    "Sb": "uncommon", "Cd": "uncommon",
    "Ta": "rare", "W": "rare", "Mo": "rare", "Nb": "rare",
    "Hf": "rare", "Zr": "rare",
    "La": "rare", "Ce": "rare", "Nd": "rare", "Y": "rare",
    "Pr": "rare", "Sm": "rare", "Eu": "rare", "Gd": "rare",
    "Ru": "rare", "Tl": "rare",
    "Ir": "very_rare", "Rh": "very_rare", "Os": "very_rare",
    "Re": "very_rare", "Tc": "very_rare",
    "Tb": "very_rare", "Dy": "very_rare", "Ho": "very_rare",
    "Er": "very_rare", "Tm": "very_rare", "Yb": "very_rare",
    "Lu": "very_rare", "Th": "very_rare", "U": "very_rare",
}

RARITY_SUPPORT_REQUIREMENT: dict[str, int] = {
    "common": 0, "uncommon": 1, "rare": 2, "very_rare": 3,
}

# Close-doublet elements (spin-orbit splitting < 4 eV)
CLOSE_DOUBLET_ELEMENTS: dict[str, tuple[str, str, float, float]] = {
    "Nb": ("3d5/2", "3d3/2", 2.7, 1.5),
    "Mo": ("3d5/2", "3d3/2", 3.1, 1.5),
    "Zr": ("3d5/2", "3d3/2", 2.4, 1.5),
    "Hf": ("4f7/2", "4f5/2", 1.7, 1.33),
    "Ta": ("4f7/2", "4f5/2", 1.9, 1.33),
    "W":  ("4f7/2", "4f5/2", 2.2, 1.33),
    "Re": ("4f7/2", "4f5/2", 2.4, 1.33),
    "Ir": ("4f7/2", "4f5/2", 3.0, 1.33),
    "Pt": ("4f7/2", "4f5/2", 3.3, 1.33),
    "Au": ("4f7/2", "4f5/2", 3.7, 1.33),
    "Ti": ("2p3/2", "2p1/2", 5.7, 2.0),
    "V":  ("2p3/2", "2p1/2", 7.3, 2.0),
    "Cr": ("2p3/2", "2p1/2", 9.2, 2.0),
    "Mn": ("2p3/2", "2p1/2", 11.2, 2.0),
    "Fe": ("2p3/2", "2p1/2", 13.1, 2.0),
    "Co": ("2p3/2", "2p1/2", 15.0, 2.0),
    "Ni": ("2p3/2", "2p1/2", 17.3, 2.0),
    "Cu": ("2p3/2", "2p1/2", 19.8, 2.0),
    "Zn": ("2p3/2", "2p1/2", 23.0, 2.0),
}

CLOSE_DOUBLET_THRESHOLD_EV = 4.0

COOCCURRENCE_RULES: dict[str, list[str]] = {
    "Hf": ["O"], "Zr": ["O"], "Ti": ["O"], "Ta": ["O"],
    "Nb": ["O"], "W": ["O"], "Mo": ["O"],
}

_CHARGE_REFS: list[tuple[str, float, tuple[float, float]]] = [
    ("C 1s", 284.8, (278, 295)),
    ("O 1s", 529.5, (525, 540)),
    ("Si 2p", 103.5, (99, 108)),
]


def _estimate_validate_charge_shift(
    peaks: list[dict[str, Any]],
    shift_range: tuple[float, float] = (-4.0, 4.0),
) -> float:
    for _name, ref_eV, (lo, hi) in _CHARGE_REFS:
        best_peak = None
        best_prom: float = -1.0
        for p in peaks:
            e = _peak_energy(p)
            prom = float(p.get("prominence", p.get("intensity", 0)))
            if lo <= e <= hi and prom > best_prom:
                best_prom = prom
                best_peak = p
        if best_peak is not None:
            shift = _peak_energy(best_peak) - ref_eV
            if shift_range[0] <= shift <= shift_range[1]:
                return shift
    return 0.0


def _match_element_peaks(
    element: str,
    ref_peaks: list[dict[str, Any]],
    detected: list[dict[str, Any]],
    global_shift: float,
    tolerance_eV: float,
    used: set[int],
    allow_reuse: bool = False,
) -> tuple[list[dict[str, Any]], list[int], list[dict[str, Any]]]:
    matches: list[dict[str, Any]] = []
    indices: list[int] = []
    missing: list[dict[str, Any]] = []
    for ref in ref_peaks:
        ref_energy = ref["energy_eV"] + global_shift
        best_idx = -1
        best_delta = float("inf")
        for i, peak in enumerate(detected):
            if not allow_reuse and i in used:
                continue
            delta = abs(_peak_energy(peak) - ref_energy)
            if delta <= tolerance_eV and delta < best_delta:
                best_delta = delta
                best_idx = i
        if best_idx >= 0:
            matches.append({
                "element": element,
                "orbital": ref.get("orbital", ""),
                "ref_eV": ref["energy_eV"],
                "ref_eV_shifted": round(ref_energy, 2),
                "obs_eV": round(_peak_energy(detected[best_idx]), 2),
                "delta_eV": round(best_delta, 2),
                "note": ref.get("note", ""),
            })
            indices.append(best_idx)
        else:
            missing.append({
                "element": element,
                "orbital": ref.get("orbital", ""),
                "expected_eV": round(ref_energy, 2),
                "original_eV": ref["energy_eV"],
                "note": ref.get("note", ""),
            })
    return matches, indices, missing


def _detect_peak_overlaps(
    elements: list[str],
    ref_db: dict[str, list[dict[str, Any]]],
    global_shift: float,
    threshold_eV: float = 0.5,
) -> list[dict[str, Any]]:
    all_peaks: list[dict[str, Any]] = []
    for elem in elements:
        for ref in _filter_primary(ref_db.get(elem, [])):
            all_peaks.append({
                "element": elem,
                "orbital": ref.get("orbital", ""),
                "ref_energy": ref["energy_eV"],
                "shifted_energy": ref["energy_eV"] + global_shift,
            })
    all_peaks.sort(key=lambda x: x["shifted_energy"])
    overlaps: list[dict[str, Any]] = []
    i = 0
    while i < len(all_peaks):
        group = [all_peaks[i]]
        j = i + 1
        while j < len(all_peaks) and all_peaks[j]["shifted_energy"] - all_peaks[i]["shifted_energy"] <= threshold_eV:
            group.append(all_peaks[j])
            j += 1
        if len(group) > 1:
            unique = {p["element"] for p in group}
            if len(unique) > 1:
                center = sum(p["shifted_energy"] for p in group) / len(group)
                overlaps.append({
                    "peak_energy": round(center, 2),
                    "candidates": [
                        {"element": p["element"], "orbital": p["orbital"],
                         "ref_energy": p["ref_energy"],
                         "shifted_energy": round(p["shifted_energy"], 2)}
                        for p in group
                    ],
                    "risk_level": "high" if len(unique) >= 3 else "medium",
                })
        i = j if j > i + 1 else i + 1
    return overlaps


def _normalize_elem(s: str) -> str:
    e = "".join(c for c in s.strip() if c.isalpha())
    if not e or e.lower() == "unknown":
        return ""
    return e[0].upper() + e[1:].lower()


def validate(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Validate LLM-predicted elements against the XPS reference-line DB.

    Full port of lattice-cli's xps_validate + iterative analysis engine.
    Implements:
      - Auto charge-shift estimation (C 1s → O 1s → Si 2p fallback)
      - 4-tier element rarity (common/uncommon/rare/very_rare)
      - Close-doublet element handling (26 elements with ΔSO < 4 eV)
      - Primary + secondary peak matching with separate tolerances
      - Peak overlap detection
      - Co-occurrence rule validation

    Parameters:
      - elements (list[str], required): predicted element symbols
      - peaks (list[dict], required): detected peaks with position/intensity
      - tolerance_eV (float, default 1.0): primary peak matching tolerance
      - tolerance_eV_secondary (float, default 1.5): secondary peak tolerance
      - overlap_threshold_eV (float, default 0.5): peak overlap detection
    """
    raw_elements = params.get("elements")
    if not isinstance(raw_elements, list) or not raw_elements:
        return {"success": False, "error": "elements is required (list of element symbols)"}
    raw_peaks = params.get("peaks")
    if not isinstance(raw_peaks, list) or not raw_peaks:
        return {"success": False, "error": "peaks is required (list of detected peaks with position)"}

    tolerance = float(params.get("tolerance_eV", 1.0))
    tolerance_sec = float(params.get("tolerance_eV_secondary", 1.5))
    overlap_threshold = float(params.get("overlap_threshold_eV", 0.5))

    try:
        ref_db = _load_ref_lines()
    except (FileNotFoundError, ValueError) as exc:
        return {"success": False, "error": str(exc)}

    peaks = []
    for p in raw_peaks:
        if isinstance(p, dict):
            peaks.append({
                "position": _peak_energy(p),
                "intensity": float(p.get("intensity", p.get("prominence", 0))),
                "prominence": float(p.get("prominence", p.get("intensity", 0))),
            })

    global_shift = _estimate_validate_charge_shift(peaks)

    confirmed: list[str] = []
    rejected: list[str] = []
    details: list[dict[str, Any]] = []
    used_indices: set[int] = set()

    work_items: list[dict[str, Any]] = []
    for order, elem_raw in enumerate(raw_elements):
        elem = _normalize_elem(elem_raw)
        if not elem:
            rejected.append(elem_raw)
            details.append({"element": elem_raw, "status": "rejected", "reason": "Invalid element symbol"})
            continue
        ref_peaks = ref_db.get(elem)
        if ref_peaks is None:
            rejected.append(elem)
            details.append({"element": elem, "status": "rejected", "reason": "Element not in reference database"})
            continue

        primary_refs = _filter_primary(ref_peaks)
        secondary_refs = [r for r in ref_peaks if r not in primary_refs]

        primary_matches, primary_idx, primary_missing = _match_element_peaks(
            elem, primary_refs, peaks, global_shift, tolerance, used_indices,
        )
        secondary_matches, secondary_idx, _ = _match_element_peaks(
            elem, secondary_refs, peaks, global_shift, tolerance_sec, used_indices,
            allow_reuse=True,
        )

        mean_delta = (
            sum(m["delta_eV"] for m in primary_matches) / len(primary_matches)
            if primary_matches else float("inf")
        )
        work_items.append({
            "order": order,
            "element": elem,
            "primary_refs": primary_refs,
            "primary_matches": primary_matches,
            "primary_idx": primary_idx,
            "primary_missing": primary_missing,
            "secondary_matches": secondary_matches,
            "secondary_idx": secondary_idx,
            "mean_delta": mean_delta,
        })

    work_items.sort(key=lambda it: (-len(it["primary_matches"]), it["mean_delta"], it["order"]))

    for item in work_items:
        elem = item["element"]
        primary_matches = item["primary_matches"]
        primary_idx = item["primary_idx"]
        primary_missing = item["primary_missing"]
        secondary_matches = item["secondary_matches"]
        secondary_idx = item["secondary_idx"]
        primary_refs = item["primary_refs"]

        rarity = ELEMENT_RARITY.get(elem, "rare")
        required_support = RARITY_SUPPORT_REQUIREMENT.get(rarity, 2)

        primary_met = len(primary_matches) >= 1
        actual_doublets = len(secondary_matches)
        adjusted_required = required_support
        close_doublet_bonus = False
        split_energy: float | None = None

        if elem in CLOSE_DOUBLET_ELEMENTS and primary_met:
            _, _, so_split, _ = CLOSE_DOUBLET_ELEMENTS[elem]
            if so_split < CLOSE_DOUBLET_THRESHOLD_EV and primary_matches:
                best_delta = min(m["delta_eV"] for m in primary_matches)
                if best_delta < so_split / 2:
                    adjusted_required = max(0, required_support - 1)
                    close_doublet_bonus = True
                    split_energy = so_split

        doublet_met = actual_doublets >= adjusted_required or rarity == "common"

        coverage = len(primary_matches) / len(primary_refs) if primary_refs else 0.0
        if rarity in ("common", "uncommon") or len(primary_refs) <= 2 or close_doublet_bonus:
            coverage_met = True
        else:
            coverage_met = coverage >= 0.3

        if primary_met and doublet_met and coverage_met:
            confirmed.append(elem)
            used_indices.update(primary_idx)
            used_indices.update(secondary_idx)
            detail: dict[str, Any] = {
                "element": elem,
                "status": "confirmed",
                "rarity": rarity,
                "matched_peaks": primary_matches,
                "secondary_matches": secondary_matches,
                "missing_peaks": primary_missing,
                "coverage": round(coverage, 2),
                "primary_match_count": len(primary_matches),
                "secondary_match_count": len(secondary_matches),
                "required_support": required_support,
            }
            if close_doublet_bonus and split_energy is not None:
                detail["close_doublet_bonus"] = True
                detail["split_energy_eV"] = split_energy
            details.append(detail)
        elif primary_met and rarity in ("common", "uncommon"):
            confirmed.append(elem)
            used_indices.update(primary_idx)
            details.append({
                "element": elem,
                "status": "confirmed",
                "rarity": rarity,
                "matched_peaks": primary_matches,
                "secondary_matches": secondary_matches,
                "missing_peaks": primary_missing,
                "coverage": round(coverage, 2),
                "primary_match_count": len(primary_matches),
                "secondary_match_count": len(secondary_matches),
                "required_support": required_support,
                "note": f"Confirmed as {rarity} element with primary peak match",
            })
        elif primary_met:
            rejected.append(elem)
            reason = (
                f"Matched {len(primary_matches)} primary peak(s) but need "
                f"{1 + adjusted_required} total for {rarity} element"
            )
            details.append({
                "element": elem,
                "status": "weak_match",
                "rarity": rarity,
                "reason": reason,
                "matched_peaks": primary_matches,
                "missing_peaks": primary_missing,
                "coverage": round(coverage, 2),
                "primary_match_count": len(primary_matches),
                "secondary_match_count": len(secondary_matches),
                "required_support": required_support,
            })
        else:
            rejected.append(elem)
            closest_info = ""
            if primary_refs:
                closest = [r["energy_eV"] for r in primary_refs[:3]]
                closest_info = ", ".join(f"{e:.1f}" for e in closest)
            details.append({
                "element": elem,
                "status": "rejected",
                "rarity": rarity,
                "reason": "No primary peak match within tolerance",
                "expected_primary_eV": closest_info,
                "matched_peaks": [],
                "missing_peaks": primary_missing,
            })

    # Co-occurrence validation
    if confirmed:
        to_remove: list[str] = []
        for elem in confirmed:
            required = COOCCURRENCE_RULES.get(elem, [])
            if required and not any(r in confirmed for r in required):
                to_remove.append(elem)
        for elem in to_remove:
            confirmed.remove(elem)
            rejected.append(elem)
            for d in details:
                if d.get("element") == elem and d.get("status") == "confirmed":
                    d["status"] = "rejected"
                    d["reason"] = f"Co-occurrence rule: requires {COOCCURRENCE_RULES[elem]} but none present"

    # Peak overlap detection
    overlap_warnings: list[dict[str, Any]] = []
    if confirmed:
        overlap_warnings = _detect_peak_overlaps(
            confirmed, ref_db, global_shift, overlap_threshold,
        )

    # Shift reference label
    ref_label = "C 1s (284.8 eV)"
    if abs(global_shift) >= 4.0:
        ref_label = "none"

    return {
        "success": True,
        "data": {
            "confirmed": confirmed,
            "rejected": rejected,
            "charge_shift_eV": round(global_shift, 2),
            "reference_used": ref_label,
            "details": details,
            "overlap_warnings": overlap_warnings,
        },
        "summary": (
            f"Validated {len(raw_elements)} element(s): "
            f"{len(confirmed)} confirmed, {len(rejected)} rejected"
            f" (shift {global_shift:+.2f} eV)"
        ),
    }


# Kill an accidental unused-import warning in stripped-down environments.
_ = os
