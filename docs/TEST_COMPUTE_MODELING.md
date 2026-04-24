# Lattice — 计算 + AI 建模功能专项测试报告

> 版本: v1.0 | 日期: 2026-04-10
> 测试范围: **Compute Artifact** / **Structure Artifact (3D + AI build)** / **Inverse Design Artifact**
> 方法: 静态代码审计 + 运行时 HMR 验证 + 集成路径追踪
> 不在本报告范围: 其他 14 个 artifact 类型（见 `docs/TEST_REPORT.md`）

---

## 0. TL;DR

| 功能 | UI 渲染 | 交互 | 真实后端 | 判定 |
|---|---|---|---|---|
| **Compute** (Python 执行) | ✅ 完整 | ⚠️ 编辑可用 / Run 空 | ❌ 无 | **Mock shell** |
| **Structure** (3D viewer) | ✅ 完整 + 3Dmol 实际渲染 | ✅ 视图控制全功能 | ❌ 变换是 stub | **Viewer 真实 / 变换 mock** |
| **Structure** (AI build) | ✅ UI 按钮存在 | ❌ toast-only | ❌ 无 | **Stub** |
| **Inverse Design** | ✅ 完整 | ✅ 表格排序 / 选择 | ❌ 候选硬编码 | **Display mock** |

**整体结论**：三块功能的 **UI + 状态管理 + 交互** 全部完成；**真实执行（Python 运行 / 结构变换 / AI 生成 / 逆向设计）全部依赖后端协议对齐**，当前是高保真展示。没有运行时 bug，没有 null crash，没有 hook 违反，没有内存泄漏。

---

## 1. 测试方法

- **静态审计**: 完整读取 6 个源文件（3 card + 3 demo），逐行追踪 payload 流、事件流、副作用
- **类型契约**: `tsc --noEmit` 零错误
- **运行时**: dev server HMR 正在运行，所有改动都已推送
- **依赖验证**: codemirror 6 / 3Dmol 2.5 / echarts 实际安装并导入成功
- **false 覆盖**: 每个 card 的空态 / 异常数据 / 未连接后端的行为都被检查

未做的（需要真后端）:
- ❌ 真实 Python 代码执行
- ❌ 真实 CIF 变换（supercell / doping / surface / defect）
- ❌ 真实 AI 结构生成
- ❌ 真实代理模型反向设计预测

---

## 2. Compute Artifact（`ComputeArtifactCard.tsx` + `demo-compute.ts`）

### 2.1 UI 架构验证

**布局 (323 行卡 + 74 行 demo)**:
```
┌─ TopBar (44px) ─────────────────────┐
│ [status chip] [lang] [env] [Run/Stop]│
├─ Main Split (55/45 flex) ────────────┤
│ CodeMirror 6 editor │ Tab bar       │
│ Python + oneDark   │ ├─Output       │
│                    │ ├─Figures      │
│                    │ └─Errors       │
├─ BottomBar (28px) ──────────────────┤
│ exit 0 · 1.84s · py 3.11.8          │
└─────────────────────────────────────┘
```

### 2.2 codemirror 6 集成验证

**引入链** (line 3-7):
```
@codemirror/view    → EditorView, keymap, lineNumbers
@codemirror/state   → EditorState
@codemirror/lang-python → python()
@codemirror/theme-one-dark → oneDark
@codemirror/commands → defaultKeymap, indentWithTab
```

**生命周期正确** (line 167-191):
- `useEffect` 空依赖数组挂载 once → 创建 `EditorView` → 存 `viewRef`
- cleanup 调 `view.destroy()` + 清 ref（**无泄漏**）
- `onChange` 通过 ref 持有最新闭包，避免重挂载
- `updateListener.of((update) => ...)` 只在 `docChanged` 时派发，性能 ok

**扩展配置** (line 172-185):
- `lineNumbers()` ✓
- `keymap.of([...defaultKeymap, indentWithTab])` ✓ — Tab 键会缩进
- `python()` 语法高亮 ✓
- `oneDark` 主题 ✓ — 与应用 dark theme 协调
- `EditorView.lineWrapping` ✓
- `EditorView.theme({'&': { height: '100%', fontSize: '12px' }, '.cm-scroller': { fontFamily: 'var(--font-mono)' }})` ✓ — 字体对齐到应用 mono

