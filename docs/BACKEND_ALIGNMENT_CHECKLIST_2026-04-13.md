# Lattice Backend Alignment Checklist

日期: 2026-04-13

## 目的

这份清单只做一件事:

把 **Lattice-app 前端当前已经依赖的后端协议/端点**、**仍未接线的迁移面**、以及 **已经偏离 `lattice-cli` 目标架构的本地替代路径** 收集出来，作为后续真实对齐 `lattice-cli` 的执行基线。

## 结论先看

当前仓库里的前端情况可以分成 4 类:

1. **前端已真实发起后端调用**
   - `Library`
   - `Knowledge`
   - `XRD Pro / XPS Pro / Raman Pro / Compute Pro`
   - `WebSocket` 新旧协议兼容层

2. **前端已经定义了类型/Hook，但 UI 还没真正用到**
   - `POST /api/pro/undo`
   - `POST /api/pro/predict-xrd`
   - `POST /api/pro/export-report`

3. **前端 UI 在，但没有接 `lattice-cli` 后端**
   - `Batch` 启停控制
   - `Structure` 真实 transform / AI build
   - `Inverse Design` 真实生成
   - `Hypothesis / Optimization / Synthesis feasibility` 的真实 agent/backend 闭环

4. **当前实现绕开了 `lattice-cli` 主路径**
   - Agent Composer 不走 `/api/chat/send`，而是走 Electron IPC `llm:invoke`
   - `ComputeArtifactCard` 不走 `/api/pro/compute/exec`，而是走 Electron IPC `computeRun`
   - `StructureArtifactCard` 的 supercell / dope / defect / surface 目前是本地 `cif.ts` 直接计算
   - `AI build` 目前走 Electron IPC LLM，而不是 `/api/pro/struct/ai-build`

## 边界说明

- **当前仓库不包含 `lattice-cli` 后端源码**。Electron 只是通过 `python -m lattice_cli.web.server` 启动外部 Python 模块。
- 所以下面这份清单是基于:
  - 当前前端代码真实依赖
  - 当前仓库内文档约定
  - 代码中的注释/类型定义
- **不能在这个仓库内直接验证** `lattice-cli.web.server` 是否已经实现了某个端点，只能判断:
  - 前端是否已经依赖它
  - 前端是否已经调用它
  - 文档里是否把它列为迁移目标

## 1. 进程与传输契约

### 1.1 Python 后端启动契约

来源:
- `electron/python-manager.ts`
- `electron/main.ts`
- `electron/preload.ts`
- `src/types/electron.d.ts`

前端/Electron 目前假定 `lattice-cli` 满足以下契约:

- 启动命令:
  - `python -m lattice_cli.web.server --standalone --port <PORT>`
- 启动完成 stdout:
  - `LATTICE_BACKEND_READY port=<PORT> token=<TOKEN>`
- 健康检查:
  - `GET /api/status`
- WebSocket:
  - `ws://localhost:<PORT>/ws?token=<TOKEN>`
- REST 鉴权:
  - `Authorization: Bearer <TOKEN>`

这组契约如果在 `lattice-cli` 侧变化，当前 Electron 壳会直接失配。

### 1.2 当前前端传输面

| 传输面 | 当前状态 | 说明 |
|------|------|------|
| REST | 已大面积使用 | `Library` / `Knowledge` / `Pro` 依赖明确 |
| WebSocket | 已接新旧两套协议 | `useWebSocket.ts` 同时兼容 structured events 和旧事件 |
| Electron IPC | 大量存在 | LLM 调用、Compute 运行、后端状态同步都走 IPC |

## 2. WebSocket 协议对齐面

来源:
- `src/hooks/useWebSocket.ts`
- `src/dev/mock-agent-stream.ts`
- `docs/NEXT_PHASES.md`
- `docs/EXECUTION_CHECKLIST_2026-04-13.md`

### 2.1 前端已支持的新 structured agent 事件

前端已经能识别:

- `task_start`
- `agent_plan`
- `agent_reasoning`
- `tool_invocation`
- `tool_result`
- `artifact_created`
- `artifact_updated`
- `task_end`

并且已经实现了:

- TaskTimeline step 映射
- `tool_result.artifact_ids -> transcript.artifactRefs`
- 收到 structured 协议后，抑制旧 `tool_call/reasoning` 聊天事件的重复入栈

