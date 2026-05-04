# 决策日志

---

### D-001 路线重选 (v2)
**日期**: 2026-04-28  
**决策**: 放弃 PAATU 方法学包装。改为实证评估 + benchmark 发布。  
**原因**: "Silent execution drift" 是旧概念换名，hash-injectivity 定理平凡，两轴治理框架本质是工程而非研究。原方案四个贡献互相稀释。  
**否决**: PAATU 路线 / 用户研究 / 形式化定理。

### D-002 目标期刊
**日期**: 2026-04-28  
**决策**: 主投 *Digital Discovery*。如果写成纯软件系统，保留 *SoftwareX* / software article 作为备选。  
**否决**: 把目标期刊建立在大规模反直觉实验结果上。

### D-003 领域覆盖
**日期**: 2026-04-28  
**决策**: 聚焦材料表征，计算化学/文献任务只作为辅助 workflow。  
**原因**: Lattice-app 的成熟优势在 XRD / XPS / Raman / spectroscopy workspace，不应为了“跨领域”增加 ground-truth 成本。

### D-004 资源确认
**日期**: 2026-04-28  
**决策**: API 经费、现有代码、demo 数据足够支撑小规模系统论文。  
**注意**: 公开 repo / supplementary 前必须移除任何硬编码 API key，并清理本地代理配置。

### D-005 精简方案 (v3)
**日期**: 2026-04-28  
**决策**: 曾计划 60 题 MatChar-Bench + 3 模型 + 540 trials。  
**复盘**: 这个方案比原路线轻，但仍然把主要精力压在 benchmark 建题、ground truth、统计和重跑上，没有最大化展示 Lattice-app 的系统优势。

### D-006 最省力系统论文路线 (v4)
**日期**: 2026-04-28  
**决策**: 从“大 benchmark 论文”改为“Lattice 系统论文 + 12 个 workflow 的小规模实证验证”。  
**核心理由**:
1. Lattice-app 的真正贡献是系统集成：agent orchestrator、tool catalog、Python worker、artifact workspace、approval gates、traceable scientific workflows。
2. 大 benchmark 会消耗大量时间在数据集构建和专家复核上，而系统论文只需要少量代表性任务证明工作流价值。
3. 小规模对照实验足以展示 tool-grounding、artifact reproducibility、unsupported-claim reduction 等系统价值。
4. 论文叙事更诚实：不声称新模型或 SOTA benchmark，而是展示一个可运行、可审计、可复现的 scientific agent workspace。

**新目标**:
- 12 个代表性任务
- 1 个主模型
- Lattice full agent vs same-model chat-only baseline
- 2 repeats
- 总计约 48 trials
- 6 周、约 70-80 小时完成

**否决**:
- 60 题 MatChar-Bench 作为首篇论文主线
- 3 模型全量 benchmark
- “首个材料+化学 agent benchmark” 这种容易被审稿人挑战的 claim
- 把 `xrd_refine` 写成 full Rietveld

### D-007 顶层叙事重心
**日期**: 2026-04-29  
**决策**: 论文的顶层叙事从“AI 直接发现新材料”转为“AI 辅助人类快速进行实验迭代”。  
**核心观点**: 材料发现的现实瓶颈通常不是 one-shot generation，而是多轮实验循环：synthesize / process -> characterize -> interpret -> decide next experiment。Lattice 的近端价值是把表征、文献、计算、历史结果和下一步决策组织进一个可审计 workflow，从而加快人类科学家的迭代速度。  
**含义**: Introduction 应先讲 experimental iteration bottleneck，再讲 Lattice 作为 human-in-the-loop accelerator；tool-grounding 和 artifact trace 是服务这个大叙事的机制，不是论文的最终目的。  
**否决**: 把 Lattice 包装成 autonomous discovery engine；把贡献写成“AI 独立发现新材料”。

### D-008 论文标题
**日期**: 2026-04-29  
**决策**: 首选标题确定为 *Lattice: A Tool-Grounded Agent Workspace for Materials Characterization*。  
**原因**: 直接点明系统（agent workspace）+ 机制（tool-grounded）+ 领域（materials characterization），不绑死叙事框架，给正文留余地展开 human-in-the-loop iteration 论述。原 v4 首选 *Accelerating Human Experimental Iteration with Tool-Grounded AI Workflows* 降为备选。

### D-009 顶层叙事调整 (v4.1)
**日期**: 2026-04-29  
**决策**: 顶层叙事从 "AI 辅助实验迭代闭环（characterize -> interpret -> decide next experiment）" 调整为 "降低材料谱图分析的专家门槛 + 加快从谱图到可解读结果的时间"。  
**核心理由**:
1. Lattice 实际能力是把 LLM agent + 谱图工具 + Python worker + artifact workspace 组合成可审计的解读环境，并不真的驱动"下一步实验决策"——旧叙事过度承诺。
2. 新叙事更诚实：谱图分析（peak detection、charge correction、profile fitting、library matching、reference 数据库交叉核对）需要相当深的领域经验，对学生、跨领域研究者、批量处理样品的研究者都是真实门槛；对专家本身则是时间成本。
3. 新叙事更容易在 12 题对照实验里量化：time-to-result、expertise required（proxy）、interpretation quality 比 "decision readiness" 更直接。
4. 标题（D-008）刻意保持通用，新叙事完全装得下，**不动标题**。

**含义**:
- Introduction 从 "experimental iteration loop" 开题改为 "materials spectrum analysis expertise barrier" 开题。
- C1 workspace 机制叙事兼容，仅首段定位句 + 末段收尾句微调。
- C2 四个 workflow 不动；将 "Next-step decision" 字段重命名为 "Practical use"。
- C3 评价指标用 interpretation quality + expertise required (proxy) + time-to-result 替换 decision readiness。

**否决**:
- 用 "lowering the difficulty" / "making analysis easy" 这类口语；写成 lowering the expertise barrier / making spectrum analysis approachable，听起来像 scientific software claim 而非简化路线。
- 把 Lattice 包装成"自动选下一步实验"的 agent；不主张这件事。

**取代**: D-007（顶层叙事重心）部分内容。D-007 保留作为路线演化记录。

---

## 待决

### Q-001 投稿类型
**问**: 最终写成 *Digital Discovery* 的 research/system article，还是偏 software article？  
**Deadline**: W2 末

### Q-002 主模型
**问**: 用 Claude / OpenAI 哪个 tool-capable 模型作为主模型？  
**原则**: 选当前 Lattice 配置最稳定、tool-calling 最少出问题的模型。  
**Deadline**: W2 开始跑实验前

### Q-003 Demo 数据
**问**: 12 个 workflow 用哪些公开谱图 / 已有 demo 数据？  
**原则**: 优先使用可再发布、可复现、ground truth 容易写清楚的数据。  
**Deadline**: W1 末
