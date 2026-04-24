# Lattice 桌面应用 — 后续阶段实施设计稿 (Phase B/C/D/E)

> 版本: v0.1 | 日期: 2026-04-10
> 前置: `docs/DESIGN_PURPOSE.md`（设计目的 / intent）
> 状态: **待审阅**，审阅通过后进入编码
> 本文不含代码——只定义：要做什么功能、由哪些组件/状态/协议组成、依赖关系、开放问题

---

## 0. 本文的定位

| 文档 | 回答 | 粒度 |
|------|------|------|
| `DESIGN_PURPOSE.md` | **为什么** 存在 / 为什么改 | intent |
| `NEXT_PHASES.md` (本文) | **怎么做** / 由什么组成 / 何时做 | structure |
| 代码 | **具体如何实现** | implementation |

设计稿的深度是：**组件清单、状态字段、事件/协议 schema、依赖边**——不是 prop 签名，不是 TypeScript 接口，不是 ECharts option。

---

## 0.1 现状速览（Phase A 已完成）

```
✅ 类型 & 状态       Session / Artifact / Task / TaskStep + session-store
✅ Canvas            ArtifactCanvas + Spectrum/PeakFit/Placeholder cards
✅ Agent 层          AgentComposer + TaskTimeline（读旧 WS 事件）
✅ Shell             ActivityBar / Sidebar / StatusBar / CommandPalette(精简)
✅ 持久化            ❌（内存态，刷新即丢）
✅ 错误可见性        ❌（console 而已）
✅ Artifact 操作     ❌（只能看，不能 pin/export/delete）
✅ Parameters 抽屉   ❌（齿轮是 TODO）
✅ Settings          ❌（alert 占位）
✅ 领域 artifact     ❌（只有 Spectrum/PeakFit，其他是 Placeholder）
✅ Agent 真实推流    ❌（旧事件，无 reasoning / artifact 绑定）
```

本设计稿要补齐的就是上表的 `❌`。

---

## 0.2 Phase 总览

| Phase | 名称 | 主旨 | 后端依赖 | 预估 |
|-------|------|------|----------|------|
| **B** | 客户端基础设施 | session 持久化、toast、artifact 操作、参数抽屉、设置 | 无 | ~2 天 |
| **C** | Agent 协议与交互 | 新流式协议、chat 中 artifact 引用、PeakEditor 约束、Timeline 交互 | **需要后端对齐** | ~2.5 天 |
| **D** | **lattice-cli 完整迁移** (= MIGRATION_PLAN §2.1–2.15) | 15 个功能块 / 77 agent tools / 132 REST 端点，分 P0（光谱核心）/ P1（文献知识）/ P2（计算模拟）/ P3（研究辅助）/ P4（高级，可选） | 需后端 | ~13 天（并行 9 天） |
| **E** | 次级能力 | Library 模态、Explorer 次级入口、多 artifact 比较 / 叠加、Session 分享 zip | 部分 | ~2 天 |

**执行顺序**：B 全部 → C1 与后端同步 → C2–C5 并行 → D 并行（可并行拆给多个子 agent 同时铺 mock UI）→ E 收尾。

---

## 1. Phase B — 客户端基础设施

### B1. Session 持久化

**目的**：刷新 / 重启不丢会话。

**方案**：`zustand/middleware` 的 `persist`，后端 `localStorage`。

**持久化字段**（白名单）：
- `sessions`、`sessionOrder`、`activeSessionId`
- **每个 session 内**持久化：`id / title / createdAt / files / artifacts / artifactOrder / pinnedArtifactIds / paramSnapshot / transcript`
- **不持久化**：`tasks`（步骤可能很多、一次性；下次重开当作新任务即可）、`focusedArtifactId`（恢复时重置为 `artifactOrder[0]`）

**版本 & 迁移**：`version: 1`；版本号不匹配时整体 wipe（MVP 阶段不做迁移）。

**上限保护**：
- 每个 session 的 `transcript` 上限 500 条（超出滚动裁剪头部）
- 每个 artifact 的 `payload.x/y` 点数超过 100k 时序列化前降采样（或干脆不持久化原始数组，只留 `sourceFile`，重新加载时从后端取）——**开放问题 Q1**

**成功标准**：加载 demo → 刷新 → 画布还在、sidebar 列表还在、chat transcript 还在。

**触达文件**：
- `src/stores/session-store.ts`（加 persist 包装）
- `src/App.tsx`（bootstrap 逻辑改：只有当持久化里没任何 session 时才建默认）

---

### B2. Toast 通知系统

**目的**：取代被移除的 BottomPanel，作为 agent 错误、后端断线、导出成功等事件的可见入口。

**架构**：
```
src/stores/toast-store.ts          → zustand 队列 { id, kind, message, ttl, createdAt }
src/components/common/ToastHost.tsx → 固定定位的 toast 栈渲染器，挂到 App 根
src/hooks/useToasts.ts             → push / dismiss API（可选薄封装）
```

**kind**: `error | warn | info | success`

**默认 ttl**：`error` 永不自动消失（要点确认），其他 4s。

**触发点**（至少）：
1. 后端 `ready=false` 事件 → `warn: "Backend disconnected"`
2. `sendChat` throw → `error: err.message`
3. `handleExportSession` 完成 → `success: "Session exported"`
4. `loadDemo` 完成 → `info: "Demo BaTiO3 loaded"`
5. `patchArtifact` 失败（不存在的 id）→ `error`