### 2.2 前端仍保留的旧事件 fallback

- `status_update`
- `spectrum_update`
- `peaks_update`
- `workspace_update`
- `chat_message`
- `chat_message_update`

### 2.3 这块的真实缺口

- 前端 **已经就绪**
- 但真实 `lattice-cli` 是否稳定发出上述新事件，**当前仓库无法验证**
- 这意味着:
  - Phase C1 的前端兼容层已经完成
  - 真正的阻塞点已经转移到 `lattice-cli` 后端事件发射

## 3. 通用 REST 面

来源:
- `src/hooks/useApi.ts`
- `src/lib/agent-submit.ts`
- `src/lib/llm-chat.ts`

### 3.1 当前定义的通用端点

- `GET /api/status`
- `GET /api/spectrum`
- `GET /api/peaks`
- `GET /api/workspace`
- `POST /api/workspace/load`
- `POST /api/chat/send`

### 3.2 对齐判断

| 端点 | 前端状态 | 备注 |
|------|------|------|
| `/api/status` | 使用中 | Electron 健康检查依赖它 |
| `/api/spectrum` | 已定义未见实际 UI 使用 | 当前主要靠 WS 推 `spectrum_update` |
| `/api/peaks` | 已定义未见实际 UI 使用 | 当前主要靠 WS 推 `peaks_update` |
| `/api/workspace` | 已定义未见实际 UI 使用 | 当前主要靠 WS 推 `workspace_update` |
| `/api/workspace/load` | 已定义未见实际 UI 使用 | 仍是潜在接线点 |
| `/api/chat/send` | **已偏离主链** | Composer 当前不使用它 |

### 3.3 最大偏差: Chat 主链不走 backend

当前真实主链:

- `submitAgentPrompt()`
- `sendLlmChat()`
- `window.electronAPI.llmInvoke`
- `electron/llm-proxy.ts`

而不是:

- `POST /api/chat/send`

这说明当前桌面应用虽然能“聊天”，但 **并没有和 `lattice-cli` 的 Agent/Tool 主路径对齐**。

这条是当前最大的架构级偏差。

## 4. Pro API 对齐面

来源:
- `src/hooks/useProApi.ts`
- `src/types/pro-api.ts`
- `src/components/canvas/artifacts/XrdProWorkbench.tsx`
- `src/components/canvas/artifacts/XpsProWorkbench.tsx`
- `src/components/canvas/artifacts/RamanProWorkbench.tsx`
- `src/components/canvas/artifacts/ComputeProWorkbench.tsx`
- `docs/MIGRATION_PLAN.md`

### 4.1 当前前端已真实调用的 Pro 端点

#### 通用处理

- `POST /api/pro/detect-peaks`
- `POST /api/pro/smooth`
- `POST /api/pro/baseline`
- `POST /api/pro/clear-peaks`
- `POST /api/pro/assess-quality`

#### XRD

- `POST /api/pro/xrd-search`
- `POST /api/pro/upload-cif`
- `GET /api/pro/list-cifs`
- `POST /api/pro/delete-cif`
- `POST /api/pro/xrd-refine`
- `POST /api/pro/export-refined-cif`

#### XPS

- `POST /api/pro/charge-correct`
- `POST /api/pro/xps-fit`
- `POST /api/pro/xps-quantify`
- `POST /api/pro/xps-lookup`

#### Raman / FTIR

- `POST /api/pro/raman-identify`

#### Compute Pro

- `POST /api/pro/compute/exec`
- `GET /api/pro/compute/health`
- `GET /api/pro/compute/snippets`
- `POST /api/pro/compute/save-script`
- `GET /api/pro/compute/scripts`
- `GET /api/pro/compute/script/{name}`

### 4.2 已定义但当前 UI 未使用的 Pro 端点

- `POST /api/pro/undo`
- `POST /api/pro/predict-xrd`
- `POST /api/pro/export-report`

### 4.3 文档里有、前端还没进入 Hook 的 Pro 端点

来自 `docs/MIGRATION_PLAN.md` 但当前 `useProApi.ts` 没有:

- `POST /api/pro/math`
- `GET /api/pro/params`
- `POST /api/pro/set`
- `POST /api/pro/load-preset`
- `POST /api/pro/save-preset`
- `/api/pro/academic-figure`
- `/api/pro/export-*` 的更完整导出族
- `/api/pro/compare-spectra`

### 4.4 对齐判断

