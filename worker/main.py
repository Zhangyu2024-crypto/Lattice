"""
Lattice repo-local Python worker.

JSON-RPC over stdio. The Electron main process spawns this script with
`python3 -u worker/main.py` and exchanges newline-delimited JSON lines:

    request   {"id":"...","method":"<tool>.<verb>","params":{...}}
    response  {"id":"...","result":{...}}
              {"id":"...","error":{"code":"...","message":"..."}}
    event     {"event":"progress","id":"...","fraction":0.42, ...}
    log       {"event":"log","level":"info","message":"..."}

Process model: one long-lived worker that handles many calls. Stdout is
the protocol channel; stderr is reserved for unstructured logging that
the worker-manager surfaces in the renderer console. The worker terminates
when stdin is closed (Electron quits) or when an unhandled SystemExit
escapes a tool (the worker-manager will respawn on next call).

See docs/PYTHON_WORKER_PLAN.md for the bigger picture (P4-α scaffold +
later XRD / XPS / Raman / paper-extraction tools).
"""

from __future__ import annotations

import json
import sys
import threading
import time
import traceback
from typing import Any, Callable

from tools import REGISTRY as TOOL_REGISTRY


PROTOCOL_VERSION = "1"

# Hard upper bound on the byte-size of a single JSON-RPC request line read
# from stdin. Realistic payloads — even a full spectrum plus peak table —
# stay well under 2 MB; 4 MB gives comfortable headroom while still being
# small enough that a misbehaving client can't pressure the worker into an
# OOM by streaming an unbounded line. Lines above this are rejected with
# a structured error before any JSON parse is attempted.
MAX_LINE_BYTES = 4 * 1024 * 1024


def _emit(payload: dict[str, Any]) -> None:
    """Write a single JSON line to stdout. The flush is critical — without
    it the parent reads nothing until the buffer fills."""
    sys.stdout.write(json.dumps(payload, separators=(",", ":")))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _emit_log(level: str, message: str) -> None:
    """Structured log line. The worker-manager forwards these to the
    renderer's console / toast surface."""
    _emit({"event": "log", "level": level, "message": message})


def _emit_event(event: str, request_id: str | None, **fields: Any) -> None:
    """Out-of-band event tied to an in-flight request. Used by long-running
    tools to report progress (`progress` event with a `fraction`)."""
    payload: dict[str, Any] = {"event": event}
    if request_id is not None:
        payload["id"] = request_id
    payload.update(fields)
    _emit(payload)


def _make_progress_callback(request_id: str) -> Callable[..., None]:
    """Inject a per-request progress emitter into a tool. Tools that don't
    want to report progress simply ignore the kwarg."""

    def progress(**fields: Any) -> None:
        _emit_event("progress", request_id, **fields)

    return progress


def _dispatch(request_id: str, method: str, params: dict[str, Any]) -> None:
    """Resolve a method to a tool and run it on the dispatch thread (each
    request gets its own thread so a slow tool can't block ping/pong)."""
    tool = TOOL_REGISTRY.get(method)
    if tool is None:
        _emit(
            {
                "id": request_id,
                "error": {
                    "code": "UNKNOWN_METHOD",
                    "message": f"Unknown method: {method}",
                },
            }
        )
        return

    started = time.monotonic()
    try:
        progress = _make_progress_callback(request_id)
        result = tool(params, progress=progress)
        _emit(
            {
                "id": request_id,
                "result": result,
                "duration_ms": int((time.monotonic() - started) * 1000),
            }
        )
    except Exception as exc:  # noqa: BLE001 — tools may throw anything
        _emit(
            {
                "id": request_id,
                "error": {
                    "code": exc.__class__.__name__,
                    "message": str(exc) or repr(exc),
                    "traceback": traceback.format_exc(),
                },
                "duration_ms": int((time.monotonic() - started) * 1000),
            }
        )


def _spawn_dispatch(request_id: str, method: str, params: dict[str, Any]) -> None:
    """Run `_dispatch` in its own thread so the main read-loop stays
    responsive. Threads are intentionally not pooled — request volume is
    expected to stay low and joinless threading keeps the code obvious."""
    threading.Thread(
        target=_dispatch,
        args=(request_id, method, params),
        daemon=True,
    ).start()


def _read_loop() -> None:
    """Block on stdin and dispatch each well-formed line. Bad lines are
    logged but don't terminate the worker — the parent might recover."""
    for raw in sys.stdin:
        if len(raw) > MAX_LINE_BYTES:
            # Reject before any JSON parse so an unbounded line can't
            # cascade into a huge string allocation downstream. We skip
            # the line entirely — partial JSON is not recoverable, and
            # the parent will time out the request and retry.
            _emit_log(
                "error",
                f"stdin line exceeds {MAX_LINE_BYTES} bytes "
                f"(got {len(raw)}); dropping request",
            )
            continue
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            _emit_log("error", f"failed to parse line: {exc}")
            continue
        if not isinstance(msg, dict):
            _emit_log("error", "expected a JSON object per line")
            continue
        request_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params") or {}
        if not isinstance(request_id, str) or not isinstance(method, str):
            _emit_log("error", "missing id/method in request")
            continue
        if not isinstance(params, dict):
            _emit_log("error", f"params must be an object (got {type(params).__name__})")
            params = {}
        _spawn_dispatch(request_id, method, params)


def main() -> int:
    _emit(
        {
            "event": "ready",
            "protocol": PROTOCOL_VERSION,
            "tools": sorted(TOOL_REGISTRY.keys()),
            "python": sys.version.split()[0],
        }
    )
    try:
        _read_loop()
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
