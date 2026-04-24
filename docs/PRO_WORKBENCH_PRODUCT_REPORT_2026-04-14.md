---
title: Pro Workbench 重设计产品报告 —— 从"仪器面板"到"可观察的分析工作流"
status: Draft v0.1（重定位，不含具体实现）
author: Claude (Lattice front-end)
date: 2026-04-14
related:
  - docs/MIGRATION_PLAN.md (§4.1–4.3 pro.html 移植路线)
  - docs/SELF_CONTAINED_PORT_PLAN_2026-04-13.md
  - docs/RESEARCH_SURVEY_PRODUCT_REPORT_2026-04-14.md
  - docs/AGENT_LLM_REDESIGN.md
  - docs/CHAT_PANEL_REDESIGN.md
---

# Pro Workbench 重设计产品报告

## 0. TL;DR

Pro Workbench（XRD / XPS / Raman / Compute 四个 artifact）是 Lattice-app 里**最重**的功能面——1428 + 1239 + 586 + 909 = **~4.2k 行**的单文件组件，各自把 6–9 个参数 section 糊在一块右侧面板里。移植自 pro.html 时把"网页仪器面板"一对一搬了过来，但没有回答两个关键问题：

1. **用户到底在这里做什么？** —— 不是"每次调 7 个滑块点 5 个按钮"，而是"走一条假设 → 验证 → 汇报的分析路径"。
2. **Agent 是什么角色？** —— 当前 Agent 和 Workbench 互不相识：用户在 Composer 里问 "帮我找相", Agent 只能文字回答，没法把 "2θ 范围改成 10–60, 搜三相" 这种**参数建议**落到对应的 XRD Workbench 里。

本报告给出重设计方向。**命题：** Pro Workbench 的中心不是仪器面板，是**可观察、可回放、可协作的分析工作流**。

---

## 1. 现状盘点

### 1.1 四个 Workbench

| Workbench | LoC | pro.html 对应段 | 右面板 section 数 | 独有交互 |
|-----------|-----|-----------------|-------------------|----------|
| XrdProWorkbench | 1428 | L1260–1494 | 6（Quality / Peak / Phase Search [DB\|CIF tabs] / Refinement / Scherrer / Results） | CIF 拖拽、相搜索、Rietveld 精修、结晶粒度计算 |
| XpsProWorkbench | 1239 | L1499–1670 | 8（Quality / ChargeCorrect / Peak / Def / Fit / Quant / BE-Lookup / Results） | 能级窗口顶栏、峰组双态、BE 数据库查询 |
| RamanProWorkbench | 586 | L1675–1768 | 6（Quality / Smooth / Baseline / Peak / Table / AI Assign） | FTIR 模式切换（同组件） |
| ComputeProWorkbench | 909 | L1870–1986 | 3（Session Context / Snippets / Saved Scripts） | CodeMirror 编辑器、stdout 流、图形抓取、Jobs 历史 |

### 1.2 共享层（`src/components/common/pro/*`）

**布局**：`ProLayout`（左内容 + 右 380px 可拖拽参数面板 + 底 `ProActionBar`）

**原子**：`ProButton / ProSelect / ProNumber / ProSlider / ProText / ProRow / ProSection / ProTabs / ProEmpty / ProHealthBadge / ProDropZone`（11 个，共 ~830 行）

**健康的部分**：原子设计一致；所有 workbench 都吃 `ProLayout`；`ProSection` 可折叠；`ProActionBar` 是统一的命令条。

### 1.3 入口

- `ProLauncherMenu`（全屏居中 Modal）：点 ActivityBar 的 Zap 图标或命令面板，弹出"XRD Pro / XPS Pro / Raman Pro / Compute Pro"四选一
- `createProWorkbench({ sessionId, kind, spectrum, sourceArtifactId })`：注入默认 payload（参数初值）+ 注册 artifact + 聚焦 EditorArea
- 没有从侧栏直接打开 XRD/XPS/Raman 的路径（只 Compute 有 — Phase 3 新做的）

