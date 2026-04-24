# Phase 7c 探路 findings

## 0. 背景

Phase 7b 已完成 artifact Card 从 session-store 的解耦；Phase 7c 的任务是把 agent-tools 下写 session-store 的 14 个 artifact 相关点改为走 `ctx.orchestrator.emit*`。策略：**无 workspace 时静默 skip**，不再 fallback。

## 1. 完整调用点清单（grep -rn 原始结果）

`useSessionStore` 在 `src/lib/agent-tools/` 的出现 —— 共 21 个 file。分三类：

### A. artifact 写入（本期迁移目标，14 处）

| 文件 | 行 | 调用 | artifact kind |
|---|---|---|---|
| `research-plan-outline.ts` | 166–167 | `upsertArtifact` + `focusArtifact` | `research-report` |
| `research-draft-section.ts` | 187, 252 | `patchArtifact` (两处：预标记 drafting + 写入正文；revert-to-empty 也在 252) | `research-report` |
| `research-finalize-report.ts` | 123 | `patchArtifact` | `research-report` |
| `compute-create-script.ts` | 121–122 | `upsertArtifact` + `focusArtifact` | `compute` |
| `compute-edit-script.ts` | 133 | `patchArtifact` | `compute` |
| `structure-fetch.ts` | 195 | `upsertArtifact` | `structure`（CIF 双写） |
| `structure-from-cif.ts` | 124 | `upsertArtifact` | `structure`（CIF 双写） |
| `structure-modify.ts` | 224 | `upsertArtifact` | `structure`（CIF 双写） |
| `latex-selection.ts` | 379 | `patchArtifact`（在 `applyLatexEditSelectionPatch` 中） | `latex-document` |
| `latex-add-citation.ts` | 397 | `patchArtifact`（在 `applyLatexCitationOps` 中） | `latex-document` |
| `latex-insert-figure-from-artifact.ts` | 452 | `patchArtifact`（在 `applyLatexInsertFigurePatch` 中） | `latex-document` |
| `latex-fix-compile-error.ts` | 199 | `patchArtifact`（在 `applyLatexFixCompileErrorPatch` 中） | `latex-document` |
| `invoke-developer.ts` | 274 | `upsertArtifact` | `compute-pro` |
| `focus-artifact.ts` | 44 | `focusArtifact` | (UI only) |

> `latex-*` 的 4 处 `patchArtifact` 都在 `apply*Patch` helper 函数中，这些 helper 被 tool-card 的 Approve 按钮从 UI 层调用 — **不是** 从 tool.execute 路径。orchestrator ctx 只活在 agent turn 作用域，UI 调用路径拿不到。**Phase 7c 不动 latex 的 apply\*Patch** — 这些属于 Phase 7b card 层（但 Phase 7b 显式未动 Pro workbench，只涵盖 15 个 artifact Card，而这 4 个 helper 是 UI 旁路，不是 Card render 本身）。留给 Phase 7d 合并到 workspace 写入。

### B. artifact/session 读入（本期可能需要调整）

| 文件 | 行 | 用途 | 处理 |
|---|---|---|---|
| `structure-modify.ts` | 135 | 读 session `focusedArtifactId` + `session.artifacts[id]` | 短期保留 — 需要访问 source structure |
| `structure-analyze.ts` | 152 | 同上 | 保留 |
| `compute-edit-script.ts` | 77 | 读 compute artifact payload | 保留 |
| `compute-run.ts` | 121 | 读 compute artifact（`readComputeArtifact`） | 保留 |
| `latex-*` | 多处 | 读 latex artifact + paper artifacts | 保留 |
| `research-draft-section.ts` | 95, 246 | 读 research-report artifact | 保留 |
| `research-finalize-report.ts` | 67 | 读 research-report artifact | 保留 |
| `list-artifacts.ts` | 31 | 读取整 session 列表 | 保留 |
| `get-artifact.ts` | 73 | 读单个 | 保留 |
| `focus-artifact.ts` | 40 | 读 session 验证 id 存在 | 保留（仍从 session-store 查） |

**读入保留策略**：Phase 7c 只迁"写入"，读入继续从 session-store 查。原因：
1. 其他 Phase 7b 组件（Card）仍消费 session-store，迁入路径上 session-store 依然是权威。
2. 将 tool 同时改成从 workspace 文件读回会引入 envelope decode + 路径解析，复杂度成倍增长。
3. Phase 7d 会在 session-store 拔除时一并迁移读路径。

### C. task / plan / agent-tasks 等（非 artifact，本期不动）