**成功标准**：断开 lattice-cli 进程，右下角弹出 warn toast；手动重连后消失。

**触达文件**：新 2 个，修改 `App.tsx` / `useWebSocket.ts` / `AgentComposer.tsx` / `useApi.ts`（错误路径）。

---

### B3. Artifact 操作（Pin / Duplicate / Export / Delete）

**目的**：让 artifact 不只是"看"，可以管理。

**UI 位置**：`ArtifactFrame` header 右侧增加 `⋯` 溢出菜单按钮（齿轮旁）。

**菜单项**：
| 动作 | 行为 |
|------|------|
| Pin / Unpin | 切换 `session.pinnedArtifactIds`；Pinned 在 Sidebar 列表顶置，chip 加锁形图标 |
| Duplicate | clone artifact，`id` 新生成，`title` 追加 `(copy)`，`parents` 指向原 artifact；加入 `artifactOrder` 末尾 |
| Export… | 打开子菜单：**JSON**（artifact 全量）/ **CSV**（只对 spectrum/peak-fit）/ **PNG**（spectrum/peak-fit 导出 ECharts 图） |
| Delete | 从 `artifacts / artifactOrder / pinnedArtifactIds` 移除；若被 delete 的是 focused，自动 focus 上一个 |

**新增 store 方法**：
- `duplicateArtifact(sessionId, id): ArtifactId`
- `removeArtifact(sessionId, id): void`
- `selectPinnedArtifacts`（**不要做成选择器**，在组件内 `useMemo` 派生）

**Sidebar 联动**：artifacts 列表按 `pinned 优先 + 时间次序` 排序，pinned 条目左边加 🔒。

**成功标准**：Load demo → duplicate peak-fit → 两个 peak-fit chip 并存；delete 其中一个，剩一个正常；pin 一个后刷新（依赖 B1）pin 状态还在。

**触达文件**：`session-store.ts`、`ArtifactCanvas.tsx`、`Sidebar.tsx`、新 `ArtifactActionMenu.tsx`。

---

### B4. Parameters 抽屉

**目的**：兑现 DESIGN_PURPOSE §5.11 的"专家逃生门"。

**位置**：从右侧滑入（固定宽 320px），压在 ChatPanel 之上；从 artifact header 齿轮触发，或从 Command Palette `Open Parameters`。

**参数层级**（读取优先级从高到低）：
1. `artifact.params[key]` — 这个 artifact 的私有覆盖
2. `session.paramSnapshot[key]` — session 默认
3. `PARAM_DEFAULTS[kind][key]` — 代码里的 kind 默认

**参数 schema 注册表**（新文件 `src/params/schemas.ts`）：
```
{
  kind: ArtifactKind,
  groups: [
    { title, params: [{ key, type: 'number'|'bool'|'select', label, min?, max?, step?, options?, default, description }] }
  ]
}
```

**MVP 阶段覆盖的 kind**：
- `spectrum`：baseline (none/linear/shirley)、smooth window、trim range
- `peak-fit`：algorithm (auto/find_peaks/lmfit)、min prominence、min FWHM

**保存行为**：
- **Apply**：写 `artifact.params`（仅当前 artifact 生效）
- **Save as session default**：同时写 `session.paramSnapshot`（后续同 kind 新 artifact 继承）
- **Reset**：清 `artifact.params` 回落到 session / defaults

**关键点**：**本阶段不调后端**。这只是"捕获专家意图"，等 Phase C1 协议落地后，会把 artifact.params 一起塞到下一次 agent 调用。

**成功标准**：打开 spectrum artifact 齿轮 → 看到 baseline / smooth / trim 表单 → 改 smooth=11 点击 Apply → artifact.params.smooth = 11 → Reset 后消失。

**触达文件**：新 `src/params/schemas.ts`、`src/components/canvas/ParametersDrawer.tsx`、`ArtifactCanvas.tsx`（齿轮接线）、`session-store.ts`（`patchArtifact` 已够用）。

---

### B5. Settings 模态

**目的**：兑现 DESIGN_PURPOSE §2.8；替代 ActivityBar ⚙ 的 `alert` 占位。

**内容**（三节，从上到下）：
1. **Agent**：model 选择（下拉 + 文字描述）；当前连接的后端 URL（只读）
2. **Appearance**：主题切换（dark / light — 现在只有 dark，light 留 TODO）
3. **Parameter Presets**：列出已保存预设（"Fast Analysis" / "High-Resolution XPS" 等）；可新建 / 删除 / 另存当前 session 为预设

**存储**：
- `appPreferences` 新 zustand store（persist 到 localStorage 键 `lattice.prefs`）
- 字段：`agentModel / theme / presets: { name, params }[]`

**模态 vs 抽屉**：模态（居中 overlay），避免它和 Parameters 抽屉在右侧打架。

**成功标准**：Ctrl+, 或 ⚙ 图标 → 打开 → 改 model → 关掉 → StatusBar 反映新 model → 刷新仍然是新值。

**触达文件**：新 `src/stores/prefs-store.ts`、`src/components/layout/SettingsModal.tsx`、`App.tsx`（替换 alert）。

