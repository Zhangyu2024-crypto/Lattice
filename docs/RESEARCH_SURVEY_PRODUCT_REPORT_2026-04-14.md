---
title: Research / Survey 模块产品报告 —— 对话为核心、过程可见的调研体验
status: Draft v0.1（方向重定位，取代 2026-04-14 下午已实施的 UI 入口/工具版本）
author: Claude (Lattice front-end)
date: 2026-04-14
supersedes: /home/huangming20/.claude/plans/abundant-enchanting-hopcroft.md
related:
  - docs/CHAT_PANEL_REDESIGN.md
  - docs/AGENT_LLM_REDESIGN.md
  - docs/SELF_CONTAINED_PORT_PLAN_2026-04-13.md
changelog:
  - v0.1: 初稿。用户明确"像 Manus 那样以对话为核心、调研过程可见"，
          前一轮以 artifact 为中心的 research_brief 单次调用模型被否决。
---

# Research / Survey 模块产品报告 —— 对话为核心、过程可见

## 0. TL;DR

今天 14:00 落地的 research/survey 方案（Composer chip + Canvas 空态双卡 + `research_brief` 单次 LLM 调用 + 落一张 research-report artifact）**方向性错误**。用户的真实诉求不是"生成一份报告 artifact"，而是"像 Manus 那样能看到 agent 怎么一步步做调研、并能在过程中介入对话引导"。

本报告重写方向。核心命题：

> **调研的价值在于过程，而不是产物。** UI 的组织中心应当是对话 + 过程可视化，artifact 是这段调研过程的"凝华"副产物。

---

## 1. 为什么前一轮方向错了

### 1.1 我们做了什么

- Composer 上方加两个 chip（Research Brief / Literature Survey），点击 prefill prompt。
- ArtifactCanvas 空态加两张入口卡，行为与 chip 一致。
- CommandPalette 加两条对应命令。
- 新建 `research_brief` LocalTool，**单次 LLM 调用**，结构化 JSON 输出，产一张 research-report artifact 入 canvas。
- Card 打磨：sticky topbar、mode-aware icon、unverified citations 黄条 banner 等。

### 1.2 为什么不对

用户原话："跟我想的不太一样，我想的是和 Manus 那种方式，**我可以看到它调研的过程**，然后是**以对话框为核心**。"

把这句话解构：

| 维度 | 前一轮实现 | 用户期望 |
|---|---|---|
| 主舞台 | ArtifactCanvas（右侧 artifact） | AgentComposer 对话区（中间/右侧对话流） |
| 运行模式 | 一次性 LLM 调用（~10 秒黑盒） | 多步骤流式过程（分钟级可观察） |
| 中间可见性 | 无 —— tool_invocation 只给一行 "Generate literature brief"，然后直接出结果 | 每一步都有"研究笔记"式的消息：规划 → 检索 → 摘录 → 起草 → 校对 |
| 用户参与 | 点完只能等 | 过程中可插话："深入第 2 节"、"跳过 X"、"换个视角" |
| 产出形态 | 一次落地一整张 artifact | artifact 渐进生长，sections 一节节出现；对话记录才是主角 |
| 可信度 | 最后丢出"unverified"黄条兜底 | 过程中明示信息来源，每一条 claim 贴近 step |

**根本差异：我们把 research 当成了"生成型工具"（prompt → output），用户要的是"探究型协作"（dialog → process → artifact）。**

前者是 Google Translate 的心智模型，后者是 Manus / Perplexity Research / OpenAI Deep Research 的心智模型。对材料学研究员来说，调研的认知价值 50% 在过程，看见 agent 筛了哪些来源、排除了哪些、为什么选某条结论，才能判断结论是否可信。一次性产出剥夺了这部分价值。

### 1.3 今天已交付代码的去留建议