### 1.4 生命周期

- **状态全在 artifact payload 里**：`patchArtifact(sessionId, artifactId, { payload: { ...current, newField } })`；React 状态只有局部 UI toggle（busy flag、snippet lang）
- **session 内可多实例**：session 里能有 N 个 XrdProArtifact，互不干扰
- **持久化**：session-store 已经 persist，跨会话还在
- **Spectrum 来源**：拖拽文件到 `ProDropZone` → 后端解析 → payload.spectrum 写入；或从其他 artifact "Open in XRD Pro"（只 XRD 有）

---

## 2. 痛点诊断（代码证据）

### 2.1 单文件过重，关注点未拆

- `XrdProWorkbench.tsx` 1428 行，`Inner` 函数承担了：7 个 Section 的 JSX、15+ 个 `run*` action handler、相搜索 db/cif 双 tab 状态、snapshot 导出、CIF 拖拽、instrument profile 下拉…
- `XpsProWorkbench.tsx` 8 个 section 顺序排列，但**顺序本身就是流程**（Assess → Charge → Peak → Def → Fit → Quant → Lookup），用户不知道当前该做哪步，所有 section 都默认展开
- 三个 spectrum workbench（XRD/XPS/Raman）都有独立拷贝的 `Data Quality` section（相同的 grade/snr/issues/recommendations 展示）

### 2.2 右面板是"一页全参数"，没有流程感

当前模型：所有 section 铺陈在右面板，各自折叠。用户打开 XRD Workbench 看到的是：

```
│ [Chart]                                         │ Data Quality     [Run]
│                                                 │ Peak Detection   [Run]
│                                                 │ Phase Search     [DB|CIF]
│                                                 │ Refinement       [Run]
│                                                 │ Scherrer         [Run]
│                                                 │ Results          (empty)
│ ────────────────────────────────────────────────┼─────────────────────────
│ [ SEARCH DB | REFINE | EXPORT CIF | SAVE SNAPSHOT ]                     │
```

问题：
- **第一次使用的人**不知道先点哪个（pro.html 原设计是上到下的顺序，但 UI 没有明示）
- **重复使用的人**每次都要手动滚动到对应 section，改几个数，点 Run，等结果
- **不跑也要显示**：Results section 在空态时仍占位，Scherrer 在没测峰时也显示
- **没有步骤回放**：改了 2θ 范围再点 Refine，之前的 fit 结果直接被覆盖，看不到是否真的变好了

### 2.3 Compute vs Spectrum 被强塞进同一个 ProLayout

Compute 的左侧是 **编辑器 + 控制台 + 图形画廊**（3 个垂直分区），右侧只有 3 个 section（Context / Snippets / Scripts）。它和 XRD 的"chart + peak table"根本不是同一类 UI，但被同一个 `ProLayout` 约束：右侧 380px 固定。Compute 在大屏上编辑器被挤到 <60% 宽度，snippet 列表又空荡荡。

### 2.4 Agent 与 Workbench 是两条割裂的线

Agent 的 LocalTool 能读 artifact payload（通过 session-store），但**不能主动修改**。实际表现：

| 场景 | Agent 能做 | 用户体验 |
|------|-----------|----------|
| 用户问 "2θ 范围选多少合适？" | 回答 "一般 10°–90°..." | 用户手动改 |
| 用户问 "帮我跑一下 Rietveld" | Agent 只能说 "点右边 Refinement 按钮" | 用户手动点 |
| 用户问 "为什么 fit 这么差？" | Agent 没有 fit result 上下文，只能凭空 speculate | 用户只能靠自己判 |

当前架构里 `useProApi` 调用都走前端，Agent 没有 tool 能 `set_xrd_params(twoThetaMin=10)` 或 `run_xrd_refinement()` 或 `read_xrd_result()`。**Agent 在 Pro Workbench 场景下几乎是装饰**。