---

## 2. Phase C — Agent 协议与交互增强

### C1. Agent 流式协议（前后端协议对齐，**关键依赖**）

**目的**：把 Agent 执行的每一步结构化，让 Task Timeline 有真实数据喂。

**现状**：后端 `lattice-cli` 目前通过 WS 发送 `chat_message / spectrum_update / peaks_update / status_update / workspace_update`；粒度粗，`chat_message.msg_type='tool_call'` 带 `tool_name / input_summary / output_summary` 但没有：
- reasoning 流
- 工具产生的 artifact 引用
- 计划（上游总览）

**提议新事件集**（前端可识别，后端需要发）：

| 事件 | payload | 语义 |
|------|---------|------|
| `task_start` | `{task_id, title, root_message_id}` | 用户消息触发新任务 |
| `agent_plan` | `{task_id, steps: [{kind, label, tool?}]}` | 初始计划（乐观显示 planned 状态） |
| `agent_reasoning` | `{task_id, step_id?, content}` | LLM 自述；作为 reasoning step 追加或更新 |
| `tool_invocation` | `{task_id, step_id, tool_name, input}` | 开跑；前端 step 从 planned → running |
| `tool_result` | `{task_id, step_id, status, output_summary, artifact_ids?}` | 结束；绑定 artifact 引用 |
| `artifact_created` | `{session_id, artifact}` | 新 artifact（包含完整 payload） |
| `artifact_updated` | `{session_id, artifact_id, patch}` | 增量更新 |
| `task_end` | `{task_id, status: 'succeeded'\|'failed'\|'cancelled'}` | 任务收尾 |

**前端映射**：
- `task_start` → `startTask`
- `agent_plan` → 批量 `appendStep(status=planned)`
- `agent_reasoning` → `appendStep(kind=reasoning)` 或 `updateStep`
- `tool_invocation` → `appendStep(kind=tool_call, status=running)`
- `tool_result` → `updateStep` + 绑定 `artifactRef`
- `artifact_created` → `upsertArtifact`
- `artifact_updated` → `patchArtifact`
- `task_end` → `endTask`

**向后兼容**：保留旧 `chat_message / spectrum_update / peaks_update` handler 作为 fallback，用特性开关 `useNewAgentProtocol` 切换（**开放问题 Q2**：旧事件是否会被后端一并废弃？）。

**与后端同步**：这一条必须拉上 lattice-cli 那边的人对齐。前端可以先按此约定写 handler + mock 注入器，做端到端 demo。

**触达文件**：`useWebSocket.ts`（handler 扩充）、`session-store.ts`（已够）、新 `src/dev/mock-agent-stream.ts`（开发期注入器）。

---

### C2. Transcript 的 Artifact 引用徽章

**目的**：让 chat 里的 assistant 消息能直接"点进"生成的 artifact。

**状态**：`TranscriptMessage.artifactRefs: ArtifactId[]` 已定义但没用。

**行为**：
- assistant 消息里，文本内嵌占位符如 `[artifact:{id}]` 或由 `artifactRefs` 驱动渲染
- 渲染为 inline pill：`◈ Spectrum — BaTiO3_xrd.xy ↗`
- 点击 → `focusArtifact(session.id, id)` + 如果该 artifact 不在当前 session 则 no-op

**来源**：Phase C1 之后，后端在 `tool_result` 事件里给出 `artifact_ids`，前端把 summary 消息追加到 transcript 时同步写入 `artifactRefs`。

**触达文件**：`AgentComposer.tsx`（MessageBubble 渲染）、`useWebSocket.ts`。

---

### C3. PeakEditor 约束模式

**目的**：恢复旧版的"点击增删峰位"交互，但语义改为"给 Agent 下次拟合的约束"（DESIGN_PURPOSE §4.3）。

**形态**：
- 不是独立组件 tab，而是 `PeakFitArtifactCard` 的一个编辑子模式
- Header 增加 `Edit constraints` 按钮，点击进入模式
- 进入后：ECharts 可点击，临时锚点以虚线标出（**不**修改原 artifact）
- 底部出现 "Refit with these constraints" 按钮 → 调用 `sendChat("refit peak-fit {id} with constraints [22.1, 45.3]")`（Phase C1 落地后换成结构化 API）
- 退出模式清空临时锚点

**状态**：组件内部 state，**不**进 session store。

**触达文件**：`PeakFitArtifactCard.tsx`（大改）、`useApi.ts`（新增 `refitPeaks(artifactId, constraints)`——fallback 到 sendChat）。

---

### C4. Command Palette 领域命令

**目的**：兑现 DESIGN_PURPOSE §2.6，把 palette 从"开关清单"升级为"动词清单"。

**新命令组**（所有这些在选中后都是向 AgentComposer 注入文案 + 自动发送）：
- `Auto-detect peaks`
- `Fit peak profiles (Lorentzian)`
- `Fit peak profiles (Pseudo-Voigt)`
- `Identify XRD phases`
- `Charge-correct XPS (C1s @ 284.8 eV)`
- `Match Raman to database`
- `Generate report from current session`

**依赖**：需要有活跃 session + 至少一个 spectrum artifact，否则命令 disabled。

**触达文件**：`CommandPalette.tsx`（命令表扩充）、`AgentComposer.tsx`（暴露一个 `submit(text)` API 给外部调用）。