| 子域 | 状态 | 说明 |
|------|------|------|
| XRD Pro | 前端已接真实 REST | 这是当前最接近 `lattice-cli` 的区域之一 |
| XPS Pro | 前端已接真实 REST | 基本具备后端联调条件 |
| Raman Pro | 前端已接真实 REST | FTIR lookup 仍提示 backend 不可用 |
| Compute Pro | 前端已接真实 REST | 已和 `ComputeArtifactCard` 形成双路径并存 |
| 参数/预设/math/export/compare | 未接 | 仍停在迁移计划层 |

## 5. Library API 对齐面

来源:
- `src/hooks/useLibraryApi.ts`
- `src/components/library/LibraryModal.tsx`
- `src/components/library/MultiPaperQAModal.tsx`
- `src/components/canvas/artifacts/PaperArtifactCard.tsx`
- `docs/MIGRATION_PLAN.md`

### 5.1 当前前端已真实调用的 Library 端点

- `GET /api/library/papers`
- `POST /api/library/papers`
- `POST /api/library/papers/doi`
- `PUT /api/library/papers/{id}`
- `DELETE /api/library/papers/{id}`
- `GET /api/library/tags`
- `POST /api/library/papers/{paperId}/tags`
- `DELETE /api/library/papers/{paperId}/tags/{tag}`
- `GET /api/library/stats`
- `GET /api/library/collections`
- `POST /api/library/collections`
- `DELETE /api/library/collections/{name}`
- `POST /api/library/collections/{name}/papers/{paperId}`
- `DELETE /api/library/collections/{name}/papers/{paperId}`
- `POST /api/library/import/bibtex`
- `POST /api/library/import/ris`
- `GET /api/library/export/bibtex`
- `GET /api/library/paper/{id}/read`
- `GET /api/library/paper/{id}/extractions`
- `GET /api/library/paper/{id}/chains`
- `POST /api/library/paper/{id}/ask`
- `POST /api/library/ask-multi`
- `GET /api/library/paper/{id}/annotations`
- `POST /api/library/paper/{id}/annotations`
- `PUT /api/library/annotations/{annId}`
- `DELETE /api/library/annotations/{annId}`
- `POST /api/library/scan`

### 5.2 对齐判断

- `Library` 是当前前端中 **后端依赖最完整** 的区域之一
- `LibraryModal`、`PaperArtifactCard`、`MultiPaperQAModal` 都已经在真实调用 backend
- 这部分如果联调失败，问题大概率不在 UI 缺席，而在:
  - `lattice-cli` 端点实现
  - 鉴权/token
  - 返回字段契约漂移

## 6. Knowledge API 对齐面

来源:
- `src/hooks/useKnowledgeApi.ts`
- `src/components/knowledge/KnowledgeBrowserModal.tsx`
- `src/components/knowledge/KnowledgeCharts.tsx`
- `src/components/library/ChainExtractModal.tsx`
- `src/components/canvas/artifacts/PaperArtifactCard.tsx`
- `docs/MIGRATION_PLAN.md`

### 6.1 当前前端已真实调用的 Knowledge 端点

- `GET /api/knowledge/stats`
- `GET /api/knowledge/extractions`
- `GET /api/knowledge/extraction/{id}`
- `GET /api/knowledge/search`
- `GET /api/knowledge/export/csv`
- `POST /api/knowledge/compare`
- `DELETE /api/knowledge/extraction/{id}`
- `GET /api/knowledge/tags`
- `POST /api/knowledge/extraction/{id}/tags`
- `DELETE /api/knowledge/extraction/{id}/tags/{tag}`
- `GET /api/knowledge/projects`
- `POST /api/knowledge/extract-selection`
- `POST /api/knowledge/save-chains`
- `GET /api/knowledge/metric-distribution`
- `GET /api/knowledge/heatmap`
- `GET /api/knowledge/timeline`
- `GET /api/knowledge/peaks`
- `GET /api/knowledge/variable-list`
- `GET /api/knowledge/papers`

### 6.2 对齐判断

- `Knowledge` 端和 `Library` 一样，前端调用面已经比较完整
- 问题不在“有没有前端入口”，而在真实后端是否能按这些 shape 返回

## 7. 已偏离 `lattice-cli` 目标路径的实现

### 7.1 Agent Composer 偏离

现状:

- 走 Electron IPC `llm:invoke`
- 不走 `lattice-cli` 的 `/api/chat/send`

影响:

- 无法验证 `lattice-cli` agent tool orchestration 是否真正可用
- 前端虽然有 TaskTimeline / artifactRefs / structured WS 支持，但目前主入口不是 backend agent

### 7.2 Compute 双路径并存

现状:

- `ComputeProWorkbench` 走 `/api/pro/compute/exec`
- `ComputeArtifactCard` 走 Electron IPC `computeRun`

影响:

- 同一个“Compute”能力在桌面应用内已经分裂成两套执行体系
- 这会让后续迁移判断变得含混: 功能看起来“能跑”，但不一定是 `lattice-cli` 在跑

### 7.3 Structure 本地实现替代了后端

现状:

- `StructureArtifactCard` 的 supercell / dope / surface / defect 当前依赖 `src/lib/cif.ts`
- `AiBuildPromptBar` 调的是 `invokeLlmForCif()`，本质仍是 Electron IPC LLM

文档目标:

- `POST /api/pro/struct/transform`
- `POST /api/pro/struct/ai-build`

影响:

- 结构卡目前更像“桌面本地功能”，而不是 `lattice-cli` 迁移完成态

## 8. 仍未接线的迁移面

### 8.1 Batch

现状:

- `BatchWorkflowCard` 只有:
  - 本地筛选
  - JSONL 下载
  - 结果 artifact 聚焦
- `Start / Resume / Cancel` 仍明确写着 backend 未接

缺口:

- 缺 `useBatchApi` 或等价调用层
- 缺 `/api/batch/*` 对应前端控制面
- 缺 batch 结果与 structured WS / `artifact_created` 的真实联动

### 8.2 Inverse Design

现状:

- UI 卡存在
- 局部动作现在已经能生成本地 artifact
- 但真实候选生成仍是 demo / mock

缺口:

- 当前仓库内没有 `inverse design` 的 Hook
- 文档里把 `POST /api/inverse-design/propose` 作为目标
- 但该端点是否已在 `lattice-cli` 存在，当前仓库无法验证

### 8.3 Hypothesis / Optimization / Synthesis feasibility

现状:

- 前端都有 artifact 类型或命令面板入口
- 但没有对应 backend hook / REST 契约 / WS artifact 写回面

缺口:

- 仍停留在 `docs/NEXT_PHASES.md` 的承载设计层
- 还没有进入当前前端的 backend 依赖面

### 8.4 Simulation Jobs

文档目标:

- `/api/sim/jobs`
- `/api/sim/jobs/{id}`
- `/api/sim/jobs/{id}/cancel`
- `/api/sim/stats`

现状:

- 前端没有对应 hook
- `JobMonitorCard` 当前是 artifact 渲染，不是 jobs API 的完整迁移

## 9. 推荐的后端对齐优先级

### P0

- 把 Agent 主链拉回 `lattice-cli`
- 确认 `/api/chat/send` 是否废弃；若不废弃，定义与 structured WS 的关系
- 让 backend 稳定发出:
  - `task_start`
  - `agent_plan`
  - `agent_reasoning`
  - `tool_invocation`
  - `tool_result`
  - `artifact_created`
  - `artifact_updated`
  - `task_end`

### P1

- 把 `Structure` 从本地实现切回 `lattice-cli`
- 对齐:
  - `/api/pro/struct/transform`
  - `/api/pro/struct/ai-build`

### P2

- 打通 `Batch`
- 打通 `/api/batch/*`
- 让 batch 结果通过 structured WS 回写 artifact

### P3

- 落 `Inverse Design`
- 明确 `POST /api/inverse-design/propose` 是否真实存在
- 再往后推进:
  - hypothesis
  - optimization
  - synthesis feasibility

### P4

- 收尾未进入 UI 的 Pro 面:
  - `undo`
  - `predict-xrd`
  - `export-report`
  - `math`
  - params / preset
  - academic-figure
  - compare-spectra
  - report/export 系列
  - sim jobs 系列

## 10. 本轮收集的直接产物

这份文档可以直接作为后续 backend 对齐执行清单的输入。

如果下一步继续做，最合理的顺序不是再补前端 demo，而是:

1. 定死 Agent/WS 契约
2. 定死 Structure/Batch/Inverse 的 REST 契约
3. 再逐项把当前“本地替代路径”切回 `lattice-cli`
