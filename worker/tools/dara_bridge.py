"""Local BGMN Rietveld refinement via dara-xrd.

Replaces the old HTTP bridge to an external dara Docker service.
Now calls the ``dara-xrd`` Python package directly — BGMN binary is
bundled inside the package (``pip install dara-xrd``).

The public API (``is_available``, ``call_refinement``) is unchanged so
``xrd.refine_dara`` works without modification.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any


def _check_dara_xrd() -> bool:
    try:
        from dara.bgmn_worker import BGMNWorker
        w = BGMNWorker()
        return w.bgmn_path.exists() or w.bgmn_path.with_suffix(".exe").exists()
    except Exception:
        return False


_available: bool | None = None


def is_available(base_url: str | None = None) -> bool:
    """Check whether dara-xrd + BGMN binary are usable."""
    global _available
    if _available is None:
        _available = _check_dara_xrd()
    return _available


def _to_list(obj: Any) -> list:
    if obj is None:
        return []
    if hasattr(obj, "tolist"):
        return obj.tolist()
    if isinstance(obj, list):
        return obj
    return list(obj)


def _infer_crystal_system(spacegroup_no: int | None) -> str | None:
    """Map space-group number to crystal system."""
    if spacegroup_no is None:
        return None
    n = int(spacegroup_no)
    if 1 <= n <= 2:
        return "triclinic"
    if 3 <= n <= 15:
        return "monoclinic"
    if 16 <= n <= 74:
        return "orthorhombic"
    if 75 <= n <= 142:
        return "tetragonal"
    if 143 <= n <= 167:
        return "trigonal"
    if 168 <= n <= 194:
        return "hexagonal"
    if 195 <= n <= 230:
        return "cubic"
    return None


def call_refinement(
    xy_path: str,
    *,
    cif_paths: list[str] | None = None,
    cif_texts: list[dict[str, str]] | None = None,
    instrument_profile: str | None = None,
    wmin: float | None = None,
    wmax: float | None = None,
    base_url: str | None = None,
    timeout: float = 300,
) -> dict[str, Any]:
    """Run Rietveld refinement locally via dara-xrd + BGMN.

    Same signature as the old HTTP bridge so ``xrd.refine_dara`` is
    unchanged.  Returns the same response shape:
        {rwp, rexp, gof, quality_flags, phases, fitted_pattern}
    """
    from dara.refine import do_refinement_no_saving

    xy = Path(xy_path)
    if not xy.exists():
        raise FileNotFoundError(f"XY file not found: {xy}")

    all_cif_paths: list[Path] = []
    tmp_dir: Path | None = None

    if cif_paths:
        all_cif_paths.extend(Path(p) for p in cif_paths)

    if cif_texts:
        tmp_dir = Path(tempfile.mkdtemp(prefix="lattice-dara-cif-"))
        for entry in cif_texts:
            fname = entry.get("filename", f"phase_{len(all_cif_paths)}.cif")
            safe_name = Path(fname).name or f"phase_{len(all_cif_paths)}.cif"
            dest = tmp_dir / safe_name
            dest.write_text(entry["content"], encoding="utf-8")
            all_cif_paths.append(dest)

    if not all_cif_paths:
        raise ValueError("call_refinement: supply cif_paths or cif_texts")

    try:
        result = do_refinement_no_saving(
            pattern_path=xy,
            phases=all_cif_paths,
            instrument_profile=instrument_profile or "Aeris-fds-Pixcel1d-Medipix3",
        )
    finally:
        if tmp_dir is not None:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    rwp: float = result.lst_data.rwp
    rexp: float | None = getattr(result.lst_data, "rexp", None)
    gof: float | None = getattr(result.lst_data, "gof", None)
    if gof is None and rexp is not None and rexp > 0:
        gof = round(rwp / rexp, 4)

    quality_flags: list[str] = []
    if rwp > 15.0:
        quality_flags.append("HIGH_RWP")
    if gof is not None:
        if gof > 3.0:
            quality_flags.append("HIGH_GOF")
        elif gof < 1.0:
            quality_flags.append("POSSIBLE_OVERFIT")

    n_phases = len(result.lst_data.phases_results)
    phases: list[dict[str, Any]] = []
    for name, pr in result.lst_data.phases_results.items():
        def _unpack(field: Any) -> tuple[float | None, float | None]:
            if field is None:
                return (None, None)
            if isinstance(field, tuple):
                return (field[0], field[1] if len(field) > 1 else None)
            return (float(field), None)

        a_val, a_err = _unpack(pr.a)
        b_val, b_err = _unpack(pr.b)
        c_val, c_err = _unpack(pr.c)
        gew_val, gew_err = _unpack(pr.gewicht)
        alpha_val, _ = _unpack(getattr(pr, "alpha", None))
        beta_val, _ = _unpack(getattr(pr, "beta", None))
        gamma_val, _ = _unpack(getattr(pr, "gamma", None))

        if n_phases == 1 and (gew_val is None or gew_val == 0.0):
            gew_val = 1.0
            gew_err = None

        # BGMN only refines independent lattice parameters. Fill in
        # symmetry-constrained values so the UI always shows a/b/c/α/β/γ.
        cs = _infer_crystal_system(getattr(pr, "spacegroup_no", None))
        if cs == "cubic":
            if b_val is None and a_val is not None: b_val = a_val
            if c_val is None and a_val is not None: c_val = a_val
            alpha_val = alpha_val or 90.0
            beta_val = beta_val or 90.0
            gamma_val = gamma_val or 90.0
        elif cs == "hexagonal" or cs == "trigonal":
            if b_val is None and a_val is not None: b_val = a_val
            alpha_val = alpha_val or 90.0
            beta_val = beta_val or 90.0
            gamma_val = gamma_val or 120.0
        elif cs == "tetragonal":
            if b_val is None and a_val is not None: b_val = a_val
            alpha_val = alpha_val or 90.0
            beta_val = beta_val or 90.0
            gamma_val = gamma_val or 90.0
        elif cs == "orthorhombic":
            alpha_val = alpha_val or 90.0
            beta_val = beta_val or 90.0
            gamma_val = gamma_val or 90.0
        elif cs == "monoclinic":
            alpha_val = alpha_val or 90.0
            gamma_val = gamma_val or 90.0

        a_ang = round(a_val * 10, 5) if a_val else None
        b_ang = round(b_val * 10, 5) if b_val else None
        c_ang = round(c_val * 10, 5) if c_val else None
        alpha_d = round(alpha_val, 3) if alpha_val else None
        beta_d = round(beta_val, 3) if beta_val else None
        gamma_d = round(gamma_val, 3) if gamma_val else None

        phases.append({
            "phase_name": name,
            "weight_pct": round(gew_val * 100, 2) if gew_val is not None else None,
            "weight_pct_err": round(gew_err * 100, 2) if gew_err else None,
            "a": a_ang, "b": b_ang, "c": c_ang,
            "a_angstrom": a_ang, "b_angstrom": b_ang, "c_angstrom": c_ang,
            "a_err": round(a_err * 10, 5) if a_err else None,
            "b_err": round(b_err * 10, 5) if b_err else None,
            "c_err": round(c_err * 10, 5) if c_err else None,
            "alpha": alpha_d, "beta": beta_d, "gamma": gamma_d,
            "alpha_deg": alpha_d, "beta_deg": beta_d, "gamma_deg": gamma_d,
            "spacegroup_no": getattr(pr, "spacegroup_no", None),
            "hermann_mauguin": getattr(pr, "hermann_mauguin", None),
            "rphase": getattr(pr, "rphase", None),
        })

    fitted: dict[str, Any] = {}
    pd = getattr(result, "plot_data", None)
    if pd is not None:
        y_obs = _to_list(getattr(pd, "y_obs", None))
        y_calc = _to_list(getattr(pd, "y_calc", None))
        y_diff: list[float] = []
        if y_obs and y_calc and len(y_obs) == len(y_calc):
            y_diff = [round(o - c, 6) for o, c in zip(y_obs, y_calc)]
        fitted = {
            "x": _to_list(getattr(pd, "x", None)),
            "y_obs": y_obs,
            "y_calc": y_calc,
            "y_bkg": _to_list(getattr(pd, "y_bkg", None)),
            "y_diff": y_diff,
        }

    return {
        "rwp": rwp,
        "rexp": rexp,
        "gof": gof,
        "quality_flags": quality_flags,
        "phases": phases,
        "fitted_pattern": fitted,
    }
