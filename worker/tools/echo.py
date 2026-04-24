"""system.echo — round-trip the input back as the result.

Used by the worker-manager to verify spawn / IPC plumbing without
exercising any scientific dependency. The renderer's CommandPalette
"Test Python worker" entry calls this on demand."""

from __future__ import annotations

import sys
from typing import Any


def echo(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    return {
        "echo": params,
        "python_version": sys.version.split()[0],
    }
