# Lattice 桌面应用重构 — 设计目的 (Design Purpose)

> 版本: v0.1 | 日期: 2026-04-10
> 范围: 仅定义"每个功能为什么存在 / 为什么要改"——不含实现细节、组件 API、线框图
> 前置阅读: `docs/MIGRATION_PLAN.md`（功能清单与 lattice-cli 后端能力）

---

## 0. 一句话方向

保留 VSCode 式外壳的熟悉感，但把 **Chat 升级为驱动整个工作流的 Agent Composer**，把分析结果改造为**由对话生成的 Artifact**，以 **Session / Experiment 为组织单位**，Pro 参数交由 Agent 推断并收进可选的 **Parameters 抽屉**。

方向选型：**Cursor-lead 改良**。Manus 风格的纯 Chat + Artifact 两栏布局被评估为过于激进——VSCode 老用户不适应、布局层需要完整重写、学习成本陡峭。

---

## 1. 核心设计原则

### P1. 意图优先，工具靠后
用户用自然语言表达目标（"帮我判断这段 XRD 有没有 TiO₂ 锐钛矿相"），Agent 负责拆解 → 调工具 → 产出结果。工具按钮不再是主入口，而是给专家的"逃生门"。

### P2. 过程透明，不是黑盒
Agent 的计划、调用的每个工具、中间产物都必须可见、可点开、可回滚。研究者必须能审查"它为什么得出这个结论"——信任源自可追溯性。

### P3. 结果是"物"，不是"视图"
光谱图、峰表、拟合报告不再是永远在那的静态面板，而是由对话生成、可并存、可比较、可导出的 **Artifact**。同一个 Session 允许多份 artifact 并存（如两种算法的拟合结果同时比较）。

### P4. 以 Session 为单位重现研究过程
组织单位不再是"文件"，而是"实验/会话"。每个 Session = 输入文件 + 对话 + artifacts + 参数快照，可保存、可恢复、可分享——科研工作流的最小可复现单元。

### P5. 默认极简，专家有出口
Pro 模式 50+ 参数默认不暴露，Agent 从上下文推断；专家用户从任一 artifact 右上角齿轮进入 **Parameters 抽屉**手动覆盖。新手零门槛，高手有深度。

---

## 2. Shell 与导航层

### 2.1 ActivityBar
- **当前目的**: 左侧图标条，切换 9 种视图（Explorer / Search / Analysis / Settings / Library / Knowledge / Compute / Structure / Jobs）+ Chat 开关。
- **痛点**: 把文件操作、专业模块、Chat 开关混为一谈、暗示等权重；Chat 只是"开关项之一"而不是主角。
- **新目的**: 成为 **Session 与 Agent 可见性的锚**。主入口是 Session 切换 / 新建；专业模块下沉为次级；Chat 不再是开关而是常驻。

### 2.2 Sidebar
- **当前目的**: 依赖 activeView 渲染文件树、搜索、分析 FSM 或设置。
- **痛点**: 文件树假设多文件编辑工作流，与"单实验流"的科研现实不符；FSM 是固定流水线，无法表达"回炉重做"。
- **新目的**: 仅承载**当前 Session 上下文**——元数据、已加载数据、已生成 artifact 列表、相关历史 session。默认折叠，只在用户明确需要时打开。

### 2.3 EditorArea
- **当前目的**: 带 9 个 tab 的编辑区，混合渲染 Spectrum/Peaks 与重量模块（Library/Compute/Structure/Jobs）。
- **痛点**: 把"轻量视图"和"重量模块"塞进同一组 tab；tab 模型暗示频繁上下文切换，但科研是一次一个实验。
- **新目的**: 成为**当前 Session 的 Artifact 画布**。不再是预制 tab，而是由对话动态产生的 artifact 卡片组；轻量（Spectrum/Peak）与重量（Structure/Compute）拉齐为同一种"artifact"，只是类型不同。

### 2.4 BottomPanel
- **当前目的**: Output / Tools / Problems 三 tab 的开发者风格底部面板，Ctrl+J 开关。
- **痛点**: 把工具调用日志、错误暴露给研究者——典型开发者心智残留；研究者不关心 agent 内部栈。
- **新目的**: **移除**。工具调用的可见性由 Chat 中的 Task Timeline 承担，致命错误用 toast 浮出。保留一个隐藏的 debug 视图留给开发模式即可。

