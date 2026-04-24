"""paper.* tools — local PDF text extraction + heuristic chain parsing.

Self-contained Port §P4-ε — replaces three lattice-cli REST endpoints:

- ``paper.read_pdf``         (was ``GET /api/library/paper/{id}/read``)
- ``paper.extractions``      (was ``GET /api/library/paper/{id}/extractions``)
- ``paper.extract_chains``   (was ``GET /api/library/paper/{id}/chains``)

The real lattice-cli pipeline used a full LLM + PDF layout parser to
build knowledge chains; the repo-local worker stays dependency-light
and ships a *heuristic* first pass.

- ``read_pdf`` uses ``pdfplumber`` to pull raw text per page. The
  import is deferred so a worker without the optional dependency still
  boots and answers other tools; we return an actionable error from
  the tool itself rather than crashing the whole registry on startup.

- ``extract_chains`` walks the full text sentence-by-sentence and tags
  fragments that look like materials-science process / state /
  measurement nodes (anneal / reflux / SEM / XRD / etc.).

- ``extractions`` is a placeholder — the real summary-of-extractions
  response needs LLM-backed analysis that lives downstream of this
  phase; we return an empty array so the renderer's "extractions" tab
  renders cleanly without a stub error banner.

Every response intentionally mirrors what ``src/lib/local-pro-paper.ts``
expects: ``success: bool`` plus typed payload.
"""

from __future__ import annotations

import os
import re
from typing import Any


_PROCESS_VERBS: tuple[str, ...] = (
    "anneal", "annealed", "annealing",
    "reflux", "refluxed", "refluxing",
    "sinter", "sintered", "sintering",
    "calcine", "calcined", "calcination",
    "dry", "dried", "drying",
    "grind", "ground", "grinding",
    "centrifuge", "centrifuged", "centrifugation",
    "stir", "stirred", "stirring",
    "dissolve", "dissolved",
    "wash", "washed",
    "filter", "filtered",
)

_MEASUREMENTS: tuple[str, ...] = (
    "XRD", "SEM", "TEM", "BET", "Raman", "IR", "FTIR",
    "UV", "UV-Vis", "XPS", "NMR", "TGA", "DSC", "EDS", "EDX",
)

_STEP_RE = re.compile(r"\bStep\s+(\d+)\s*[:\.\-]", re.IGNORECASE)
_YIELD_RE = re.compile(r"\byield(?:s|ed)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*%")
_ARROW_RE = re.compile(r"→|->|⟶")

_PROCESS_RE = re.compile(
    r"\b(" + "|".join(re.escape(v) for v in _PROCESS_VERBS) + r")\b",
    re.IGNORECASE,
)
# Measurements are case-sensitive — acronyms only, avoids "ir" matching "their".
_MEASUREMENT_RE = re.compile(
    r"\b(" + "|".join(re.escape(m) for m in _MEASUREMENTS) + r")\b"
)

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[\.!?])\s+(?=[A-Z(])|\n{2,}")

_MAX_NAME_CHARS = 80
_MAX_LINE_CHARS = 240


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


def extract_chains(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Heuristic chain extraction from free-form paper text.

    DEPRECATED (2026-04): The renderer's self-contained pipeline
    (`src/lib/knowledge/auto-extract.ts` → `llm-extract.ts`) now owns
    chain extraction end-to-end. It uses an LLM prompt plus the v2
    quality gate in `quality-evaluator.ts`, writing results directly
    to IndexedDB. This worker tool is retained only for potential
    programmatic callers; do NOT reconnect it to the main extraction
    path — heuristic output here bypasses the quality gate and would
    re-introduce the pollution this refactor was meant to clear.
    """
    text = params.get("text")
    paper_id = params.get("paper_id")
    if not isinstance(text, str) or not text.strip():
        return {"success": True, "paper_id": paper_id, "chains": []}

    nodes = _scan_nodes(text)
    if not nodes:
        return {"success": True, "paper_id": paper_id, "chains": []}

    return {
        "success": True,
        "paper_id": paper_id,
        "chains": [{"id": 1, "nodes": nodes}],
    }


def extractions(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Placeholder — LLM-driven extraction summary lands in a later phase."""
    paper_id = params.get("paper_id")
    return {"success": True, "paper_id": paper_id, "extractions": []}


def _normalise_text(text: str) -> str:
    no_hyphen = re.sub(r"-\n(?=\w)", "", text)
    cleaned_lines = [ln.rstrip() for ln in no_hyphen.splitlines()]
    return "\n".join(cleaned_lines).strip()


def _sentences(text: str) -> list[str]:
    if not text:
        return []
    unified = text.replace("\r", "\n").replace("\f", "\n")
    unified = re.sub(r"(?<!\n)\n(?!\n)", " ", unified)
    parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(unified) if p.strip()]
    return parts


def _truncate(value: str, limit: int) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


def _classify_sentence(sentence: str) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    line_excerpt = _truncate(sentence, _MAX_LINE_CHARS)

    for match in _STEP_RE.finditer(sentence):
        nodes.append({
            "role": "state",
            "name": _truncate(f"Step {match.group(1)}", _MAX_NAME_CHARS),
            "line": line_excerpt,
        })

    if _ARROW_RE.search(sentence):
        nodes.append({
            "role": "state",
            "name": _truncate(sentence, _MAX_NAME_CHARS),
            "line": line_excerpt,
        })

    for match in _YIELD_RE.finditer(sentence):
        nodes.append({
            "role": "state",
            "name": _truncate(f"yield {match.group(1)}%", _MAX_NAME_CHARS),
            "line": line_excerpt,
        })

    seen_process: set[str] = set()
    for match in _PROCESS_RE.finditer(sentence):
        token = match.group(1).lower()
        if token in seen_process:
            continue
        seen_process.add(token)
        nodes.append({
            "role": "process",
            "name": _truncate(token, _MAX_NAME_CHARS),
            "line": line_excerpt,
        })

    seen_meas: set[str] = set()
    for match in _MEASUREMENT_RE.finditer(sentence):
        token = match.group(1)
        key = token.upper()
        if key in seen_meas:
            continue
        seen_meas.add(key)
        nodes.append({
            "role": "measurement",
            "name": _truncate(token, _MAX_NAME_CHARS),
            "line": line_excerpt,
        })

    return nodes


def _scan_nodes(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    ordinal = 1
    for sentence in _sentences(text):
        for node in _classify_sentence(sentence):
            node["ordinal"] = ordinal
            ordinal += 1
            out.append(node)
    return out
