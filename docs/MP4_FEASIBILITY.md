---
title: MP-4 可行性勘察 —— Composer 内联 chip 升级路径
status: Draft v0.1
date: 2026-04-13
author: Claude (集成评估 — 未做用户访谈)
related:
  - docs/CHAT_PANEL_REDESIGN.md §9 MP-4
  - docs/CHAT_PANEL_REDESIGN.md §4.4 文本 ↔ mention 编码
---

# MP-4 可行性勘察

## 1. 目标回顾

MP-2 选定的 MVP 方案是 **plain `<textarea>` + 侧栏 chip 列**，文本里塞 `@[label#anchor]` 字面量（设计文档 §4.4）。MP-4 的目标是把 chip **真正**渲染在文本流中（像 Notion / Cursor 那样），文本与 chip 位置硬绑定（用 anchor 作为隐式占位符），同时保住：

- **数据模型不变**：`{ content, mentions: Array<{anchor, ref}> }` 与 IPC 协议无差
- IME（中文/日韩）输入流畅
- 复制粘贴 chip 跨消息保留 ref（合理范围内）
- backspace 在 chip 边界一次删整个 chip（atomic delete）
- undo / redo 不破坏 chip 完整性
- 不引入巨型依赖（bundle 已 3.2MB）

## 2. 四方案对比矩阵

| 维度 | A. Lexical (Meta) | B. Slate | C. ProseMirror | D. 自研 contentEditable |
|---|---|---|---|---|
| 实现量 | M（plugin + node 定义 ~400 LOC） | M（schema + render ~500 LOC） | L（schema + view ~700 LOC） | XL（要自己处理 IME / paste / undo / 选区 ~1500 LOC + 长尾 bug） |
| IME | ✅ 内置正确（已被 Meta 内部产品验证） | ⚠️ 多数 OK，复杂场景有 issue | ✅ 良好 | ❌ 自己写很难，CJK 候选列表与 chip 边界冲突高发 |
| 复制粘贴 | ✅ 可定义 chip serializer 跨消息保留 | ✅ 同 | ✅ 同 | ⚠️ 必须自己写 mime 解析 |
| 原子删除 | ✅ 原生 atomic node 支持 | ✅ void node | ✅ atom node | ❌ 必须监听 `beforeinput` 自己合并 selection |
| Undo/Redo | ✅ 内置 history plugin | ✅ 内置 | ✅ 内置 history | ❌ 必须自己实现，与 React state 协调复杂 |
| 数据模型兼容 | M（写 chip-to-mention 序列化） | M（同） | M（同） | S（直接读 DOM 序列化） |
| Bundle 增量 | ~70KB gz（lexical core + react binding） | ~110KB gz（slate + slate-react + slate-history） | ~150KB gz（prosemirror-state + view + model + react binding） | 0KB |
| 维护 / 文档 | ✅ 活跃，Meta 用 | ✅ 活跃 | ✅ 活跃但 API 学习曲线陡 | ❌ 我们自己长期维护 |
| 长尾风险 | ~ 已知 minor bug | ~ 跨浏览器选区偶发 | 较少 | 高（IME × paste × undo 三向交叉） |

## 3. 结论与推荐

**推荐 A — Lexical**。理由：

1. **IME 正确性**是最大不确定项；Lexical 是被生产环境验证过的（Meta Workplace、ChatGPT Web 早期），自研走 D 路线我们大概率会在 CJK 输入上栽大跟头。
2. **API 适合 React**：node 定义 + plugin 系统贴近 React 心智模型；Slate 也行，但 Lexical 的 atomic node 比 Slate 的 void element 概念清晰一截。
3. **Bundle 70KB gz**：在已有 3.2MB / 970KB gz 的盘子里几乎不可见。
4. **数据互通成本可控**：写一个 `MentionNode extends DecoratorNode` 包住 `MentionRef`；序列化器输出 `@[label#anchor]` 文本就回到 MP-2 数据形态。

**不推荐 D 自研**：行业里这条路上踩过坑的人都不再推荐。我们的核心价值是科研工作流，不是富文本编辑器。

**不推荐 C ProseMirror**：能力过剩、bundle 略大、上手陡。Lattice 不需要 schema 验证级别的强约束。