---

### C5. Task Timeline 交互增强

**目的**：让 Timeline 从"只读流水账"变成"可操作的 agent 控制台"。

**增强点**：
1. **折叠已完成 task**：只默认展开 `activeTaskId`；历史 task 折叠为一行 summary
2. **展开 reasoning**：`kind='reasoning'` 的 step 默认折叠，点击展开 markdown
3. **单步重跑**：tool_call step 右侧增加 ↻ 按钮，调 `rerunStep(stepId)` → 后端重发该工具调用（**需 C1 协议**）
4. **取消任务**：running task 右上角 ✕ 按钮 → `cancelTask(taskId)`（**需 C1 协议**）
5. **跳转到产物**：`artifactRef` 存在时 step 整行变 hover 高亮 + 右侧 "→ artifact"

**触达文件**：`TaskTimeline.tsx`、`session-store.ts`（加 `cancelTask`, `rerunStep` — 本地 optimistic + WS 发请求）。

---

## 3. Phase D — lattice-cli 功能迁移

> **范围 = `docs/MIGRATION_PLAN.md` §2.1–2.15 的全部**，共 15 个功能块、77 个 Agent 工具、132 个 REST 端点。
>
> 与 MIGRATION_PLAN.md 原方案的**唯一区别**是 reshape：
> - 原方案把每个功能做成一个**独立 tab**（LibraryView / KnowledgeView / ComputeView / ...）
> - 新方案按 DESIGN_PURPOSE.md 的原则，把每个功能**重塑为 4 种承载形态之一**：
>
> | 承载形态 | 适用场景 | 例子 |
> |---|---|---|
> | **Artifact 类型** | 有结构化产物，需要保留 / 比较 / 导出 | XRD Analysis, Structure, Compute, Job Monitor |
> | **Agent 工具** | 透明的后端能力，无专属 UI，结果写入其他 artifact | detect_type, read_spectrum, find_peaks, file IO |
> | **Parameters 抽屉条目** | 低层算法参数，专家覆盖默认 | baseline method, smooth window, peak min prominence |
> | **模态浏览器** | 重度浏览场景，不适合做成 artifact | Library, Knowledge Graph |

### D.0 Reshape 映射表（MIGRATION_PLAN → 新设计）

| 来源 §2.x | 原方案 tab/组件 | **新设计承载** |
|---|---|---|
| §2.1 Pro 工具栏（detect-peaks/smooth/baseline/undo/math） | ProToolbar | **Agent tools** + **Parameters 抽屉** |
| §2.1 质量评估 | QualityBadge 组件 | **Spectrum artifact header 的 Quality Badge** |
| §2.1 XRD（search/refine/predict/CIF） | XrdPanel | **XRD Analysis Artifact**（D.P0.2） |
| §2.1 XPS（fit/quantify/database/charge-correct） | XpsPanel | **XPS Analysis Artifact**（D.P0.3） |
| §2.1 Raman（database/overlay） | RamanPanel | **Raman ID Artifact**（D.P0.4） |
| §2.1 FTIR | FtirPanel | **复用 Spectrum Artifact + 抽屉**（不新设类型，D.P0.5） |
| §2.1 Pro 参数 + 预设 | ProParamEditor | **Parameters 抽屉**（已在 B4）+ Settings 预设管理（B5） |
| §2.2 光谱比较 + 相似度 | CompareView / SimilarityMatrix | **多 Artifact 比较/叠加能力**（§E3）+ **Similarity Matrix Artifact**（D.P0.6） |
| §2.3 报告生成 | ReportPreview | **Research Report Artifact**（D.P3.1） |
| §2.3 学术图表导出 | AcademicFigure | **artifact ⋯ 菜单 → Export (Nature/ACS/RSC style)** |
| §2.3 CSV/JSON/PDF/LaTeX | ExportPanel | **artifact ⋯ 菜单 → Export**（已在 B3） |
| §2.4 论文库（列表/搜索/标签/集合） | LibraryView | **Library 模态浏览器**（D.P1.1） |
| §2.4 PDF 阅读 + 标注 | PdfReader / AnnotationPanel | **Paper Artifact 类型**（D.P1.2） |
| §2.4 论文 RAG 问答 | PaperDetail | **Agent tool paper_rag**（结果作为 chat reasoning + 引用 paper artifact） |
| §2.4 论文提取数据 | ExtractionTable | 嵌入 **Paper Artifact 的子面板** |
| §2.5 知识图谱 | KnowledgeView / KnowledgeGraph | **Knowledge Graph Artifact**（D.P1.3） |
| §2.5 跨论文对比 + 热图 + 时间线 | ComparePanel / Heatmap / Timeline | **Material Comparison Artifact**（D.P1.4） |
| §2.6 Compute Python 执行 | ComputeView / CodeEditor / Console / FigureGallery | **Compute Artifact**（D.P2.1） |
| §2.7 Structure 建模 + 3D | StructureView / MolViewer | **Structure Artifact**（D.P2.2） |
| §2.7 AI 结构生成 | StructureBuilder | **Agent tool**，产物写入 Structure Artifact |
| §2.8 DFT/MD 任务管理 | JobList / JobDetail | **Job Monitor Artifact**（D.P2.3） |
| §2.8 DFT/MD 配置 | DftSetup / MdSetup | **CommandPalette + Parameters 抽屉**，不做专属配置 UI |
| §2.9 /research 文献综述 | ResearchPanel | **Research Report Artifact**（D.P3.1） |
| §2.9 /survey 网络调研 | SurveyPanel | **Research Report Artifact** 的一种模式（同一个 artifact 类型） |
| §2.10 批量分析 | BatchSetup / BatchResults | **Batch Workflow Artifact**（D.P3.2） |
| §2.11 Copilot 底部面板 | 底部面板 | **已并入 AgentComposer + TaskTimeline** |
| §2.12 实验优化（贝叶斯） | 未定 | **Optimization Artifact**（D.P4.1） |
| §2.13 假设管理 | 未定 | **Hypothesis Artifact**（D.P4.2） |
| §2.14 逆向设计 | 未定 | **Inverse Design Artifact**（D.P4.3） |
| §2.15 合成可行性 | 未定 | **Agent tool + Research Report 内嵌徽章**（D.P4.4） |

