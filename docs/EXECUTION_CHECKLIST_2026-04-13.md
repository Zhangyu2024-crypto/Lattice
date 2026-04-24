# Lattice Migration Execution Checklist

日期: 2026-04-13

## 本轮执行清单

- [x] `Inverse Design` 卡片动作从 toast 占位改为真实产出
  - `Open structure` 现在会生成并聚焦一个 `structure` artifact 脚手架
  - `Query literature` 现在会生成并聚焦一个 `research-report` artifact
  - `Add to library` 现在会优先写入 backend library；若 backend 不可用，则退化为本地 `paper` artifact note

- [x] `Hypothesis` 卡片从只读改为可操作
  - `New Hypothesis` 支持新增假设
  - `Mark as supported/refuted/inconclusive` 会真实更新 artifact payload
  - evidence 上的 `artifactId` 现在会尝试聚焦当前 session 内的对应 artifact

- [x] `Batch Workflow` 成功文件行支持跳转结果
  - 优先按 `artifactIds` 找结果 artifact
  - 找不到时回退到 `sourceFile` 匹配

- [x] `Agent` 新流式协议前端兼容层
  - `useWebSocket` 现在识别 `task_start / agent_plan / agent_reasoning / tool_invocation / tool_result / artifact_created / artifact_updated / task_end`
  - 保留旧 `chat_message / chat_message_update / spectrum_update / peaks_update` fallback
  - 一旦收到新协议事件，旧 `tool_call / reasoning` step 不再重复入栈
  - `tool_result` 会把 `artifact_ids` 写入 transcript message 的 `artifactRefs`

- [x] 开发期新协议 mock 注入器
  - dev 模式下可在控制台调用 `window.__latticeMockAgentStream()`
  - 用于手动验证 TaskTimeline、artifact 创建和 transcript 徽章

- [x] `Optimization` 卡片候选入队从 toast 占位改为真实本地状态变更
  - `Queue` 现在会把候选参数写入 `trials`，生成一个新的 `pending` trial
  - 已入队候选会从 `nextCandidates` 列表移除

- [x] `Knowledge Graph` 论文节点支持打开本地 `paper` artifact
  - 选中带 `paperRef` 的节点后，侧边栏按钮会生成并聚焦一个 `paper` artifact note
  - DOI 会在可识别时写入 paper metadata

- [x] `Material Comparison` 行点击支持打开材料简报
  - 点击表格行会生成并聚焦一个 `research-report` artifact
  - 简报包含材料快照、比较表中的属性摘要和后续建议

- [x] Command Palette 增加 dev mock stream 入口
  - dev 模式下可直接从命令面板触发 `DEV: Emit mock agent stream`
  - 降低新协议前端回归验证成本，无需再手动打开控制台

- [x] `lattice-cli` 后端对齐依赖面已收集成文档
  - 输出到 `docs/BACKEND_ALIGNMENT_CHECKLIST_2026-04-13.md`
  - 覆盖 Electron 启动契约、WS 事件、Library / Knowledge / Pro API、以及当前绕开 backend 的实现路径

- [x] “自包含移植”方向已重排成文档和基础代码
  - 输出到 `docs/SELF_CONTAINED_PORT_PLAN_2026-04-13.md`
  - `wsClient` 新增本地 `dispatch()`，为后续本地 agent / IPC 执行器复用同一套 structured event 流做准备
  - `useWebSocket` 不再要求 backend ready 才订阅事件，降低对外部 WS 的耦合

## 本轮验证方式

- [x] `npm run typecheck`
- [x] `npx vite build`

### dev 手动验证建议

- 打开 Command Palette，执行 `DEV: Emit mock agent stream`
- 确认 TaskTimeline 收到 `task_start -> tool_invocation -> tool_result -> task_end`
- 确认 transcript 内 assistant message 出现 artifact 徽章
- 在 `Knowledge Graph` 中选中 paper 节点并打开本地 `paper` artifact
- 在 `Material Comparison` 中点击任意材料行，确认会打开 `Material Brief`
- 在 `Optimization` 中点击 `Queue`，确认新增 `pending trial` 且候选行被移除

## 本轮未动但仍然重要的主缺口

- [ ] Agent 新流式协议与 `lattice-cli` 后端对齐
- [ ] 真实 inverse-design 后端生成与重排行为
- [ ] Structure / Batch 的后端控制端点统一接线
- [ ] 更完整的集成测试，而不只是 `typecheck` / `vite build`
