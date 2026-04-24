# Self-Contained Port Plan

日期: 2026-04-13

## 目标重定义

目标不是:

- 让当前项目去直连一个外部运行中的 `lattice-cli` backend

目标是:

- 把 `lattice-cli` 的能力 **迁进当前 Electron + React 项目**
- `lattice-cli` 只作为 **行为参考 / 协议参考 / UI 参考**
- 当前项目最终应当能以 **自包含运行时** 工作

## 设计原则

### 1. 传输和能力分离

前端的 Task / Artifact / Transcript 处理，不应该依赖某个固定传输层。

现在已经有第一步基础:

- `src/stores/ws-client.ts` 增加了本地 `dispatch()`
- `src/hooks/useWebSocket.ts` 现在即使没有 backend 连接，也能接收同一套事件

这意味着后续可以由:

- WebSocket
- Electron IPC
- 本地执行器
- 开发期 mock

向同一套 renderer 事件流发:

- `task_start`
- `agent_plan`
- `agent_reasoning`
- `tool_invocation`
- `tool_result`
- `artifact_created`
- `artifact_updated`
- `task_end`

## 1. 能力落位

### A. 直接保留在前端 / 本地 TS

这些能力已经适合留在项目本地，不需要再走外部 backend:

- `StructureArtifactCard` 的本地 CIF 变换
  - `src/lib/cif.ts`
  - supercell / dope / defect / slab 已可本地执行
- `Optimization` / `Hypothesis` / `Material Comparison` / `Knowledge Graph` 这类 artifact 内部交互
- Session / Artifact / Task store
- 导出 JSON / zip / markdown / PDF 的纯前端动作
- 各类 demo / scaffold artifact builder

这部分要做的不是“回接 backend”，而是:

- 补强功能
- 提高可靠性
- 让 agent/tool 结果能直接写入这些 artifact

### B. 下沉到 Electron IPC

这些能力天然适合由 Electron main 承接:

- LLM 调用
  - 已存在: `electron/llm-proxy.ts`
- Compute 容器执行
  - 已存在: `electron/compute-runner.ts`
- 文件系统访问 / 打开文件 / 目录扫描
  - 已存在 preload IPC 基础
- 后续的本地 agent orchestrator
  - 应落在 Electron main，而不是 renderer

建议后续把下面这些都逐步做成 IPC，而不是再去挂 REST:

- 本地 Agent 任务执行
- 任务事件回推
- Batch 调度
- 本地 Library / Knowledge 查询入口

### C. 在仓库内补本地 Python worker

有些能力更适合做成 **本项目自带的 Python worker**，而不是全改写成 TS:

- XRD 搜索 / 精修
- XPS 拟合 / 定量 / lookup
- Raman 匹配
- 论文抽取 / 知识抽取
- DOI / BibTeX / RIS 导入链路
- 可能的 inverse design / hypothesis / synthesis feasibility

原因:

- 科学计算和文献处理现成生态主要在 Python
- 全部重写成 TS 成本高、风险大
- 但这不意味着继续依赖外部 `lattice-cli` 运行时

目标形态应该是:

- 本仓库内新增自己的 worker 入口
- Electron main 启动它
- 通过 IPC 或本地 loopback 与 renderer 通信

而不是:

- `python -m lattice_cli.web.server`

## 2. 当前代码里的“好基础”

### 2.1 已经不依赖 `lattice-cli` 的部分

- LLM:
  - `src/lib/agent-submit.ts`
  - `src/lib/llm-chat.ts`
  - `electron/llm-proxy.ts`
- Compute Artifact:
  - `src/lib/compute-run.ts`
  - `electron/ipc-compute.ts`
  - `electron/compute-runner.ts`
- Structure transforms:
  - `src/lib/cif.ts`
  - `src/components/canvas/artifacts/StructureArtifactCard.tsx`
- AI build:
  - `src/components/canvas/artifacts/AiBuildPromptBar.tsx`
  - `src/lib/llm-client.ts`

这些都已经说明:

- 项目并不是必须绑定 `lattice-cli`
- 自包含迁移是现实可走的

### 2.2 当前仍强依赖外部 backend 的部分

- `electron/python-manager.ts`
  - 直接启动 `python -m lattice_cli.web.server`