**保留**：
- `research-prompts.ts`（常量可复用）
- `composer-bus.ts` 的 prefill 事件（将来仍需从外部触发 composer）
- `ComposerQuickActions` 作为"启动研究会话"的一级入口（语义需重解释）
- ResearchReportArtifactCard 的 mode 差异化 / unverified banner / cited-in 反链（新 artifact 骨架仍需要它渲染）
- ArtifactCanvas 空态的双卡（仍作为首屏发现入口）
- CommandPalette 的两条 Start 命令

**重做**：
- `research_brief` LocalTool —— 从"单次 LLM 调用"重写为"多工具协同的研究会话 orchestrator"。
- 点击 chip / card / command 后的行为 —— 从"prefill prompt 等用户敲 Send"改为"立即创建一个带骨架的 research artifact + 启动一段可见的多步骤研究"。

不扔掉今天的工作，但**改变它的终点**。

---

## 2. 目标用户心智与参考物

### 2.1 目标用户

材料学研究员，场景示例：
- "我在看 Fe:BaTiO3 做光催化，想扫一遍近 5 年的相关文献"
- "我刚做完一组 XRD 识别出 BaTiO3 + TiO2 两相，想让 agent 帮我补一份 related literature 结合我的数据给出下一步方向"
- "这个 XPS 峰的位移看着像带电效应，也像 Fe 化学态切换，帮我理一下业界共识"

共同点：**用户不是找"一份周报"，而是找"一个能陪我推理的同事"**。

### 2.2 参考产品

| 产品 | 借鉴点 |
|---|---|
| **Manus** | 侧栏"agent 活动流"实时展示每个 tool use 的语义描述、输入、结果；可在过程中打断；artifact 左右侧同步 |
| **OpenAI Deep Research** | 明确的 "plan first"（10+ 条子问题）→ "browse" → "synthesize" 三阶段；每阶段可见进度 |
| **Perplexity Pro (Research)** | 来源卡片实时涌现；每段结论都有可点击的溯源 |
| **Claude Code** | Task Timeline（我们已有雏形）—— 用户看不到"推理"但看得到"工具调用及其意图摘要" |

### 2.3 Lattice 已有的正确骨架

其实大半基础设施已经对：
- `AgentComposer.tsx` + `TaskTimeline.tsx` —— 对话 + 过程活动流的容器已在
- `ArtifactCanvas` + `research-report` artifact —— 产物承载已在
- `agent-orchestrator.ts` —— 多轮 tool_use 循环（MAX_ITERATIONS=5）已在
- `wsClient.dispatch('tool_invocation' | 'tool_result' | ...)` —— 步骤分发协议已在
- `composer-bus` —— 外部触发机制已在

**缺的不是基建，是"把这些基建串成一段有叙事感的调研过程"的产品意图。**

---

## 3. 产品原则

### P1 对话优先（Dialog-first）

主舞台是 `AgentComposer` 的 transcript 区。研究会话以一连串**真正的 assistant 消息**呈现（而不是仅在 TaskTimeline 折叠区塞事件）。用户点"Start Research"后，看到的第一件事不是 artifact，而是 composer 里开始流出：

> **📝 Research Plan**
> I'll approach this as a focused research brief on *Fe-doped BaTiO3 photocatalysis*. My plan:
> 1. Outline the key sub-questions (3 minutes)
> 2. Survey related literature (5 minutes)
> 3. Cross-reference your session artifacts
> 4. Draft a structured brief
> 5. Flag open questions
>
> Reply "go ahead" to start, or tell me to focus differently.

### P2 过程透明（Process visibility）

每一步可见的三件套：
- **一条叙述消息** （agent 在对话里说自己正在做什么、为什么）
- **一项 TaskTimeline 条目**（结构化：tool_name + input_summary + status + output_summary）
- **artifact 的对应增量**（outline 出现 → section 1 流入 → citations 到位 → section 2 流入）

三者同步，用户任一视角看都能追得上。

### P3 渐进式产出（Progressive output）

research-report artifact 从创建那一刻就在 canvas 里，但起始状态是 `status: 'generating'` + 只有 outline + 空 sections。随着 agent 推进，它逐步填充：