| 文件 | 行 | 调用 | 处理 |
|---|---|---|---|
| `agent-tasks.ts` | 56, 82, 130, 131 | `addAgentTask` / `updateAgentTask` / 读 `agentTasks` | 不动（task tree — Phase 7d 决定） |
| `plan-mode.ts` | 44, 83 | `enterPlanMode` / `exitPlanMode` / `setPlanText` | 不动（plan-mode 属于 session 概念） |

## 2. ctx API 扩展需求

`OrchestratorCtx` 当前暴露 `emitArtifact / emitTranscript / openFile`；本期还需要：

1. **`patchFile(relPath, patch)`**：把"更新已存在 artifact"的语义翻译到文件系统 —— read envelope → merge payload → writeEnvelope。必须保留 `id` / `createdAt`，只动 `updatedAt` 和 payload 子集。
2. **`emitStructureArtifact(cif, meta, hint?)`**：structure 是 CIF 文本主体 + `.structure.meta.json` 旁路 envelope 的双文件模式。提供一个专用 helper 避免每个 structure tool 重复写双文件胶水代码。返回 `{ cifRel, metaRel }`。
3. **`focus(relPath)`**：就是 `openFile(relPath)` 的语义，不需要额外；沿用 `openFile`。

注意：`emitArtifact(kind, payload, hint)` 对于 JSON-payload artifact 已足够；CIF 的 payload.cif 是文本，不能原样塞进 envelope 的 payload。所以结构 artifact 有两条路：
- **选项 A**：把整个 `StructureArtifactPayload`（含 CIF 字符串字段）包在 envelope payload 里 —— 信息完整但 CIF 文本埋在 JSON 里，外部工具（pymatgen / VESTA）读不到。
- **选项 B（推荐）**：CIF 文本写 `structure/<slug>.cif`；剩下的 metadata（formula / spaceGroup / latticeParams / transforms）写 `structure/<slug>.structure.meta.json`（`kind='structure-meta'`，Phase 7a 已加枚举）。CIF 文件和 meta 文件通过 meta envelope 的 `meta.cifRel` 关联。

选 B。`emitStructureArtifact()` 写双文件，`openFile(cifRel)` 用 CIF 文件做"主"入口。

## 3. `appendTranscript / focusArtifact / appendStep` 现状

- `appendTranscript`：**agent-tools 下没有直接调用**（WS 旁路的 `useWebSocket` 才调）。本期跳过。
- `focusArtifact`：研究/compute-create 的 tool 在 upsert 后会 focus；方案是 `emitArtifact` 返回 relPath 后 `ctx.orchestrator.openFile(relPath)`。
- `appendStep`：**agent-tools 下没有直接调用**；orchestrator 自己也不调（只 dispatch WS 事件让 useWebSocket 写 session-store）。保持 Phase 7a 结论 "留给 7d"。

## 4. `focusedArtifactId` 来源

- `structure-modify.ts` + `structure-analyze.ts`：`input.artifactId ?? session.focusedArtifactId`。
- `agent-context-injection.ts`：`session.focusedArtifactId` → `contextParams: ['artifactId']` 的 tool 自动填 artifactId。

**Phase 7c 任务 outline 第 3.2 点建议改为从 `editor-store.activeGroup.activeTab` 取**。这是一个破坏性变化 —— 当前 activeTab 是 relPath（如 `structure/mp-149.cif`），不是 artifactId。tool 调用链（`session.artifacts[targetId]`）假设 targetId 是 artifactId。

**本期决策**：暂不迁 `focusedArtifactId`。原因：
1. Phase 7c 只迁"写"，不动"读"；context-injection 读 `focusedArtifactId` 属于"读"。
2. 如果要改，需要同步改 `session.artifacts[id]` 查询 → 从 workspace 读 envelope 还原 Artifact，复杂度炸裂。
3. Phase 7d 拔 session-store 时一并处理 focus 语义（可能会从 editor-store.activeTab 衍生 artifact 等价物，或引入独立 focus-store）。

## 5. 迁移模板（落地形态）

### A. 典型 upsert（research-plan-outline）

```ts
// 新增
const relPath = await ctx.orchestrator?.emitArtifact(
  'research-report',
  payload,
  { basename: slugify(topic, 'report'), meta: { title } },
)
if (relPath) ctx.orchestrator?.openFile(relPath)
```

artifactId 返回：tool output `artifactId` 字段变成 `relPath`（向后兼容意义上 LLM 只要把这个字符串回填 `artifactId` 参数能拿到同一个文件即可）；tool 内部"查找同一个 artifact"的路径转为 `ctx.orchestrator.patchFile(relPath, ...)`。

