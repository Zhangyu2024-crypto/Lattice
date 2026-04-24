---
title: AI 对话框再设计 —— 双模式 + @-mention 上下文注入
status: Draft v0.4（MP-1 / MP-2 / MP-3 / Inspector 落地归档）
author: Claude (Lattice front-end)
date: 2026-04-13
supersedes: §3 of docs/AGENT_LLM_REDESIGN.md (Composer dual-mode section)
related:
  - docs/DESIGN_PURPOSE.md
  - docs/NEXT_PHASES.md
  - docs/MANUAL_TEST_MP2_MP3.md
  - docs/MP4_FEASIBILITY.md
changelog:
  - v0.1: 初稿。
  - v0.2: 修正主链路认定（IPC 而非 REST）；收敛 MentionRef 到三类；删除隐式 peakId 继承；
          重拆分期为 6 步；补 TaskStep 扩展、per-request 预算、transcript 迁移、
          敏感 artifact 外送控制。
  - v0.3: 为文本 mention 引入短哈希锚点消歧；敏感外送改硬阻断（redacted 占位）；
          `file` 显式标"弱身份"；MP-3/MP-4 合并确保"每步都验证核心价值"，
          MP-4 改"最晚本步必须完成 contentEditable"；`outputMentions` 与 `artifactRef` 的
          收敛结论闭环。
  - v0.4: MP-1 / MP-2 / MP-3 全部落地；新增 InspectorRail 对象级 details rail（codex
          UI 审计 P0-3）；composer-bus 已落地（dispatchMentionAdd + useComposerMentionListener）；
          ContextMenu primitive 抽出供 Canvas 反向注入复用；XPS / Raman 卡片接入右键菜单；
          MP-4 转勘察阶段（见 docs/MP4_FEASIBILITY.md，推荐 Lexical，但建议先 dogfood
          MP-2 一周再决定是否上）。新增 §13 实施差异档案。
---

# AI 对话框再设计 —— 双模式 + @-mention 上下文注入

## 1. 背景与目标

当前 `AgentComposer`（`src/components/agent/AgentComposer.tsx`）已经有 Dialog / Agent 两个模式的顶部切换，但其能力仅限于：

- **Dialog 模式**：纯文本问答，不挂任何领域对象作为上下文。
- **Agent 模式**：能触发任务与工具调用，但用户无法在输入框里明确"就这张谱图的第 3 号峰"来圈定对象；Agent 对场景的感知完全依赖模型自己去 session 上下文里猜。

这带来两个问题：

1. **Dialog 模式过轻** —— 用户很快就希望"就我刚才这个结果继续问"，但 Dialog 不认识 Artifact。
2. **Agent 模式过重且上下文不精确** —— 每次都让 Agent 去规划一轮流程，但有时用户只是想问"这个峰形是否合理"，并不需要再跑工具。

本次再设计的目标：

- **G1 保留双模式的同时，让 Chat 模式可以访问上下文** —— Chat 不调用工具，但能读懂 @ 提到的对象。
- **G2 引入统一的 @-mention 语法** —— 文件、artifact、以及 artifact 内部的结构化元素（峰、相、XPS 成分等）都能作为一等公民被 @。
- **G3 谱图上的任何信息都可被 @** —— 包括：单根峰、峰组、拟合残差、XRD 识别的相、XPS fit 成分、Raman 指认结果等。x 范围选区在 v0.2 延后（见 §4.3），先用"@ artifact + 自然语言描述区间"兜底。
- **G4 上下文注入对后端是显式的** —— 不是把整个 session 打包丢给 LLM，而是明确附带一个"引用清单"，由前端/后端按既定预算 resolve 成 prompt 片段。
- **G5 渲染可回链** —— 对话中的 @-mention 可点击跳回 Canvas 高亮；Agent 产物仍走 `ArtifactBadge` 回链（收敛为 MentionChip 的一种形态）。

非目标：

- 不改变 session / artifact / task 的底层模型（P3 Artifacts as objects 原则保留）。
- 不在本期实现"Chat 模式下半自动建议 @ 什么"这类 LLM-辅助补全。
- 不在本期首个里程碑实现 Canvas 拖选 x 范围 → selection mention（见 §9 MP-5）。

## 2. 现状盘点

### 2.1 组件与数据流（v0.2 订正）

| 层 | 文件 | 当前职责 | 备注 |
|---|---|---|---|
| 顶部壳 | `src/components/agent/AgentComposer.tsx` | 模式切换 / 模型芯片 / 输入框 / 消息渲染 | 普通 `textarea`，无 mention 能力 |
| 时间线 | `src/components/agent/TaskTimeline.tsx` | Agent 任务步骤 | 仅消费 `Task/TaskStep`，不感知 mention |
| 产物徽章 | `src/components/agent/ArtifactBadge.tsx` | 消息里回链产物 | 读 `TranscriptMessage.artifactRefs` |
| **提交主链** | `src/lib/agent-submit.ts` → `src/lib/llm-chat.ts` | 预算检查 → `window.electronAPI.llmInvoke`（IPC） | **这是真正跑通的路径** |
| ❌ 旧 REST | `src/hooks/useApi.ts#sendChat` | `POST /api/chat/send` | `llm-chat.ts` 头注释标注为 "broken dead-queue"，未接到 Composer |
| Session 模型 | `src/stores/session-store.ts` + `src/types/session.ts` + `src/types/artifact.ts` | Session / Artifact / Task / Transcript | 见 §2.3 |
| LLM 配置 | `src/stores/llm-config-store.ts` + `llm-defaults.ts` | Dialog / Agent 各自的 `GenerationConfig` | 已分模式 |
| 模式偏好 | `src/stores/prefs-store.ts` | `composerMode: 'dialog' \| 'agent'` | |
| 实时事件 | `src/hooks/useWebSocket.ts` + `src/stores/ws-client.ts` | `status_update`, `spectrum_update`, `peaks_update`, `workspace_update` 等 | WS **不是**当前 Chat 回复的主通道 |

**关键订正**：codex 指出 v0.1 把主链路错认为 `/api/chat/send`，实际是 Electron IPC `llmInvoke`。这会反过来决定协议改动的落点（见 §6.4）。