```
t=0s    [骨架]     Outline only, body = "Generating..."
t=5s    [1/5]      Section 1 markdown streamed in
t=20s   [2/5]      Section 2 appears; outline nav now highlights 2 done
t=45s   [3/5]      Section 3 + 2 citations added; yellow banner shows
t=70s   [4/5]      Section 4, cross-refs to session artifacts [@cite: spec_XRD_001]
t=90s   [5/5]      Section 5 + final polish; status: 'complete'
```

### P4 可引导（Steerable）

在任意 step 之间（甚至一个 step 进行中），用户可在 composer 里输入：
- `@[section#2] 这一节多讲点 Mott-Schottky 分析`
- `跳过第 4 节`
- `换成 survey 视角，我不要决策导向`
- `暂停`

agent 在下一轮迭代中感知这些 steering 并调整计划。

### P5 scratchpad 可见（"agent 的笔记本"）

除了整洁的 research-report artifact，agent 还维护一个**"研究笔记"scratchpad**，记录：
- 发现过哪些来源
- 拒绝了哪些（为什么）
- 矛盾点待解决的列表
- 与会话 artifact 的对照

这个 scratchpad 以一个**新 artifact kind（`research-notebook`）** 形式存在，或作为 research-report 的一个 tab/section。用户可查看但不需要编辑。凝华版产物（research-report）是给外部看的，scratchpad 是给作者自己看的。

### P6 诚实的来源标签

- 未接入 RAG 时：LLM-drafted citations 继续打 `unverified: true` 黄条（今天做过，保留）
- 接入 RAG（未来）后：citations 与 session library / knowledge-graph 中的 paper 建立硬链接，变绿色 `verified` 标
- 过程中每个"Searching literature..."步骤都要明示是 mock 还是真实检索。**不能让用户误以为有真实 web search**。

---

## 4. 目标 UX 走查

以用户点了 empty-state 的 "Start Research Brief" 为例，端到端：

### 4.1 即刻状态（t=0）

- 一张空壳 research-report artifact 出现在 canvas 中央，outline 栏显示 "Planning outline…"，body 显示 skeleton 骨架
- Composer 自动切到 agent mode，输入框有 topic placeholder：`Research topic (e.g., "Fe:BaTiO3 photocatalysis")`
- transcript 出现一条 system-ish 消息："Ready to start. Give me a topic and optional focus."

### 4.2 用户输入主题 + Send

用户键入 `Fe-doped BaTiO3 for photocatalytic water splitting, focus on band-gap engineering`，Send。

### 4.3 Plan 阶段（t=1~5s）

Composer transcript 新增 assistant 消息（**非黑盒，边流边显示**）：

> **📝 Plan**
> Focus: band-gap engineering of Fe:BaTiO3 for water splitting.
>
> I'll break this into 5 sections:
> 1. **Snapshot** — baseline BaTiO3 band structure, why Fe doping?
> 2. **Dopant configurations** — substitutional vs interstitial, concentration effects
> 3. **Literature findings** — reported band-gap shifts, key measurements
> 4. **Open questions** — defects, stability, spin states
> 5. **Next steps** — validation against your session XRD data
>
> Starting section 1 now…

TaskTimeline 同时展示：
- `research_plan_outline` · input: `{topic, mode, focus}` · output: 5 sections listed

Artifact 左侧 outline 栏填入 5 个 section 标题（灰色未开始）；body 仍是 "Generating…".

### 4.4 Section 起草阶段（t=5~90s）

对每一节，agent 依次：

**(a) 声明 intent**（一条 assistant 消息）：
> **✏️ Drafting §1 — Snapshot**
> I'm grounding this in general materials-science knowledge since no literature-RAG is configured. Citations here will be flagged unverified.

**(b) 调用 tool**（TaskTimeline 条目）：
- `research_draft_section` · input: `{section_id: 'snapshot', context: [...]}`

