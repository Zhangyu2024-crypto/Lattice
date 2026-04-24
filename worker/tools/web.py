"""web.* tools — URL fetching and web search.

Provides the Lattice agent with general-purpose web access:

- ``web.fetch``   — Retrieve a URL and return its content as plain text
                    (HTML is stripped to readable text). Useful for
                    fetching paper abstracts, database pages, API docs.

- ``web.search``  — Search the web via DuckDuckGo (no API key needed)
                    and return a list of results with title, snippet, URL.
"""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_MAX_CHARS = 50_000
DEFAULT_TIMEOUT_S = 15
DEFAULT_MAX_RESULTS = 10

_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


# ── HTML → plain text ───────────────────────────────────────────────

def _strip_html(raw: str) -> str:
    """Best-effort HTML → readable plain text without external deps."""
    text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", raw, flags=re.I)
    text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", text, flags=re.I)
    text = re.sub(r"<nav[^>]*>[\s\S]*?</nav>", "", text, flags=re.I)
    text = re.sub(r"<footer[^>]*>[\s\S]*?</footer>", "", text, flags=re.I)
    text = re.sub(r"<header[^>]*>[\s\S]*?</header>", "", text, flags=re.I)
    text = re.sub(r"<(br|hr)\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|div|li|tr|h[1-6])>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_title(raw_html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", raw_html, re.I | re.S)
    return html.unescape(m.group(1).strip()) if m else ""


# ── web.fetch ───────────────────────────────────────────────────────

