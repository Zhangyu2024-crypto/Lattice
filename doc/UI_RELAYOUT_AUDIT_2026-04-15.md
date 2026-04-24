# Lattice UI 重编排排查报告

日期：2026-04-15  
作者：Codex  
范围：桌面端整体 UI 信息架构、页面组织、交互层级、视觉一致性  
结论类型：排查报告，不含本轮代码重构实施

## 1. 结论摘要

当前 UI 的主要问题不是“某个页面不好看”，而是**产品心智已经切到 Agent + Session + Artifact 的科研工作台**，但外层壳和若干关键入口仍停留在 **IDE / 工具箱 / 多面板拼接** 的旧结构里。

这导致了 4 个系统级问题：

1. **导航语义冲突**：一级入口把 Session、Library、Knowledge、Compute、Research、Agent、Settings、Pro Launcher 混放在同一层，用户很难理解哪些是“空间”、哪些是“动作”、哪些是“工具”。
2. **默认布局过度拥挤**：左侧栏、主画布、Inspector、聊天栏同时打开，桌面宽度被切成过多竖栏，主任务区缺少明确主次。
3. **核心工作流被分裂**：Research、Workbench、Agent 对话、Artifact 浏览分别长在不同壳里，用户要频繁切换上下文。
4. **设计系统落地不彻底**：全局 token 和主题定义是有的，但大量页面仍靠内联样式和超大单文件维持，造成交互节奏、间距、密度和组件语言不稳定。

如果要做“整个 UI 重新编排”，应优先改**结构和层级**，而不是先改颜色或局部组件皮肤。

## 2. 排查方法

本次排查基于以下内容：

- 主壳与布局：`src/App.tsx`
- 一级导航：`src/components/layout/ActivityBar.tsx`
- 侧边栏：`src/components/layout/Sidebar.tsx`
- Session 视图：`src/components/layout/views/SessionView.tsx`
- 主工作区：`src/components/canvas/ArtifactCanvas.tsx`
- 对话区：`src/components/agent/AgentComposer.tsx`
- Inspector：`src/components/inspector/InspectorRail.tsx`
- Research 工作区：`src/components/research/ResearchWorkspace.tsx`
- 状态栏与设置入口：`src/components/layout/StatusBar.tsx`
- 现有产品报告：`docs/DESIGN_PURPOSE.md`、`docs/RESEARCH_SURVEY_PRODUCT_REPORT_2026-04-14.md`、`docs/PRO_WORKBENCH_PRODUCT_REPORT_2026-04-14.md`、`docs/SETTINGS_PRODUCT_REPORT_2026-04-14.md`

补充量化观察：

- `src` 下含内联 `style={{ ... }}` 的文件数：**90**
- 内联样式出现次数：**712**
- `src/components` 下 TSX 文件数：**117**
- 重型组件示例：
  - `src/components/agent/AgentComposer.tsx`：**1057** 行
  - `src/components/canvas/ArtifactCanvas.tsx`：**734** 行
  - `src/components/library/LibraryModal.tsx`：**1741** 行
  - `src/components/llm/tabs/ModelsTab.tsx`：**1580** 行

## 3. 现状优点

在指出问题前，先明确几个可以保留的基础：

1. **主题基础是成立的**  
   `src/styles/global.css` 已经有完整的颜色、字体、字号、圆角、阴影和布局 token，这说明项目不是没有设计系统，而是还没有把设计系统真正推到页面层。

2. **Session / Artifact / Agent 的产品方向是对的**  
   `docs/DESIGN_PURPOSE.md` 已经明确提出“以 Session 为组织单位、以 Artifact 为结果对象、以 Agent 为核心入口”的方向，这个方向比现在的 UI 更先进，也更适合科研工作流。

3. **若干重设计文档已经找准了问题**  
   Research、Workbench、Settings 三份产品报告都已经指出旧结构的问题。当前更大的问题不是“看不到问题”，而是**产品新方向已经在文档里，UI 壳层还没统一跟上**。

## 4. 关键问题

### P0. 一级信息架构混乱

`src/components/layout/ActivityBar.tsx` 当前把以下内容都放在一级：

- Session Explorer
- New Session
- Library
- Knowledge
- Compute
- Research
- Agent Chat
- Pro Launcher
- Settings

这里混入了三种完全不同的对象：

- **空间/容器**：Session、Library、Knowledge
- **动作**：New Session、Start Research
- **工具/模式**：Agent、Pro Launcher、Settings、Compute

