"""library.* tools — paper metadata and reference helpers.

P4-η: `library.fetch_doi` resolves a DOI to a paper record via the
Crossref REST API. The renderer's `localProLibrary.addPaperByDoi` calls
this so the local library can grow from a DOI string without hitting
`lattice-cli`. Crossref is free + polite-headers friendly + low latency
for the metadata fields we need (title / authors / year / venue / DOI).

Other library.* tools (zotero export, RIS / BibTeX import) will land in
later phases under this same module."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


CROSSREF_BASE = "https://api.crossref.org/works/"
USER_AGENT = (
    "Lattice-app/0.1 (mailto:lattice@local) — self-contained "
    "compute notebook for materials-science spectroscopy"
)
DEFAULT_TIMEOUT_S = 12


def _normalize_doi(raw: str) -> str:
    """Strip common DOI prefixes so the Crossref URL is well-formed for
    both `10.x/...` shorthand and full `https://doi.org/...` URLs."""
    doi = raw.strip()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.lower().startswith(prefix):
            doi = doi[len(prefix):]
    return doi.strip()


def _join_authors(authors: list[dict[str, Any]]) -> str:
    """Crossref returns one object per author with `given` + `family`.
    The Lattice library stores authors as a single semicolon-separated
    string (matches the lattice-cli backend's column shape)."""
    parts: list[str] = []
    for a in authors:
        given = (a.get("given") or "").strip()
        family = (a.get("family") or "").strip()
        if family and given:
            parts.append(f"{family}, {given}")
        elif family:
            parts.append(family)
        elif given:
            parts.append(given)
    return "; ".join(parts) if parts else "Unknown"


def _extract_year(message: dict[str, Any]) -> str:
    """Crossref's date fields are nested arrays of [year, month, day].
    Prefer `published-print` then fall back to `issued` / `created`."""
    for key in ("published-print", "issued", "created"):
        chunk = message.get(key)
        if not isinstance(chunk, dict):
            continue
        parts = chunk.get("date-parts")
        if isinstance(parts, list) and parts and isinstance(parts[0], list):
            year = parts[0][0]
            if isinstance(year, (int, str)):
                return str(year)
    return ""


def fetch_doi(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    raw = params.get("doi")
    if not isinstance(raw, str) or not raw.strip():
        return {"success": False, "error": "doi parameter is required"}

    doi = _normalize_doi(raw)
    url = CROSSREF_BASE + urllib.parse.quote(doi, safe="/")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT_S) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {
                "success": False,
                "error": f"DOI not found in Crossref: {doi}",
            }
        return {
            "success": False,
            "error": f"Crossref returned HTTP {exc.code}: {exc.reason}",
        }
    except urllib.error.URLError as exc:
        return {
            "success": False,
            "error": f"Crossref request failed: {exc.reason}",
        }

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        return {
            "success": False,
            "error": f"Crossref returned malformed JSON: {exc}",
        }

    message = data.get("message") or {}
    title_list = message.get("title") or []
    title = title_list[0].strip() if title_list else doi
    authors = _join_authors(message.get("author") or [])
    year = _extract_year(message)
    container = message.get("container-title") or []
    journal = container[0] if container else None
    abstract = message.get("abstract")
    if isinstance(abstract, str):
        # Crossref abstracts come wrapped in `<jats:p>` etc. — strip the
        # tags so the renderer can render plain text without an HTML pass.
        abstract = _strip_tags(abstract)
    return {
        "success": True,
        "doi": doi,
        "title": title,
        "authors": authors,
        "year": year,
        "journal": journal,
        "url": message.get("URL"),
        "abstract": abstract,
        "source": "crossref",
    }


def _strip_tags(text: str) -> str:
    """Tiny, defensive HTML / XML tag stripper. Crossref abstracts may
    embed `<jats:p>` / `<jats:italic>` etc.; we don't ship a real parser
    for one tool, but a regex pass is enough for the metadata shape."""
    import re

    no_tags = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", no_tags).strip()
