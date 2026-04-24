"""Utilities shared between the spectrum analysis tools (``spectrum``,
``xps``, ``xrd``, future additions).

Three near-identical copies of ``_validate_xy`` used to live in each
module; the differences were just error-message wording and whether the
axis gets flipped when the caller-supplied payload tabulates from high
to low (XPS binding-energy convention, inverted XRD scans). Centralising
here lets the flip behaviour be a parameter rather than three forks.
"""

from __future__ import annotations

from typing import Any

import numpy as np


_MIN_POINTS = 8


def validate_xy_arrays(
    x_raw: Any,
    y_raw: Any,
    *,
    flip_descending: bool = False,
    label: str = "spectrum",
) -> tuple[np.ndarray, np.ndarray]:
    """Coerce caller-supplied x / y lists into float64 ndarrays, raising
    ``ValueError`` on any of: non-list input, length mismatch, too-short
    series (< 8 points), or non-finite values. When ``flip_descending``
    is True and the input is tabulated high → low, both arrays are
    reversed so downstream interpolation / range filtering can assume
    ascending x.

    ``label`` customises the error-message prefix so stack traces stay
    intelligible when this runs on behalf of many callers.
    """
    if not isinstance(x_raw, list) or not isinstance(y_raw, list):
        raise ValueError(f"{label}.x and {label}.y must be arrays of numbers")
    if len(x_raw) != len(y_raw):
        raise ValueError(
            f"{label}.x ({len(x_raw)}) and {label}.y ({len(y_raw)}) length mismatch"
        )
    if len(x_raw) < _MIN_POINTS:
        raise ValueError(
            f"{label} is too short to analyse (need ≥ {_MIN_POINTS} points)"
        )
    x = np.asarray(x_raw, dtype=np.float64)
    y = np.asarray(y_raw, dtype=np.float64)
    if not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):
        raise ValueError(f"{label} contains non-finite values")
    if flip_descending and x.size >= 2 and x[0] > x[-1]:
        x = x[::-1]
        y = y[::-1]
    return x, y


def validate_xy_params(
    params: dict[str, Any],
    *,
    flip_descending: bool = False,
    label: str = "spectrum",
) -> tuple[np.ndarray, np.ndarray]:
    """Convenience wrapper for the common pattern ``params['x'] + params['y']``."""
    return validate_xy_arrays(
        params.get("x"),
        params.get("y"),
        flip_descending=flip_descending,
        label=label,
    )
