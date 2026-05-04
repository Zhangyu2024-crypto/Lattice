# 论文方案 (v4)

## 标题方向

首选：

> **Lattice: A Tool-Grounded Agent Workspace for Materials Characterization**

备选：
- *Lattice: Accelerating Human Experimental Iteration with Tool-Grounded AI Workflows*
- *From Autonomous Discovery to AI-Assisted Experimental Iteration in Materials Characterization*
- *Tool-Grounded LLM Agents for Materials Characterization in an Auditable Workspace*
- *From Chat to Scientific Workflow: An Agent Workspace for XRD, XPS, Raman, and Literature-Grounded Analysis*
- *Lattice: Integrating Scientific Tools, Artifacts, and LLM Agents for Reproducible Materials Analysis*

---

## 核心叙事

材料表征里 XRD / XPS / Raman 谱图分析的真实瓶颈不在”是否有结论”，而在**形成可信结论的门槛和速度**：

- 峰检测、background / charge correction、profile fitting、library matching、reference 数据库交叉核对——每一步都需要相当深的领域经验和具体软件操作。
- 学生、跨领域研究者、刚接触某个表征手段的人，常被卡在专家约定（charge reference、constraint 选择、approximate vs Rietveld 区分）和工具链拼接上。
- 即便对有经验的研究者，处理批量样品时也仍然慢——多个工具、多个脚本、多份截图，最后人工拼成一份能写进报告的解读。

LLM 是诱人的解，但 plain chat 在这件事上特别危险：可以流畅地输出 2θ 位置、binding energies、stoichiometric ratios，却没有工具证据、没有可复现 artifact、没有审计轨迹——错误的数值和正确的数值看起来一模一样。

Lattice 的定位由此而来：

> Lattice 是一个 tool-grounded scientific agent workspace，专为**降低材料谱图分析的专家门槛、加快从谱图到可解读结果的时间**而设计。它把 LLM agent、XRD / XPS / Raman 工具、Python scientific worker、文献检索 / RAG、artifact workspace 和 approval gates 组合在同一个可审计循环里：用户用自然语言描述问题，agent 调用合适的工具，产出可追溯的 typed artifact，把可由用户审阅 / 编辑的中间结果留下来。

这条叙事比旧的 “human-in-the-loop iteration accelerator” 更紧、更诚实——它就是 Lattice 实际在做的事情；同时它直接利用现有 app，而不需要额外发明一个大 benchmark。

---

## 三个贡献

### C1 — A tool-grounded workspace that lowers the spectrum-analysis expertise barrier

Lattice 不是单个分析脚本，也不是 autonomous discovery engine，而是把 spectrum analysis 所需的工具链、artifact、approval、trace 统一组织进一个本地桌面 workspace：
- Agent orchestrator: 多轮 tool-calling loop、loop detection、abort、permission mode
- Tool catalog: XRD / XPS / Raman / compute / literature / workspace tools
- Python worker: repo-local JSON-RPC scientific tools
- Artifact workspace: 谱图、结构、compute、paper、report 等输出以 typed artifact 形式保存、跨 session 持久化
- Approval gates: 高风险工具、可编辑输出、人工确认

论文要强调：贡献在 workspace 把专家级谱图分析变得对非专家可达、对专家更快，不是新模型，也不是全自动发现材料。

> 正文 draft 见 `07-c1-section.md`。

### C2 — Tool-grounded characterization workflows that shorten time-to-interpretation

用 4 类 workflow 展示 Lattice-app 把谱图分析从碎片化操作压成单一可审计路径：
1. XRD: spectrum import -> peak detection -> phase search -> approximate whole-pattern fit -> plot artifact
2. XPS: charge correction -> peak fitting -> element validation / quantification -> reviewed components
3. Raman: peak detection -> database matching -> ranked candidate interpretation
4. Literature / compute assisted analysis: literature search / paper RAG / compute artifact -> grounded interpretation

每个 workflow 展示：
- agent 调用了哪些工具
- 产生了哪些 artifact
- 哪些中间结果可以人工检查
- 最终回答如何回链到工具证据，并形成可信的 interpretation 直接交付（reportable, cross-checkable, ready for downstream use）

### C3 — Small but hard evidence: Lattice vs chat-only

不做大 benchmark。做一个 12 题小规模 evaluation：
- 同一个模型
- Lattice full agent vs chat-only baseline
- 2 repeats
- 约 48 trials

核心指标不追求 SOTA，而是证明系统对 spectrum analysis 的两个具体好处：**降低专家门槛 + 加快产出**：
- tool-grounded answer rate
- unsupported numeric claims
- reproducible artifact produced
- final-answer correctness
- interpretation quality（rubric 给分；衡量结论是否可直接进入下游使用）
- expertise required（用 human intervention / edit count 作 proxy）
- time-to-result

---

## 不做的 claim

为了省力和避免审稿风险，论文不声称：
- Lattice 提出了新 LLM 模型
- Lattice 是首个所有材料/化学 agent benchmark
- Lattice 能全自动发现新材料
- Lattice 自动决定下一步实验
- `xrd_refine` 是 full Rietveld
- 小规模 12 题实验能代表所有科学任务
- 工具结果永远正确