### 2.2 与新需求相关的现有能力

- `Session.transcript: TranscriptMessage[]`，`TranscriptMessage.artifactRefs?: ArtifactId[]` —— **已有**"一条消息引用若干 artifact"的字段，是 `mentions` 落地的天然前身；v0.2 中 `artifactRefs` 会被 `mentions` 覆盖（§6.1）。
- `XrdPhase.id`（`artifact.ts:85`）、`RamanMatch.id`（`artifact.ts:159`）**已经是稳定字符串**。之前 v0.1 误判为"需要新增"，订正。
- `PeakFitPayload.peaks[]`（`artifact.ts:53`）目前只有 `index` 字段，**缺真正稳定 id**；`XpsPeak`、`XpsFit`（`artifact.ts:111/119`）同样缺 id。真正要补的只是这三个。
- `Session.focusedArtifactId` + `pinnedArtifactIds` —— 已有 session 级"当前注意力"概念，可以作为 Chat 模式"推荐 mention"的来源（不自动注入）。

### 2.3 缺口

1. **子对象稳定 ID 不全** —— 见 §2.2 第 3 点。
2. **没有 mention 解析器/UI** —— textarea 裸输入，没有触发菜单，没有 token 化的 mention 模型。
3. **提交链不带 mentions** —— `sendLlmChat` 的 `LlmInvokeRequestPayload` 只有 `messages/systemPrompt/maxTokens`，没有任何结构化上下文槽位。
4. **`TaskStep` 不承载 mention** —— `TaskStep` 当前字段为 `kind/status/label/toolName/inputSummary/outputSummary/artifactRef`，Timeline 无法高保真回显"Agent 依据哪些 mention 计划"。
5. **预算是粗粒度** —— `agent-submit.ts#checkBudget` 只看**当日累计** token/费用，不看本次 prompt 体量；`llm-chat.ts` 的历史截断按**消息条数**（Dialog 10 / Agent 20）而非 token 数。mention 引入大上下文块后必须改为 token 级裁剪。
6. **Canvas → Composer 反向通道不存在** —— 图上的选中状态没法注入到 Composer。
7. **敏感 artifact 外送无守卫** —— 一旦 mention，其 payload 要序列化发给第三方 LLM provider；目前没有开关/审计/脱敏。

## 3. 设计总览

整体形状：**Chat 模式 = 没有工具调用的轻 LLM + 显式 @-mention 上下文；Agent 模式 = 以往的规划 + 工具调用 + 产物，同样可以 @。**

```
┌─ AgentComposer ─────────────────────────────────────────────┐
│ [Chat | Agent]   ● backend   ◈ claude-sonnet · 12k          │
│─────────────────────────────────────────────────────────────│
│ Task Timeline (仅 Agent 模式)                                │
│─────────────────────────────────────────────────────────────│
│ 消息区：                                                     │
│   assistant: ...引用了 [@peak#3 of BaTiO3_xrd] 之后...      │
│   user:     分析一下 @BaTiO3_xrd.xy 第 3 个峰的 FWHM        │
│                                                              │
│─────────────────────────────────────────────────────────────│
│ ┌─ Mention chips (侧栏；MP-2 起生效) ─────────────────────┐ │
│ │ [×] @BaTiO3_xrd.xy · spectrum                           │ │
│ │ [×] @peak#3 of peak-fit art_123    resolve ≈ 420 tok   │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌─ textarea —— @ 触发 MentionPicker 菜单 ──────────────┐ │
│ │ 这个峰的半高宽偏宽是不是仪器展宽？|                   │ │
│ └────────────────────────────────────────────────────────┘ │
│ prompt ≈ 3,140 / 16,000 tok                        [Send]  │
└─────────────────────────────────────────────────────────────┘
```

两模式差异被收敛到两件事：

| 维度 | Chat | Agent |
|---|---|---|
| 工具调用 | ❌（前端硬拒 tool_call） | ✅ |
| Task Timeline | ❌ | ✅ |
| @-mention 注入 | ✅ | ✅ |
| 产物创建 | ❌（只读引用） | ✅ |
| 默认模型 | 便宜模型（如 Haiku） | 强模型（如 Opus） |
| System prompt | "你没有工具，只依据用户给的 mentions 回答" | "你可调用工具并产出 artifacts；mentions 是用户锁定的目标" |

## 4. Mention 对象与协议

### 4.1 MVP 三类 —— `file | artifact | artifact-element`

v0.1 的五类设计被 codex 指出过宽 + 语义重叠，v0.2 收敛为三类作为 MVP：

| type | 指向 | 身份强度 | 典型 payload 片段 |
|---|---|---|---|
| `file` | `Session.files[]` 某一条（按 `sessionId + relPath`） | **弱身份** —— relPath 可重命名，文件内容可被重新导入；见下方说明 | `{ relPath, spectrumType, size }` |
| `artifact` | `Session.artifacts[id]` 整体 | 强（`artifactId` 是 UUID，不重名） | `{ kind, title, sourceFile, params, payload 摘要 }` |
| `artifact-element` | artifact 内部的结构化子对象 | 取决于子 id（见 §4.2 表） | 见 §4.2 |

**`file` 的"弱身份"取舍**：`sessionId + relPath` 不是内容快照，若 relPath 被重命名或同路径文件被覆盖，引用会"悄悄指向新内容"。v0.3 选择接受这个弱点，原因有二：(1) 对 LLM 对话而言，"这个文件现在的内容"往往正是用户期望的语义（例如调整完处理管线后再继续讨论同一个文件）；(2) 若需要强身份请引导用户改为 `artifact` 引用（所有导入都会生成一个 `spectrum` artifact，`artifactId` 天然是内容快照）。MentionPicker 在选中 `file` 项时会在 chip 上展示灰色"弱引用" tag，并在下拉里优先列出该文件对应的 `spectrum` artifact 作为推荐项。

延后类型（见附录 B 与 MP-5）：