这会直接造成导航认知成本过高。尤其是：

- `Library` / `Knowledge` 看上去像侧栏视图，但实际上在 `src/App.tsx` 中是 modal；
- `Research` 不是普通页面，而是切换主画布形态；
- `Agent` 不是工作区，而是右侧聊天栏开关；
- `Pro Launcher` 甚至不是页面，只是一个启动器。

从 UI 设计角度，这属于**导航语义失真**。

### P0. 默认四栏结构过于拥挤，主任务区缺乏统治力

`src/stores/prefs-store.ts` 的默认布局为：

- sidebarVisible: true
- chatVisible: true
- inspectorVisible: true
- sidebarWidth: 260
- chatWidth: 380
- inspectorWidth: 280

再加上 `ActivityBar` 的 48px，意味着应用一启动就默认占用大量水平宽度给辅助面板。`src/App.tsx` 里也确实把：

- 左侧边栏
- 中间主画布
- 右侧 Inspector
- 最右聊天栏

同时渲染出来。

问题在于：  
对一个需要深度阅读图表、表格、报告和参数的科研产品来说，**主画布应该是主角**，其余都应该是条件性出现的辅助层，而不是默认并列分屏。

现在的结构更像“开发工具面板拼接”，不像“单任务沉浸式工作台”。

### P0. 产品目标是 Agent-first，但主壳仍然是 IDE-first

`docs/DESIGN_PURPOSE.md` 明确希望把 Chat 升级为驱动整个工作流的 Agent Composer，但当前主壳仍然保留明显的 IDE 残留：

- ActivityBar 组织方式像编辑器
- Sidebar 仍承担“资源列表”而非“任务上下文”
- StatusBar 仍承担连接/模型/导出等底层控制
- 多个功能通过 modal 和启动器拼接在主壳外侧

更重要的是，`docs/RESEARCH_SURVEY_PRODUCT_REPORT_2026-04-14.md` 已经明确指出“调研的主舞台应该是对话和过程，而不是 artifact 页面”，但当前 `ResearchWorkspace` 仍是一个**单独打开的工作区壳**，没有和全局 Agent 区做真正统一。

这说明现在的 UI 还没有把“Agent 是主入口”贯彻到整体框架。

### P0. Research、Agent、Artifact 是三套并行心智

当前存在三条并行主线：

1. 平时模式：中间 `ArtifactCanvas` + 右侧 `AgentComposer`
2. Research 模式：中间 `ResearchWorkspace`，并且关闭普通 chat panel
3. Pro Workbench：从 launcher 或其他入口打开，形成另一套重型工作面

这种结构的问题是：

- 用户不知道“Research 是 Agent 的一种任务，还是另一个产品”
- Workbench 与聊天无法形成同一操作闭环
- 主对话区和特殊场景区之间没有统一容器

从体验上看，用户不是在一个工作台里切换任务，而是在几个半独立子产品之间跳转。

### P1. Sidebar 承载能力不足，且存在空壳入口

`src/components/layout/Sidebar.tsx` 当前只有：

- `session`
- `compute`

两个真实视图；`library` 和 `knowledge` 只会显示 `Coming soon` 占位。

这带来两个问题：

1. 用户点击 ActivityBar 的入口，看到的却是无内容占位，导航承诺和实际内容不匹配。
2. Sidebar 没有真正承担“当前任务上下文”角色，只是一个轻量资源清单。

进一步看 `src/components/layout/views/SessionView.tsx`，它把：

- 当前 Session 标题
- 文件列表
- Artifact 列表
- 全部 Sessions

全部压缩在一个窄列里。这个结构更像“数据树”，不像“工作上下文面板”。  
它缺少：

- 当前任务状态
- 最近活动
- 关键结果
- 推荐下一步
- 当前会话与历史会话的明显分层

### P1. Workbench 的复杂度组织不合理

`docs/PRO_WORKBENCH_PRODUCT_REPORT_2026-04-14.md` 对这个问题已经给出充分证据：XRD/XPS/Raman/Compute 是高复杂度工作区，但当前仍倾向于“右侧参数长面板 + 底部动作条”的网页仪器式结构。

核心问题不是功能少，而是**流程没有被设计出来**：

- 用户不知道先做哪一步
- 参数面板是一次性展开的信息堆
- 结果经常被覆盖而不是沉淀成 run history
- Compute 和谱图类工作台共用一套布局壳，导致信息形态不匹配