### 2.5 StatusBar
- **当前目的**: 显示后端状态、model、token 用量、当前文件类型、面板开关。
- **痛点**: turn_count、token_usage 是开发者指标；detected_type 反映"文件心智"。
- **新目的**: 极简底栏，只显示：当前 Session 名、Agent 模型、连接状态（🟢/🔴）、一个快速动作位（导出当前 session）。开发指标移到 Settings 或只在 debug 模式出现。

### 2.6 CommandPalette
- **当前目的**: Ctrl+Shift+P，7 个全局命令，混合 UI 开关与数据操作。
- **痛点**: 仍是 VSCode 复刻；没有领域命令，Session 切换、Agent 快捷操作都缺失。
- **新目的**: 升级为**领域命令执行器 + Session 快速切换器**。内容以"自动检测峰位""拟合 Lorentzian""与数据库比对""生成报告"这类动词为主；UI 开关类命令降级。

### 2.7 DragOverlay
- **当前目的**: 全屏拖放遮罩；drop 时加载一个光谱文件。
- **痛点**: 机制可用，但语义是"全局文件加载"，与 Session 心智脱节。
- **新目的**: 语义改为"把文件注入当前 Session"。drop 之后不是静默加载，而是触发 Agent 自动分析管线（检测类型 → 给出初步 artifact）。

### 2.8 SettingsPanel
- **当前目的**: 后端 URL、AI model、auto-approve、主题、快捷键、About。
- **痛点**: 把开发配置与用户偏好混在一起；缺少 Pro 参数默认值管理。
- **新目的**: 收敛为"用户偏好"—— Agent 模型选择、主题、参数预设（Fast Analysis / High-Resolution 等命名预设）。后端 URL 等开发配置移到隐藏的高级区。

### 2.9 AnalysisPanel（FSM 阶段指示器）
- **当前目的**: 7 阶段 FSM（Idle → Report Generated）+ 4 个快捷动作按钮。
- **痛点**: 固定阶段与真实 Agent 工作流无关；按钮是 mock、未接后端；线性流水线无法表达"回头重做"。
- **新目的**: **移除**。它的职责完全由 Chat 中的 Task Timeline 承担（更真实、更可交互）。如需"session 总览"，下沉为 Sidebar 中的 Session 卡片。

### 2.10 LazyPanel / SplitPane（工具组件）
- **新目的**: LazyPanel 保留，语义更名为"Artifact Loading"。SplitPane 目前未使用，只在"多 artifact 并列比较"时重新引入。

---

## 3. Chat / Agent 交互层（本次重构的核心引擎）

### 3.1 Agent Composer 输入（新概念，替代当前 ChatPanel 的输入框）
- **新目的**: 研究者的意图入口。接受自然语言意图，由 Agent 构造计划 → 拆解工具 → 流式产出每一步的推理、工具输入输出、artifact 引用。Chat 从"对话框"升级为"Agent 决定了什么、为什么决定"的账本。

### 3.2 Task Timeline（新概念）
- **新目的**: 在 Chat 顶部或侧边呈现当前任务的阶段条（Plan → Tool1 → Tool2 → Summarize）。每一步可点开看 reasoning、可回滚、可重跑；显示 elapsed、当前工具、剩余步数。这是"过程透明"原则的主要载体，也吸收了当前 AnalysisPanel + BottomPanel 的所有合理职能。

### 3.3 Tool Call 卡片
- **当前目的**: 显示工具名 + 状态 + 自由文本摘要（inputSummary / outputSummary）。
- **痛点**: 摘要是自由文本，与实际 artifact 没有结构化绑定——无法"从 chat 里点到那张图"。
- **新目的**: 每个 tool 卡片是 Timeline 中的一个检查点，必须携带它产生的 **artifact 引用 ID**；点击即在画布中聚焦该 artifact。状态细分为 planned / running / succeeded / failed / skipped。