- `selection`（Canvas 拖选 x 范围）—— 与 `artifact-element:spectrum-segment` 语义重叠；MP-2 之前不做，由用户用文字描述区间替代。
- `session`（跨 session 引用）—— 跨 session 缺版本/权限语义，且 session 标题可被重命名而 `sessionId` 是临时 UUID，快照稳定性差；需要先设计"session 版本锁"才能开。

### 4.2 `artifact-element` 的子类型

| elementKind | 适用 artifact.kind | 依赖的稳定 id 源 | 状态 |
|---|---|---|---|
| `peak` | `peak-fit` | 需新增 `PeakFitPayload.peaks[].id` | 待补 |
| `peak-group` | `peak-fit` | 多 peakId 的 immutable 集合 | 待补（依赖上一项） |
| `residual` | `peak-fit` | 父 artifact id 即可 | 现成 |
| `phase` | `xrd-analysis` | `XrdPhase.id` | **已存在**（artifact.ts:85） |
| `rietveld-param` | `xrd-analysis.rietveld` | 字段名作 id（参数集合是闭集） | 用字段名 |
| `xps-component` | `xps-analysis.fits[].peaks[]` | 需新增 `XpsPeak.id` | 待补 |
| `xps-fit` | `xps-analysis.fits[]` | 需新增 `XpsFit.id` | 待补 |
| `xps-quant-row` | `xps-analysis.quantification` | 以 `element` 作 id（单 artifact 内唯一） | 可直接用 |
| `raman-match` | `raman-id` | `RamanMatch.id` | **已存在**（artifact.ts:159） |
| `graph-node` / `graph-edge` | `knowledge-graph` | 图元素 id | 待核对 |
| `paper-section` | `paper` | section heading 锚点 | 待核对 |

真正要新增 id 字段的只有三处：`PeakFitPayload.peaks[]`, `XpsPeak`, `XpsFit`。

**稳定 ID 策略（v0.2 订正）**：

- 新生成的 artifact 在前端落盘时补 id；读取历史持久化数据缺 id 时按数组下标惰性补齐一次并写回（一次性迁移）。
- **禁止隐式继承**：v0.1 提出的"最近邻 x0 继承旧 peakId"被 codex 指出会在峰分裂/合并时静默误绑。v0.2 改为：**重拟合产生全新 id**，对旧 peakId 的 mention 直接标 `missing`（渲染为置灰 chip，hover 解释原因）。这牺牲一点"跨版本连续性"换取"绝不误绑"。
- 如果后续真的需要跨版本连续性，单独做"artifact 历史版本链"专题，不走 mention 内部魔法。

### 4.3 `MentionRef` 类型

新增 `src/types/mention.ts`：

```ts
export type MentionRef =
  | { type: 'file'; sessionId: string; relPath: string }
  | { type: 'artifact'; sessionId: string; artifactId: string }
  | {
      type: 'artifact-element'
      sessionId: string
      artifactId: string
      elementKind: MentionElementKind
      elementId: string               // 稳定 id 或字段名
      label?: string                  // 冗余冷启动字段
    }

export type MentionElementKind =
  | 'peak' | 'peak-group' | 'residual'
  | 'phase' | 'rietveld-param'
  | 'xps-fit' | 'xps-component' | 'xps-quant-row'
  | 'raman-match'
  | 'graph-node' | 'graph-edge'
  | 'paper-section'

// v0.2 暂不实现，但预留 union 扩展点
// | { type: 'selection'; ... }
// | { type: 'session'; ... }
```

### 4.4 文本 ↔ mention 的编码

v0.2 **放弃** v0.1 的"contentEditable + 内联 chip"直接做 MVP（见 §9 的 MP-2/MP-5 拆分）。MVP 采用 **plain textarea + 侧栏 chips + 短哈希锚点**：

- 用户在 textarea 里键入 `@`，触发 MentionPicker。
- 选中后：
  1. 在文本里**不**插入 chip，而是插入只读 token 文字 `@[label#ah5]`（光标跟随），其中 `ah5` 是该 mention 在本条消息内的 5 字符短哈希锚点（取自随机 id）；同时
  2. 在输入框上方的"Mention chips" 侧栏里新增一枚可删除的 chip，chip 内部展示 label，tooltip 展示 `#ah5`。
- 侧栏 chip 与文本 token 的绑定关系维护在 React state：`pendingMentions: Array<{ anchor: string; ref: MentionRef }>`。
  - chip 删除时，用 **anchor 正则**（`/@\[[^\]]*#ah5\]/`）定位并移除文本片段，匹配失败（用户手工改动了 anchor）则仅删 chip，不碰文本。
  - 用户手工改 label 文案不影响锚定；直接删掉 `#ah5` 或整段文本也能通过文本扫描回收 chip。
- 提交时：
  ```ts
  {
    content: string,                  // 原文（含 @[label#anchor] 字面量）
    mentions: Array<{                 // 与 anchor 强绑定
      anchor: string                  // 5-char，本消息内唯一
      ref: MentionRef
    }>,
  }
  ```

**语义歧义消除（v0.3）**：v0.2 的松绑定在"重复 label / 手工改文案 / 字符串删除失败"下会让文本和真实 mention 脱钩。v0.3 引入 anchor 后：

- 同一 label 多次引用互不干扰；
- LLM 回复里出现 `@[peak#3 #ah5]` 可以反查到具体哪个 mention，消歧。
- anchor 不依赖光标/位置，textarea 足够。

MP-5 升级为 contentEditable 时，直接复用 anchor 作为占位符 id（`{{mention:ah5}}`），数据模型不变、只是渲染换壳。

序列化（assistant 回复里回引用的约定）：`@[label#ah5](mention://artifact/art_123)`。前端渲染层正则识别并渲染为 MentionChip。

### 4.5 隐式上下文 vs 显式 mention

Chat 模式下**不**偷偷注入 `focusedArtifactId`。Composer 顶部仅显示一枚灰色"推荐上下文" chip（例 `focused: BaTiO3_xrd`），点一下即转成显式 mention。Agent 模式保留现有行为（自身感知 session state），但 `mentions` 仍作为"用户锁定的目标"在 prompt 中单列高优先级段。

## 5. UI 规范（MVP）