**(c) 流式填入 artifact**：
- Section 1 的 markdown 逐字涌入 canvas 的对应 `<section>`
- outline 栏将 §1 从灰变亮

**(d) 声明 done**（一条简短的 assistant 消息）：
> ✓ §1 drafted (180 words, 2 citations). Moving to §2.

五节结束后，进入 §4.5。

### 4.5 Cross-reference 阶段（t=90~100s）

agent 发现用户 session 里有一个 XRD artifact，主动关联：

> **🔗 Cross-referencing your session**
> You have an artifact `XRD Analysis (BaTiO3 + TiO2)` in this session. §5 (Next steps) can reference it for validation. Linking now.

TaskTimeline：
- `list_artifacts` · returns 3 artifacts
- `get_artifact` · id=xrd_xxx
- `research_link_session_artifact` · bind xrd_xxx as parent of the research-report

artifact 的 `parents` 字段追加 xrd_xxx，card 左上 source 变成 "XRD Analysis → Research Brief"。

### 4.6 Finalize（t=100~105s）

> **✅ Research brief complete**
> - 5 sections, 8 citations (7 unverified, 1 anchored to your session)
> - Open questions listed in §4
> - Next-step validation plan in §5
>
> You can export as MD/PDF from the top bar, or ask me to refine any section.

artifact `status: 'complete'`, unverified banner appears. Done.

### 4.7 用户中途引导（steering）

在 4.3 ~ 4.5 任意位置，用户可：

**场景 A**：在 plan 阶段后，用户想调整：
> **User**: skip §2, and for §3 only cite papers after 2020

agent 接到后：
> **📝 Plan revised**
> Dropping §2. §3 will only cite 2020+ sources. Re-numbering.

plan message 上方加一条 "Edited by user" 注记；outline 栏收缩到 4 个 section。继续。

**场景 B**：在 §2 起草中，用户插话：
> **User**: I care more about oxygen vacancy mechanism

agent 完成当前正在写的段落后（不粗暴打断），回复：
> I'll finish the current paragraph on substitutional Fe, then pivot §2 to oxygen-vacancy mechanism. Is that ok?

允许细粒度协作。

### 4.8 Survey 模式差异

survey 模式下 plan 更强调横向比较：
- "I'll compare 5 approaches across X sources"
- 每节是一个对比维度而非报告结构
- cited-in 反链更密集（一篇论文常被多节引用）

基本骨架相同，差异在 prompt + outline templates，不在交互结构。

---

## 5. 与今天交付的差异 / 改造点

### 5.1 `research_brief` 工具重设计

今天的 `research_brief` 是一个**单次**调用，返回完整 JSON。需要改造成一组**协同工具**：

| 新工具 | 作用 | 调用时机 |
|---|---|---|
| `research_plan_outline` | 产出 outline + 规划消息 | 会话开始，且用户在 steering 后可再调 |
| `research_draft_section` | 为某一 section 生成 markdown + 局部 citations | 每节依次调用 |
| `research_link_session_artifact` | 把 research-report 与 session 中某 artifact 绑定 parents 关系 | 发现相关数据后 |
| `research_finalize_report` | 把分段 citations 合并、去重、计算 cited-in、切换 status='complete' | 结束时 |
| `research_notebook_append`（P5）| 向 scratchpad 追加一条发现/拒绝 | 自由时机 |
| （未来）`literature_search` | 真实 RAG 检索 | 取代"假装 searching"时 |

每个工具都：
- 自己调一次 LLM（小而聚焦的 prompt）
- 产出通过 `upsertArtifact` / `patchArtifact` 增量写入 research-report
- orchestrator 的 WS `tool_invocation` / `tool_result` 已自动展示到 Timeline，无须改动

### 5.2 Artifact schema 扩展

`ResearchReportPayload` 追加：
- `status: 'planning' | 'drafting' | 'complete'`（扩展现有的 `'generating' | 'complete'`）
- `currentSectionId?: string`（当前正在写的 section，用于 highlight）
- sections[].`status?: 'empty' | 'drafting' | 'done'`