### 3.4 消息流中的 Artifact 引用（新概念）
- **新目的**: 当 Agent 生成 artifact 时，对应消息里嵌入"artifact 徽章"（类型 + 标题 + 缩略图），点击在画布打开或聚焦。artifact 可反向追溯到产生它的那句话 + 那次工具调用。

### 3.5 Session 状态容器（新概念）
- **当前目的**: 全局 Zustand store，无 session 概念，状态是"最后一次操作的快照"。
- **新目的**: Session 作为一等存储单元，内含：对话（含 reasoning / tool call）、加载的文件、所有 artifact、参数快照、元数据（开始时间、标题、标签）。可列出、可恢复、可分享、可重跑。

### 3.6 连接状态与离线降级
- **当前目的**: 红绿点 + 离线时用静态 demo 兜底。
- **痛点**: 离线 demo 并不能让 Agent 工作，反而误导用户以为"离线可用"。
- **新目的**: 断线时暂停当前 Task Timeline 并显示"Agent 已暂停 — 重试 / 保存 session"；冷启动无后端时引导"打开已保存的 session"而不是 demo。

### 3.7 Agent 流式传输（意图层，非实现）
- **当前目的**: WebSocket 事件只有 chat_message / spectrum_update / peaks_update 等粗粒度事件。
- **新目的**: 后端需要向前端推送"Agent 执行的每一步"的结构化事件——覆盖计划、reasoning、工具调用、工具结果、artifact 创建、任务完成。前端据此驱动 Task Timeline 与 artifact 画布。具体事件名与 schema 留到实施阶段设计。

---

## 4. 光谱分析核心

### 4.1 SpectrumChart
- **当前目的**: 永远在的静态图表，显示全局 spectrumData。
- **痛点**: 单例图表无法呈现"同一段光谱的两种处理方式"；比较需要手动切换覆盖，破坏心智。
- **新目的**: 从"视图"降级为一种 **Artifact 类型**，按需实例化。原始、平滑版、基线扣除版各自是独立 spectrum-artifact，可叠加、可并列。携带源文件引用 + 处理链元数据，让 Agent 可在后续引用"第 2 步平滑后的那份"。

### 4.2 PeakTable
- **当前目的**: 只读的峰位表格，绑定全局 peaks 数组。
- **痛点**: 单例、无历史；研究者无法"保留算法 A 的峰位结果同时再跑算法 B"。
- **新目的**: 作为 **Peak-Fit Artifact** 的一部分而非独立面板。每次拟合/检测结果是一个 artifact（图 + 表 + 元数据），多份可并存、可比较。表格支持内联编辑某个峰并把编辑作为下一次 Agent 调用的约束。

### 4.3 PeakEditor（点击增删峰位）
- **当前目的**: 直接修改全局 peaks，作为手工真值输入。
- **痛点**: 操作全局状态、会覆盖之前的结果；没有"这次只想给 Agent 一组约束"的机制。
- **新目的**: **保留**，但语义改为"artifact 内的局部标注"。用户在某个 peak-fit artifact 上添加锚点后，作为"约束重跑"的输入提交给 Agent（"以 22.1°/45.3° 为初始峰位重拟合"），而不是直接改结果。点击式交互是专家的细调入口，不是主工作流。

### 4.4 Spectrum Artifact（新概念）
- **新目的**: 一等对象：源文件引用 + x/y 数据 + 标签 + 处理链（如 "median-filter w=5, shirley baseline"）。是后续一切 artifact 的输入来源。

### 4.5 Peak-Fit Artifact（新概念）
- **新目的**: Agent 工具调用（如 `fit_peaks`）的产物。打包：拟合图、峰表、模型参数、残差、χ²、算法名。同一 Session 可多份并存，用于 A/B 比较。支持"编辑" → 触发局部 PeakEditor → "带约束重拟合"。

### 4.6 多 Artifact 比较 / 叠加（新能力）
- **新目的**: Session 画布支持将两个 artifact 固定并排、或把它们的曲线叠加到同一坐标（显示/隐藏通道）。用于比较两种算法结果、比较预处理前后。这是 Session 模型自然解锁的能力。

### 4.7 Analysis FSM
- **决定**: 移除（见 2.9）。工作流流畅性由对话驱动，不由 UI 状态机规定。