更稳的写法：

> Rather than treating AI as an autonomous discoverer of new materials, we present Lattice as a tool-grounded workspace that lowers the expertise barrier and shortens the time-to-interpretable-result in materials spectrum analysis: grounding spectrum interpretations in tools and literature, preserving inspectable intermediate artifacts, and surfacing reviewable evidence at every step.

---

## 论文大纲（约 5500-7000 字）

> v4.1 增补：在原 7 节结构上插入 Section 2 (Related work)；System Design 增 3.0 (defensible interpretation 定义 + scope statement)；Compact Evaluation 增 5.5 (reproducibility statement)；Discussion 拆为 7.1 threat model / 7.2 limitations / 7.3 implications。详 `00-decision-log.md` D-009。

### 1. Introduction (700-900 字)
- 材料表征里 XRD / XPS / Raman 谱图分析是把测量变成证据的关键步骤，但需要相当深的领域经验：peak detection、background / charge correction、profile fitting、library matching、reference DB 交叉核对
- 这一专家门槛对学生、跨领域研究者、批量处理样品的研究者都是真实瓶颈；对专家本身则是时间瓶颈
- 当前 AI-for-materials 路线多瞄准 autonomous discovery，但更直接、更通用的近端价值是降低 spectrum analysis 的专家门槛、缩短 time-to-interpretable-result
- Plain LLM chat 看似能帮，却缺 tool evidence、artifact memory 和 audit trail——错误数值和正确数值看起来一样，会污染报告和下游决策
- 当前科学软件碎片化进一步放大问题；加一个 LLM 不会自动解决
- Lattice 的核心想法：agent + tools + artifacts + audit trail in one workspace，专门服务"让谱图分析更可达、更快"
- 贡献概述：系统架构、代表性 workflow、小规模对照评估

推荐 introduction opening (v3)：

> In materials characterization, spectrum analysis is the step that turns a measurement into evidence. An XRD pattern becomes a phase identification only after peak finding, indexing against reference databases, and profile fitting. An XPS survey becomes a chemical-state assignment only after charge correction, peak deconvolution, and quantification. These are executable procedures with substantial community convention behind them — easy to read about, hard to apply correctly the first time. The result is an expertise barrier that is real for working researchers and steeper for everyone else.

### 2. Related work and positioning (400-600 字)
> v4.1 新增。把 Lattice 放进四条线，每条 80–150 字带 2–3 个引用，避免审稿人问"和 X 什么差别"：
- **Agentic AI for science**：Coscientist / ChemCrow / A-Lab 瞄准 autonomous discovery；Lattice 不是——它瞄准 spectrum-analysis 的专家门槛和时间成本
- **Domain spectrum analysis software**：GSAS-II / BGMN / CasaXPS / RRUFF 是单点专业工具，门槛高、彼此不通；Lattice 用 LLM agent 把它们串成一条可审计路径
- **Tool-augmented LLMs**：ReAct / Toolformer / LangChain 提供通用 tool-calling 范式；Lattice 把 typed artifact + approval gate + 跨 session 持久化加进去，针对 spectrum analysis 场景
- **Reproducible scientific workflows**：Donoho / Stodden 等强调 provenance；Lattice 通过 tool-step + artifact DAG 把 provenance 做成 first-class，而不是脚注

### 3. System Design (1300-1600 字)

#### 3.0 Defensible spectrum interpretation: scope and definition (200 字)
> v4.1 新增。显式定义贯穿全文的核心概念，避免 claim 浮空。

> A *defensible spectrum interpretation* is one in which (a) every quantitative claim is produced by a registered tool whose call is recorded, (b) intermediate state and assumptions are stored as inspectable artifacts, (c) uncertainty and out-of-scope statements are explicit, and (d) any consequential step (e.g., editable peak fit, host-side compute) carries a logged human approval or edit. We use this definition to anchor the rubric (Section 5), the blind-review protocol, and the interpretation-quality metric.

紧跟一个 **scope statement**：

> Throughout this paper, "materials spectrum analysis" refers specifically to powder XRD, XPS, Raman, and literature-grounded interpretation of these. We do not evaluate TEM, SEM, NMR, EDS, single-crystal diffraction, or synchrotron techniques.

#### 3.1 – 3.5 系统子节
- 3.1 Agent orchestrator and tool-calling loop
- 3.2 Scientific tool catalog and Python worker
- 3.3 Artifact-centered workspace
- 3.4 Approval gates and permission modes
- 3.5 Traceability and reproducibility

正文 draft 见 `06-system-design.md`（中文长稿，待压成英文）和 `07-c1-section.md`（英文成稿）。

### 4. Materials-Characterization Workflows (1000-1200 字)
用 4 个 workflow 说明系统如何被使用：
- W1 XRD phase identification + approximate whole-pattern fit
- W2 XPS charge correction + peak deconvolution
- W3 Raman database identification
- W4 Literature / compute grounded interpretation