**约定**（所有 D 项目通用）：
- `payload` 字段用强类型接口替换当前 `OpaquePayload`
- mock 数据生成器放 `src/stores/demo-data.ts`（离线开发用）
- 卡片组件放 `src/components/canvas/artifacts/<Kind>ArtifactCard.tsx`
- 在 `ArtifactCanvas.renderArtifact` 的 switch 里加一支
- 参数 schema 在 `src/params/schemas.ts` 里登记
- Agent tools 在 Phase C1 协议落地前用 **CommandPalette 注入自然语言 `sendChat`** fallback

---

### D.P0 — 核心光谱分析（MIGRATION_PLAN §2.1–2.3）

#### D.P0.1 Spectrum artifact 接入真实后端
- 把 Phase A 的 mock Spectrum / PeakFit artifact 对接到后端 `/api/pro/detect-peaks` / `smooth` / `baseline` / `math` / `undo`
- 每次 Agent 调用处理工具产出**新 spectrum artifact**（`processingChain` 追加一步），原始不改
- 在 spectrum artifact header 加 **Quality Badge**，数据源 `/api/pro/assess-quality`（snr / saturation / spikes）
- Agent tools 覆盖：detect_type / read_spectrum / find_peaks / assign_peaks / edit_peaks / assess_quality / correct_baseline / smooth_spectrum / spectrum_math

#### D.P0.2 XRD Analysis Artifact
- **payload**：`{ query, phases[{name, formula, spaceGroup, cifRef, confidence, matchedPeaks, weightFraction?}], rietveld?{rwp, gof, converged}, theoreticalPattern? }`
- **UI**：叠加图（原 XRD + 候选相理论图样）+ 相列表（名称 / 置信度条 / 空间群 / 权重）+ hkl 匹配表 + Rietveld 指标面板
- **操作**：每个相 → `Open CIF`（打开 Structure Artifact，D.P2.2）/ `Export JSON`
- **后端**：`/api/pro/xrd-search` `/xrd-refine` `/predict-xrd` `/upload-cif`
- **Agent tools**：xrd_database / xrd_refine / predict_xrd / compare_theory / dara_{bridge,peaks,predict,cif,convert}
- **参数**：`search_range / method (peak-match|rietveld) / tolerance / max_phases / refinement_cycles`

#### D.P0.3 XPS Analysis Artifact
- **payload**：`{ fits[{element, line, peaks[{binding, fwhm, area, assignment}], background}], quantification[{element, atomicPercent, rsf}], chargeCorrection?{refElement, refLine, refBE, shift}, validation? }`
- **UI**：拟合图 + 残差双轨 + 元素定量表（可选饼图）+ 校正状态条
- **后端**：`/api/pro/xps-fit` `/xps-quantify` `/xps-lookup` `/charge-correct`
- **Agent tools**：xps_fit_spectrum / xps_quantify / xps_database / xps_validate
- **参数**：`background_method (shirley|linear|tougaard) / fit_model (voigt|gaussian|lorentzian|pseudo-voigt) / charge_correction_element / charge_correction_be`

#### D.P0.4 Raman ID Artifact
- **payload**：`{ matches[{mineralName, formula, referenceSource, cosineScore, referenceSpectrum}], query: {source, topN, hint?} }`
- **UI**：叠加图（user + top-3 reference）+ Top-N 列表（名称 / 得分条 / 来源 / 展开）
- **后端**：`/api/pro/raman-identify`
- **Agent tool**：raman_database
- **参数**：`top_n / score_threshold / database (rruff|user) / mineral_hint`

#### D.P0.5 FTIR 支持（轻量，不新设类型）
- 复用 Spectrum Artifact + Parameters 抽屉里的 FTIR 专用参数组（transmittance→absorbance 转换、特征波段预设）
- Agent tool 层面：FTIR 走通用 find_peaks / correct_baseline / smooth_spectrum
- **不做**独立 artifact 类型，避免膨胀

#### D.P0.6 光谱比较 / 相似度（与 §E3 多 artifact 比较协同）
- 底层能力：§E3 多 artifact 叠加模式（pinned artifact → split canvas / overlay）
- **Similarity Matrix Artifact**：`{ sources: ArtifactId[], metric: 'pearson'|'cosine', matrix: number[][] }` → 热力图渲染
- **后端**：`/api/pro/compare-spectra` `/api/compare/*`
- **Agent tool**：compare_spectra