- `useProApi.ts`
- `useLibraryApi.ts`
- `useKnowledgeApi.ts`
- `App.tsx` 中的 backend status 接线
- `useWebSocket.ts` 中的 loopback WS 连接

这些是后续真正要逐步替换掉的面。

## 3. 替换路线

### Phase 1: 先把“协议层”独立出来

目标:

- 不管事件来自 WS 还是本地执行器，renderer 都走同一套 step/artifact 流

本轮已完成的基础:

- `wsClient.dispatch()` 本地分发
- `useWebSocket.ts` 不再要求 backend ready 才能订阅事件

后续动作:

- 做一个本地 agent/task dispatcher
- 让 IPC 返回结果后直接分发 structured events
- 逐步减少对 WS 的依赖

### Phase 2: 明确保留本地实现的能力

不再“回接 backend”的能力:

- Structure 本地变换
- Optimization / Hypothesis 本地交互
- Material brief / local paper note / inverse-design scaffold 这类本地 artifact 生成

这类工作应该继续加强，而不是回退。

### Phase 3: 先移植最有价值的一条本地执行链

建议优先级:

1. `Batch`
   - 适合直接在 Electron main 做本地调度
   - 不必先依赖外部 backend
2. `Pro spectrum core`
   - detect-peaks / smooth / baseline / assess-quality
   - 可以先做本地最小可用实现
3. `Library / Knowledge`
   - 最终应有本地库，而不是外部 REST 服务

### Phase 4: 引入仓库内 Python worker

建议把复杂科学能力集中到一个仓库内 worker:

- `xrd`
- `xps`
- `raman`
- `paper extraction`
- `knowledge extraction`

Electron main 负责:

- worker 生命周期
- IPC 桥
- 任务流转
- structured event 回推

## 4. 具体替换矩阵

| 当前面 | 当前实现 | 目标实现 |
|------|------|------|
| Agent 主链 | Electron IPC LLM + 外部 backend WS 混合 | Electron main 本地 agent orchestrator |
| Task 事件 | 主要依赖 WS | 传输无关，优先本地 dispatcher |
| Compute Artifact | Electron IPC | 保留 |
| Compute Pro | `/api/pro/compute/*` | 收敛到 Electron IPC / 本地 compute service |
| Structure transforms | 本地 `cif.ts` | 保留并增强 |
| Structure AI build | Electron IPC LLM | 保留，并把结果接入统一 task 流 |
| Pro XRD/XPS/Raman | 外部 REST | 仓库内 Python worker 或本地服务 |
| Library | 外部 REST | 仓库内本地库 + IPC |
| Knowledge | 外部 REST | 仓库内本地库 + IPC |
| Batch | 未接 | Electron main 本地调度 |
| Inverse Design | demo + scaffold | 仓库内服务/worker |

## 5. 建议的第一批落地顺序

### P0

- 继续把 Task / Artifact 事件流从 WS 里抽出来
- 做本地 dispatcher，给后续 IPC 执行器复用

### P1

- 统一 Compute 两条路径
  - `ComputeArtifactCard`
  - `ComputeProWorkbench`
- 不再让它们分别代表“本地能力”和“外部 backend 能力”

### P2

- 给 `Batch` 做 Electron main 本地调度
- 直接输出 `BatchWorkflowArtifact` + structured events

### P3

- 选 `Library` 或 `Knowledge` 其中一个，做本地化存储入口
- 逐步替换 `useLibraryApi` / `useKnowledgeApi`

### P4

- 引入仓库内 Python worker，承接 XRD/XPS/Raman

## 6. 当前判断

如果按“移植”而不是“对接”来做，那么当前项目里最不应该继续投入的方向是:

- 再去扩充对外部 `lattice-cli` REST 端点的依赖面
- 再把更多能力做成“等 backend 才能跑”

最应该投入的方向是:

- 把已有本地能力收束成统一运行时
- 把剩余能力分批迁到 Electron IPC / 本地 worker

## 7. 本轮产物

这份文档用于替代“继续对齐外部 backend”这个工作方向。

后续如果继续推进，应该直接按这里的 P0/P1 开始，而不是再新增一批 `/api/...` hook。
