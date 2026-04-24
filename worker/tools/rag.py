"""rag.* tools — 本地 RAG 检索（纯检索，不做 LLM 回答合成）。

Self-contained Port Plan §P4-ζ —— 替代 lattice-cli 的
`/api/library/paper/{id}/ask` 与 `/api/library/papers/ask-multi`
的第一阶段：worker 端只负责把一篇或多篇全文切成带重叠的片段，
用 TF-IDF 向量化（sklearn）对用户问题做 cosine 相似度检索，
返回 top-k chunks 及其来源元数据。LLM 端的 prompt 拼装与回答
生成放在 renderer（`src/lib/local-pro-rag.ts`），走现有
`sendLlmChat` IPC，以复用用户已配置的 LLM provider，并避免把
API key 暴露给 Python 进程。

这样分层的好处：
- worker 保持 *无状态、无网络、无密钥*（与 spectrum / xps 工具一致）。
- sentence-transformers 之类的大依赖无需引入；TF-IDF 覆盖 80% 的
  段落相关性检索场景已经足够，且冷启动显著更快。
- 未来升级到本地 embedding 模型时，只需替换本文件的向量化函数，
  接口签名与返回 shape 保持不变。

依赖：scikit-learn（TfidfVectorizer + cosine_similarity）。缺失时
返回一个明确 `{success: False, error: ...}`，不抛异常，这样
renderer 可以把它作为用户可读的提示展示而不是一个 500 错误。
"""

from __future__ import annotations

from typing import Any

# chunking 参数的默认值与硬上限。默认与 lattice-cli 的 RAG 参数接近
# （chunk 约 800 chars、overlap 约 200），命中率在 XRD/XPS/Raman 论文
# 全文上经验良好。上限用来防御恶意或错误输入（例如把 question 误传成
# 整篇论文）。
DEFAULT_TOP_K = 6
DEFAULT_CHUNK_SIZE = 800
DEFAULT_CHUNK_OVERLAP = 200

MIN_CHUNK_SIZE = 64
MAX_CHUNK_SIZE = 8_000
MAX_TOP_K = 32
MAX_FEATURES = 20_000
# 单次调用 chunk 总数上限——TF-IDF 对几千个短 chunk 仍然很快，但
# 万级以上会明显拖慢；超出就提示调用方先缩减文档集或增大 chunk_size。
MAX_TOTAL_CHUNKS = 5_000

_SKLEARN_HINT = (
    "scikit-learn required; pip install -r worker/requirements.txt"
)


def _coerce_int(value: Any, default: int, *, minimum: int, maximum: int) -> int:
    """把参数里可能是 int / float / str 的值收敛成合法整数。非法或
    越界时返回 `default`（而不是抛错），保证检索行为在 UI 面前永远
    稳定 —— 用户在参数面板里把 top_k 清空不应该让整次问答失败。"""
    try:
        n = int(value) if value is not None else default
    except (TypeError, ValueError):
        return default
    if n < minimum:
        return minimum
    if n > maximum:
        return maximum
    return n


def _coerce_documents(raw: Any) -> list[dict[str, Any]]:
    """把 renderer 传来的 documents 列表规范化：

    - 强制 `id`（允许 int 或 str；None/空串直接跳过该文档）
    - 强制 `text` 为非空 str（空文本没有检索价值）
    - `title` 可选，规范成 str 或 None

    返回副本，不修改原对象。校验失败的文档静默跳过 —— 多文档问答里
    其中一篇没全文不应该让整次调用失败；如果所有文档都被过滤掉了，
    上层函数会返回一个显式的 `success: False` 错误。
    """
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        doc_id = item.get("id")
        if doc_id is None:
            continue
        if isinstance(doc_id, str):
            doc_id = doc_id.strip()
            if not doc_id:
                continue
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        title = item.get("title")
        out.append(
            {
                "id": doc_id,
                "text": text,
                "title": title if isinstance(title, str) else None,
            }
        )
    return out


def _chunk_document(
    doc_id: Any,
    doc_title: str | None,
    text: str,
    chunk_size: int,
    overlap: int,
) -> list[dict[str, Any]]:
    """把一篇全文按字符窗口切片，窗口之间重叠 `overlap` 字符。

    关键边界：
    - text 长度 <= chunk_size → 整篇作为一个 chunk 返回
    - overlap >= chunk_size → 退化到 overlap=0，否则 step 非正会死循环
    - overlap < 0 → 按 0 处理
    - chunk_size 比下限小 → 上层 `_coerce_int` 已兜住，这里只是最后一道 guard

    生成的 `chunk_index` 从 0 开始在该文档内编号，便于 UI 展示 "第 N 段" 并定位原文。
    """
    n = len(text)
    if n == 0:
        return []
    # guard 一次，避免上层参数穿透进来是负数
    chunk_size = max(int(chunk_size), MIN_CHUNK_SIZE)
    overlap = max(int(overlap), 0)
    if overlap >= chunk_size:
        # overlap 不应该 >= chunk_size —— 否则每轮窗口原地踏步。
        # 规约到 chunk_size 的一半，这是个常用且安全的默认。
        overlap = chunk_size // 2
    step = chunk_size - overlap
    if step <= 0:
        step = chunk_size  # 最后一道保险

    chunks: list[dict[str, Any]] = []
    if n <= chunk_size:
        chunks.append(
            {
                "doc_id": doc_id,
                "doc_title": doc_title,
                "chunk_index": 0,
                "char_start": 0,
                "char_end": n,
                "text": text,
            }
        )
        return chunks

    idx = 0
    start = 0
    while start < n:
        end = min(start + chunk_size, n)
        piece = text[start:end]
        # 纯空白的片段没有检索价值（TF-IDF 会抛 "empty vocabulary"）
        if piece.strip():
            chunks.append(
                {
                    "doc_id": doc_id,
                    "doc_title": doc_title,
                    "chunk_index": idx,
                    "char_start": start,
                    "char_end": end,
                    "text": piece,
                }
            )
            idx += 1
        if end >= n:
            break
        start += step
    return chunks