**问题**：`research-draft-section` 是后续 tool 调用，其 `input.artifactId` 是 LLM 从前一轮 tool output 抄来的。如果前一轮返回 relPath，后一轮 tool 查 `session.artifacts[relPath]` 就 miss。

**Phase 7c 做法**：双轨制过渡。
1. `emitArtifact` 照写（workspace 有 workspace 时）。
2. **同时**保留 session-store 写（upsertArtifact / patchArtifact），让后续 tool 在 session-store 里仍能按 artifactId 读到。

等等 —— 任务明确说"保守策略：静默 skip，**不再** fallback 到 session-store。简化后续 Phase 7d 清理"。所以：
1. workspace 有 → 只写 workspace，**删掉** session-store 写。
2. workspace 无 → 什么都不写（tool 行为退化为 "LLM call 出结果但无处落地"）。

这意味着：workspace 有 workspace 时，**research-draft-section 等后续 tool 就要从 workspace relPath 读回 envelope**（因为 session-store 已经没了）。

这又撞上第 4 节的"读入保留"原则 —— 自相矛盾。

**重新决策（关键）**：
- **research / compute / structure / latex 这几条链式 tool**：第一 tool 不写 session-store、后续 tool 无法查 → 链断。所以这几个 tool 的 `upsertArtifact/patchArtifact` 需要**继续留写入 session-store**，workspace emit 作为**附加写**（非互斥）。这与任务描述的"不再 fallback"有冲突，但不这么做会破坏整个 research-flow / compute flow / structure-modify 链。
- `invoke-developer` 的 compute-pro artifact：独立产物，LLM 下一步可能调 compute_run（吃 artifactId）；所以也要双写。
- `focus-artifact`：纯 UI 操作，改走 `ctx.orchestrator?.openFile(cache.lookupRelPath(artifactId))` 需要一张 id → relPath 映射表，不值得；**保留不变**。

**最终决策**：
1. 本期为 artifact 写入提供"workspace 附加写"，**同时保留** session-store 写 —— 与任务描述"不再 fallback"冲突，但技术上必须；这是"Phase 7c 中途态"。文档里标注清楚 Phase 7d 需要把读路径也迁掉，session-store 写才能拔。
2. 不破坏任何已有 artifactId 语义 —— LLM 看到的 artifactId 仍是 session-store 的那个。workspace 写入纯粹是"把 artifact 快照落盘到 workspace，供 Explorer / File watcher 感知"。
3. 链上每个 tool（draft/finalize）的 `patchArtifact` 调用，在 workspace 有 workspace 时，**也 emit 一次 workspace**（新文件名从 artifactId 派生稳定）—— 这才是"Phase 7c 的价值"：Explorer 能看到 artifact 文件。
4. 不新增 `patchFile(relPath, patch)` API —— 因为我们保留"以 artifactId 为权威"的数据路径；workspace 写是从 session-store 快照重刷整个文件。用 `emitArtifact` 的 `id` hint 固定 envelope id，basename 固定文件名，每次重写同一个文件 = 等价 patch。

## 6. 修正后的迁移骨架

```ts
// 每个 artifact 写入点（upsert / patch）后追加：
if (ctx.orchestrator && ctx.orchestrator.fs) {
  try {
    await ctx.orchestrator.emitArtifact(
      '<kind>',
      artifactPayloadSnapshot,
      {
        basename: `${slug}-${artifactId}`,  // 稳定命名 → patch 等价
        id: artifactId,                     // envelope id 复用 artifactId
        meta: { title, artifactId, sessionId: ctx.sessionId },
      },
    )
    // 只在首次创建时 openFile，避免每次 patch 都切焦
    if (firstTime) ctx.orchestrator.openFile(relPath)
  } catch (err) {
    console.warn('[<tool>] workspace emit failed', err)
  }
}
```

对结构 tool：用新的 `emitStructureArtifact(cif, meta, hint)` 写双文件。
对 compute：kind='script'（`.py`）写 code 文本主体 + 可选的 `.json` 元数据；或者简化成只写 `.py` 主体（status/stdout 这些 runtime 态放 session-store）。**简化：compute 只 emit `.py` 文件**，payload 结构态不写到 workspace。

## 7. 对 `orchestrator-ctx.ts` 的扩展