#### D.P0.7 报告与导出
- 报告 → D.P3.1 Research Report Artifact
- 每个 artifact 的 ⋯ 菜单增加 `Export as Academic Figure`（调 `/api/pro/academic-figure` + `/api/pro/export-*`）
- **Agent tools**：generate_report / academic_figure / export_data

---

### D.P1 — 文献知识管理（MIGRATION_PLAN §2.4–2.5）

#### D.P1.1 Library 模态浏览器
- 从 CommandPalette `Open Library` 或 Sidebar Files header 右侧图标打开**全屏模态**
- 布局：左侧集合树 / 中间论文卡片流 / 右侧过滤侧栏
- 导入：DOI 输入框 / BibTeX 上传 / PDF 上传
- **后端**：`/api/library/*` 全量（20+ 端点）
- **Agent tools**：ref_library_tools / paper_reader_tool

#### D.P1.2 Paper Artifact（从 Library 打开单篇时生成）
- **payload**：`{ paperId, metadata{title, authors, year, doi, venue, abstract}, pdfUrl, annotations[], extractions[], chains[] }`
- **UI**：上 PDF 阅读器（pdfjs-dist 延迟加载）+ 下右侧边栏（标注 / 提取数据 / 推理链 tab）+ 底部"向论文提问"输入（触发 `paper_rag` agent tool）
- **后端**：`/api/library/paper/{id}/*`
- **Agent tools**：paper_rag / paper_extract
- **参数**：无（阅读类）

#### D.P1.3 Knowledge Graph Artifact
- **payload**：`{ nodes[{id, type: 'material'|'process'|'property'|..., label}], edges[{from, to, relation}], filters?, layout? }`
- **UI**：ECharts 力导向图 + 左侧节点类型过滤 + 顶部搜索框 + 点击节点 → 右侧详情抽屉
- **触发**：CommandPalette `Explore Knowledge Graph` 或 Agent tool 返回
- **后端**：`/api/knowledge/stats` `/extractions` `/search` `/peaks`
- **Agent tools**：knowledge search / extract 系列

#### D.P1.4 Material Comparison Artifact
- **payload**：`{ materials: [{id, name, properties}], comparisonRows[], heatmap, timeline }`
- **UI**：对比表 + 热图（属性 × 材料）+ 时间线
- **后端**：`/api/knowledge/compare` `/heatmap` `/timeline` `/export/csv`

---

### D.P2 — 计算模拟（MIGRATION_PLAN §2.6–2.8）

#### D.P2.1 Compute Artifact
- **payload**：`{ language: 'python', code, stdout, stderr, figures[{format, base64, caption?}], exitCode, status, env?{packages, pythonVersion} }`
- **UI**：上 codemirror 6 编辑器（**Q4 默认选型**）+ 下左 stdout/stderr 流 + 下右 figures 画廊 + header Run / Stop 按钮
- **后端**：`/api/pro/compute/exec` `/health` `/snippets` `/save-script` `/scripts`
- **Agent tools**：compute_exec / coding_agent
- **参数**：`timeout / env / packages / python_version`

#### D.P2.2 Structure Artifact
- **payload**：`{ cif, formula, latticeParams{a,b,c,α,β,γ}, transforms[{kind, params, appliedAt}], computedFrom?: ArtifactId }`
- **UI**：上 3Dmol.js 查看器（**Q3 默认选型**，延迟加载）+ 下左 CIF 文本（codemirror 6 只读 / 编辑切换）+ 下右变换历史时间线
- **操作**：`Make 2×2×2 supercell` / `Dope Fe 5%` / `Generate (001) surface` / `Add O vacancy` / `AI build from prompt`
- **后端**：`/api/pro/struct/transform` `/ai-build`
- **Agent tools**：structure_tools（8 个 pymatgen wrappers）/ dara_cif

#### D.P2.3 Job Monitor Artifact
- **payload**：`{ jobId, backend: 'cp2k'|'vasp'|'lammps'|'ase'|..., status, progress 0..1, startedAt, endedAt?, convergence[{iter, metric, value}], log[], resultArtifactIds? }`
- **UI**：顶进度条 + 中 ECharts 收敛曲线 + 底 virtualized 日志 + header Cancel
- **后端**：`/api/sim/jobs` 轮询 + WS `job_update` 事件（**依赖 C1 协议**）
- **Agent tools**：dft_tools (6 个 CP2K) / md_tools (7 个 LAMMPS/ASE) / optimize_tools
- 任务结束后自动生成 **Structure / Compute artifact** 作为输出，并在 Job Monitor 内列出引用

---

### D.P3 — 研究辅助（MIGRATION_PLAN §2.9–2.10）

#### D.P3.1 Research Report Artifact
- **payload**：`{ topic, mode: 'research'|'survey', sections[{id, heading, level, markdown, citations}], citations[{id, doi?, title, authors, year, venue, url?}], outline, generatedAt, style }`
- **UI**：双栏 —— 左章节导航（outline，可拖拽排序）+ 右 markdown 渲染；内联引用下标 `[1]` hover 展开；header 操作 `Export PDF / Markdown / LaTeX`
- **触发**：CommandPalette `/research <topic>` 或 `/survey <topic>` 或 `Generate report from session`
- **后端**：`/api/report/*`
- **Agent tools**：invoke_research / survey / survey_pipeline / paper_extract / generate_report / academic_figure
- **参数**：`style (concise|comprehensive) / citation_format (APA|MLA|IEEE) / max_sources / time_range`

