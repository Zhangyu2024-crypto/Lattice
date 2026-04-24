"""spectrum.* tools — generic peak detection + quality assessment.

P4-β v0 — first real scientific tool moved into the repo-local worker.
The lattice-cli backend exposed `/api/pro/detect-peaks` and
`/api/pro/assess-quality` against a session-tracked spectrum; here the
caller passes the spectrum data explicitly so the worker stays
stateless (no session bookkeeping).

Algorithms intentionally kept narrow + dependency-light:

- `detect_peaks` uses scipy.signal.find_peaks with a prominence threshold
  derived from the noise estimate, then walks down each peak to find the
  half-max width (FWHM proxy that avoids any model fit). SNR is the
  peak intensity divided by a local standard deviation outside the
  peak's own half-max region.

- `assess_quality` returns a coarse grade (good / fair / poor) along
  with the inputs that drove the grade. It mirrors the lattice-cli
  endpoint shape (`grade`, `snr`, `n_points`, `issues`,
  `recommendations`) so the renderer's `XrdProWorkbench`,
  `XpsProWorkbench` and `RamanProWorkbench` can swap call sites
  without changing how they consume the response.

Both tools require numpy + scipy — see worker/requirements.txt.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.signal import find_peaks, savgol_filter
from scipy.ndimage import gaussian_filter1d

from .common import validate_xy_params

# Bounds chosen for general-purpose peak finding across XRD / XPS /
# Raman. Each tool can override via `prominence_mult` / `min_distance` if
# the caller knows their domain better than the defaults.
DEFAULT_TOPK = 20
DEFAULT_PROMINENCE_MULT = 3.0
DEFAULT_MIN_DISTANCE_FRAC = 0.005  # of total x range

# Quality thresholds. These are heuristic; the goal is "the renderer can
# show a yellow/red badge and a useful nudge", not a publication-grade
# diagnostic.
SNR_GOOD = 30.0
SNR_FAIR = 10.0
NPOINTS_FEW = 256
NPOINTS_TINY = 64


def _validate_xy(params: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    # Thin wrapper preserved for existing call sites; the shared helper
    # in ``worker/tools/common.py`` enforces identical semantics across
    # xps / xrd / spectrum. No flip — generic curves can be descending
    # intentionally (e.g. time-reversed kinetics plots).
    return validate_xy_params(params, label="spectrum")


def _estimate_noise(y: np.ndarray) -> float:
    """Median absolute deviation from a smoothed baseline; robust to
    real peaks. Returns the σ estimate scaled to ≈ stdev of pure
    Gaussian noise (MAD × 1.4826)."""
    if y.size < 16:
        return float(np.std(y, ddof=0)) or 1.0
    # 5-point moving median acts as a coarse baseline; the residual
    # against y captures noise without being dragged by sharp peaks.
    window = 5
    pad = window // 2
    padded = np.pad(y, pad, mode="edge")
    rolling_median = np.zeros_like(y)
    for i in range(y.size):
        rolling_median[i] = np.median(padded[i : i + window])
    residual = y - rolling_median
    mad = np.median(np.abs(residual - np.median(residual)))
    return float(mad * 1.4826) or float(np.std(residual, ddof=0)) or 1.0


def _fwhm(y: np.ndarray, peak_idx: int, baseline: float) -> float | None:
    """Walk down both flanks of `y[peak_idx]` until we cross half-max,
    interpolate the crossing, and return the index-space width. Caller
    converts to x-space by multiplying by the average dx."""
    height = y[peak_idx] - baseline
    if height <= 0:
        return None
    half = baseline + height / 2.0

    # Left flank
    left = peak_idx
    while left > 0 and y[left] > half:
        left -= 1
    if left == peak_idx:
        return None
    # Linear interpolation between left and left+1 for the crossing
    y_lo, y_hi = y[left], y[left + 1]
    if y_hi == y_lo:
        left_cross = float(left)
    else:
        left_cross = left + (half - y_lo) / (y_hi - y_lo)

    # Right flank
    right = peak_idx
    while right < y.size - 1 and y[right] > half:
        right += 1
    if right == peak_idx:
        return None
    y_lo, y_hi = y[right - 1], y[right]
    if y_hi == y_lo:
        right_cross = float(right)
    else:
        right_cross = (right - 1) + (half - y_lo) / (y_hi - y_lo)

    width = right_cross - left_cross
    return float(width) if width > 0 else None


def _local_snr(y: np.ndarray, peak_idx: int, fwhm_idx: float | None, noise: float) -> float:
    if fwhm_idx is None or fwhm_idx <= 0:
        return float(y[peak_idx] / noise) if noise > 0 else 0.0
    # Mask the peak region (±2 × FWHM) and use the unmasked stdev as the
    # local noise denominator. Falls back to global noise estimate when
    # the masked region is too narrow.
    half_window = max(int(round(fwhm_idx * 2)), 4)
    lo = max(peak_idx - half_window, 0)
    hi = min(peak_idx + half_window + 1, y.size)
    mask = np.ones_like(y, dtype=bool)
    mask[lo:hi] = False
    pool = y[mask]
    sigma = float(np.std(pool, ddof=0)) if pool.size > 16 else noise
    if sigma <= 0:
        sigma = noise or 1.0
    return float(y[peak_idx] / sigma)


def detect_peaks(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    x, y = _validate_xy(params)
    spectrum_type = params.get("spectrumType") or params.get("spectrum_type") or "spectrum"
    topk = int(params.get("topk", DEFAULT_TOPK) or DEFAULT_TOPK)
    prominence_mult = float(
        params.get("prominence_mult", DEFAULT_PROMINENCE_MULT) or DEFAULT_PROMINENCE_MULT,
    )
    x_min = params.get("x_min")
    x_max = params.get("x_max")

    # Optional x-range filter — useful when the user has zoomed into
    # one phase region and only wants peaks from there.
    mask = np.ones_like(x, dtype=bool)
    if isinstance(x_min, (int, float)):
        mask &= x >= float(x_min)
    if isinstance(x_max, (int, float)):
        mask &= x <= float(x_max)
    if not np.any(mask):
        return {
            "success": True,
            "peaks": [],
            "total": 0,
            "type": spectrum_type,
            "data": {
                "spectrum_type": spectrum_type,
                "peaks": [],
                "n_peaks": 0,
                "algorithm": "scipy.signal.find_peaks",
                "warnings": ["x_min/x_max excluded all points"],
            },
        }
    x_eff, y_eff = x[mask], y[mask]
    full_range = (float(x.min()), float(x.max()))
    applied_range = (float(x_eff.min()), float(x_eff.max()))

    noise = _estimate_noise(y_eff)
    baseline = float(np.percentile(y_eff, 10))
    prominence = max(prominence_mult * noise, 1e-9)
    dx = float(np.median(np.diff(x_eff))) if x_eff.size > 1 else 1.0
    min_distance_x = (applied_range[1] - applied_range[0]) * DEFAULT_MIN_DISTANCE_FRAC
    distance = max(int(round(min_distance_x / max(dx, 1e-12))), 1)

    indices, properties = find_peaks(
        y_eff,
        prominence=prominence,
        distance=distance,
    )
    if indices.size == 0:
        return {
            "success": True,
            "peaks": [],
            "total": 0,
            "type": spectrum_type,
            "data": {
                "spectrum_type": spectrum_type,
                "peaks": [],
                "n_peaks": 0,
                "algorithm": "scipy.signal.find_peaks",
                "full_range": list(full_range),
                "applied_range": list(applied_range),
                "warnings": [
                    f"no peaks above prominence {prominence:.3g} (noise σ ≈ {noise:.3g})",
                ],
            },
        }

    # Rank by prominence; keep top K.
    prominences = properties.get("prominences", np.zeros_like(indices, dtype=float))
    order = np.argsort(prominences)[::-1][:topk]
    selected = indices[order]

    peaks: list[dict[str, Any]] = []
    for rank, idx in enumerate(sorted(selected.tolist())):
        position = float(x_eff[idx])
        intensity = float(y_eff[idx])
        fwhm_idx = _fwhm(y_eff, idx, baseline)
        fwhm_x = fwhm_idx * dx if fwhm_idx is not None else None
        snr = _local_snr(y_eff, idx, fwhm_idx, noise)
        peaks.append(
            {
                "index": rank,
                "position": position,
                "intensity": intensity,
                "fwhm": fwhm_x,
                "snr": snr,
                "label": "",
            }
        )

    return {
        "success": True,
        "peaks": peaks,
        "total": len(peaks),
        "type": spectrum_type,
        "data": {
            "spectrum_type": spectrum_type,
            "peaks": peaks,
            "n_peaks": len(peaks),
            "algorithm": "scipy.signal.find_peaks",
            "full_range": list(full_range),
            "applied_range": list(applied_range),
        },
        "summary": (
            f"Detected {len(peaks)} peaks (prominence ≥ {prominence:.3g}, noise σ ≈ {noise:.3g})"
        ),
    }


def assess_quality(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    x, y = _validate_xy(params)
    n_points = int(y.size)
    noise = _estimate_noise(y)
    baseline = float(np.percentile(y, 10))
    signal_peak = float(np.max(y) - baseline)
    snr = signal_peak / noise if noise > 0 else 0.0

    issues: list[str] = []
    recommendations: list[str] = []

    if n_points < NPOINTS_TINY:
        issues.append(f"only {n_points} data points (very low resolution)")
        recommendations.append("Re-acquire with a finer step or longer scan range.")
    elif n_points < NPOINTS_FEW:
        issues.append(f"only {n_points} data points (low resolution)")
        recommendations.append("Consider increasing scan resolution if possible.")

    if snr < SNR_FAIR:
        issues.append(f"low signal-to-noise (SNR ≈ {snr:.1f})")
        recommendations.append("Increase counting time or apply Savitzky-Golay smoothing.")
    elif snr < SNR_GOOD:
        issues.append(f"moderate signal-to-noise (SNR ≈ {snr:.1f})")
        recommendations.append("A modest smoothing step would improve peak fitting.")

    # Detect a near-flat spectrum (no real signal) — common when the
    # user accidentally picked an empty channel.
    span = float(np.max(y) - np.min(y))
    if span < noise * 3:
        issues.append("intensity span barely exceeds noise — spectrum may be empty")
        recommendations.append("Verify the file path and acquisition parameters.")

    if snr >= SNR_GOOD and not issues:
        grade = "good"
    elif snr >= SNR_FAIR:
        grade = "fair"
    else:
        grade = "poor"

    if not recommendations:
        recommendations.append("No additional preprocessing recommended.")

    return {
        "success": True,
        "grade": grade,
        "snr": float(snr),
        "n_points": n_points,
        "noise_sigma": float(noise),
        "baseline": baseline,
        "issues": issues,
        "recommendations": recommendations,
    }


# ─── Smooth (Q · curve preprocessing) ──────────────────────────────
#
# Mirrors lattice-cli's `tools/smooth_spectrum.py`. Three algorithms +
# pass-through `none` so the agent can declaratively drive the
# preprocessing chain.

def _ensure_odd(n: int, lo: int = 3) -> int:
    n = max(lo, int(n))
    return n if n % 2 == 1 else n + 1


def smooth(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Smooth y values; return the same-length new y vector.

    params: x, y (arrays); method ('savgol' | 'moving_average' |
    'gaussian' | 'none'); window (int, must be odd for SG); order (int,
    SG polynomial order); sigma (float, gaussian σ in samples).
    """
    try:
        _x, y = _validate_xy(params)
    except ValueError as exc:
        return {"success": False, "error": str(exc)}

    method = str(params.get("method") or "savgol")
    if method == "none":
        return {"success": True, "y": y.tolist(), "method": "none"}

    if method == "savgol":
        window = _ensure_odd(int(params.get("window") or 11))
        order = int(params.get("order") or 3)
        if window > len(y):
            window = _ensure_odd(min(len(y) - (1 if len(y) % 2 == 0 else 0), 11))
        order = max(1, min(order, window - 1))
        try:
            ys = savgol_filter(y, window_length=window, polyorder=order)
        except ValueError as exc:
            return {"success": False, "error": f"savgol failed: {exc}"}
        return {"success": True, "y": ys.tolist(), "method": "savgol"}

    if method == "moving_average":
        window = max(2, int(params.get("window") or 5))
        kernel = np.ones(window, dtype=np.float64) / window
        # `same` mode keeps the output the same length; edges have boundary
        # bias but for a UI smoothing that's acceptable.
        ys = np.convolve(y, kernel, mode="same")
        return {"success": True, "y": ys.tolist(), "method": "moving_average"}

    if method == "gaussian":
        sigma = max(0.1, float(params.get("sigma") or 1.5))
        ys = gaussian_filter1d(y, sigma=sigma)
        return {"success": True, "y": ys.tolist(), "method": "gaussian"}

    return {"success": False, "error": f"unknown smoothing method: {method}"}