def retrieve(params: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
    """检索一个或多个文档里与问题最相关的 top-k chunks。

    参数（`params` 字典）：
    - `documents`: `list[{id, text, title?}]` — 一或多篇全文（已经从
      PDF 提取成纯文本）。`id` 可以是 int（library 的 paper id）或
      任意 str。
    - `question`: `str` — 用户的自然语言问题。
    - `top_k` (可选)：返回前 k 个 chunks，默认 6，上限 32。
    - `chunk_size` (可选)：每片字符数，默认 800。
    - `chunk_overlap` (可选)：相邻片段重叠字符数，默认 200。

    返回（成功）：
        {
          "success": True,
          "question": <原样回传>,
          "chunks": [{doc_id, doc_title, chunk_index, score, text, char_start, char_end}, ...],
          "summary": "Retrieved <k> chunks across <n> document(s)"
        }

    返回（失败）：
        {"success": False, "error": "<人读错误>"}

    失败不抛异常：renderer 需要把这个错误直接显示给用户。未安装
    scikit-learn 是最常见的失败路径，错误消息里直接给出安装命令。
    """
    # sklearn 的导入放在函数体内，这样 worker 启动时不会因为缺
    # sklearn 就把 rag.retrieve 标记成不可用（而是在真正调用时
    # 才报错，对用户更友好）。同时延后导入显著降低 cold start。
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity
    except ImportError:
        return {"success": False, "error": _SKLEARN_HINT}

    question_raw = params.get("question")
    if not isinstance(question_raw, str) or not question_raw.strip():
        return {
            "success": False,
            "error": "question is required and must be a non-empty string",
        }
    question = question_raw.strip()

    documents = _coerce_documents(params.get("documents"))
    if not documents:
        return {
            "success": False,
            "error": (
                "at least one document with non-empty text is required; "
                "make sure the paper has extractable full text"
            ),
        }

    top_k = _coerce_int(
        params.get("top_k"), DEFAULT_TOP_K, minimum=1, maximum=MAX_TOP_K,
    )
    chunk_size = _coerce_int(
        params.get("chunk_size"),
        DEFAULT_CHUNK_SIZE,
        minimum=MIN_CHUNK_SIZE,
        maximum=MAX_CHUNK_SIZE,
    )
    chunk_overlap = _coerce_int(
        params.get("chunk_overlap"),
        DEFAULT_CHUNK_OVERLAP,
        minimum=0,
        maximum=max(chunk_size - 1, 0),
    )

    all_chunks: list[dict[str, Any]] = []
    for doc in documents:
        all_chunks.extend(
            _chunk_document(
                doc_id=doc["id"],
                doc_title=doc["title"],
                text=doc["text"],
                chunk_size=chunk_size,
                overlap=chunk_overlap,
            )
        )
        if len(all_chunks) > MAX_TOTAL_CHUNKS:
            return {
                "success": False,
                "error": (
                    f"too many chunks ({len(all_chunks)} > {MAX_TOTAL_CHUNKS}); "
                    "increase chunk_size or reduce the number of documents"
                ),
            }

    if not all_chunks:
        return {
            "success": False,
            "error": "no indexable text after chunking (documents may be whitespace-only)",
        }

    # 当 chunk 数 ≤ top_k 时我们依旧跑一遍 TF-IDF —— 虽然所有片段都
    # 会被返回，但保留 score 排序让 UI 能按相关性高亮。
    corpus: list[str] = [c["text"] for c in all_chunks]

    try:
        vectorizer = TfidfVectorizer(
            stop_words="english",
            max_features=MAX_FEATURES,
            ngram_range=(1, 1),
        )
        # 把 question 和所有 chunks 一起 fit，保证两侧共享同一个词表。
        matrix = vectorizer.fit_transform(corpus + [question])
    except ValueError as exc:
        # "empty vocabulary" 常见于文档全是停用词或非字母字符（例如
        # OCR 失败只剩标点）。这种情况给调用方一个能定位的错误。
        return {
            "success": False,
            "error": f"TF-IDF vectorization failed: {exc}",
        }

    doc_matrix = matrix[:-1]
    question_vec = matrix[-1]
    similarities = cosine_similarity(question_vec, doc_matrix)[0]

    # argsort 从小到大；取末尾 top_k 再反向，得到相关度降序索引。
    # 当 chunk 数少于 top_k 时自然就是全集。
    k = min(top_k, len(all_chunks))
    order = similarities.argsort()[-k:][::-1]

    ranked: list[dict[str, Any]] = []
    for rank_pos, idx in enumerate(order):
        chunk = all_chunks[int(idx)]
        ranked.append(
            {
                "doc_id": chunk["doc_id"],
                "doc_title": chunk["doc_title"],
                "chunk_index": chunk["chunk_index"],
                "char_start": chunk["char_start"],
                "char_end": chunk["char_end"],
                "score": float(similarities[int(idx)]),
                "rank": rank_pos,
                "text": chunk["text"],
            }
        )

    # 用集合统计独立 doc 数，而不是直接 len(documents)：后者会把那些
    # chunk 全部被过滤掉的文档也算进去，误导用户。
    distinct_docs = len({c["doc_id"] for c in ranked})
    return {
        "success": True,
        "question": question,
        "chunks": ranked,
        "summary": f"Retrieved {len(ranked)} chunks across {distinct_docs} document(s)",
    }
