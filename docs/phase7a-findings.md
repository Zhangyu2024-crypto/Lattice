# Phase 7a 探路 findings

## 1. orchestrator 主文件

- 绝对路径：`/home/huangming20/paper/Lattice-app/src/lib/agent-orchestrator.ts`
- 入口：`runAgentTurn(args: RunAgentTurnArgs): Promise<RunAgentTurnResult>`
- 周边文件：
  - `/home/huangming20/paper/Lattice-app/src/lib/agent-orchestrator-approvals.ts`（approval promise 桥）
  - `/home/huangming20/paper/Lattice-app/src/lib/subagent-runner.ts`（`runSubagent` → `runAgentTurn`）
  - `/home/huangming20/paper/Lattice-app/src/lib/agent-submit.ts`（唯一的用户入口 → `runAgentTurn`）
  - `/home/huangming20/paper/Lattice-app/src/lib/agent-context-injection.ts`（读 session-store，填空输入）
  - `/home/huangming20/paper/Lattice-app/src/types/agent-tool.ts`（`ToolExecutionContext` / `LocalTool`）

## 2. orchestrator 层的 artifact 写入现状

**关键发现：** `agent-orchestrator.ts` 本体**不直接调用** `upsertArtifact` / `patchArtifact` / `appendStep`。它只做 `wsClient.dispatch(...)` 发布 `task_*` / `tool_*` / `approval_required` 事件。artifact / step / transcript 的写入实际上来自两条旁路：

### A. WS handler 反向灌入 session-store

`src/hooks/useWebSocket.ts` 把 orchestrator dispatch 的事件转回 `useSessionStore.getState().appendStep / updateStep / endTask / upsertArtifact / patchArtifact`。orchestrator 自己看起来是"无状态"的，通过 WS 消息总线间接写 session-store。

实际调用点（会话状态写入）：
- `useWebSocket.ts:212` `startTask`
- `useWebSocket.ts:253` `appendStep`
- `useWebSocket.ts:301` `appendTranscript`（summary 消息）
- `useWebSocket.ts:333` `endTask`
- `useWebSocket.ts:534` `updateStep`（approval）
- `useWebSocket.ts:553` **`upsertArtifact`**（`artifact_created` 事件 — orchestrator 自己从未 dispatch 过，目前只有 python 后端走这条路）
- `useWebSocket.ts:562` **`patchArtifact`**（`artifact_updated`）

### B. agent-tools 直写 session-store（Phase 7c 迁移目标）

下列 14 处 agent-tool 写入是 Phase 7c 的目标，**不是** Phase 7a：

| 文件 | 行 | 调用 | 产物 kind |
|---|---|---|---|
| `src/lib/agent-tools/research-plan-outline.ts` | 166 | upsertArtifact | research-report |
| `src/lib/agent-tools/research-draft-section.ts` | 187, 252 | patchArtifact | research-report |
| `src/lib/agent-tools/research-finalize-report.ts` | 123 | patchArtifact | research-report |
| `src/lib/agent-tools/compute-create-script.ts` | 121 | upsertArtifact | compute (.py) |
| `src/lib/agent-tools/compute-edit-script.ts` | 133 | patchArtifact | compute |
| `src/lib/agent-tools/structure-modify.ts` | 224 | upsertArtifact | structure |
| `src/lib/agent-tools/structure-from-cif.ts` | 124 | upsertArtifact | structure |
| `src/lib/agent-tools/structure-fetch.ts` | 195 | upsertArtifact | structure |
| `src/lib/agent-tools/latex-selection.ts` | 379 | patchArtifact | latex-document |
| `src/lib/agent-tools/latex-add-citation.ts` | 397 | patchArtifact | latex-document |
| `src/lib/agent-tools/latex-insert-figure-from-artifact.ts` | 452 | patchArtifact | latex-document |
| `src/lib/agent-tools/latex-fix-compile-error.ts` | 199 | patchArtifact | latex-document |
| `src/lib/agent-tools/invoke-developer.ts` | 274 | upsertArtifact | compute-pro |
| `src/lib/agent-tools/workbench-shared.ts` | 81 | patchArtifact | xrd-pro/xps-pro/raman-pro/curve-pro |