#### D.P3.2 Batch Workflow Artifact
- **payload**：`{ sourceDir, pattern, pipeline: string[], concurrency, files[{relPath, status, artifactIds?, error?}], summary?{total, ok, failed, jsonlUrl} }`
- **UI**：顶配置条 + 中 virtualized 文件列表 + 底汇总 + Download JSONL
- **后端**：`/api/batch/*`
- **Agent tool**：batch_analyze

---

### D.P4 — 高级功能（MIGRATION_PLAN §2.11–2.15，**可选 / 后置**）

> 这些是 MIGRATION_PLAN 里标记"未定"的，属于锦上添花。建议 P0–P3 走通后再开。

| ID | 来源 | 承载 | payload 骨架 |
|---|---|---|---|
| D.P4.1 | §2.11 Copilot | **已并入 AgentComposer** | — |
| D.P4.2 | §2.12 实验优化 | **Optimization Artifact** | `{ objective, params[{name, range}], trials[{x, y}], posterior?, nextCandidates[] }` + `optimize_tools` |
| D.P4.3 | §2.13 假设管理 | **Hypothesis Artifact** | `{ hypotheses[{id, statement, score, evidence: ArtifactId[], status}] }` + `hypothesis_tools` / `hypothesis_report` |
| D.P4.4 | §2.14 逆向设计 | **Inverse Design Artifact** | `{ target: {property, value}, candidates[{composition, predictedProperty, score}] }` + `inverse_design_tools` |
| D.P4.5 | §2.15 合成可行性 | **Agent tool + Research Report 内嵌徽章** | — |

---

### D.X 77 个 Agent 工具的处理策略

MIGRATION_PLAN 附录 A 列的 77 个工具，按**前端是否需要专属 UI** 分三类：

| 类别 | 数量 | 处理 |
|---|---|---|
| **透明工具** | ~50 | read_spectrum / find_peaks / list_files / read_file / preview_data / get_datetime 等 —— 前端无任何 UI，Agent 调用后的结果要么写入现有 artifact，要么作为 tool_call step 在 Timeline 显示 |
| **产物工具** | ~20 | xrd_database / xps_fit / structure_tools / compute_exec / dft_tools / md_tools 等 —— 每个归入上面 D.P0–P4 某个 artifact 类型 |
| **研究工具** | ~7 | invoke_research / survey / survey_pipeline / paper_rag / paper_extract / paper_reader_tool / ref_library_tools —— 归入 D.P3.1 Research Report 或 D.P1.2 Paper Artifact |

**统一接口**：前端不直接调 132 个 REST 端点，而是由 Agent 协议 (C1) 的 `tool_invocation` / `tool_result` 事件统一承载。前端只**看** artifact 和 step，不管后端走哪个端点。

---

## 4. Phase E — 次级能力

### E1. Library 作为 RAG 工具
- `/import doi:10.1038/...` → 后端解析 DOI → 入库
- 在 artifact（尤其 Research Report）侧显示"相关文献"卡
- **不做独立 tab**

### E2. Explorer 作为次级入口
- 从 Sidebar 顶部 `Files (N)` 的 header 打开一个**模态**文件浏览器
- 支持浏览、搜索、多选导入到当前 session
- **不是 ActivityBar 一级项**

### E3. 多 Artifact 比较 / 叠加
- Canvas 支持 **split mode**：两个 pinned artifact 左右并列
- 若都是 spectrum/peak-fit，可切换为 **overlay mode**：同一坐标系叠加，图例可切
- 触发：在某 pinned artifact chip 上右键 "Compare with…"

### E4. Session 分享 / 快照
- `Export Session` 除了当前的 JSON，增加 **`.lattice.zip`**：包含 manifest + 所有源文件 + artifact 快照 + transcript
- 对称的 `Import Session` 导入入口
- **开放问题 Q5**：是否需要加密？

---

## 5. 依赖关系图

```
Phase B （全部并行）
  B1 persist  ── 没有前置依赖
  B2 toast    ── 没有前置依赖
  B3 artifact action ── 依赖 B1（刷新后仍可见）
  B4 params drawer  ── 依赖 B1（session.paramSnapshot 要持久）
  B5 settings       ── 依赖 B1

Phase C
  C1 protocol  ── **需要后端** 阻塞 C3~C5 的真实功能，C2 可先做 UI
  C2 artifact badges  ── 依赖 C1
  C3 peak constraints ── 可先 fallback 到 sendChat，C1 后升级
  C4 palette commands ── 可独立做，fallback 到 sendChat
  C5 timeline ops     ── 部分依赖 C1

Phase D
  D1~D8  ── 每个依赖 C1 拿真数据；UI + mock 可在 C1 前并行铺
  D4 Structure ── 额外依赖 Q3 3D viewer 选型
  D5 Compute   ── 额外依赖 Q4 代码编辑器选型

Phase E
  E1  ── 依赖 C1 + 后端 RAG 端点
  E2  ── 独立
  E3  ── 依赖 B3（pin）
  E4  ── 依赖 B1
```