```ts
export interface OrchestratorCtx {
  // ... 现有
  emitTextFile(
    relPath: string,
    text: string,
    opts?: { refreshDir?: boolean },
  ): Promise<void>  // 写任意文本（CIF 主体、py 脚本主体）
  emitStructureArtifact(
    cifText: string,
    meta: Record<string, unknown>,
    hint?: EmitArtifactHint,
  ): Promise<{ cifRel: string; metaRel: string } | null>  // 无 workspace → null
}
```

## 8. 探路结论 → 任务清单

### 改的文件

| 文件 | 改动 |
|---|---|
| `src/lib/agent/orchestrator-ctx.ts` | 新增 `emitTextFile` + `emitStructureArtifact` |
| `src/lib/agent-tools/research-plan-outline.ts` | upsert 后追加 workspace emit |
| `src/lib/agent-tools/research-draft-section.ts` | 每次 patchArtifact 后追加 workspace emit（重写同文件） |
| `src/lib/agent-tools/research-finalize-report.ts` | 同上 |
| `src/lib/agent-tools/compute-create-script.ts` | upsert 后写 `.py` 文本 + emit kind='script' |
| `src/lib/agent-tools/compute-edit-script.ts` | patch 后重写 `.py` |
| `src/lib/agent-tools/structure-from-cif.ts` | `emitStructureArtifact` |
| `src/lib/agent-tools/structure-fetch.ts` | `emitStructureArtifact` |
| `src/lib/agent-tools/structure-modify.ts` | `emitStructureArtifact`（作为新 child） |
| `src/lib/agent-tools/invoke-developer.ts` | compute-pro upsert 后 emit kind='workbench' |

### 不改（本期）

- 4 个 `latex-*` apply\*Patch helper —— UI 旁路，不走 ctx；留给 Phase 7d/8。
- `focus-artifact.ts` —— 纯 session focus，无 workspace 等价。
- `agent-tasks.ts` / `plan-mode.ts` —— 非 artifact。
- 所有"读 session-store"代码段 —— 读路径整体保留，Phase 7d 统一迁。

### API 约束

- `ctx.orchestrator?.fs` null 时静默 no-op（console.warn 已在 emitArtifact 内）。
- 不改 artifactId 生成策略（仍用 `genArtifactId()`），把 artifactId 作为 envelope.id 传入保证"同一 artifact 同一文件"。
- `emitArtifact` 内部的 `refreshDir` 保留，让 Explorer 即时看到新文件。

## 9. 风险

1. **artifactId ↔ relPath 映射不是 1:1** —— artifactId 唯一但 basename 可能冲突（两个"Research — band gap"同 topic）。缓解：`basename: \`${slug}-${artifactId}\``，artifactId 自带唯一性。
2. **research-draft-section 每次 patch 都重写 workspace 文件** —— envelope `id` 保持不变，`createdAt` 不变，`updatedAt` 更新。文件原子覆盖。chokidar 会报 `change` 事件；Explorer 仅刷新，不重开 tab。
3. **structure-modify 的 new child**：`emitStructureArtifact` 产生新文件名（新 artifactId），不覆盖 source；符合 "modify 创建新 artifact" 语义。
4. **compute .py 文件名冲突**：多个脚本可能共享同 title；落地方案 = `script/${slug}-${artifactId.slice(-6)}.py`。
5. **session-store 仍写**：Phase 7d 计划时需明确列出"先把读路径迁到 workspace 为权威，然后拔 session-store 写"的顺序。

## 10. 落地结果

### 实际改/新建的文件

| 文件 | 变更类型 | 描述 |
|---|---|---|
| `src/lib/agent/orchestrator-ctx.ts` | 扩展 | +`emitTextFile`、+`emitStructureArtifact`、+`StructureArtifactRefs` 接口 |
| `src/lib/agent-tools/research-plan-outline.ts` | 追加 | upsertArtifact 后 workspace emit |
| `src/lib/agent-tools/research-draft-section.ts` | 追加 | patchArtifact 后 workspace emit；新增 slugify import |
| `src/lib/agent-tools/research-finalize-report.ts` | 追加 | patchArtifact 后 workspace emit；新增 slugify import |
| `src/lib/agent-tools/compute-create-script.ts` | 追加 | upsertArtifact 后 emitTextFile `.py` |
| `src/lib/agent-tools/compute-edit-script.ts` | 追加 | patchArtifact 后 emitTextFile `.py` |
| `src/lib/agent-tools/structure-from-cif.ts` | 追加 | upsertArtifact 后 emitStructureArtifact |
| `src/lib/agent-tools/structure-fetch.ts` | 追加 | upsertArtifact 后 emitStructureArtifact |
| `src/lib/agent-tools/structure-modify.ts` | 追加 | upsertArtifact 后 emitStructureArtifact |
| `src/lib/agent-tools/invoke-developer.ts` | 追加 | upsertArtifact 后 emitArtifact workbench |
| `docs/phase7c-findings.md` | 新建 | 本文件 |