### 2.5 没有"对比"和"分析日志"

材料学家的工作流 90% 是对比：两个样品、两个退火条件、两个精修参数组合。当前 Workbench 一个 artifact 只持有一条 spectrum + 一组参数 + 一组 peaks；要对比只能开两个 artifact 窗口人眼看。也没有 run log：用户跑 peak detect 三次调参，中间两次的结果自动被后一次覆盖，**无法回溯哪个参数组最合理**。

### 2.6 入口不统一

- Compute: ActivityBar Compute 图标 → 侧栏 ComputeView → "+" 新建
- XRD / XPS / Raman: ActivityBar Zap 图标 → ProLauncherMenu（全屏 Modal） → 四选一
- 命令面板：`Open Pro Launcher`、`Open XRD Workbench`（混用）
- 拖 spectrum 文件到 canvas 空态：打开 XRD Workbench

同一类动作有四种入口，用户要记住哪个图标对应哪个。

---

## 3. 目标用户与场景

### 3.1 用户画像

- **材料学硕博 / 研究员**：跑 XRD / Raman / XPS 属于日常操作；懂参数意义但**不想记所有 API**；希望"默认值 90% 情况够用"。
- **科研小组长**：看学生跑出来的数据，要能**3 秒判断 fit 是否 trustworthy**；要能批注"R_wp 8.5% 可以，但 (110) 峰位偏 0.2°"。
- **跨学科人员（化学、地质、半导体）**：可能只用其中 1–2 个模块；希望**看不懂的部分能被 Agent 解释**。

### 3.2 三个典型场景

**场景 A — "这 XRD 谱是什么相？"**

1. 拖 `.xy` 文件到 canvas
2. Data Quality 自动打分 → 绿色 B+
3. 用默认参数点 "Detect Peaks" → 18 个峰
4. Phase Search 切 DB tab，点 "Search" → 3 个候选（TiO₂ anatase 匹配度 92%）
5. 看结果觉得合理，点 "Refine" 跑 Rietveld → R_wp 7.3%
6. 点 "Snapshot" 存档
7. 去 Composer 问 agent "Rietveld 质量怎么样 R_wp 7.3%" → 获得解释

当前痛点：步骤 2–6 都在右面板里手动切 section、滚动、点击；agent 在 7 才介入；过程没 log。

**场景 B — "对比两个样品"**

用户有 sample A（退火前）和 sample B（退火后），想看 anatase (101) 峰位和 FWHM 怎么变化。

当前：开两个 XRD Workbench artifact，人眼看两张图。峰数据要手动抄。

期望：一个 workbench 里双曲线叠加 + 自动算峰位 Δ、FWHM Δ、强度 Δ。

**场景 C — "Compute 脚本探索"**

用户想用 pymatgen 算空间群。当前：打开 Compute Workbench，从 Snippets 找 "Space Group Analysis"，Load，改 CIF path，Run。stdout 出来，没有上下文。想再试个相关 snippet，editor 里当前代码被覆盖没备份。

期望：每次 run 都是一条 "cell" 式记录（像 Jupyter），保留前一次的输入输出，能回编辑。

---

## 4. 重设计原则

### 4.1 流程 > 面板

**现在**：一页铺所有参数，用户自己悟执行顺序。
**目标**：显式的**步骤轨道（Pipeline Rail）**在左上方，当前步骤高亮，已完成步骤显示摘要 chip，未来步骤灰色可点。每一步的参数面板只在被激活时展开。

### 4.2 Agent 是一等协作者，不是聊天机器人

**现在**：Agent 和 Workbench 是两个孤岛。
**目标**：Agent 拥有 workbench-scope 的 tool 集 —— `propose_xrd_params` / `apply_xrd_params` / `run_xrd_refinement` / `read_xrd_result` / `annotate_peak`。用户在 Composer 里发的每条 message 都能看到**Agent 意图落到 workbench 的哪里**（param chip 高亮、建议行内显示"Agent ▸ 把 2θ 改到 10–60, 原因：高角度信噪比低"，一键 Apply）。