### 5.1 输入区 —— `MentionComposerInput`

MVP 版本就是一个受控 `<textarea>` + 上方 chip 侧栏 + 一个 `@` 监听器。好处：

- 零依赖、无 contentEditable 坑（IME / 粘贴 / 原子删除都 N/A）。
- 可以复用现有 `chat-input` 样式。
- 代码量小，易回滚。

陷阱应对：

- `@` trigger 要区分 IME composition（`compositionstart`/`end` 门控），避免拼音候选被当成 mention 搜索。
- 侧栏 chip 顺序 = 优先级；用户可拖拽重排（MP-4 之后再做，MVP 固定按添加顺序）。
- 粘贴一整段含 `@[label]` 的文本但不带 chip 时，只作为普通文本入库，不 fuzzy 复原 mention。

### 5.2 MentionPicker

按优先级分组（最多约 50 项，超过开启搜索）：

1. **最近引用过的**（来自 session-store 新增的 `recentMentions`）
2. **当前聚焦 / pinned artifact 的子元素** —— 展开到 peak / phase / component 层
3. **当前 session 的 files**
4. **当前 session 的其他 artifact**

（跨 session 与 selection 延后；MVP 不出现这两组）

### 5.3 MentionChip 渲染

消息气泡里的 `@[label#anchor](mention://...)` 序列由 `MessageBubble` 的 markdown 渲染器扩展识别，转 `<MentionChip>`（`anchor` 字段对齐 §4.4 协议）。点击：
- `artifact` → `focusArtifact` + Canvas 高亮（高亮靠既有 Canvas 状态，不走 §5.4 的总线，MVP 足够）。
- `artifact-element` → 先聚焦 artifact，再通过 Canvas 子组件的 `scrollToElementId` 接口滚动/闪烁（不需要发布订阅总线）。
- `file` → 高亮文件树。
- `missing` → 置灰，tooltip 说明原因。

### 5.4 Canvas → Composer 反向通道（MP-3 已落地）

实际落地形态：极小 pub/sub 模块 `src/lib/composer-bus.ts`，导出两个对外 API：

- `dispatchMentionAdd({ ref: MentionRef, label: string })` —— 发起方调用
- `useComposerMentionListener(handler)` —— Composer 侧订阅（handler 必须 useCallback 稳定）

**接入位**（MP-3 + MP-3+）：
- `PeakFitArtifactCard.tsx`：peak 行 `onContextMenu` → 弹 `<ContextMenu>` → "Mention in chat"
- `XrdAnalysisCard.tsx`：PhaseList 行同上
- `XpsAnalysisCard.tsx`（MP-3+）：quantification 表行同上（XPS 成分行因 UI 上不存在表，留给 InspectorRail "Mention" 按钮）
- `RamanIdCard.tsx`（MP-3+）：MatchRow 同上
- `InspectorRail.tsx`：header 加 `AtSign` IconButton（focusedElement 为空时 disabled）一键 dispatch

**ContextMenu primitive**（`src/components/common/ContextMenu.tsx`）：portal 渲染、视口坐标、边界镜像、键盘 ↑↓Enter Esc、外部点击 / scroll/resize 关闭。供本模块与未来其他需要右键菜单的场景复用。

**为什么不抽 `canvas-bus` 总线**：当前只有一个订阅者（Composer），单向；CustomEvent on `window` 已够用且零依赖。MP-5 解冻 selection mention 出现多消费者时再升级。

## 6. 数据模型与协议改动

### 6.1 类型

```ts
// types/mention.ts   新文件（见 §4.3）

// types/session.ts   扩展
interface TranscriptMessage {
  id: TranscriptId
  role: TranscriptRole
  content: string
  mentions?: Array<{                 // 新增；anchor 与 content 内 @[label#anchor] 一一对应
    anchor: string
    ref: MentionRef
  }>
  timestamp: number
  taskId?: TaskId
  // artifactRefs 保留但标 deprecated；读取时若无 mentions 则 fallback
  // 清理计划：等所有生成路径都写 mentions 之后（预计 MP-4 发版 + 一个迭代），移除
  artifactRefs?: ArtifactId[]
}

interface TaskStep {
  // ...既有字段
  inputMentions?: MentionRef[]       // 新增：Agent 计划时引用了哪些 mention
  outputMentions?: MentionRef[]      // 新增：step 输出的结构化引用
  // 关系闭环：outputMentions 是 artifactRef 的超集 —— 单个 artifact 输出时两者都写；
  //          element-level 输出时仅 outputMentions 能完整表达。MP-4 之后新代码
  //          只读 outputMentions；artifactRef 在下一个 minor 版本移除。
  artifactRef?: ArtifactId           // deprecated；保留到下一 minor 版本
}

// types/artifact.ts   补缺失 id
interface PeakFitPayload {
  peaks: Array<{ id: string; /* 其余不变 */ }>
}
interface XpsPeak  { id: string; /* ... */ }
interface XpsFit   { id: string; /* ... */ }
```

### 6.2 Store

`session-store` 新增：

- `selectMentionablesForSession(sessionId)` → 打平 files + artifact + 已补 id 的子元素。
- `selectRecentMentions(sessionId, limit)` → 最近 N 条用过的 `MentionRef`（会话内）。
- `resolveMention(ref)` → 同步返回 `{ label, previewText, targetArtifactId? }`，UI 渲染用。
- `pushRecentMention(ref)` → 每次发送时调用。

### 6.3 Canvas 事件

不引入 `canvas-bus` 总线；从 PeakTable / 等组件的右键菜单项直接派发 `CustomEvent('composer:mention-add', { detail: ref })`，Composer 在 mount 时监听。若 MP-5 发现多消费者需求再评估升级为发布订阅。

### 6.4 协议改动（v0.2 订正 —— 以 IPC 为主）

**Step 1（核心）：扩展 `LlmInvokeRequestPayload` 与 `sendLlmChat`**

实际主通道是 `electron/llm-proxy.ts` ↔ `src/lib/llm-chat.ts`。扩展点：