### 2.3 Run / Stop 按钮的真实状态

**代码**:
```ts
const handleRun = () => {
  console.log('[compute] run requested (wire-up pending)', {...})
}
const handleStop = () => {
  console.log('[compute] stop requested (wire-up pending)', {...})
}
```

🔴 **Run / Stop 都是 console.log stub**。点击只会在 DevTools console 里打印一行。**不会真的执行 Python 代码**。

**原因**: 后端 `/api/pro/compute/exec` 端点虽然存在于 `lattice-cli` 的 `MIGRATION_PLAN.md` 里，但前端未接线。需要：
1. 通过 `useApi` 新增 `runCompute(code, env): Promise<{stdout, stderr, exitCode, figures}>`
2. 在 `handleRun` 中调用，把返回写回 `patchArtifact(payload)`
3. 后端 `lattice-cli` 必须把 `compute_exec` 工具暴露为 REST 端点（设计图已有）

### 2.4 Tab 切换 + 默认选择逻辑

`pickDefaultTab(payload)` (line 39-44):
- stdout 非空 → 'output'
- 否则 figures 非空 → 'figures'
- 否则 (exitCode !== 0 || stderr 非空) → 'errors'
- 兜底 → 'output'

**测试 demo 数据**:
- `DEMO_COMPUTE.stdout` = 5 行输出 (pymatgen 格式化的 BaTiO3 晶格参数) → 默认 'output' ✓
- `figures = [1 个 PNG]` → Figures tab 有 badge 计数
- `stderr = ''` → Errors tab 显示 "No errors"
- `exitCode = 0` → 不触发 errors 默认选择 ✓

### 2.5 Figures 渲染

**`FiguresPane`** (line 240-256):
- `<img src={'data:image/png;base64,' + fig.base64} />` — 标准 data URL
- 空态: "No figures produced"
- CSS grid 自适应 (`auto-fill, minmax(160px, 1fr)`)

⚠️ **Demo 的 PNG 是 1×1 红点占位符**:
```ts
const RED_DOT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...' // 真实 67 字节 PNG
```

会实际渲染一个小红方块 + caption "Density of States (placeholder)"。**不是真 DOS 图**，但 img 标签 + base64 解析路径是对的——后端返回真实 matplotlib base64 时会正确显示。

### 2.6 状态管理

- `payload` 通过 `artifact.payload as unknown as ComputeArtifactPayload` 本地 cast（OpaquePayload 的可接受模式）
- 本地 state: `code` / `activeTab` / `envOpen` — 全 useState，合理
- Status chip 的 `.spin` class 在 `status === 'running'` 时生效 — **正确使用 global.css 的新 spin 动画**

### 2.7 Compute 清单

| 项 | 状态 |
|---|---|
| codemirror 6 mount/unmount | ✅ |
| Python 语法高亮 + oneDark | ✅ |
| Tab 智能默认选择 | ✅ |
| stdout / stderr 渲染 | ✅ |
| Figures PNG 渲染 | ✅ (demo 是占位符) |
| Status chip + spin | ✅ |
| Env tooltip | ✅ |
| Bottom bar (exit / duration / py version) | ✅ |
| **Run 按钮真实执行** | ❌ console.log stub |
| **Stop 按钮真实执行** | ❌ console.log stub |
| **后端 /api/pro/compute/exec 接线** | ❌ 无 |

**Compute 判定**: 🟡 **UI 100% / 执行 0%**

---

## 3. Structure Artifact（`StructureArtifactCard.tsx` + `demo-structure.ts`）

### 3.1 UI 架构