### 4.3 记录 > 覆盖

每次参数运行都产生一条 **Run** 记录（时间戳 + 参数 + 结果快照 + 一句备注）。之前的 run 可以被 Pin、Diff、Export。仪表盘显示"R_wp 从 12% 降到 7.3%"这种趋势。

### 4.4 对比是一等公民

`Workbench` 能挂 1 或 2 条 spectrum（Primary + Comparison）；所有可视化自动双曲线；分析步骤产出的 peaks/fit/quality 自动配对显示 Δ。

### 4.5 Compute 是不同物种，分家

Spectrum 系 workbench（XRD / XPS / Raman / FTIR）共享一套信息架构。Compute 拉出去做 **Notebook 形态**（cell 为主），和前三者在 UI 上不再共用 `ProLayout`。

### 4.6 渐进披露

默认显示 Quick 模式（3 个滑块 + 跑一把）。"Expert" toggle 展开所有可调参数。绝大多数用户永远只用 Quick。

---

## 5. 信息架构方案

### 5.1 Spectrum 系 Workbench（XRD/XPS/Raman/FTIR）统一结构

```
┌────────────────────────────────────────────────────────────────────┐
│ Workbench Header: [XRD] Sample-A.xy                [⚙︎] [📷] [↗]   │
├────────────────────────────────────────────────────────────────────┤
│ Pipeline Rail                                                      │
│ ● Quality  ──  ● Preprocess  ──  ● Peaks  ──  ○ Phase  ──  ○ Refine│
│   B+ SNR 84     baseline ok     18 peaks    —              —       │
├──────────────────────────┬─────────────────────────────────────────┤
│                          │ ▾ PHASE SEARCH (current step)           │
│                          │   [DB]  [CIF]  [FILE]                   │
│   [ SpectrumChart ]      │   2θ range  [10] ── [80]                │
│   2θ vs Intensity        │   Max phases  [3]                       │
│   + peaks + fit envelope │   ☑ Include amorphous                   │
│   + comparison overlay   │   [ Run Phase Search ]                  │
│                          │   ─────────────────────                 │
│                          │   💡 Agent suggests:                    │
│                          │   "Try narrowing to 15–65° to skip      │
│                          │    glass substrate halo (see chart      │
│                          │    around 22°). [Apply]"                │
│                          │                                         │
│                          │ ▸ Refine (locked until Phase done)      │
│                          │ ▸ Crystallite Size (optional)           │
├──────────────────────────┴─────────────────────────────────────────┤
│ Runs ▾   ⓘ 4 runs · latest succeeded 38s ago                       │
│  ☆ run-04  2θ 10–80, 3 phases   R_wp 7.3%  [Load] [Diff]           │
│    run-03  2θ 5–90, 3 phases    R_wp 9.1%  [Load] [Diff]           │
│    run-02  2θ 10–80, 2 phases   R_wp 12.8% [Load] [Diff]           │
└────────────────────────────────────────────────────────────────────┘
```

核心变化：
- **Pipeline Rail**（水平 stepper）：清晰告诉用户当前在哪、完成了什么。点任意步骤可以跳回重做。
- **右面板只显示当前步骤的参数**。其他步骤是折叠 link。一屏永远只有一件事要决策。
- **Agent 建议**内嵌在当前步骤面板里（不是浮在对话里）。用户决定 Apply 或忽略。
- **Runs 日志**在底部（取代原 ActionBar），显示该 artifact 上所有 run 的时间线，可以 Load 回任意一次的状态。

### 5.2 Compute Notebook 形态

Compute 从"单 code buffer + 单 stdout"改为 **cell 列表**：