```ts
// src/types/electron.ts  （与 electron/ 主进程对称）
interface LlmInvokeRequestPayload {
  // 既有字段...
  messages: Array<{ role: 'user'|'assistant'; content: string }>
  systemPrompt?: string
  // 新增
  contextBlocks?: Array<{
    ref: MentionRef                // 原始引用
    role: 'context'                // 区别于对话消息
    body: string                   // 已序列化成 markdown / json 字符串
    tokenEstimate: number          // 前端估算，用于 server-side 裁剪兜底
  }>
  mode: 'dialog' | 'agent'         // 目前只用作 systemPrompt 选择；预留后续服务端路由
}

interface LlmInvokeResultPayload {
  // 既有字段...
  // 新增（选填）：assistant 在回复里生成的结构化 mention（anchor 与回复 content 中
  // 的 @[label#anchor] 一一对应，闭环 §4.4 语法）
  mentions?: Array<{ anchor: string; ref: MentionRef }>
}
```

`sendLlmChat` 内部负责：

1. 从 `mentions: MentionRef[]` 经 `resolveMention` 得到每个的 `body` + token 估算；
2. 按"artifact ≤ 4 KB 摘要；artifact-element ≤ 2 KB；file ≤ 256 B metadata（不展开内容）"的 `MENTION_BUDGET` 裁剪；
3. 把 `contextBlocks` 并入 prompt（作为追加 system/user 上下文段，与 transcript 共存）。

Chat 模式下硬禁 `tool_call`：即使未来 provider 支持工具，`llm-chat.ts` 的 Chat 分支**不传** tool schema；若模型意外输出 tool_call 文本，前端原样渲染为文本（不执行）。

**Step 2（次要）：WebSocket 推流事件**

当前 Chat / Agent 回复走 IPC，WS 不是必经之路。真正涉及 WS 的场景是后端侧 agent-tool 执行中 push：

- `chat_message.mentions?: Array<{ anchor: string; ref: MentionRef }>`（新增，可选；与 IPC 回包同构）
- `status_update`、`spectrum_update`、`peaks_update` 不动
- 当后端开始支持从工具执行中 push 结构化引用时才启用；MVP 不依赖此项

**Step 3（维护）：旧 REST `useApi.sendChat` 保留还是移除？**

`llm-chat.ts` 注释指它"broken dead-queue"。v0.2 建议：留作 backend tool-exec 回流的占位（若后端未来做代理路由），但**不**挂到 Composer；在 `useApi.ts` 顶部加 deprecation 注释。见 §12 开放问题 1。

### 6.5 预算与历史裁剪（v0.2 订正）

当前 `checkBudget` 只看日累计；`llm-chat.ts` 按消息条数截断历史（`HISTORY_LIMIT_DIALOG = 10`, `AGENT = 20`）。引入 mention 后 input token 会显著上升，需要：

1. **Per-request 预算估算**：`sendLlmChat` 在真正 `llmInvoke` 前估算 `systemPrompt + messages + contextBlocks` 的 token 数（用现有 `token-estimator`），如超 `budget.perRequest.maxInputTokens` 按 `budget.mode` 做 warn / block。Composer UI 发送前把该估算回显给用户（见 §3 示意图里的 "prompt ≈ 3,140 / 16,000 tok"）。
2. **Token 级历史裁剪**：从旧到新丢弃历史消息直到满足 `maxInputTokens - contextBlocksTokens - systemTokens - safetyMargin`；mentions 永远保留（用户显式锁定），必要时**反过来**裁摘要长度（把 artifact 摘要阈值从 4KB 降到 2KB 再试），实在不行报错让用户手动删 chip。

## 7. 模式语义细化

### 7.1 Chat 模式

**定位**：基于给定事实问答；不动状态；不产出 artifact。

**System prompt 关键点**（`llm-defaults.ts` 更新）：

> 你是 Lattice 的对话助手。你**不能**调用任何工具或修改任何 artifact。你必须优先基于用户通过 `mentions` 明确附带的对象回答；如果没有 mention，就只能依据对话历史或一般科学知识回答，并主动说明缺少数据。回复时如需引用已 mentioned 对象，使用 `@[label#anchor](mention://...)` 格式，`anchor` 必须来自用户输入里的同一 mention。

**硬约束**：Chat 分支不向 provider 传 tool schema；若模型仍产出疑似工具调用文本，前端仅渲染不执行。

### 7.2 Agent 模式

- Prompt 组装时，`mentions` 作为"用户锁定的分析目标"单列高优先级段。
- Agent 规划步骤引用 mention 时，写入 `TaskStep.inputMentions`，Timeline 渲染 chip（§6.1）。
- 执行完成后新建的产物自动塞进下一轮 MentionPicker 的"最近"组。

### 7.3 模式切换对 transcript 的影响

两模式共享 transcript；切换不清空。Agent 模式追加的 `mentions`（及兼容的 `artifactRefs`）在 Chat 模式下仍可点击（只读回链）。

## 8. 交互细节与边界情况

- **mention 指向已删除对象**：resolve 返回 `{ missing: true, label: '<deleted>' }`；chip 置灰；transcript 保留 ref（以防后端 GC 后恢复）。
- **跨 session mention**：MVP 禁用；MentionPicker 不展示其他 session 的项。
- **粘贴带 `@[label]` 的富文本跨消息复制**：只带文本，不跟随 MentionRef（避免伪造引用）；若要保留，用户需要在新消息重新从 picker 选一次。
- **IME / 中文输入**：`@` trigger 受 `compositionstart/end` 门控。
- **空 Chat + 没 mention**：维持现有 empty hint。
- **Mention 解析失败**（`resolveMention` 抛错）：该 chip 单独置灰，不影响其他 mention 与消息发送。
- **Transcript 持久化迁移**：旧消息缺 `mentions` 字段 → 反序列化补 `mentions: []`；缺 id 的 peak/XpsPeak/XpsFit → 首次读入时按下标补 id 并标记 `_migrated: true`（不发请求，仅本地）。
- **敏感 artifact 外送（v0.3 改为硬阻断 + 软确认两档）**：每个 provider 增加 `mentionResolve: 'allow' | 'confirm' | 'block'` 字段（三态，默认 `'allow'`）。
  - `'block'`（硬阻断）：`resolveMention` 返回 `{ redacted: true, body: '[redacted by provider policy]' }`，不下发真实 payload；UI chip 显示红色 "🛑 redacted" 角标；适合 clawd-proxy 等第三方代理。
  - `'confirm'`：发送前弹列表确认框；适合企业自建但敏感的 provider。
  - `'allow'`：直接放行；适合官方 Anthropic/OpenAI 直连。
  - 默认值按 provider 类型初始化：`openai-compatible` / `custom` 代理类默认 `'confirm'`；直连 SDK 默认 `'allow'`。