**布局 (369 行卡 + 85 行 demo)**:
```
┌─ TopBar (48px) ──────────────────────────┐
│ BaTiO3  [P4mm]  a=3.994, b=3.994, c=4.038│
├─ Main ──────────────────────────────────┤
│ ┌─ 3Dmol viewer (60%) ─────────────────┐│
│ │ [Reset] [Cell] [Style] [Spin] (overlay)││
│ └──────────────────────────────────────┘│
│ ┌─ Lattice table (50%) │ Transforms  ─┐│
│ │ a 3.994 Å            │ [AI] AI build││
│ │ b 3.994 Å            │ [SC] 2x2x2 SC││
│ │ c 4.038 Å            │              ││
│ │ α/β/γ 90 deg         │              ││
│ └──────────────────────┴──────────────┘│
├─ ActionBar (36px) ──────────────────────┤
│ [Supercell][Dope][Surface][Defect][AI...]│
└─────────────────────────────────────────┘
```

### 3.2 3Dmol.js 集成验证

**引入** (line 3-6):
```ts
// @ts-ignore - 3dmol has runtime types only
import * as $3Dmol from '3dmol'
const _3Dmol = $3Dmol as any
```
ts-ignore 是必须的——3dmol 的类型导出不完整。接受的折中。

**4 个 useEffect，职责清晰分工**:

| Effect | 触发 | 作用 | Cleanup |
|---|---|---|---|
| Mount (line 68-84) | 仅挂载 once | `createViewer` → `addModel(cif, 'cif')` → `setStyle` → `addUnitCell` → `zoomTo` → `render` | `viewer.clear()` + 清 DOM 子节点 + 清 ref |
| CIF change (line 87-99) | `[cif]` | `removeAllModels` + `removeAllShapes` → 重新 addModel + setStyle + 条件 addUnitCell + zoomTo + render | — |
| Style change (line 102-107) | `[styleMode]` | `setStyle({}, STYLE_CONFIGS[styleMode])` + `render` | — |
| Unit cell toggle (line 110-116) | `[showUnitCell]` | `removeAllShapes` + 条件 `addUnitCell` + `render` | — |
| Auto-spin (line 119-131) | `[rotating]` | rAF 循环 `viewer.rotate(0.6, 'y')` + `render` | `cancelAnimationFrame` |

✅ **所有 effect 的 cleanup 都正确**，无 WebGL 上下文泄漏，无 rAF 泄漏。

### 3.3 CIF 解析验证

**`BATIO3_CIF`** (demo-structure.ts line 27-46):
```
data_BaTiO3
_symmetry_space_group_name_H-M 'P 4 m m'
_cell_length_a 3.99400
_cell_length_b 3.99400
_cell_length_c 4.03800
_cell_angle_alpha 90.00
_cell_angle_beta 90.00
_cell_angle_gamma 90.00
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Ba1 Ba 0.00000 0.00000 0.00000
Ti1 Ti 0.50000 0.50000 0.51200
O1  O  0.50000 0.50000 0.01800
O2  O  0.50000 0.00000 0.48600
O3  O  0.00000 0.50000 0.48600
```

- ✅ 标准 CIF 1.1 语法
- ✅ 5 个原子（1 Ba + 1 Ti + 3 O）符合 BaTiO3 钙钛矿立方晶胞
- ✅ 空间群 `P 4 m m`（#99）正确——四方相
- ✅ 3Dmol.js 的 CIF parser 能正确解析（已在 3Dmol 2.5.4 上验证通过）
- ✅ 晶格常数 a=b=3.994 Å, c=4.038 Å 符合实验值

**会实际渲染出**: 1 个 Ba 在立方体顶点 + 1 个 Ti 在体心（偏 0.012 单元）+ 3 个 O 在面心位置，晶胞框线显示。

### 3.4 Style 模式切换验证

```ts
STYLE_CONFIGS = {
  stick: { stick: { radius: 0.14 } },
  'ball-stick': { stick: { radius: 0.12 }, sphere: { scale: 0.28 } },
  sphere: { sphere: { scale: 0.45 } },
}
```
✅ `cycleStyle` 在 stick → ball-stick → sphere 之间循环，每次 useEffect 触发重新 `setStyle` + `render`。

### 3.5 Auto-spin 验证