**不推荐 B Slate**：与 A 几乎打平，但 Slate 的 IME 与 void node 在 CJK 上有 GitHub issue 历史；A 略稳。

## 4. 增量上线方案（如果选 Lexical）

避免一次性大改 AgentComposer 把 MP-2/MP-3 现有体验摔碎，分三步走：

**MP-4-α（≈0.5 天）**：在 `src/components/mention/` 新建 `LexicalComposerInput.tsx`，**与现有 textarea 并存**，由一个 prefs 开关 `prefs.experimental.lexicalComposer` 切换。默认关闭。
- LexicalComposerInput 内部对外暴露与 textarea 相同的 props（`value`/`onChange`/`onMentionInsert`/`onSubmit`），让 AgentComposer 切换零侵入。
- MentionNode：包 ref + label + anchor，渲染为 `<MentionChip>`。

**MP-4-β（≈1 天）**：MentionPicker 接到 LexicalComposerInput，复用现有 hover/键盘逻辑；插入路径调 Lexical 的 `$insertNodes`。
- IME guard 用 Lexical 的 `COMPOSITION_PRIORITY` 命令拦截。
- Paste handler 注册 `PASTE_COMMAND`，按 `text/lattice-mention` mime 解析 chip。

**MP-4-γ（≈0.5 天）**：dogfood 一周后，把 prefs 默认翻为 true，删除 textarea 路径与字符串扫描的 fallback。anchor 协议保留（同 anchor 既能被序列化为 `@[label#anchor]` 也能在 Lexical 内部对应 MentionNode），与 LLM 协议无差。

如果 MP-4-α 上线后 dogfood 有阻塞 bug，prefs 开关让我们能一键回滚。

## 5. 决策题：是否上 MP-4？

**真正应该问的**：MP-2 的"侧栏 chip + 文本字面量"在用户实测里是否真有体验问题？

**支持上 MP-4 的信号**（任意一条出现就建议推）：
- 用户经常误删/编辑文本里的 `@[label#anchor]` 字面量并困惑
- 用户在长消息里看不出哪段对应哪枚 chip（侧栏与文本失联感）
- assistant 回复里 `@[label#anchor]` 的 chip 渲染体验差异让用户感觉 "用户/助手风格不统一"

**反对上 MP-4 的信号**：
- 实测中没人抱怨；文本中字面量"反而像 markdown 链接"被接受
- 我们更需要先做的科研功能（Pro 模块、跨 session 对比、批量分析）排队

**我（Claude）的判断**：在没有用户访谈的情况下，**先不上**。MP-2 已经能跑 + 验收清单覆盖；anchor 协议为 MP-4 升级保留了可能性。把这份勘察归档作为决策记录，等 dogfood 一周后用真实信号决定。

## 6. 没法在 desk 上判定的指标

- 真实 IME 体验（不同 OS / IME 框架差异巨大；只有用户能告诉）
- "atomic delete 失效一次"的烦躁度（量化困难）
- 跨浏览器 / Electron renderer 一致性（仅 Electron 的 Chromium 是单点，其它分布式签出不在我们 scope）
- 性能（自研一次性 1500 LOC vs Lexical 70KB gz 在低端机器上差异如何）

如果未来要上 MP-4，至少要做：
1. 在 dev 环境 dogfood 至少一周（不开默认）
2. 收集 3-5 个用户的 30 分钟使用录像
3. 列出每次 chip 边界 bug，统计频率

---

附：本勘察未引入任何新依赖；只在 docs 与 MentionChip CSS 上做了小 UX 打磨（见 §7）。

## 7. 不破坏现有路径的小 UX 打磨（已落地）

- `.mention-chip-remove` 加 hover 反馈（背景轻亮 + cursor pointer 已在），**待 v0.5 复审决定是否加**
- token counter 超限文案：当前只显红，**已改为 hover tooltip 显示 "Remove mentions or shorten the message"** 帮助用户找方向
- 文本 `@[label#anchor]` 与 chip 的视觉桥接：因 textarea 不能局部样式化，**放弃**；在 MentionChip 上 hover 时 toast 提示用户"chip 与文本中的 token 是同一引用"作为补偿（**未实现**，需 MentionChipsBar 加 onMouseEnter 回调，复杂度不值，留待 MP-4 真正上时随手解决）