从 UI 设计角度，这类界面应该从“参数面板”转成“步骤流 + 当前焦点任务 + 历史运行记录”。

### P1. 设置系统仍然是割裂的

`docs/SETTINGS_PRODUCT_REPORT_2026-04-14.md` 已经指出：

- 现在实际存在两个设置系统
- 多个入口指向不同模态
- “Usage” 和 “Configuration” 混在一起
- 模型、预算、Provider 的关系不清晰

尽管部分底层状态已经在收敛，但从 UI 结构上看，用户仍然需要理解：

- Settings
- LLM Configuration
- StatusBar 模型片
- Composer 齿轮

这不符合“设置入口要单一、上下文入口要可回流到统一设置页”的原则。

### P1. 视觉一致性被页面级实现方式削弱

虽然 `global.css` 提供了较完整的 token，但页面层仍有 712 处内联样式，分散在 90 个文件中。  
这通常会带来以下后果：

- 同样功能的按钮、区块、列表项密度不一致
- 间距、对齐、hover、边框半径难以统一
- 很多交互状态只在局部文件中被“手写”，无法系统复用
- 后续要整体改版时，修改成本非常高

这不是单纯的工程问题，它会直接表现为 UI 语言不稳。

### P2. 模态和临时层使用过多

当前较重的 modal / overlay 包括但不限于：

- `LibraryModal`
- `KnowledgeBrowserModal`
- `SettingsModal`
- `LLMConfigModal`
- `ProLauncherMenu`
- `CommandPalette`
- 若干对话框和弹层

它们解决了“快速接入功能”的问题，但长期会造成：

- 页面之间缺少稳定的空间归属
- 用户对“当前身处哪里”感知下降
- 多个功能只能通过弹层访问，不利于整体重编排

## 5. 设计判断

### 5.1 当前 UI 的根本矛盾

可以把整个产品的现状概括成一句话：

**产品概念已经升级到了“科研协作工作台”，但 UI 壳层还停留在“工具集合 + 面板拼接”。**

因此，重编排的目标不应该是：

- 再加一层导航
- 再加几个快捷入口
- 继续在右侧塞更多 panel

而应该是：

- 明确主舞台是谁
- 明确哪些是一级导航，哪些是二级工具
- 明确哪些信息默认可见，哪些按需出现
- 让 Agent、Artifact、Workbench 进入同一套容器逻辑

### 5.2 本产品应该采用的主结构

我建议产品采用下面这套主框架：

1. **左侧：任务与资源导航层**
   - 只保留真正的一级空间：Session、Library、Knowledge、Compute
   - 动作类入口从导航中移出，例如 New Session、Start Research

2. **中间：唯一主工作区**
   - 所有工作都在这里展开，包括 Artifact、Research、Workbench
   - 不再出现“另开一个完全不同壳”的 Research 模式

3. **右侧：统一协作侧栏**
   - 合并 Agent、Inspector、Run Log
   - 默认只开一个 tab，而不是多个竖栏并列
   - 建议采用 `Agent / Details / Activity` 三标签结构

4. **顶部上下文条**
   - 显示当前 Session、当前工作对象、当前模式、关键动作
   - 代替一部分状态栏和分散入口

5. **底部状态层最小化**
   - 仅保留连接状态、后台任务、导出提醒等必要轻状态
   - 不承担复杂入口

## 6. 重编排建议

### 6.1 壳层重编排

建议把现有四栏改为“三段式”：

- 左：导航与上下文
- 中：主工作区
- 右：统一协作侧栏

具体建议：

- 默认关闭 Inspector 独立竖栏
- 将 Inspector 融入右侧协作侧栏中的 `Details` 标签
- 将 TaskTimeline / 运行日志纳入 `Activity` 标签
- 将 AgentComposer 作为 `Agent` 标签

这样可以立即解决当前横向过碎的问题。

### 6.2 ActivityBar 重编排

建议 ActivityBar 只保留“空间入口”，不保留动作和启动器混合项。

保留：

- Session
- Library
- Knowledge
- Compute
- Settings

移出 ActivityBar：

- New Session
- Start Research
- Toggle Agent
- Pro Launcher

替代方式：

- New Session 放到 Session 区顶部主操作
- Start Research 放到 Agent 快捷动作或顶部上下文条
- Agent 不再是“开关”，而是统一协作侧栏默认标签
- Pro Launcher 不作为一级入口，而是变成“在当前 Artifact 上打开专业工作台”的动作