## 9. 分阶段落地（v0.3 再拆）

v0.2 的六步被 codex 指出："MP-1~3 只能 dogfood UI，MP-4 才是真正价值验证闭环；MP-5 'pas 可无限期延后' 等于把歧义型 MVP 常态化"。v0.3 重排为 5 步，**每步都必须验证一条核心价值**，且 contentEditable 升级的下限是 MP-5。

**MP-1 —— 类型底座** ✅ 已落地

- `src/types/mention.ts` 新增三类 union + `anchor` 协议。
- `PeakFitPayload.peaks[].id`、`XpsPeak.id`、`XpsFit.id` 补字段；反序列化惰性迁移。
- `TranscriptMessage.mentions?`（含 anchor）、`TaskStep.inputMentions? / outputMentions?` 扩展。
- `session-store` 反序列化 backfill；`provider.mentionResolve` 三态字段。
- **核心价值验证**：`npm run typecheck` 通过 ✅；`session-store` 持久化反序列化在 `src/__smoke__/mp2-mp3-smoke.ts` 中验证 ✅。

**MP-2 —— Composer UI + IPC 协议 + 真实 mention 进 prompt** ✅ 已落地（**合并原 v0.2 的 MP-2/3/4**）

合并原因：原 MP-2 发完版也没进 prompt，没法验证"模型是否真的用上了 mention"。v0.3 把 IPC 协议、预算、UI 捆在一起作为首个"真正可用"里程碑。

- MentionPicker（分组搜索）、MentionChip（侧栏版）、textarea + anchor 插入。
- `handleSend` 传 `{ content, mentions: [{anchor, ref}] }`。
- `LlmInvokeRequestPayload` 增 `contextBlocks / mode`；`electron/llm-proxy.ts` 对称透传。
- `sendLlmChat` 按 `MENTION_BUDGET` resolve 并组装 contextBlocks；Chat 分支硬禁 tool schema；两模式 system prompt 更新（`llm-defaults.ts`）。
- `token-estimator` 扩展；Composer 底部回显 `prompt ≈ X / Y tok`；per-request 预算 warn/block。
- 敏感外送：`mentionResolve='block'` 硬返回 redacted；`'confirm'` 走确认框。
- 消息渲染识别 `@[label#anchor](mention://...)` → MentionChip（只读）。
- **核心价值验证**：AC-1/AC-4/AC-5/AC-7（见 §11）全部可跑通。用户选中一个峰、发一句话，模型回复里能引用到它——这就是整个 feature 的"最小可信闭环"。

**MP-3 —— Canvas 反向注入（右键 + 多选）** ✅ 已落地（核心）+ 🔧 多选 group 留 TODO

- `PeakFitArtifactCard` / `XrdAnalysisCard` / `XpsAnalysisCard` / `RamanIdCard` 行 onContextMenu → ContextMenu portal → "Mention in chat"（参见 §5.4 实际 API）
- 派发通过 `dispatchMentionAdd({ ref, label })`（替代原计划的 raw CustomEvent name）
- InspectorRail header 加 `AtSign` IconButton 一键 dispatch（focusedElement 为空时 disabled）
- **多选 group 推迟**：`peak-group` 的 elementId 形态（合成 id vs 数组）未定，留 TODO；MVP 单选已能验证主路径
- 消息 chip 点击 → 聚焦 artifact（沿用 focusArtifact，未引入总线）
- **核心价值验证**：AC-2/AC-3 通过 ✅；端到端清单见 `docs/MANUAL_TEST_MP2_MP3.md`

**MP-4 —— 内联 chip 升级（contentEditable）** ⏸ 转勘察阶段（见 `docs/MP4_FEASIBILITY.md`）

- 推荐 **Lexical**（IME 已生产验证、bundle ~70KB gz、API 适合 React）；不推荐自研 contentEditable
- 增量上线方案：α 引 Lexical 与 textarea 并存（prefs 开关）→ β picker / paste / IME 接入 → γ 翻默认并删旧路径
- 决策：**dogfood MP-2 一周后再决定是否上**；如果用户没抱怨，anchor 协议已为升级保留可能性，不必硬上
- 覆盖 IME / 复制粘贴 / 原子删除的手测脚本 + 单测。
- **为什么不是"可延后"**：MP-2 的 anchor 方案已经消歧，但"用户看到的 label 与真实 ref 可被手工改成不一致"仍是体验坑；且 MP-2 → MP-4 的数据模型不变（anchor 共用），不做升级等于让字符串正则这段权宜代码长期留在代码库。v0.3 把它定为"最晚 MP-5 前完成"，避免变成长期负担。
- **核心价值验证**：去除 MP-2 字符串匹配 fallback 后回归测试无 regression；AC-1~AC-7 全绿。

**MP-5 —— Canvas 拖选 + selection mention（解冻第四类）**（≈1 天）

- `MentionRef` union 解冻 `selection`。
- SpectrumChart 拖选 x 范围 → 弹 "分析这一段" 快捷按钮 → selection mention。
- 后端配合：`contextBlocks` 对 selection 做降采样（≤ 2048 点）。
- 如本步发版时用户反馈"MP-3 的 @artifact+自然语言描述区间"已够用，可推迟到需求明确再做；不阻塞其他功能。
- **核心价值验证**：AC-补 "拖选一段 → Agent 只分析这一段"。

## 10. 风险与取舍