Card 读这些字段渲染：
- outline 栏 section 颜色反映状态（灰/动画呼吸/亮）
- 正在写的 section 下方显示打字机光标

### 5.3 ResearchReportArtifactCard 增强

在今天基础上：
- `status: 'planning' | 'drafting'` 时 body 渲染一个叙事式 skeleton（不只是 spinner）
- outline 栏每个 section 有状态灯
- 右上角新增"Open research notebook"按钮（打开 scratchpad 侧板）
- steering 按钮（暂停/继续/调整）就在 topbar 上

### 5.4 AgentComposer transcript 叙事化

问题：今天的 assistant message 是朴素 markdown。研究过程中 agent 会发多条"声明 intent / done"短消息。需要：
- 一种轻量的"agent 活动消息"样式（带图标、更小字号、可折叠为时间轴）
- 在 transcript 里把**同一次研究会话**的消息视觉上聚合（类似 Slack thread）
- 区分"真对话回复"（用户发言 → agent 回应）与"过程叙述"（自发的进度 narration）

### 5.5 Composer chip / EmptyState card / CommandPalette 语义变化

从"prefill scaffold 让用户敲 Send"改为"立即发起一段研究会话"：

- 点 chip/card → 不再 prefill 文本、不再让用户敲 Send
- 而是：弹出一个 1 行的主题输入 popover（light-weight，不抢焦点），用户键入主题 → Enter → 立刻触发 `research_plan_outline` 工具
- 这和 Manus 的"Start a new research"按钮行为一致

---

## 6. 技术层级粗略映射（不含实现代码）

### 6.1 调用栈新形态

```
用户点 Start Research Brief
  ↓
<ComposerQuickActions>.onStart('research')
  ↓ (新) 弹 topic popover
用户输入 "Fe-doped BaTiO3 photocatalysis" + Enter
  ↓
submitAgentPrompt(promptWithTopic, { sessionId, transcript, mentions: [] })
  ↓
runAgentTurn() — 与现在一样，但 tools 包含新的 research_* 家族
  ↓
LLM iteration 1: plan
  → tool_use: research_plan_outline({topic, mode, focus})
  → tool_result: creates skeleton artifact (status='planning'), dispatches plan narration message
  ↓
LLM iteration 2: draft §1
  → tool_use: research_draft_section({section_id: 'snapshot'})
  → tool_result: patches artifact, dispatches drafting narration
  ↓ … 3~6 ...
  ↓
LLM iteration N: finalize
  → tool_use: research_finalize_report
  → tool_result: status='complete', dispatch final narration
```

注意：
- `MAX_ITERATIONS=5` 必须调大（新流程要 7-10 轮）。或者把 research-flow 用**嵌套 agent** 实现（orchestrator 内再 orchestrator，各自独立预算）。
- Token 消耗会明显上升。需配合 §7 的成本告警。

### 6.2 Artifact 增量更新

需要一个 `patchArtifact(sessionId, artifactId, partialPayload)` store action（基于现有 `upsertArtifact`，但只覆盖 payload 指定 keys，保留其他）。工具每次产出用它而不是 `upsertArtifact` 整张替换。

### 6.3 消息叙事样式

`TranscriptMessage` 类型追加 `kind?: 'chat' | 'agent-narration' | 'agent-plan' | 'agent-done'`。MessageBubble 分发到不同样式：narration 用带图标 + 左侧色条 + 缩略字号的样式，chat 保持现状。

### 6.4 Steering

- Composer 在研究会话进行时（通过 `session.activeResearchSessionId` 标记），下方加一个 "⏸ Pause / ✎ Refocus" 按钮行
- 用户任何 send 都会附带一个元标签 `{ research_session_id }`，orchestrator 下一轮把这条用户消息注入 research-plan 的上下文，LLM 决定如何调整

### 6.5 Scratchpad artifact