### 6.3 Session Sidebar 重编排

建议把当前 `SessionView` 改成 4 个清晰分区：

1. Session Header  
   当前会话名、摘要、关键动作

2. Working Set  
   当前已加载文件、活跃 artifacts、Pinned items

3. Recent Activity  
   最新生成、最近修改、失败任务、未完成任务

4. Session History  
   历史会话列表

这会比现在“文件 + artifact + sessions 三段直排”更符合任务型产品的上下文需求。

### 6.4 Research 重编排

Research 不应再是独立壳，而应成为：

- 主工作区中的一种任务状态
- 右侧协作侧栏中的一种 Agent 工作流
- 中间主区同步显示 research report / notebook / sources

也就是说：

- 保留 Research 的专属工作流
- 但取消“Research 是另一个页面”的感觉
- 让它继承统一的顶部、右侧协作栏和工作区框架

### 6.5 Workbench 重编排

Workbench 应从“参数大面板”转为“流程驱动工作区”。

建议结构：

- 顶部：步骤轨道
- 中间：图表/结果主视图
- 右侧：当前步骤的参数与建议
- 底部或右侧标签：run history / compare

并明确分流：

- XRD / XPS / Raman / FTIR：同一类谱图工作台
- Compute：Notebook 化，单独信息架构

### 6.6 设置重编排

建议只保留一个 Settings 容器，内部再做 tab 分层。

首层建议：

- Models
- Compute
- Budget
- Advanced

并把以下入口全部回收为深链入口：

- StatusBar 模型片
- Composer 齿轮
- 命令面板里的相关项

### 6.7 视觉系统重编排

建议本轮不要推翻现有暗色主题 token，而是做以下收敛：

1. 把高频布局块抽成标准容器
   - 页面头部
   - 区块标题
   - 列表项
   - 工具条
   - 空状态
   - 分栏面板

2. 大幅减少页面内联样式

3. 建立统一密度规则
   - 导航密度
   - 数据阅读密度
   - 操作区密度

4. 统一按钮层级
   - 主行动作
   - 次行动作
   - 轻操作
   - 危险操作

## 7. 优先级建议

### 第一阶段：先改结构，不改细节视觉

- 统一主壳为“左导航 + 中工作区 + 右协作侧栏”
- 合并 Agent / Inspector / Activity
- 收缩 ActivityBar，只保留空间入口
- 取消 Research 的独立壳感

### 第二阶段：重做高复杂度工作区

- 重编排 Pro Workbench
- 重编排 Session Sidebar
- 合并 Settings / LLM Configuration

### 第三阶段：清理设计系统债务

- 抽离高频布局组件
- 减少内联样式
- 建立统一页面模板
- 统一空状态、表单、列表、操作条语言

## 8. 最终判断

如果只做局部页面优化，当前 UI 仍会持续出现“入口越来越多、工作流越来越碎、功能越来越像外挂”的问题。  
从设计师视角看，当前最需要的不是继续加页面，而是**先做一次壳层级的秩序重建**。

一句话总结：

**Lattice 现在缺的不是功能，而是一个足够稳定、足够统一、真正以 Agent 协作和科研任务为中心的主界面框架。**

## 9. 附：本次排查使用的关键证据

- `src/App.tsx`：主壳同时渲染 Sidebar、ArtifactCanvas、InspectorRail、AgentComposer，并通过 modal 叠加 Library / Knowledge
- `src/components/layout/ActivityBar.tsx`：一级入口混合空间、动作、工具
- `src/components/layout/Sidebar.tsx`：Library / Knowledge 仍为占位
- `src/components/layout/views/SessionView.tsx`：Session 上下文承载偏弱
- `src/stores/prefs-store.ts`：默认布局同时打开多个辅助竖栏
- `src/components/research/ResearchWorkspace.tsx`：Research 仍是独立壳化体验
- `src/components/layout/StatusBar.tsx`：状态层仍承担模型与设置入口
- `docs/DESIGN_PURPOSE.md`：产品方向已是 Session / Agent / Artifact 中心
- `docs/RESEARCH_SURVEY_PRODUCT_REPORT_2026-04-14.md`：Research 已明确要求对话优先
- `docs/PRO_WORKBENCH_PRODUCT_REPORT_2026-04-14.md`：Workbench 已明确需要从仪器面板转向流程工作流
- `docs/SETTINGS_PRODUCT_REPORT_2026-04-14.md`：设置体系割裂问题已被验证