```
┌────────────────────────────────────────────────────────────────────┐
│ Compute Notebook  · lattice-compute · 🟢 py 3.12 + lammps + cp2k   │
├────────────────────────────────────────────────────────────────────┤
│  [1] ▶  python  ─────────────────────────────   ✓ 2.1s             │
│     from pymatgen.core import Structure                            │
│     print(Structure.from_str(ACTIVE_CIFS...).formula)              │
│     ────────────────────────────                                   │
│     TiO2                                                            │
│                                                                    │
│  [2] ▶  python  ─────────────────────────────   ⚠ 5.0s timeout     │
│     # ASE optimize                                                 │
│     ...                                                            │
│     ────────────────────────────                                   │
│     [Figure 01]                                                    │
│                                                                    │
│  + Add cell  [ python | lammps | cp2k ]                            │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ ▸ Session Context  ▸ Saved Scripts  ▸ Snippets                     │
└────────────────────────────────────────────────────────────────────┘
```

每个 cell 是一次 run，stdout/stderr/figures 留在 cell 里；不会被下一次 run 覆盖。Export notebook 一键导出为 `.ipynb`。这一块的心智模型完全不同于仪器面板。

### 5.3 单一入口 + 持久侧栏视图

**统一入口**：ActivityBar 增加 4 个图标（XRD / XPS / Raman / Compute），每一个都像 Phase 3 的 Compute 那样走 "侧栏视图 + Editor artifact"模式：

- 点 XRD 图标 → Sidebar 切到 XRD 视图（展示：该 session 的所有 XRD artifacts 列表 + 拖入新 .xy 文件区 + 最近 snapshot）
- 点列表里的 artifact → EditorArea 聚焦对应 workbench
- 点 "+ New" → 创建空 workbench artifact

去掉 `ProLauncherMenu` 的全屏 Modal，入口统一为 ActivityBar。命令面板命令相应精简。

---

## 6. Agent × Workbench：交互协议

这是本次重设计**最重要的增量**。

### 6.1 新增一组 LocalTool

每个 spectrum workbench 暴露一组对称的 tool：

| Tool | 语义 | 返回 |
|------|------|------|
| `read_<kind>_state` | 读 workbench payload 概要（spectrum meta、当前参数、最近 run 结果） | JSON summary |
| `propose_<kind>_params` | 仅给"建议"，**不应用**。payload: `{twoThetaMin: 10, reason: "..."}` | written back 到 payload.agentSuggestion 字段 |
| `apply_<kind>_params` | 应用 params。**必须用户点 Confirm 才真改**（agent 只是请求） | pending flag |
| `run_<kind>_<stage>` | 触发某一步（detectPeaks / phaseSearch / refine）。同样等 Confirm | run id |
| `annotate_peak` | 在某个峰位添加文本批注 | 批注 id |

### 6.2 UI 里 Agent 的可见性

- 每一个 Pipeline Rail 步骤下方都有一条 **Agent Suggestion Strip**：若 agent 提出了该步骤的建议，这里显示黄/紫色小条："💡 Agent ▸ 2θ → 10–65° （理由…） [Apply] [Dismiss]"
- Composer 对话里每次 agent 发 `apply_*` / `run_*` tool call 都要求用户**在 Workbench 面板**上按 Confirm；**不能暗中改用户参数**（对齐 RESEARCH_SURVEY_PRODUCT_REPORT 里"过程可见、用户能介入"的原则）
- Agent 主动说："我已经看了 run-04，R_wp 7.3%, (110) 峰位偏 0.2°，建议加入 texture 参数再跑一遍 [Apply proposal]" —— 这整段既存在于 chat transcript 里，也反映在 workbench Pipeline Rail 的 Refine 步骤 Suggestion Strip 里

这条协议其实就是把 Workbench 升级为 **Agent 的具身行动界面**：当前 agent 是只嘴不手，以后是嘴手同步，且手的每一步用户都能看见。

---

## 7. 与现有 docs 的关系