- **R1 contentEditable 坑** —— 隔离到 MP-4，anchor 协议在 MP-2 已确立，MP-4 只换渲染层不改数据模型。
- **R2 子对象 ID 稳定性** —— 改为"重新拟合即产生新 id + 旧 ref 标 missing"，杜绝隐式误绑。代价：跨版本连续性需要额外专题。
- **R3 mention 上下文膨胀** —— 明确 `MENTION_BUDGET` 阈值（§6.4）+ token 级历史裁剪（§6.5）+ UI 回显本次 token 估算。
- **R4 模式误用** —— Chat 模式软提示 + 系统 prompt 拒绝 + tool schema 不下发，三层约束。
- **R5 `artifactRefs` vs `mentions` 并存** —— 过渡期前端优先读 `mentions` 回退 `artifactRefs`；`TaskStep.outputMentions` 为 `artifactRef` 超集；所有生成路径在 MP-2 发版后统一写 `mentions`；下一 minor 版本移除 `artifactRefs` / `artifactRef`（见 §6.1 注释）。
- **R6 transcript 持久化迁移** —— 旧数据按 §8 惰性迁移；反序列化层一次性补默认值避免运行时 undefined 分叉。
- **R7 敏感 artifact 外送** —— provider 级 `mentionResolve: 'allow'|'confirm'|'block'` 三态（§8）；`'block'` 是硬阻断（不下发 body），`'confirm'` 是软确认。不在前端做内容脱敏（信噪比低），依靠 provider 策略 + 用户明示。
- **R8 `file` 弱身份** —— 显式承认 `sessionId + relPath` 不是内容快照（§4.1）；MentionPicker 对应推荐 `spectrum` artifact 作为强身份替代。若用户明知要弱身份（想引用"这个文件现在的内容"）也合法。
- **R9 anchor 冲突** —— 5 字符随机 anchor 在单条消息内发生碰撞的概率极低（< 10⁻⁵ @ 20 mentions），生成时做简单冲突检测重新抽取即可；anchor 仅消息内唯一、不要求全局唯一。

## 11. 验收标准

- **AC-1 Chat 模式**：输入"@BaTiO3_xrd.xy 这个谱峰位置合理吗？"，模型基于 spectrum payload 回答，且明确拒绝"我帮你拟合一下"类动作。
- **AC-2 Agent 模式 mention**：从 PeakTable 右键菜单 "Mention in chat" 选中三根峰 → Composer 侧栏出现三枚 chip → 发"把这三根合并拟合为一个 Voigt 组" → TaskStep.inputMentions 含这三枚 mention。
- **AC-3 消息回链**：点击消息里的 `@peak#3` chip → 聚焦对应 artifact；Canvas 对应峰闪烁、PeakTable 对应行滚动到视区（MVP 允许通过 CustomEvent 实现，不强求总线）。
- **AC-4 Missing ref**：引用一个被删的 artifact，chip 置灰；发送后模型回复说明该引用已失效。
- **AC-5 Per-request 预算**：发送时 Composer 底部显示本次 prompt token 估算；超 `perRequest.maxInputTokens` 按 `budget.mode` warn / block。
- **AC-6 Transcript 迁移**：打开包含旧消息（无 `mentions` / 无 peakId）的 session，渲染不报错，内部已 backfill。
- **AC-7 敏感 provider 外送策略**：对 clawd-proxy provider 设 `mentionResolve='block'`，Chat 模式下带 mention 发送 → provider 收到 redacted 占位，chip 显红色 🛑 角标；改设 `'confirm'`，发送前弹列表确认框；改回 `'allow'` 正常放行。

**端到端验收清单**：见 `docs/MANUAL_TEST_MP2_MP3.md`（10 节 ~30 步骤）；自动烟测见 `src/__smoke__/mp2-mp3-smoke.ts`（`npx tsx src/__smoke__/mp2-mp3-smoke.ts`，目前 7/7 通过）。

## 12. 开放问题

1. `/api/chat/send` 是彻底废弃还是保留为后端 agent-tool 回流的代理路径？若保留，应同步设计其 payload 与 IPC 对齐。
2. Mention 的 `contextBlocks` 由前端组装传给 provider 还是送后端由 `lattice-cli` 组装？前者好迭代，后者能做智能裁剪；v0.3 先走前者，留接口位。
3. peak-group 是否允许跨 artifact？MVP 不允许；若后续需要，单独 `peak-group-union` 子类型。
4. MentionChip 视觉语言需 Figma 补 token：file（弱身份灰）/ artifact / element / missing / redacted 五种。

（v0.2 的 Q3 "outputMentions 与 artifactRef 关系" 已在 §6.1 与 R5 闭环，故删除。）

---

附录 A. 实施优先触点：

- `src/components/agent/AgentComposer.tsx`
- 新 `src/components/agent/MentionComposerInput.tsx`（MVP：textarea + 侧栏壳）
- 新 `src/components/agent/MentionPicker.tsx`
- 新 `src/components/agent/MentionChip.tsx`（MP-5 前服务于侧栏；之后同时服务内联）
- `src/components/agent/ArtifactBadge.tsx`（逐步收敛为 MentionChip 的退化形态）
- `src/lib/agent-submit.ts`、`src/lib/llm-chat.ts`、`src/lib/token-estimator.ts`
- `src/stores/session-store.ts`（selectors + 反序列化迁移）
- `src/stores/llm-defaults.ts`（system prompt）
- `src/stores/llm-config-store.ts`（provider `mentionResolve: 'allow' | 'confirm' | 'block'` 字段）
- `src/types/mention.ts`（新）、`src/types/session.ts`、`src/types/artifact.ts`、`src/types/electron.ts`
- `electron/llm-proxy.ts`（主进程侧 contextBlocks 透传）
- `src/components/spectrum/PeakTable.tsx`、`xrd/PhaseTable`、`xps/*`（右键 → `composer:mention-add` 事件）

附录 B. 明确不在本设计范围：

- Chat 模式下 LLM-建议 mention（"你可能想 @ 这个"）。
- Mention 的可视化 diff（跨两次 peak-fit）。
- 语音 / 剪贴板图片 mention（绑多模态上线节奏）。
- `session` mention 跨 session 引用（见 §4.1；待 session 版本锁设计完成后另议）。`selection` mention 在 MP-5 解冻，本设计已在 §9 MP-5 覆盖。
- 跨 session 权限与 session 版本锁设计（前置依赖，需独立文档）。