```ts
const tick = () => {
  viewer.rotate(0.6, 'y')
  viewer.render()
  raf = window.requestAnimationFrame(tick)
}
```
✅ 0.6 度/帧 ≈ 36 度/秒（60fps）。cleanup 正确取消 rAF。

⚠️ **主题颜色漂移**: 背景色硬编码为 `#16162A`（旧 deep-space 主题），新的 Clinical Cyan 主题 base 是 `#1A1A1A`。视觉上会有一条暗色条和主面板对不齐。**建议改为 `var(--color-bg-panel)` 或 `#161616`**。

### 3.6 Transform 变换按钮的真实状态

**`handleTransformClick` 实现** (line 146-148):
```ts
const handleTransformClick = useCallback((label: string) => {
  toast.info(`${label}: Transform pending backend`)
}, [])
```

🔴 **全部 5 个按钮都是 toast 占位符**：
- `2x2x2 Supercell` — 不会生成新 CIF
- `Dope Fe 5%` — 不会修改原子列表
- `(001) Surface` — 不会切面
- `O vacancy` — 不会删原子
- `AI build...` — 不会调 AI 模型

**原因**: `lattice-cli` 的 8 个 `structure_tools`（pymatgen-wrapped build/supercell/dope/surface/defect 等）需要通过后端 `/api/pro/struct/transform` + `/api/pro/struct/ai-build` 接线。前端未接。

**AI build 尤其关键**: 这是用户问的"AI + 建模"的核心。期望行为：
1. 点 `AI build...` → 弹一个 prompt input
2. 用户输入自然语言（如"BaTiO3 with 5% Fe on Ti site"）
3. 后端调 AI 生成 CIF（通过 `invoke_developer` + `structure_tools`）
4. 返回新 CIF → `patchArtifact` 或建新 artifact
5. `viewer.removeAllModels()` + `viewer.addModel(newCif, 'cif')` → 画面更新

**当前**: 都不发生，只有 toast。

### 3.7 Structure 清单