---

## 6. 开放问题（已给默认答案，可覆盖）

| ID | 问题 | **默认决定** | 备注 |
|----|------|---------|------|
| **Q1** | artifact.payload 大数组是否持久化？ | **不持久化**原始 x/y，只留 `sourceFile`；每次打开 session 按需 refetch；payload 点数 >50k 时触发此路径 | 代价：完全离线（后端没跑）打不开旧 session。可接受。 |
| **Q2** | 后端旧 WS 事件是否被 C1 新协议取代？ | **并行期**：C1 上线后前端同时兼容新旧；6 周后前端去掉旧 handler；后端何时停发由 lattice-cli 那边定 | 需要和后端同步过一个去弃期 |
| **Q3** | 3D 结构可视化选型 | **3Dmol.js** | ~180KB；已满足 MIGRATION_PLAN §2.7 的需求；NGL 800KB 太重 |
| **Q4** | 代码编辑器选型 | **codemirror 6** | ~300KB；monaco 2MB+ 对桌面 app 也太重；延迟加载 |
| **Q5** | Session 分享 zip 加密 | **默认不加密**；提供可选密码字段（AES-GCM），留给 E4 阶段 | MVP 不做 |
| **Q6** | parameter 预设存储位置 | **localStorage 起步**（key `lattice.prefs`）；后续可同步到后端 `/api/pro/load-preset` `/save-preset` | Phase B5 只做本地 |
| **Q7** | Phase D 范围 | **全部做**（D.P0→P1→P2→P3，P4 按需）。已明确 = MIGRATION_PLAN §2.1–2.15 完整迁移 | ← **用户已确认** |
| **Q8** | Agent 协议事件命名 | **参考 lattice-cli 已有事件**；C1 前端侧先用临时命名 `agent_*` / `tool_*` / `artifact_*`，写代码前拉一次后端的 WebSocketHandler 代码对齐 | 阻塞 C1 |

如果上述默认决定有任何一条你不同意，告诉我覆盖哪条。

---

## 7. 预估工作量

| Phase | 工时（单人）|
|-------|--------|
| B1 persist / B2 toast / B3 artifact ops / B4 params drawer / B5 settings | **~2 天** |
| C1 protocol (前端 + mock + 后端同步) | 1 天 |
| C2 badges / C3 peak constraints / C4 palette / C5 timeline ops | 1.5 天 |
| **Phase C 小计** | **~2.5 天** |
| D.P0.1 spectrum 接真后端 + quality badge | 0.8 天 |
| D.P0.2 XRD Analysis | 1 天 |
| D.P0.3 XPS Analysis | 1 天 |
| D.P0.4 Raman ID | 0.5 天 |
| D.P0.5 FTIR 轻量 | 0.2 天 |
| D.P0.6 Similarity Matrix + overlay | 0.5 天 |
| D.P0.7 报告导出 | 合并进 D.P3.1 |
| **D.P0 小计** | **~4 天** |
| D.P1.1 Library 模态 | 1 天 |
| D.P1.2 Paper Artifact (pdfjs) | 1.2 天 |
| D.P1.3 Knowledge Graph | 0.8 天 |
| D.P1.4 Material Comparison | 0.5 天 |
| **D.P1 小计** | **~3.5 天** |
| D.P2.1 Compute (codemirror 6) | 1.5 天 |
| D.P2.2 Structure (3Dmol.js) | 1.5 天 |
| D.P2.3 Job Monitor | 0.6 天 |
| **D.P2 小计** | **~3.6 天** |
| D.P3.1 Research Report | 1.2 天 |
| D.P3.2 Batch Workflow | 0.8 天 |
| **D.P3 小计** | **~2 天** |
| D.P4.1–5（可选） | 2 天（如全做） |
| **Phase D 合计** | **~13 天（不含 P4）** |
| E1–E4 | 2 天 |
| **总计** | **~20–22 天（单人，不含后端配合窗口）** |

**并行化策略**：Phase D 里 P0/P1/P2/P3 互相独立，可以并行铺 UI + mock（交给子 agent 分工），各自对接后端那段串行。预计总工期可压缩到 **12–15 天**。

---

## 8. 审阅要点（回答后即开工）

Phase D 已确认 = MIGRATION_PLAN.md 完整迁移（Q7 ✓）；其余 7 个开放问题也都给了默认答案。还需要你确认的只剩三件事：

1. **执行顺序**：Phase B → C → D.P0 → D.P1 → D.P2 → D.P3 → (D.P4) → E —— OK？还是想先抢 D.P0.2 XRD 出效果？
2. **工作节奏**：
   - 方案 A（推荐）：**每个 Phase 做完停一次**给你看（B、C、D.P0、D.P1、...），7 次停顿
   - 方案 B：B 全做完停一次，C 全做完停一次，D 全做完停一次，共 3 次停顿
   - 方案 C：全程不停，出最终版给你看
3. **Phase C1 后端协议**：这一条必须和 lattice-cli 的人拉对齐会议。我们是**先跳过 C1 做 B + D mock**，C1 等后端配合时再补？还是**卡在 C1** 等对齐？

答完上述 3 条（加任何想覆盖的默认答案），我立刻拆 Phase B 任务开干。