---

## 5. Pro 模式与领域模块

### 5.1 Pro Toolbar（detect peaks / smooth / baseline / undo / quality）
- **当前目的**: 当 editor 显示 spectrum 时的一排功能按钮。
- **痛点**: 暴露低层操作；研究者说的是"去噪""找化学变化"而不是"3 点 Savitzky-Golay"。
- **新目的**: 降级到 **Parameters 抽屉内的操作组**。Agent 从上下文推断最优处理链；工具栏按钮降级为"对这个 artifact 手动再加一步"的次级入口。

### 5.2 XRD 领域（数据库搜索 + CIF 上传 + Rietveld 精修）
- **当前目的**: 三块独立面板。
- **痛点**: 三步串联的工作被拆成三个独立 UI，研究者必须理解工具链顺序。
- **新目的**: 成为 **XRD Analysis Artifact 类型**。用户说"识别相" → Agent 跑数据库搜索 → 产出含候选相、置信度、候选 CIF 的 artifact；参数抽屉里可调搜索范围、精修方法、约束。数据库搜索、精修退化为 Agent 工具，不再是 tab。

### 5.3 XPS 领域（峰拟合 + 定量 + 荷电校正 + BE 查库）
- **当前目的**: 四个独立工作流。
- **痛点**: 拟合、定量、校正天生互相依赖，拆成独立面板破坏专家直觉。
- **新目的**: 成为 **XPS Analysis Artifact 类型**。Agent 编排：自动拟合 → 验证峰 → 元素定量 → C1s 校正 → 生成含置信带的报告。用户说出目标（"测 Fe 价态分布"），artifact 自动完成。抽屉暴露拟合模型（Shirley/Linear）、峰位规则、置信阈值。

### 5.4 Raman 领域（RRUF 匹配 + 参考谱叠加）
- **当前目的**: 搜索与叠加是两个独立动作。
- **痛点**: 两步本应原子化。
- **新目的**: 成为 **Raman ID Artifact 类型**（或并入通用比较工具）。Agent 自动查库 → 给出 Top-N 匹配 → 一次性叠加在 artifact 里。矿物提示作为可选上下文而不是 UI 输入字段。

### 5.5 Library 模块（样品/文献库）
- **当前目的**: 占位；目标为 DOI 导入、全文检索、PDF 预览、批注。
- **痛点**: 独立 tab 让文献与分析脱节；文献应当在分析过程中*原地*浮出。
- **新目的**: 降级为 **Agent RAG 工具 + Artifact 内的关联卡片**。不再是一级 tab，而是 artifact 侧边可展开的"相关文献"。导入通过 chat 命令 `/import doi:...`。完整阅读/批注作为从 artifact 上下文打开的模态/抽屉。

### 5.6 Knowledge 模块（知识图谱 / 物性对比）
- **当前目的**: 占位；目标是知识图谱、材料物性对比、热图。
- **痛点**: 独立 tab 暗示"逛图谱"，但研究者其实想让知识注入 Agent 决策，而不是自己浏览。
- **新目的**: **移除 tab**。抽取和对比成为 Agent 工具；图谱只在 artifact 内可视化（如"材料空间地图" artifact）。探索式场景下从 chat 弹出模态。

### 5.7 Compute 模块（Python 脚本 + 输出 + 图库）
- **当前目的**: 占位；类 IDE 面板。
- **痛点**: "Compute tab" 暗示独立 IDE，但 compute 实际上是 Agent 需要时调用的**服务**，不是日常导航目的地。
- **新目的**: 成为 **Compute Artifact 类型**。Agent 需要跑自定义 Python 时生成一份 Compute artifact（代码 + 输出 + 图），用户可在 artifact 内编辑并重跑。无独立 tab。

### 5.8 Structure 模块（3D 结构可视化 + 结构变换）
- **当前目的**: 占位；3Dmol 预留、结构变换（supercell/doping/surface/defect）。
- **痛点**: 独立 tab 暗示结构建模是顶层工作流，但它大多是分析过程中触发的（如"做 5% Fe 掺杂对比 XRD"）。
- **新目的**: 成为 **Structure Artifact 类型**。Agent 在对话中生成/变换结构；3D 视图在 artifact 内；变换（超胞、掺杂、表面）是 Agent 工具而非工具栏按钮。