| 现有文档 | 本报告与它的关系 |
|---------|-----------------|
| `MIGRATION_PLAN.md` §4.3 | 本报告是对 §4.3 "Pro Workbench (XRD/XPS/Raman/Compute)" 落地后的一次**方向修正**。移植完成了"从 pro.html 把面板挪到 React"，但没回答"面板该怎么组织"。 |
| `SELF_CONTAINED_PORT_PLAN_2026-04-13.md` | 它关注后端独立（不依赖 lattice-cli），本报告关注前端交互重构。两者正交。Phase A（compute 换容器模型）是 self-contained 目标，本报告的 Compute Notebook 是交互目标。 |
| `RESEARCH_SURVEY_PRODUCT_REPORT_2026-04-14.md` | 原则共通："过程可见、对话为核心"。本报告是它在 Pro Workbench 语境的延续 —— 把 agent 从 Composer 延伸到仪器面板。 |
| `AGENT_LLM_REDESIGN.md` / `CHAT_PANEL_REDESIGN.md` | Agent 协作协议（第 6 节）必须与其对齐。在 §6.1 定义的 tool 集要注册在 `AGENT_LLM_REDESIGN` 的 LocalTool registry 里。 |

---

## 8. 分阶段落地路线（建议）

每个 Phase 可独立合入，不锁定。顺序是**风险由低到高**。

### Phase 1 · 共享抽取 + 非破坏性重构（~5 天）

- 把 XRD / XPS / Raman 的 `Data Quality` section 抽成 `<SharedQualitySection>` 组件
- 把 spectrum chart 的 echarts option 构建逻辑统一到 `buildSpectrumChartOption`（已存在，核查重复调用）
- 把每个 workbench 拆成"头部 + 左区 + 右区 + 底部"四个子文件
- **产出**：单文件从 1428 → 6 个 200–300 行文件；外观零变化；为后续阶段打地基

### Phase 2 · Pipeline Rail（~1 周）

- 新增 `<PipelineRail>` 组件（水平 stepper + 当前步骤高亮）
- 每个 workbench 定义自己的 pipeline 步骤数组（XRD: quality → preprocess → peaks → phase → refine → crystallite → results）
- 右面板改为"只显示当前步骤的参数"模式，其他步骤折叠
- 加 Expert toggle：展开时显示所有 section（回退到旧版本行为，给老用户过渡）

### Phase 3 · Runs 日志（~1 周）

- `payload.runs: RunRecord[]`：每次 action 结果压入数组（类似 Compute Workbench 已有的 `runs` 字段，但给 spectrum workbench 也加）
- `<RunsDrawer>` 底部可展开/收起；Load 按钮能把 artifact 回滚到那次 run 的参数
- Diff 模式：两个 run 参数 + 结果 side-by-side

### Phase 4 · 入口统一（~3 天）

- ActivityBar 增 XRD / XPS / Raman 3 个图标（复用 Phase 3 的 SidebarView 模式）
- 分别建 XrdView / XpsView / RamanView（镜像 ComputeView）
- `ProLauncherMenu` 降级为命令面板入口，ActivityBar 不再指向它

### Phase 5 · Compute Notebook 形态（~2 周）

- `payload.cells: CellRecord[]` 取代单一 `code` buffer
- 编辑器 / 执行 / 输出 渲染切换到 Jupyter-style cell UI
- 保留 "Single File" toggle（旧体验回退）
- Export `.ipynb`

### Phase 6 · 对比模式（~1 周）

- `payload.spectrumComparison: ProWorkbenchSpectrum | null` 第二条数据
- Chart 自动双曲线；peak table 自动配对 Δ 列
- 仅 XRD / Raman / FTIR 启用（XPS 的能级对齐复杂，延后；Compute 不需要）

### Phase 7 · Agent Tool 集（~2 周）

- 定义 §6.1 表格里的 tool schema
- LocalTool registry 注册
- Agent Suggestion Strip 组件（挂在 Pipeline Rail 每一步）
- Confirm / Dismiss / Apply 状态机
- Composer 对话里每条 tool call 可视化