每个 workflow 给出输入、tool path、artifact output、review point、final answer 与 trace anchor。详细方案见 `08-c2-plan.md`。

### 5. Compact Evaluation (1000-1200 字)
- 12 个任务
- 2 条件：Lattice agent vs chat-only
- 1 个主模型，2 repeats，48 trials
- v4.1 补充实验：3 manual baseline / 12 expert blind review / 4 cross-domain operator trials（详 `03-experiment-design.md` "v4.1 补充实验"节）
- 指标定义：tool-grounded rate / unsupported claims / artifact reproducibility / correctness / interpretation quality / expertise required (proxied) / time-to-result
- 评分方式：人工 rubric（pre-registered 在 supplementary）+ artifact/trace audit + 1 名外部专家盲评 12 trials

#### 5.5 Reproducibility statement (100-150 字)
> v4.1 新增。Methods 末尾必须显式声明：

> Model and version (provider/model-id/date), Lattice commit hash used for evaluation, demo data sources and licenses, full tool-step JSON dumps and screenshots in `paper/supplementary/c2/`, blind-review protocol and unblinded mapping, and step-by-step reproduction instructions for each of the 48 + 7 supplementary trials.

### 6. Results and Case Studies (1200-1500 字)
建议结果结构：
- 6.1 Overall comparison: correctness / unsupported claims / artifact completeness / time-to-result（含 manual baseline 锚点）
- 6.2 Workflow trace examples
- 6.3 Three case studies:
  - 成功案例：XRD 或 XPS 多步工具链如何让一个非专家用户产出可信解读
  - 防错案例：工具低置信度，agent 没有强行下结论
  - baseline 失败案例：chat-only 编造数值或相名

### 7. Discussion (800-1100 字)

#### 7.1 Threat model and failure modes (300 字)
> v4.1 新增。显式列举失败类型 + workspace 是否能暴露，每类至少给 1 个真实 trial 例子：
- T1 工具失败（DB miss / fit 不收敛）→ Lattice 显式 flag，chat-only 无感
- T2 LLM 选错工具 / 错参数 → Lattice tool-step 可定位，chat-only 不可见
- T3 Silent wrong answer：工具跑了但被 LLM 错误综述 → 新叙事下最危险类型；artifact 存原始数值 + rubric 反查作为 mitigation
- T4 Refusal / 中断 → 偶发，可恢复
- T5 Loop / 重复 tool 调用 → loop detector 截断

#### 7.2 Limitations (250 字)
> v4.1 新增。集中列出，避免分散：
- `xrd_refine` 是 approximate whole-pattern fit，不是 full Rietveld
- 数据库 (MP / Scofield / RRUFF) 是 bundled snapshot，不会自动更新
- 单模态独立分析，不联合 refinement
- 当前没有 GPU compute 路径
- 没有多人协作 / 实时同步
- 模型可能在低 SNR 数据上误读工具结果
- 12 题 + 4 模态，不能代表全部材料表征

#### 7.3 Implications and future work (250-400 字)
- Lattice 的价值：把谱图分析的专家门槛部分吸收进 workspace，让非专家可达、专家更快
- 为什么 artifact workspace 对科学 agent 重要
- 下一步：更大 benchmark、更多模态（TEM / NMR）、replayable traces；以及把当前的 "interpretation accelerator" 扩到 experimental iteration loop

### 8. Conclusion (200 字)
简洁收束：Lattice 提供了一个可运行的系统路径，使 AI 更现实地服务材料表征：不是替代人类科学家直接发现材料，而是把谱图分析的专家门槛吸收进 workspace，使可信解读对非专家更可达、对专家更快。

---

## Figures

| # | 内容 | 作用 |
|---|---|---|
| Fig 1 | Lattice architecture: UI, orchestrator, tool catalog, Python worker, artifacts, LLM proxy | 第一眼展示系统贡献 |
| Fig 2 | Agent workflow lifecycle: prompt -> tool calls -> tool results -> artifacts -> final answer | 展示 tool-grounded loop |
| Fig 3 | XRD/XPS/Raman workflow screenshots or panels | 展示 app 真实能力 |
| Fig 4 | Compact evaluation results: Lattice vs chat-only | 给审稿人硬证据 |
| Fig 5 | Case-study trace: where tool evidence prevents unsupported claim | 展示 auditability |

## Tables

| # | 内容 |
|---|---|
| Table 1 | Lattice components and their roles |
| Table 2 | 12 workflow tasks, expected tools, scoring criteria |
| Table 3 | Evaluation metrics by condition |

---

## 写作原则

- 论文卖点是系统闭环，不是模型能力。
- 少造术语，多用具体 workflow。
- 截图和 trace 要比抽象框架更重要。
- 所有 claim 都落到 Lattice-app 现有功能：orchestrator、tools、artifacts、approval、trace。
- 结果不需要惊天动地，只要证明 chat-only 缺 evidence，而 Lattice 能产生可审计 artifact。
