"""Tool registry for the Lattice Python worker.

Each tool is a callable `tool(params: dict, *, progress: Callable) -> Any`.
The worker dispatcher injects a `progress` keyword so long-running tools
can stream back partial state; tools that don't care should accept
`**kwargs` (or list `progress=None` explicitly).

Adding a tool: drop the module under `tools/`, then list it in
`_TOOL_SPECS` below with the dotted name (`namespace.verb`).

Imports are **lazy** so a single tool whose dependency isn't installed
(numpy / scipy / pymatgen / ...) doesn't take the whole worker down.
A failed import registers a placeholder that, when called, returns a
clear error pointing at the missing requirement.
"""

from __future__ import annotations

import importlib
from typing import Any, Callable, Dict, List, Tuple

Tool = Callable[..., Any]

# Each entry: (dotted-method-name, module-name-under-tools, attribute-name).
# Add new tools here; the registry build below handles import failures
# gracefully so a half-installed worker still boots with the rest of the
# catalog intact.
_TOOL_SPECS: List[Tuple[str, str, str]] = [
    ("system.echo", "echo", "echo"),
    ("library.fetch_doi", "library", "fetch_doi"),
    ("spectrum.detect_peaks", "spectrum", "detect_peaks"),
    ("spectrum.assess_quality", "spectrum", "assess_quality"),
    ("spectrum.smooth", "spectrum", "smooth"),
    ("spectrum.baseline", "spectrum", "baseline"),
    ("xrd.search", "xrd", "search"),
    ("xrd.refine", "xrd", "refine"),
    ("xrd.refine_dara", "xrd", "refine_dara"),
    ("xps.lookup", "xps", "lookup"),
    ("xps.charge_correct", "xps", "charge_correct"),
    ("xps.quantify", "xps", "quantify"),
    ("xps.fit", "xps", "fit"),
    ("xps.validate", "xps", "validate"),
    ("web.fetch", "web", "fetch"),
    ("web.search", "web", "search"),
    ("raman.identify", "raman", "identify"),
    ("paper.read_pdf", "paper", "read_pdf"),
    ("paper.extract_chains", "paper", "extract_chains"),
    ("paper.extractions", "paper", "extractions"),
    ("rag.retrieve", "rag", "retrieve"),
    ("cif_db.get", "cif_db", "get"),
    ("cif_db.search", "cif_db", "search"),
    ("cif_db.stats", "cif_db", "stats"),
]


def _make_unavailable(name: str, reason: str) -> Tool:
    """Return a placeholder that surfaces the import failure inline so a
    user calling a half-installed tool sees an actionable hint rather
    than a generic UNKNOWN_METHOD."""

    def _placeholder(_params: dict, **_kwargs: Any) -> Any:
        raise RuntimeError(
            f"Tool '{name}' is not available in this worker: {reason}. "
            "Install missing dependencies (see worker/requirements.txt) "
            "and restart the worker."
        )

    return _placeholder


def _build_registry() -> Dict[str, Tool]:
    out: Dict[str, Tool] = {}
    failures: List[str] = []
    for method, module_name, attr in _TOOL_SPECS:
        try:
            module = importlib.import_module(f".{module_name}", __name__)
        except Exception as exc:  # noqa: BLE001
            out[method] = _make_unavailable(method, str(exc))
            failures.append(f"{method}: {exc}")
            continue
        tool = getattr(module, attr, None)
        if not callable(tool):
            out[method] = _make_unavailable(
                method, f"module '{module_name}' has no callable '{attr}'",
            )
            failures.append(f"{method}: missing attribute {attr}")
            continue
        out[method] = tool
    if failures:
        # The dispatcher's ready event already enumerates the registered
        # tools; printing the failures to stderr lets the worker-manager
        # forward them to the Electron main-process console for triage
        # without polluting the JSON-RPC stdout channel.
        import sys

        for line in failures:
            print(f"[worker tools] unavailable — {line}", file=sys.stderr)
    return out


REGISTRY: Dict[str, Tool] = _build_registry()