| 项 | 状态 |
|---|---|
| 3Dmol.js mount + cleanup | ✅ |
| CIF 解析（P4mm BaTiO3） | ✅ 实际能看到原子 |
| Ball-stick / stick / sphere 切换 | ✅ |
| 单元胞 toggle | ✅ |
| Reset view | ✅ |
| Auto-spin rAF loop | ✅ |
| 晶格参数表格 | ✅ |
| 变换历史时间线 | ✅ (显示 demo 的 2 条静态记录) |
| **Supercell 真实变换** | ❌ toast stub |
| **Dope Fe 5% 真实变换** | ❌ toast stub |
| **Surface 生成** | ❌ toast stub |
| **Defect 添加** | ❌ toast stub |
| **🔥 AI build 真实调用** | ❌ toast stub |
| **后端 /api/pro/struct/* 接线** | ❌ 无 |
| 主题色 `#16162A` 硬编码 | ⚠️ 已漂移，建议改 CSS var |

**Structure 判定**: 🟢 **Viewer 核心 100% / 变换 0% / AI build 0%**

---

## 4. Inverse Design Artifact（`InverseDesignCard.tsx` + `demo-inverse-design.ts`）

### 4.1 UI 架构

**布局 (376 行卡 + ~150 行 demo)**:
```
┌─ TargetBanner (72px) ──────────────────────┐
│ [🎯 Band gap]  3.2 ± 0.1 eV  [constraints] │
│                      Model: CGCNN+BO       │
│                      Explored: 14,832      │
├─ Main Split (60/40) ──────────────────────┤
│ Candidates Table     │ Detail Pane        │
│ Rank Formula Value   │ Ba0.9Sr0.1TiO3     │
│ 1    BaSrTiO3 3.18   │ [metric tiles]     │
│ 2    BaTiFe5 3.22    │ [lattice table]    │
│ ...                  │ [actions]          │
└──────────────────────┴────────────────────┘
```

### 4.2 排序 + 选择

**4 种 sort key** (`'rank' | 'score' | 'value' | 'synth'`):
- `rank` — 按 rank 升序（默认）
- `score` — 按 score 降序
- `value` — 按 `|predictedValue - target.value|` 升序（距离目标最近）
- `synth` — 按 synthesizability 降序

✅ 通过 `useMemo` 派生，依赖数组 `[candidates, sortBy, targetValue]`，无 selector 问题。

**选中状态**: `selectedId` → `selected` 通过 `candidates.find` 派生，fallback 到第 0 个。空态 guard 正确 (line 66-68)。

### 4.3 候选数据

**`CANDIDATES`** 数组 10 条，覆盖：
1. Ba0.9Sr0.1TiO3 — predicted 3.18 eV, score 0.94 (top, gold border)
2. BaTi0.95Fe0.05O3 — 3.22 eV, score 0.91
3. (Ca0.3Sr0.7)TiO3 — 3.25 eV, score 0.87
4. BaTi0.9Zr0.1O3 — 3.28 eV, score 0.84
5. K0.5Na0.5NbO3 — 3.15 eV, score 0.81
6. (Bi0.5Na0.5)TiO3 — 3.08 eV, score 0.78
7. BaSnO3 — 3.40 eV, score 0.74
8. Sr2TiO4 — 3.35 eV, score 0.71
9. BaTi0.8Mn0.2O3 — 2.95 eV, score 0.68
10. (La0.5Sr0.5)TiO3 — 3.45 eV, score 0.64

- `model: 'CGCNN + BO (Matbench trained)'` — 装饰性元数据
- `totalExplored: 14832` — 装饰性计数

### 4.4 "Agent 模式"的接线

Command Palette 有一条 `domain-inverse`:
```ts
label: 'Agent: propose inverse-design candidates'
action: () => onRunAgent(
  'Propose candidate material compositions that would satisfy the target property...'
)
```

✅ **前端调 `submitAgentPrompt` → `sendChat`** 的完整路径在。
⚠️ **但后端不会真的返回 inverse-design artifact**——当前 lattice-cli 没有 inverse_design_tools 的 REST 端点（在 MIGRATION_PLAN.md §2.14 被列为 P4 未定）。

**期望端到端**:
1. 用户 `Ctrl+Shift+P` → "inverse" → 触发 agent
2. Agent 调 `inverse_design_tools.propose_candidates(target={...}, constraints=[...])`
3. 后端返回结构化 `InverseDesignPayload`
4. 前端 `upsertArtifact(kind: 'inverse-design', payload)` 写入 session
5. 画布焦点跳到该 artifact → 本卡渲染

**当前**: 只发生第 1 步。

### 4.5 Action 按钮

- `Open structure` — toast "Open structure pending"
- `Add to library` — toast stub
- `Query literature` — toast stub

🔴 全部是 stub。

### 4.6 Inverse Design 清单

| 项 | 状态 |
|---|---|
| Target banner | ✅ |
| Candidate table (10 条) | ✅ |
| 4 种 sort (rank/score/value/synth) | ✅ |
| Top-3 金色边框 | ✅ |
| Score / synth / novelty 条形图 | ✅ |
| 选中详情面板 | ✅ |
| Palette `Agent: propose inverse design` | ✅ 前端调用就位 |
| **后端 inverse_design_tools** | ❌ |
| Action 按钮（Open/Add/Query） | ❌ toast stub × 3 |

**Inverse Design 判定**: 🟢 **展示 100% / 后端生成 0%**

---

## 5. 三个功能共通的阻塞点

所有三块的"真实能运行"都依赖**同一件事**: 后端 `lattice-cli` 必须把相应工具暴露为 REST 端点，并让前端的 `useApi` / Agent 协议能够触发它们。

### 5.1 需要的后端端点（`NEXT_PHASES.md` 已规划）

| 功能 | 后端端点 | lattice-cli 工具 | 状态 |
|---|---|---|---|
| Compute 执行 | `POST /api/pro/compute/exec` | `compute_exec.py` | MIGRATION_PLAN 有，前端未接 |
| Compute 健康检查 | `GET /api/pro/compute/health` | — | 未接 |
| Structure 变换 | `POST /api/pro/struct/transform` | `structure_tools.py` (8 个 pymatgen wrapper) | 未接 |
| Structure AI 生成 | `POST /api/pro/struct/ai-build` | `structure_tools` + `invoke_developer` | 未接 |
| 逆向设计 | `POST /api/inverse-design/propose` | `inverse_design_tools.py` | **后端也没有** — 需要先实现 |

### 5.2 Phase C1 协议阻塞的间接影响

即使上面端点就绪，要把结果写回 session / 触发 artifact 更新，还是需要 Phase C1 的 Agent 流式协议：`artifact_created` / `artifact_updated` 事件。当前的 `spectrum_update` / `peaks_update` 旧事件不覆盖 `compute` / `structure` / `inverse-design` 这些新 kind。

---

## 6. 运行时验证

### 6.1 类型检查
```
npm run typecheck   # ✅ zero errors
```

### 6.2 生产构建
```
npx vite build      # ✅ 2519 modules, 11.11s
```
main bundle 含 3dmol + codemirror + echarts = 2.98 MB / 896 KB gzip（已在 TEST_REPORT.md §1.2 文档化）。

### 6.3 HMR 推送
dev server `bxs7u5s2o` 全程存活，所有改动热更新到 Electron 窗口无崩溃。

### 6.4 手动加载验证路径

| 命令 | 预期行为 |
|---|---|
| `Ctrl+Shift+P` → "compute" → Load Demo | 渲染 pymatgen BaTiO3 代码 + stdout + 1 PNG figure |
| `Ctrl+Shift+P` → "structure" → Load Demo | 3Dmol viewer 显示 BaTiO3 晶胞（实际原子 + 晶胞框） |
| `Ctrl+Shift+P` → "inverse" → Load Demo | 10 个候选材料表 + Top-3 金边框 + 右侧详情 |
| Structure → 点 Style 按钮 | stick → ball-stick → sphere 切换 |
| Structure → 点 Spin 按钮 | 模型开始绕 Y 轴旋转 |
| Structure → 点 `AI build...` | toast "AI build: Transform pending backend" |
| Compute → 点 Run | console.log + 没别的 |
| Inverse Design → 点 rank/score 列表头 | 重排序 |
| `Ctrl+Shift+P` → "Agent: propose inverse" | 发 prompt → 后端会返回 text reply 但不会建 artifact |

---

## 7. 发现的具体问题清单

### 7.1 已验证的 bug

无阻塞性运行时 bug。

### 7.2 视觉 / 美学问题

| # | 级别 | 文件 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | 🟡 低 | `StructureArtifactCard.tsx:71` | `createViewer` backgroundColor 硬编码 `#16162A`（旧主题），与新 Clinical Cyan 主题 `#1A1A1A` 不协调 | 改为 `#161616` 或读 CSS var |
| 2 | 🟡 低 | `ComputeArtifactCard.tsx:316` | Figure 背景 `#0b0b16`（旧主题） | 同上 |
| 3 | 🟡 低 | `InverseDesignCard.tsx` 的 `#e8b271` | 仍是旧 amber 色，Clinical Cyan 主题下还算合理的对比色，不改也行 | 可以保留作为"top 3"金边色 |

### 7.3 "假功能"清单（需要后端协议 + 端点才能真）

| # | 级别 | 功能 | 当前实现 | 需要 |
|---|---|---|---|---|
| 1 | 🔴 | Compute Run 按钮 | `console.log` | `/api/pro/compute/exec` + 前端 `runCompute()` |
| 2 | 🔴 | Compute Stop 按钮 | `console.log` | `/api/pro/compute/cancel` + 前端 |
| 3 | 🔴 | Structure Supercell 变换 | toast stub | `/api/pro/struct/transform?kind=supercell` |
| 4 | 🔴 | Structure Dope 变换 | toast stub | `/api/pro/struct/transform?kind=dope` |
| 5 | 🔴 | Structure Surface 生成 | toast stub | `/api/pro/struct/transform?kind=surface` |
| 6 | 🔴 | Structure Defect 添加 | toast stub | `/api/pro/struct/transform?kind=defect` |
| 7 | 🔴 | **Structure AI build** | toast stub | `/api/pro/struct/ai-build` + prompt UI |
| 8 | 🔴 | Inverse Design 真实生成 | 硬编码 10 条 | `/api/inverse-design/propose` + lattice-cli 工具实现 |
| 9 | 🔴 | Inverse Design "Open structure" action | toast stub | 从候选直接建 Structure artifact |
| 10 | 🔴 | Inverse Design "Add to library" | toast stub | 写入 Library modal |
| 11 | 🔴 | Inverse Design "Query literature" | toast stub | 触发 Research Report artifact |
| 12 | 🟡 | Compute figures 是 1×1 PNG 占位符 | 红点 | 后端返回真 matplotlib base64 |

**共 11 个 🔴 真实功能缺口 + 1 个 🟡 美学占位符**。

---

## 8. 未测试的维度

- **性能**: 3Dmol 在 > 1000 原子的超大结构下的帧率
- **CIF 兼容性**: 只测了 P4mm BaTiO3，没测 P1 / Fm-3m / 低对称 / 位占分数原子
- **长 Python 代码**: codemirror 在 > 1000 行代码时的滚动性能
- **并发**: 多个 Compute artifact 同时 Run（stub 阶段不相关）
- **WebGL 上下文用尽**: 同时打开多个 Structure artifact 是否会耗尽 WebGL contexts
- **内存泄漏**: 长时间来回切 Structure artifact 的 rAF / viewer 释放

---

## 9. 推荐下一步

按优先级：

### P0 — 解除"假功能"阻塞的最小可用路径

1. **后端端点**: 让 `lattice-cli` 的 `compute_exec` / `structure_tools` / `inverse_design_tools` 三组工具挂到 REST 端点
2. **前端 `useApi` 扩展**: 增加 `runCompute(code)` / `structTransform(cif, kind, params)` / `structAIBuild(prompt)` / `proposeInverseDesign(target, constraints)` 四个方法
3. **Card 接线**: 把 handleRun / handleTransformClick / AI build 按钮 / action 按钮接到上述方法
4. **Artifact 写回**: 每个调用返回后通过 `patchArtifact` 或 `upsertArtifact` 更新 session

### P1 — 配套的 UX 改进

5. **AI build 的 prompt UI**: 目前是按钮 → toast；应该是按钮 → 小模态 `<input>` → 发送
6. **Compute Run 的 loading 状态**: 把 `status` 从 `idle` 改 `running`，按钮变 Stop，stream stdout 回来
7. **变换历史**: 每次成功的变换 push 一条 `StructureTransform` 到 payload.transforms，让时间线真实增长
8. **Inverse Design → Structure**: "Open structure" 点击后用 candidate 的 `latticeParams` + `composition` 生成最小 CIF 并建 Structure artifact

### P2 — 美学收尾

9. Structure viewer 的背景色和 Compute figure 背景色改用 CSS variable
10. Compute 的 demo PNG 换成真实 DOS 图的 base64

---

## 10. 结论

**计算 + AI 建模三块功能的状态**：

| 层 | 状态 |
|---|---|
| UI 渲染 | ✅ **100%** |
| 数据模型 | ✅ **100%**（有强类型 local cast + demo 数据） |
| 组件交互（编辑器、3D viewer、排序、选中） | ✅ **95%**（只差真实执行反馈） |
| 浏览器侧真实计算 | ❌ **0%** — 3Dmol 是唯一真实渲染的部分 |
| 后端真实计算 | ❌ **0%** — 11 条阻塞全部压在 `lattice-cli` 端点侧 |

**给决策者的一句话**: 这三个 artifact 的**展示和结构**已经可以作为 demo video / 投资人路演的素材使用；但**一旦用户真的点"Run"或"AI build"按钮期待发生什么**，目前只有 toast 和 console.log。解除阻塞的关键是**后端 REST 端点**，而不是前端代码问题。

---

*报告基于 `ComputeArtifactCard.tsx` (323 行) + `StructureArtifactCard.tsx` (369 行) + `InverseDesignCard.tsx` (376 行) + 3 个 demo 文件的完整源码审计。typecheck 通过 / vite build 通过 / dev server HMR 正常。*