### 未改的文件（及原因）

| 文件 | 原因 |
|---|---|
| `workbench-shared.ts` + 9 个 Pro workbench tool | Pro workbench 留给 Phase 7d |
| `latex-selection.ts` / `latex-add-citation.ts` / `latex-insert-figure-from-artifact.ts` / `latex-fix-compile-error.ts` | `apply*Patch` helper 是 UI 旁路（card Approve），不走 ctx |
| `focus-artifact.ts` | 纯 session focus，无 workspace 等价 |
| `agent-tasks.ts` / `plan-mode.ts` | 非 artifact，task tree 留 Phase 7d |
| `list-artifacts.ts` / `get-artifact.ts` / `structure-analyze.ts` / `compute-run.ts` | 纯读取，不写 artifact |
| `agent-context-injection.ts` | 读 `focusedArtifactId`，属于读路径 |

## 11. 验收

- `npm run typecheck` — **0 errors**
- `npm run dev` — Vite 启动正常，http 200
- `useSessionStore` 在 `src/lib/agent-tools/` 的出现次数 = **61 次 / 21 文件**（与迁移前相同）。原因：本期是"workspace 双写"策略，session-store 写保留给链式 tool 读路径。Phase 7d 切断读路径后才能拔 session-store 写。
- **请用户手动执行** `pkill -f "node.*vite" ; pkill -f electron` 清理 smoke 遗留进程。

## 12. 自主决策偏差

1. **session-store 双写保留**：任务描述说"不再 fallback 到 session-store"。实际落地保留了 session-store 写，原因是 artifact-body.tsx + chain tools 的读路径仍依赖 session-store。如果拔掉写，research-draft-section 等后续 tool 查不到 artifact，链断。正确的拔除顺序是 Phase 7d 先把读路径迁到 workspace 为权威，然后拔写。
2. **structure CIF 双文件**：采用选项 B（`.cif` 文本主体 + `.structure.meta.json` 旁路 envelope）。Phase 7a 预设的 `structure-meta` kind 派上用场。
3. **compute `.py` 只写脚本主体**：payload 中的 status / stdout / figures 是 runtime 态，不落盘到 workspace。
4. **invoke-developer 用 `workbench` kind**：compute-pro 是 Pro workbench payload，复用 `workbench` kind 而非新建 kind。
5. **appendStep 保留不动**（选项 A）：agent-tools 下本来就没有直接调 appendStep。
6. **focusedArtifactId 不迁**：agent-context-injection.ts 读 `session.focusedArtifactId`，属于"读路径"范畴，Phase 7c 不动。
7. **patchFile(relPath, patch) 未实现**：因为保留了 session-store 双写，不需要独立的 envelope 原地 patch 语义。Phase 7d 需要时再加。
8. **4 个 latex apply\*Patch helper 不动**：它们从 UI card Approve 按钮调用，没有 ctx，不属于 tool.execute 路径。

## 13. Phase 7d 接手的剩余风险点

1. **读路径迁移**：14 处 `session.artifacts[artifactId]` 读要改成从 workspace 读 envelope。需要一个 `resolveArtifactByIdOrPath(idOrRel)` 抽象，或一个 `artifactIndex: Map<id, relPath>` 缓存。
2. **artifactId → relPath 映射**：Phase 7c 的 workspace 文件名含 artifactId 的最后 6 字符 + slug；需要一个索引结构让 tool 按 artifactId 反查 relPath。
3. **Pro workbench 9 个 tool**：`patchWorkbenchPayload` + `resolveWorkbench` 要迁。
4. **latex apply\*Patch 4 个 helper**：UI 旁路的 session-store 写要迁到 workspace。
5. **focus-artifact**：`session.focusArtifact` → 可能改为 `editorStore.openFile(lookupRelPath(id))`。
6. **agent-tasks / plan-mode**：task tree + plan mode 是 session 概念，Phase 7d 决定是写文件还是保留 in-memory。
7. **artifact-body.tsx**：当前通过 session-store 聚合所有 artifact 渲染 Canvas；Phase 7d 需改为从 workspace index 驱动。
8. **session-store 最终剥离**：上述全部完成后才能拆 `session-store.ts`。