新 kind：`research-notebook`（或作为 research-report 的一个 tab）。payload：
```
{
  reportArtifactId: string
  entries: Array<{
    ts: number
    kind: 'source-found' | 'source-rejected' | 'contradiction' | 'session-link' | 'reflection'
    summary: string
    relatedSectionId?: string
  }>
}
```

---

## 7. 风险与取舍

### 7.1 Token 成本上升 3~5 倍

- 单次调用改成 7~10 轮工具调用 + 每次都要 LLM 推理
- 建议默认用最便宜的 Claude Haiku / GPT-4o-mini 跑 plan & narration，只让 draft_section 用强模型
- LLM Config 里给 research 单独一个 model dropdown

### 7.2 流式 UX 的工程复杂度

- 逐 section 流式写 artifact 需要 `patchArtifact` 的细粒度更新 + 卡片 useMemo 边界要小心重算
- 流式 markdown 渲染中 citation pill 可能"半截"，需一个 debounce

### 7.3 steering 的解释风险

用户"跳过第 2 节"是自然语言，可能被 LLM 误解成"开始写第 2 节"。缓解：
- 在 plan 消息旁边放一组 **结构化**按钮（Skip §2 / Expand §2 / Rewrite §2），steering 走按钮优先
- 自由文本 steering 作为兜底，需 LLM 先回显理解再执行

### 7.4 "假装 searching" 的诚实性

在没接入真实 RAG 前，`research_draft_section` 里会写 "Surveying literature on X..." 这样的 narration。**容易让用户误以为有真实 web 检索**。必须：
- 每个涉及"外部信息"的 step，narration 必须带一行灰色小字 `(generated from model's training knowledge, not a live search)`
- unverified 黄条在过程中就出现，不是最后才贴

### 7.5 中断与恢复

研究会话跑一半用户关闭 window / 切 session 的情况：
- MVP：artifact 保留在 status='drafting'，重新打开时显示"paused"并提供"Resume"按钮
- Resume 实质是重新调 orchestrator，从第一个 `status='empty'` 的 section 继续

### 7.6 CLAUDE.md 协作规范重申

上一轮 codex 在这个项目上严重幻觉（虚构不存在的文件）。实施新方案时：
- codex 产出任何文件引用前必须对照 Read/Grep 核验
- codex 给的 diff 必须以 Read 为对照点读入并手写实现
- 每阶段改动后自跑 `npm run typecheck`，不依赖 codex 报喜
- 如本 session 已证实 codex MCP 有时不可用，要有不依赖 codex 的实施能力

---

## 8. 分期落地建议

### Phase A（MVP，3~5 天）—— 把"对话为核心 + 过程可见"的骨架立起来

范围：
- 重写 `research_brief` 为多工具家族（plan / draft_section / finalize，先不做 link & notebook）
- Artifact 增量更新（patchArtifact store action）
- Card 读 `status` / 各 section 状态渲染动效
- Composer 的 chip / card 改为"Start research"按钮：弹 topic popover → 触发 agent
- MessageBubble 区分 narration 样式
- 保留今天已做的：composer-bus、research-prompts、EmptyState 双卡、CommandPalette 双命令

产出目标：用户点 Start → 看到 plan 消息流 → 看到 §1, §2, §3... 依次在 canvas 填入 → 看到 TaskTimeline 同步记录 → 15~60s 内拿到完整 artifact。

### Phase B（2~3 天）—— Steering

范围：
- `session.activeResearchSessionId` + composer 的暂停/引导按钮
- plan 消息旁的结构化按钮（Skip / Expand / Rewrite）
- orchestrator 识别 research_session_id 并在 next iteration 注入

### Phase C（3~5 天）—— Scratchpad + Cross-reference

范围：
- `research-notebook` artifact kind（或 research-report 的 tab）
- `research_link_session_artifact` 工具
- `research_notebook_append` 工具
- Card 上新增 "Open Notebook" 按钮

### Phase D（unblocked by backend）—— 真实 RAG