**总预算：~6–8 周**，单人半程 + review；Phase 1–3 已能显著改善体验，可以作为一个里程碑产出。

---

## 9. 风险与开放问题

### 9.1 设计风险

- **Pipeline Rail 的"步骤"粒度谁定**？XRD 是线性的 quality→peaks→phase，但 XPS 有回路（fit 结果差 → 回去改 charge correct）。需要允许"后退"步骤，视觉上不能变成一条死水管
- **Agent Suggestion 的时机**：何时 agent 应当主动建议？用户每改一个参数都发一次吗（噪音）？还是只在用户点 "Ask Agent" 时？推荐默认只在用户**完成一步后 + 结果异常**时主动建议
- **Runs 存多少**：单个 artifact 持 100 条 run 的 payload 可能膨胀到 MB 级；需要 "Pin" 机制 + "自动清理 30 天前未 pin"

### 9.2 技术风险

- **payload shape 大改**：XrdProPayload / XpsProPayload / RamanProPayload 都要加 `runs` + `pipeline` + `agentSuggestion`；现有 session 持久化里的旧 artifact 需要 migrate（类似 prefs-store v3→v4 的 pattern）
- **tool 幂等性**：`apply_xrd_params` 被 agent 连发两次会不会双写？需要请求级 idempotency key
- **Compute Cell UX 需要 CodeMirror 的多实例能力**：当前 ComputeProWorkbench 已用 CodeMirror，cell 数量上去后 DOM/性能要评估

### 9.3 产品开放问题

- **是否要把 XRD 的相库/CIF 上传纳入 Workbench**？还是走 Library 模块（跨 workbench 共享）？我倾向后者，Workbench 只是消费者
- **Snapshot 和 Run 的区别**？Snapshot 是用户手动 Pin 的 Run，可以导出成独立 artifact；Run 是自动产生的。名称要讲清楚
- **是否允许 2 个 XRD Workbench 之间 Drag 峰到对方做 "transfer peaks"**？属于高阶功能，Phase 7+
- **手机/平板是否要支持**？当前不支持；如果要，Pipeline Rail 的水平布局要降级为垂直 accordion

---

## 10. 成功指标（Phase 1–3 评估）

- **代码健康**：单文件最大 LoC ≤ 400；重复代码块 (`Data Quality` 等) ≤ 1 次定义
- **交互轮次**：用户从打开 XRD artifact 到看到 fit 结果的平均 click 数 **从 ≥ 6 降到 ≤ 3**（用 default pipeline 一键跑）
- **可理解性**：新用户首次使用能独立完成场景 A（拖文件→识别相→出结果）；调研 5 名实验室新生
- **Agent 参与度**：Phase 7 合入后，Pro Workbench 里 agent suggestion apply 率 ≥ 30%

---

## 附录 A · 现状数据

- Pro Workbench 四个文件合计 **4162 LoC**（XRD 1428 / XPS 1239 / Raman 586 / Compute 909）
- 共享层 `src/components/common/pro/*` 11 个文件 **~830 LoC**
- 入口：`ProLauncherMenu.tsx` 156 LoC，`pro-workbench.ts` 404 LoC
- 当前 ActivityBar 触发 workbench 的图标：Compute（已入侧栏）+ Zap（仍走 Modal）

## 附录 B · 与 lattice-cli pro.html 的关系

原 pro.html 已不在 lattice-cli 仓库（只有移植后的头注保留了行号引用 L1260–1986）。重设计不再以 pro.html 为事实来源 —— 它代表的是"网页 dashboard"心智模型，我们要的是"可观察分析工作流"心智模型。header 注释可以保留作为历史脚注，但**不应被未来决策反复引用**。

## 附录 C · 非目标

本报告**不**涉及：
- 后端（lattice-cli）算法改动
- 新增分析模块（除 Compute Notebook 外，不做 ML / 新仪器类型）
- 权限 / 多人协作（单人本地工具）
- 移动端适配

这些在各自的专项文档里处理。