def fetch(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Fetch a URL and return its content as plain text.

    Parameters:
      - url (str, required): The URL to fetch.
      - max_chars (int, default 50000): Truncate response body to this
        many characters. Prevents OOM on huge pages.
      - timeout (int, default 15): Request timeout in seconds.
      - raw (bool, default false): If true, return raw HTML instead of
        stripped text.
    """
    url = params.get("url")
    if not isinstance(url, str) or not url.strip():
        return {"success": False, "error": "url is required"}
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    max_chars = int(params.get("max_chars", DEFAULT_MAX_CHARS))
    timeout = int(params.get("timeout", DEFAULT_TIMEOUT_S))
    want_raw = bool(params.get("raw", False))

    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            content_type = resp.headers.get("Content-Type", "")
            charset = "utf-8"
            if "charset=" in content_type:
                charset = content_type.split("charset=")[-1].split(";")[0].strip()
            raw_bytes = resp.read(max_chars * 4)
    except urllib.error.HTTPError as exc:
        return {
            "success": False,
            "error": f"HTTP {exc.code}: {exc.reason}",
            "status": exc.code,
        }
    except urllib.error.URLError as exc:
        return {"success": False, "error": f"URL error: {exc.reason}"}
    except TimeoutError:
        return {"success": False, "error": f"Request timed out after {timeout}s"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    try:
        raw_text = raw_bytes.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        raw_text = raw_bytes.decode("utf-8", errors="replace")

    is_html = "text/html" in content_type or raw_text.lstrip()[:15].lower().startswith(("<!doctype", "<html"))
    title = _extract_title(raw_text) if is_html else ""

    if want_raw or not is_html:
        body = raw_text[:max_chars]
    else:
        body = _strip_html(raw_text)[:max_chars]

    truncated = len(body) >= max_chars

    return {
        "success": True,
        "data": {
            "url": url,
            "status": status,
            "title": title,
            "content_type": content_type,
            "body": body,
            "truncated": truncated,
            "length": len(body),
        },
        "summary": f"Fetched {url} ({status}, {len(body)} chars{', truncated' if truncated else ''})",
    }


# ── web.search (Tavily) ─────────────────────────────────────────────

_TAVILY_URL = "https://api.tavily.com/search"
_TAVILY_KEY_ENV = "TAVILY_API_KEY"

_BUILTIN_TAVILY_KEYS: list[str] = [
    "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",
    "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",
    "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",
    "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",
    "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",
    "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",
    "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",
    "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",
    "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",
    "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",
]

_tavily_key_index: int = 0


def _resolve_tavily_keys() -> list[str]:
    """Collect Tavily API keys (compatible with lattice-cli).

    Priority: TAVILY_API_KEYS env (comma pool) > LATTICE_CLI_SEARCH_API_KEY
    > TAVILY_API_KEY > built-in key pool. Supports round-robin rotation
    on 401/429."""
    import os
    raw_pool = os.environ.get("TAVILY_API_KEYS", "")
    keys = [k.strip() for k in raw_pool.split(",") if k.strip()]
    if keys:
        return keys
    single = (
        os.environ.get("LATTICE_CLI_SEARCH_API_KEY")
        or os.environ.get(_TAVILY_KEY_ENV)
        or ""
    ).strip()
    if single:
        return [single]
    return list(_BUILTIN_TAVILY_KEYS)


def _next_tavily_key(keys: list[str]) -> str:
    global _tavily_key_index
    if not keys:
        return ""
    key = keys[_tavily_key_index % len(keys)]
    _tavily_key_index = (_tavily_key_index + 1) % len(keys)
    return key


def search(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """Search the web via Tavily Search API.

    Requires ``TAVILY_API_KEY`` environment variable (supports comma-
    separated key pool for round-robin rotation). Returns results with
    title, URL, snippet, and an optional AI-generated answer.

    Parameters:
      - query (str, required): Search query.
      - max_results (int, default 5): Maximum number of results.
      - search_depth (str, default "basic"): "basic" or "advanced".
      - include_answer (bool, default true): Include Tavily AI answer.
      - timeout (int, default 30): Request timeout in seconds.
    """
    query = params.get("query")
    if not isinstance(query, str) or not query.strip():
        return {"success": False, "error": "query is required"}
    query = query.strip()

    keys = _resolve_tavily_keys()
    if not keys:
        return {
            "success": False,
            "error": (
                "TAVILY_API_KEY not set. Get a free key at https://tavily.com "
                "and set it: export TAVILY_API_KEY=tvly-..."
            ),
        }

    max_results = int(params.get("max_results", 5))
    search_depth = str(params.get("search_depth", "basic"))
    include_answer = bool(params.get("include_answer", True))
    timeout = int(params.get("timeout", 30))

    payload = json.dumps({
        "query": query,
        "search_depth": search_depth,
        "max_results": max_results,
        "include_answer": include_answer,
    }).encode("utf-8")

    last_error = ""
    tried = 0
    while tried < len(keys):
        api_key = _next_tavily_key(keys)
        tried += 1
        body = json.dumps({
            "api_key": api_key,
            "query": query,
            "search_depth": search_depth,
            "max_results": max_results,
            "include_answer": include_answer,
        }).encode("utf-8")
        req = urllib.request.Request(
            _TAVILY_URL,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 429):
                last_error = f"HTTP {exc.code} on key ...{api_key[-6:]}"
                continue
            return {"success": False, "error": f"Tavily HTTP {exc.code}: {exc.reason}"}
        except Exception as exc:
            return {"success": False, "error": f"Tavily request failed: {exc}"}

        answer = str(data.get("answer") or "").strip()
        results: list[dict[str, str]] = []
        for item in data.get("results") or []:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            url = str(item.get("url") or "").strip()
            content = str(item.get("content") or "").strip()
            if url:
                results.append({
                    "title": title or url,
                    "url": url,
                    "snippet": content[:500],
                })

        return {
            "success": True,
            "data": {
                "query": query,
                "answer": answer,
                "results": results,
                "count": len(results),
                "backend": "tavily",
            },
            "summary": (
                f"Tavily: {len(results)} result(s) for '{query}'"
                + (f" — {answer[:120]}..." if len(answer) > 120 else (f" — {answer}" if answer else ""))
            ),
        }

    return {
        "success": False,
        "error": f"All {len(keys)} Tavily key(s) exhausted. Last: {last_error}",
    }