# ─── Baseline (Q · curve preprocessing) ────────────────────────────

def _baseline_polynomial(x: np.ndarray, y: np.ndarray, order: int) -> np.ndarray:
    """Polyfit-based baseline. Best-effort: fits the raw signal and
    subtracts. Higher orders track sloped backgrounds at the cost of
    flattening real broad features."""
    coeffs = np.polyfit(x, y, max(0, min(order, 8)))
    return np.polyval(coeffs, x)


def _baseline_linear(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Two-point linear baseline through the endpoints."""
    if len(x) < 2:
        return np.zeros_like(y)
    return np.interp(x, [x[0], x[-1]], [y[0], y[-1]])


def _baseline_shirley(y: np.ndarray, iterations: int = 32) -> np.ndarray:
    """Iterative Shirley baseline — XPS standard. Works on any signal
    where peaks rise above a step background. The integral form is
    converged after ~20 iterations for typical XPS spectra."""
    n = len(y)
    if n < 3:
        return np.zeros_like(y)
    bg = np.linspace(y[0], y[-1], n)
    for _ in range(max(1, iterations)):
        signal = y - bg
        # Cumulative integral of the residual from each point onward,
        # normalised so the right end matches y[-1].
        cum = np.cumsum(signal[::-1])[::-1]
        total = cum[0]
        if abs(total) < 1e-12:
            break
        new_bg = y[-1] + (y[0] - y[-1]) * (cum / total)
        if np.allclose(new_bg, bg, atol=1e-9):
            bg = new_bg
            break
        bg = new_bg
    return bg


def _baseline_snip(y: np.ndarray, iterations: int = 24) -> np.ndarray:
    """Statistics-sensitive Non-linear Iterative Peak (SNIP) clipping —
    workhorse for XRD / Raman backgrounds. Runs in log space to handle
    high-dynamic-range spectra and clamps to non-negative input."""
    n = len(y)
    if n < 3:
        return np.zeros_like(y)
    work = np.log(np.log(np.sqrt(np.clip(y, 0, None) + 1) + 1) + 1)
    for k in range(1, max(1, iterations) + 1):
        prev = work.copy()
        for i in range(k, n - k):
            work[i] = min(prev[i], 0.5 * (prev[i - k] + prev[i + k]))
    bg = (np.exp(np.exp(work) - 1) - 1) ** 2 - 1
    return bg


def baseline(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Subtract a baseline; return both the corrected y and the
    baseline vector (UI may want to draw it).

    params: x, y; method ('none' | 'linear' | 'polynomial' | 'shirley' |
    'snip'); order (polynomial degree); iterations (snip / shirley).
    """
    try:
        x, y = _validate_xy(params)
    except ValueError as exc:
        return {"success": False, "error": str(exc)}

    method = str(params.get("method") or "polynomial")
    if method == "none":
        return {
            "success": True,
            "y": y.tolist(),
            "baseline": np.zeros_like(y).tolist(),
            "method": "none",
        }

    iterations = int(params.get("iterations") or 24)

    if method == "linear":
        bg = _baseline_linear(x, y)
    elif method == "polynomial":
        order = int(params.get("order") or 3)
        bg = _baseline_polynomial(x, y, order)
    elif method == "shirley":
        bg = _baseline_shirley(y, iterations=iterations)
    elif method == "snip":
        bg = _baseline_snip(y, iterations=iterations)
    else:
        return {"success": False, "error": f"unknown baseline method: {method}"}

    corrected = y - bg
    return {
        "success": True,
        "y": corrected.tolist(),
        "baseline": bg.tolist(),
        "method": method,
    }
