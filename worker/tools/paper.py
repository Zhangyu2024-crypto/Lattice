"""paper.* tools — local PDF text extraction.

Currently exposes a single tool:

- ``paper.read_pdf`` — pdfplumber-backed per-page + full text extract,
  consumed by paper RAG (``askPaper`` / ``askMulti``) in the renderer.

The prior ``paper.extract_chains`` / ``paper.extractions`` heuristics
used to feed the knowledge/chain feature; they were removed along with
that feature. The ``read_pdf`` path has no knowledge/chain dependency
and is kept because PDF Q&A still needs it.
"""

from __future__ import annotations

import os
import re
from typing import Any


def read_pdf(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Extract per-page + full text from a PDF on disk."""
    path = params.get("path")
    paper_id = params.get("paper_id")
    if not isinstance(path, str) or not path.strip():
        return {"success": False, "error": "path parameter is required"}
    if not os.path.isabs(path):
        return {"success": False, "error": f"path must be absolute (got {path!r})"}
    if not os.path.exists(path):
        return {"success": False, "error": f"file not found: {path}"}
    if not os.path.isfile(path):
        return {"success": False, "error": f"not a regular file: {path}"}

    try:
        import pdfplumber  # type: ignore[import-not-found]
    except ImportError:
        return {
            "success": False,
            "error": "pdfplumber not installed; pip install -r worker/requirements.txt",
        }

    pages: list[dict[str, Any]] = []
    full_chunks: list[str] = []
    try:
        with pdfplumber.open(path) as pdf:
            for idx, page in enumerate(pdf.pages, start=1):
                try:
                    raw = page.extract_text() or ""
                except Exception:  # noqa: BLE001
                    raw = ""
                text = _normalise_text(raw)
                pages.append({
                    "page_number": idx,
                    "text": text,
                    "char_count": len(text),
                })
                if text:
                    full_chunks.append(text)
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": f"failed to read PDF: {exc}"}

    full_text = "\n\n".join(full_chunks)
    return {
        "success": True,
        "paper_id": paper_id,
        "n_pages": len(pages),
        "pages": pages,
        "full_text": full_text,
        "full_text_chars": len(full_text),
    }


def _normalise_text(text: str) -> str:
    no_hyphen = re.sub(r"-\n(?=\w)", "", text)
    cleaned_lines = [ln.rstrip() for ln in no_hyphen.splitlines()]
    return "\n".join(cleaned_lines).strip()