范围：
- 接入 `src/lib/local-pro-rag.ts` 的 TF-IDF 检索
- `literature_search` 工具
- verified citations 绿色标 + 硬链接到 library artifacts

---

## 9. 度量

| 指标 | 起点（今天方案） | Phase A 目标 | Phase B+ 目标 |
|---|---|---|---|
| Time to first visible output (TTFO) | 10~30s (arcifact 整体 dump) | <3s (plan 消息开始流) | 无变化 |
| Steps visible in narration | 1 条 `tool_invocation` | 5~10 条 | 5~10 条 + steering |
| 用户过程中插话率 | 0%（UX 不允许） | 0% | ≥20%（活跃用户） |
| Artifact 产出后 24h 内被重新打开率 | 目前无基线 | 建立基线 | 提升 50% |
| 对产出 citations 的信任度（self-report） | 未测 | 测；目标"我会二次验证"≥60% | 接入 RAG 后 verified 比例≥70% |

---

## 10. 需要用户拍板的点（在 Phase A 启动前）

1. **Scratchpad 形态**：独立 artifact kind `research-notebook`，还是 research-report 内部的一个 tab？
   - 独立 artifact 好处：可单独被 @、被导出；坏处：多一个 kind 要维护。
   - 内部 tab 好处：概念凝聚；坏处：card 复杂度上升。
   - 倾向**独立 artifact**（与 Lattice "everything is an artifact" 原则一致）。

2. **Agent 每一步的 narration 长度**：
   - 激进："每步一段完整段落"（信息量大但对话很长）
   - 保守："每步一句摘要"（像 claude-code 的 task timeline）
   - 推荐：**混合** —— plan / done 用完整段落，draft_section 中间只发一句 intent（详细内容直接流进 artifact）。

3. **Steering 入口形态**：
   - Plan 消息旁结构化按钮（Skip/Expand/Rewrite）为主 + 自由文本兜底
   - 还是完全自由文本（更灵活但更容易误解）
   - 推荐：**按钮 + 文本并存**。

4. **研究会话能否并行**：
   - 同一 session 里能不能同时跑两份 research（研究 A 和 B）？
   - Phase A 推荐 **单并行**（一条研究会话，第二次点 Start 会提示"finish or cancel current first"）。

5. **Manus 有"thought stream"（连续的内部推理 narration），要不要？**
   - 做的话：模型要求更高、token 成本再翻倍；但对信任度提升显著
   - Phase A 不做；Phase B/C 评估是否加开关。

---

## 附录 A：与 `docs/CHAT_PANEL_REDESIGN.md` 的关系

本设计**不改变** MP-1/MP-2/MP-3 的 composer + mention 体系。它把"research/survey"定义为"Agent mode 下一种特定的 tool 家族编排"，仍在 G1 的"双模式"框架内。`@[section#id]` 引用也天然沿用 MP-2 的 mention 语法。

## 附录 B：本报告的实施作废清单

一旦本报告获得批准，以下今天已经落地的代码路径**需要重构或废弃**：

- `src/lib/agent-tools/research-brief.ts` — 按 §6.1 拆成多工具；保留 schema 约束 / JSON 解析 / unverified 标签逻辑作为子工具的零件。
- `src/components/agent/ComposerQuickActions.tsx` — 点击行为从 prefill 改为"起研究会话"。
- `src/components/canvas/ArtifactCanvas.tsx` EmptyState 双卡 — 同上。
- `src/components/common/CommandPalette.tsx` 两条 Start 命令 — 同上。
- `src/App.tsx` onStartResearch 回调 — 改为触发研究会话而非 dispatch prefill。

保留：
- `src/lib/composer-bus.ts` prefill 事件 —— 仍可被其他场景复用。
- `src/lib/research-prompts.ts` —— scaffold 常量不变（仍用于 popover 的默认 hint 文案）。
- `src/components/canvas/artifacts/ResearchReportArtifactCard.tsx` —— 全部改动保留，再叠加 §5.3 的增强。