### 5.9 Jobs / Sim 模块（长任务队列）
- **当前目的**: 作业队列、状态、ETA、收敛曲线、取消。
- **痛点**: 独立列表需要手动轮询；应当嵌在工作流上下文中。
- **新目的**: **移除一级 tab**。每次 Agent 提交长任务时生成一个 **Job Monitor Artifact**（状态、进度、日志、收敛图）。历史作业浏览通过 Sidebar 的 Session/Jobs 历史抽屉。

### 5.10 Batch / Explorer / Export / Research
- **Batch**: 保留为一种 **Batch Workflow Artifact**——用户给目录，Agent 并行处理，artifact 汇总结果，支持 JSONL 导出。
- **Explorer**: 作为 **ActivityBar 的次级入口保留**，仅当用户真的要手动浏览文件（最低频场景）。
- **Export**: **移除 tab**。导出是每个 artifact 右键/右上角菜单的动作（CSV / PDF / LaTeX）。
- **Research**: 降级为 **Agent 模式**，通过 `/research <topic>` 触发；结果是一个结构化的 **Research Report Artifact**（含章节、引用、大纲）。

### 5.11 Pro 参数（50+ 跨域参数，横切关注点）
- **痛点**: 一次性暴露全部参数只会让研究者瘫痪；大部分应由 Agent 推断。
- **新目的**: **默认全部隐藏**。每个 artifact 右上角齿轮打开 **Parameters 抽屉**，只显示与该 artifact *相关*的 8–12 个参数，带 Agent 推断出的默认值。专家可覆盖。参数预设管理器（"Fast Analysis" / "High-Resolution XPS"）存为用户偏好。

---

## 6. 新引入的核心抽象

| 抽象 | 是什么 | 为什么 |
|------|------|------|
| **Session / Experiment** | 文件 + 对话 + artifacts + 参数快照的一次完整研究 | 科研可复现最小单元；替代"文件"作为组织单位 |
| **Artifact** | 由 Agent 工具调用产生的一等对象（图/表/报告/结构/代码/作业/文献报告） | 让结果可保留、可对比、可导出、可被引用，而不是即时渲染即丢 |
| **Task Timeline** | 当前任务的分步执行视图（计划 → 工具调用 → 产物） | Agent 过程透明化的唯一入口 |
| **Parameters Drawer** | 从 artifact 打开的参数面板 | 专家逃生门，默认零门槛 |

---

## 7. 被移除 / 降级的旧概念

| 旧概念 | 去向 | 理由 |
|------|------|------|
| BottomPanel | 移除；功能并入 Task Timeline + toast | 开发者心智，不适合目标用户 |
| AnalysisPanel FSM | 移除 | 线性流水线表达不了真实工作流；Task Timeline 替代 |
| Library / Knowledge / Compute / Jobs / Export / Batch / Research 作为一级 tab | 全部降级为 Artifact 类型或 Agent 工具 | tab 爆炸与"意图优先"原则冲突 |
| Pro Toolbar 作为常驻 | 降级为 Parameters 抽屉内的操作 | 低层操作不该是默认入口 |
| 文件树作为主导航 | 降级为 Sidebar 次级抽屉 | 文件心智 ≠ 实验心智 |
| 离线 demo 兜底 | 改为"打开已保存 session" | demo 误导"Agent 可离线工作" |
| 全局 spectrumData / peaks 单例 | Artifact 模型替代 | 无法表达并存与比较 |

---

## 8. 下一步（不在本文档范围内）

1. 基于以上目的产出**信息架构图**（Session / Artifact / Agent / Tool Call 的关系）
2. **低保真线框图**（关键屏：空 Session / 运行中任务 / 多 artifact 比较 / Parameters 抽屉）
3. **组件树 + 状态机**设计
4. **Agent 流式协议 schema**（需与后端 lattice-cli 对齐）
5. **分阶段编码计划**（MVP 建议优先打通 Agent Composer + Spectrum Artifact + Task Timeline 的闭环）