### C. 进程级 mirror（非 orchestrator）

- `src/lib/research-mirror.ts:142` `patchArtifact`：从 IPC 拉回 research-report 的 payload。属于 Phase 7d（整条 research-mirror 会被 workspace 存储路径替代）。

### 结论

**Phase 7a 的 orchestrator 层没有"直接 upsertArtifact / appendTranscript / appendStep"要替换。** orchestrator 本体已经是"无状态 dispatch"。真正的工作是**把一个标准 ctx 扩展挂到 `tool.execute(ctx)` 上**，让 Phase 7c 的 tool 迁移有路径可走 —— 每个 tool 能从 ctx 拿到 `fs` / `emitArtifact` / `emitTranscript` / `openFile`，不再直接 import `useSessionStore`。

Phase 7a 自身落地成果 = **"零行为变更"**：
1. 定义 `OrchestratorCtx`（workspaceRoot / fs / emitArtifact / emitTranscript / openFile）
2. 通过 `ToolExecutionContext` 的**新增可选字段**透传给 `tool.execute(input, ctx)`
3. 在 `runAgentTurn()` 中构造一次 ctx，分发给所有 tool 调用（subagent-runner 自动继承，因为 subagent 内部会重建 ctx）
4. 扩展 `file-kind.ts` 枚举覆盖 agent 产出的所有 ArtifactKind，供 Phase 7c `emitArtifact(kind, payload)` 即用

## 3. 新 ctx 形状（建议）

新建文件：`/home/huangming20/paper/Lattice-app/src/lib/agent/orchestrator-ctx.ts`

```ts
import type { IWorkspaceFs } from '@/lib/workspace/fs'
import type { LatticeFileKind } from '@/lib/workspace/fs/types'
import type { TranscriptMessage } from '@/types/session'

export interface EmitArtifactHint {
  dir?: string                          // 默认 `<kind>/`
  basename?: string                     // 默认 `<kind>-<ts>`
  meta?: Record<string, unknown>        // envelope meta
  parents?: string[]                    // 父 artifact 的 relPath，持久化到 meta.parents
}

export interface OrchestratorCtx {
  workspaceRoot: string | null
  fs: IWorkspaceFs | null
  emitArtifact(
    kind: LatticeFileKind,
    payload: unknown,
    hint?: EmitArtifactHint,
  ): Promise<string>                    // 无 workspace 时返回 ''
  emitTranscript(message: TranscriptMessage): Promise<void>  // 无 workspace 时 no-op
  openFile(relPath: string): void
}
```

**在 ToolExecutionContext 上扩展（向后兼容）**：

```ts
// src/types/agent-tool.ts
export interface ToolExecutionContext {
  // ...已有字段
  /** Phase 7a — workspace-first ctx. Tools written against Phase 7c may
   *  call emitArtifact / emitTranscript to persist output as envelopes
   *  instead of session-store mutations. Undefined in headless tests. */
  orchestrator?: OrchestratorCtx
}
```

## 4. 需要改的文件清单

### 必须改（Phase 7a 本期）

| 路径 | 改动 |
|---|---|
| `src/lib/workspace/fs/types.ts` | `LatticeFileKind` union 扩展（见第 5 节） |
| `src/lib/workspace/file-kind.ts` | 扩展名 → file-kind 映射同步 |
| `src/lib/agent/orchestrator-ctx.ts`（新建） | 定义 OrchestratorCtx + 默认实现（emitArtifact / emitTranscript / openFile） |
| `src/types/agent-tool.ts` | `ToolExecutionContext` 可选字段 `orchestrator?: OrchestratorCtx` |
| `src/lib/agent-orchestrator.ts` | 在 `runAgentTurn` 顶端构造 OrchestratorCtx，传入每个 `tool.execute(injected, ctx)` 调用 |

### 随手改（Phase 7a 顺带）

| 路径 | 改动 |
|---|---|
| `src/lib/workspace/migrate-from-session-store.ts` | `ARTIFACT_FILE_MAP` 扩展到新 file-kind；避免走 `.json` fallback（非必须，但是一致性改善） |

### 等 Phase 7b