---

## 13. 实施差异档案（v0.4 新增）

汇总 v0.3 设计与实际落地代码的偏差，便于以后维护者快速定位"为何代码这么写"：

### 13.1 Inspector（来自 codex UI 审计 P0-3，超出原设计范围但已落地）

- **新增右侧 InspectorRail rail**（`src/components/inspector/InspectorRail.tsx` + 5 个 renderer），用于显示选中子对象（peak / phase / xps-component / xps-quant-row / raman-match）的结构化字段。这个组件原设计未包含；codex 在 `docs/MP3_UI_AUDIT.md`（虚拟参考）类似的审计中指出科研 app 必需 inspector，故插入。
- 数据模型增 `Session.focusedElement?: { artifactId, elementKind, elementId, label? }`；`focusArtifact` / `removeArtifact` / `duplicateArtifact` / `prunedSessionForPersist` 都正确处理重置。
- 布局：Composer 与 Canvas 之间增加可拖宽 / 持久化 / Ctrl+Shift+I 切换的 rail；持久化字段进 `LayoutPrefs.inspectorVisible / inspectorWidth`。
- 与 Mention 的闭环：InspectorRail header 加 `AtSign` IconButton —— 选中元素后一键 dispatchMentionAdd（详见 §5.4）。

### 13.2 anchor 协议在 Composer 实现中的细节

- 设计文档 §4.4 描述了 `@[label#anchor]` 字面量 + 侧栏 chip。实施中遇到 React 18 StrictMode 双调用 updater 的陷阱：在 `setPendingMentions` updater 内调用 `generateMentionAnchor` 是 impure，开发态会算两次。
- **修正方案**：anchor 计算移到 setter 之外，用 `pendingMentionsRef`（同步 mirror）+ **eager 前写** 保证同 tick 双派发也唯一（详见 `src/components/agent/AgentComposer.tsx` `handleMentionAddRequest`）。

### 13.3 assistant 镜像 mentions（设计文档未明确）

- 设计 §6.4 说了 IPC 回包 *可* 带 `mentions`，但 LLM 实际上只会回 `@[label#anchor]` 文本（不会主动产生结构化 ref）。
- **实施决定**：`submitAgentPrompt` 把当轮 user 的 `mentions` mirror 到 thinking placeholder 与最终 assistant 消息上，让 MessageBubble 能 round-trip anchor → ref。文档原本暗示需要后端帮忙，实际前端镜像更简单且足够。

### 13.4 `selectMentionablesForActiveSession` 不做高阶

- 设计 §6.2 写的 `selectMentionablesForSession(sessionId)` 是 curried 工厂；agent 实施时改为**普通 selector**（`(s: SessionState) => Mentionable[]`，固定读 active session）。理由：curried selector 每次 render 创建新引用，会触发 zustand 的无效订阅刷新。

### 13.5 stable id 兼容路径

- 设计文档 §4.2 提到"重新拟合即新 id + 旧 ref 标 missing"。实施时为兼容 MP-1 backfill 之前持久化的旧数据，element id 匹配同时支持：精确 `peak.id` / 短 `peak_${index}` / backfill 形 `peak_${index}_${suffix}` 的前缀匹配。XPS / Raman 同模式。详见 `src/stores/session-store.ts` 的 `findPeakById` 等 helper（不导出，与 inspector renderers 同源）。

### 13.6 失败保留草稿（设计文档未明确）

- 原 `submitAgentPrompt` 是 `Promise<void>`，发送一旦失败用户的 input + chip 都已被清空，必须重新 @ 重新输入。
- **修正**：返回 `Promise<boolean>`；handleSend 仅在 ok 时清稿，并 snapshot `{sessionId, text, anchors}` 应对 "异步过程中切换 session / 编辑文本 / 增删 chip" 三种竞态。详见 `AgentComposer.handleSend`。

### 13.7 Canvas 反向通道用 `composer-bus` 而非 `canvas-bus`

- 设计 §5.4 名字叫 `canvas-bus`；实际单向、单消费者，命名为 `composer-bus.ts` 更准确。API 仍是极小 pub/sub（`dispatchMentionAdd` + `useComposerMentionListener`），不引入 EventEmitter。详见 §5.4。

### 13.8 ContextMenu primitive 的 portal 选择

- 设计文档没指定上下文菜单实现方式。实施抽出 `src/components/common/ContextMenu.tsx`，选 React Portal + `position: fixed`：canvas 卡片有 `overflow: auto` + flex 容器，就地绝对定位会被裁剪。

### 13.9 redacted body 仍计入 token 估算

- `mentionResolve='block'` 替换 body 为 `[redacted by provider policy]`，但 `tokenEstimate` 按 redacted 字符数计入。
- 看似浪费，实则正确：redacted body 真的进 prompt 的 system 段，必须算进预算；不能按"等于 0"假装它不占空间。

### 13.10 MP-4 转勘察阶段

- v0.3 把 MP-4 定为"最晚本步必须完成 contentEditable"，承诺了字符串扫描会下线。v0.4 改为：先勘察再决定。
- 理由：MP-2 侧栏方案 dogfood 之前没有真实信号说"内联 chip 必需"；contentEditable 的 IME / paste / undo 坑足够大，行业经验是上 Lexical 而非自研。
- 详见 `docs/MP4_FEASIBILITY.md`：四方案对比 + 推荐 Lexical + 增量上线计划。

### 13.11 端到端测试归档

- 设计 §11 验收标准在 v0.4 落地为 `docs/MANUAL_TEST_MP2_MP3.md`（10 节手测清单，含 inspector / picker / 草稿保留 / mentionResolve 三态 / Canvas 反向 / a11y / 持久化）。
- `src/__smoke__/mp2-mp3-smoke.ts` 提供 7 项 node-tsx 烟测（store + selector + 纯函数），不依赖 React / DOM / Vite。命令：`npx tsx src/__smoke__/mp2-mp3-smoke.ts`。