- 所有 `src/components/canvas/artifacts/*.tsx`（Pro workbench / card 级 patchArtifact）

### 等 Phase 7c

- 所有 `src/lib/agent-tools/*.ts`（14 个写 artifact 的 tool）

### 等 Phase 7d

- `src/lib/research-mirror.ts` —— 整段迁走
- `src/stores/session-store.ts` —— 最终剥离

## 5. file-kind 覆盖差异（迁移风险）

当前 `LatticeFileKind` union 只列 `spectrum | chat | peakfit | xrd | xps | raman | curve | workbench | cif | script | markdown | job | unknown`。

下列 ArtifactKind 尚未覆盖 —— 需新增：

| ArtifactKind | 新 file-kind | 扩展名 |
|---|---|---|
| `research-report` | `research-report` | `.research-report.json` |
| `hypothesis` | `hypothesis` | `.hypothesis.json` |
| `paper` | `paper` | `.paper.json` |
| `inverse-design` | `inverse-design` | `.inverse-design.json` |
| `material-comparison` | `material-comp` | `.material-comp.json` |
| `knowledge-graph` | `knowledge` | `.knowledge.json` |
| `batch` | `batch` | `.batch.json` |
| `optimization` | `optimization` | `.optimization.json` |
| `similarity-matrix` | `similarity` | `.similarity.json` |
| `structure` | 复用 `cif` + 旁路 `structure-meta` | `.cif` + `.structure.meta.json` |
| `compute` / `compute-pro` | 复用 `script` + `workbench`（已覆盖） | `.py` / `.workbench.json` |
| `latex-document` | `latex-document` | `.latex.json` |

**结构 CIF 的特殊处理**：`structure` artifact 的 `payload.cif` 是 CIF 文本（非 JSON），不能包进 envelope JSON 的 payload 原样。Phase 7a 只扩枚举 + 扩展名，真正的"双文件写出"（`.cif` 文本主体 + `.structure.meta.json` envelope）留给 Phase 7c 对应 tool 迁移时实现。

## 6. 迁移风险 & 自主决策

1. **"无 workspace"分支的选择**：`ctx.fs == null` 时 `emitArtifact` **console.warn + 返回 `''`**。理由：
   - Phase 7a 不改动 tools，所有写入仍走 session-store 旧路径，不真的触发 emit\*。
   - 保留 session-store 双写会让 Phase 7d 拔除时"两边都要改"，增加反复。
   - Phase 7c 迁 tool 时，每个 tool 看到 `''` 返回值时自行决定是否也同步走 session-store；这才是正确的分层。
   - 与 `useWebSocket.ts` 现有 `warnNoWorkspaceOnce` 语义一致（丢弃 push、once-warn）。

2. **ctx 的生命周期**：`runAgentTurn` 开头构造一次 `OrchestratorCtx`，整个 turn 复用。workspaceRoot 可能在 turn 中途被用户切换 —— 边缘情况，快照一次已够。

3. **subagent-runner**：`runSubagent → runAgentTurn`，内部 runAgentTurn 会重新构造 ctx，subagent 自动继承新 ctx，不需要显式透传。

4. **file-kind 扩展 → migrate-from-session-store**：`ARTIFACT_FILE_MAP` 需要同步扩展，否则迁移路径走 `.json` fallback（功能不坏，但信息丢失）。

5. **editor-store.openFile** 是同步 action，包装成 `ctx.openFile(relPath)` 无并发风险。

6. **emitTranscript**：依赖 `editor-store.activeChatFile`；为 null 时 no-op。Phase 7c 工具如果要"向 chat 发消息"还是要经过 `useWebSocket` `chat_message` 或 `store.appendTranscript`；emitTranscript 只是给"以后要把文本摘要直接落盘到 chat 文件"的通道预留，**不取代** session-store 的 transcript 维护（那是 Phase 7d）。

## 7. 验收计划

- `npm run typecheck` 0 errors（ctx 新字段全可选、emitArtifact 返回 string 与现有调用方无兼容性问题）
- `npm run dev` smoke（新代码不改变现有 WS / orchestrator 行为路径 —— 没有调用方）
- smoke 后 `pkill -f "node.*vite"` / `pkill -f electron`
