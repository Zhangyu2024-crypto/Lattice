---
title: Pro Workbench v2 —— 给高级用户最大自由度
status: Draft v0.1（方向重定位，取代 PRO_WORKBENCH_PRODUCT_REPORT_2026-04-14.md）
author: Claude (Lattice front-end)
date: 2026-04-14
supersedes: docs/PRO_WORKBENCH_PRODUCT_REPORT_2026-04-14.md
related:
  - docs/RESEARCH_SURVEY_PRODUCT_REPORT_2026-04-14.md
  - docs/SETTINGS_PRODUCT_REPORT_2026-04-14.md
---

# Pro Workbench v2 —— 给高级用户最大自由度

## 0. TL;DR

上一份 Pro Workbench 报告（2026-04-14 早上那份）把产品定位做错了。它提出的 "Pipeline Rail + 渐进披露 + Agent 协作" 是**小白友好**的架构 —— 用视觉轨道规定步骤顺序、把参数藏进折叠 section、让 agent 替用户决策。

用户现在明确说：**Pro Workbench 是给高级用户的最大自由度工具**。两种定位几乎完全相反。

**新命题：Pro Workbench 的价值是"让专家能做他在命令行/脚本里能做的一切，只是更顺手"。**

这要求的设计原则和小白版刚好对调：

| 维度 | 小白版（旧） | Pro 版（新） |
|------|-------------|-------------|
| 参数输入 | 滑块，范围夹紧 | **精确文本输入**，滑块只是副产品 |
| 操作顺序 | Pipeline Rail 隐性规定 | **任意顺序**，什么都能随时跑 |
| 结果展示 | 一句 summary | **全量原始数据可见、可编辑、可导出** |
| 键盘 | 鼠标为主 | **键盘优先**，命令面板是主入口 |
| 单运行 | 每次点按钮得一个结果 | **历史 + 分支**，任何中间态可回放可对比 |
| 自定义 | 固定算法 | **可插自己的 Python 算法** |
| 脚本入口 | 只能跳 Compute workbench | **抽屉式脚本面板**，用变量直接拿到当前 spectrum/peaks |
| 批处理 | 单 artifact 单 spectrum | **多 spectrum 叠加 / 批量** |

---

## 1. "高级用户" 在本领域意味着什么

**目标用户画像**：
- 材料 / 化学 PhD 或资深研究员
- 对 XRD / XPS / Raman 每个参数的数学意义都清楚
- 习惯命令行 / Jupyter / MATLAB；觉得 GUI 滑块"猜"参数很低效
- 需要复现特定文献的分析方法 → 要能改算法、不只是改参数
- 会同时处理 10+ 条样品曲线，要批量 + 对比 + 衍生关系
- 愿意看懂报错、看懂 residual、愿意导出 `y_calc - y_obs` 手动画图

**他们会被什么惹恼**：
- "Top K = 20"：峰超过 20 自动截断，看不到也拿不到
- 滑块 min=0.05 max=2：超出范围的正当诉求（高能区 XRD 可能要 tolerance=5）直接没法输
- 每次改参数都要重新走 Search DB → 等 API 出结果：实际他只想算本地一个简单比值
- Refine 跑完告诉他 "R_wp=7.3%"：他想看全部 phase params、y_calc 数组、残差
- 工具链里只能装到 Agent 模式用：他就是想直接跑，不想跟 agent 聊天
- 想加一个"椭圆峰型 pseudo-Voigt + 非对称因子"自定义 fit：门都没有

---

## 2. 当前实现里"小白"痕迹

读当前代码（Phase 1 重构完成后的状态），Pro 不够 Pro 的地方：

### 2.1 参数输入受限
- `ProSlider` 主导：`prominenceMult` 固定 0.1–10，`tolerance` 固定 0.05–2，`topK` 固定 1–100
- `ProNumber` 有但少见，很多地方强制滑块
- 没有"精确输入 + 滑块 fine-tune"这种专业混合型控件
- 像 `2θ min / max` 虽是数字输入但没有单位选择（2θ vs d vs q）

### 2.2 操作顺序隐性约束
- Section 顺序：Data Quality → Peak Detection → Phase Search → Refinement → Scherrer → Results
- UI 没技术限制跳步，但视觉引导就是这样走
- 真实场景：有经验的人常先 Refine（用 ICSD 一组已知相），再反推 peak，再做相组合——完全不走这个顺序

### 2.3 结果截断 / 不可编辑
- `payload.peaks.slice(0, 40)` 显示（`XrdProWorkbench.panel:260`），剩下的"+N more…"看不见
- Peak table 的每列只读，改 FWHM 得删了手动重加
- Refine 结果只显示 rwp/gof/phases —— `ref.x`、`ref.y_calc`、`ref.y_diff` 是 payload 里的数组，UI 不展示也不暴露导出

### 2.4 无键盘中心化
- 所有动作都靠鼠标点按钮
- 没有命令面板级的 "Run: Refine" 快捷入口
- 每次想重跑一次某 action 要翻面板找按钮（Search DB 埋在 Phase Search 下两层）

### 2.5 无历史 / 无分支
- 改一次 2θ range 点 Refine，之前的 refineResult 直接被覆盖
- 想对比"含 amorphous 的 fit" vs "不含"，只能来回切换复制结果
- 不能 "从上次 Run-04 的状态衍生一条新 Run-05 调一下参再跑"

### 2.6 无脚本逃生舱
- 想跑个"把当前 y 傅立叶变换再画一下"的操作：没法做
- 想"把当前 peaks 导出 numpy 数组到 Python 里"：只能 Export CSV 再 load

### 2.7 单 spectrum 锁定
- 一个 XRD artifact 绑一条 spectrum
- 想对比 sample A 和 sample B：开两个 workbench artifact，两张独立的图，人眼比
- 没法 "在同一张图里叠两条曲线"，更不用说 "A - B"、"A / B"

### 2.8 单位刻板
- XRD 轴永远 2θ (°)；想看 d-spacing (Å) 或 q (Å⁻¹) 得自己算
- XPS 永远 binding energy；想转 kinetic energy 没途径

### 2.9 没有 "region select + run on region"
- 想只对 20°–40° 做 peak detection，其他区不动：没法
- 想只对 Fe 2p 区域 fit，不碰 C 1s：没法（只能设 energy window 但这还是全局）

---

## 3. 重设计原则

### 3.1 显性 > 隐性
每个参数：文本输入可见、范围可突破（仅 warn，不拒绝）、单位可切。

### 3.2 键盘为先
Cmd+K / Ctrl+K 触发 workbench 级命令面板：`run refine`、`detect peaks topk=200 prom=0.02`、`export peaks csv`、`show residual`、`branch from run-04`。

### 3.3 全量数据 + 编辑
任何表格无截断；每行每列可编辑；所有 payload 里的 numpy 数组通过"Send to Script"一键进脚本面板。

### 3.4 历史 + 分支 = 一等公民
每次 action 产生不可变 RunRecord；历史轨道在左侧栏；任一 Run 点击 → 该状态成为当前视图；右键 → "Branch from here" 建分支。对比两个 Run 直接 side-by-side diff。

### 3.5 脚本抽屉随时可用
F12 / "`" 键打开底部抽屉，`spectrum` / `peaks` / `fit` / `candidates` 已绑定为 Python 变量（运行在 `lattice-compute` 容器里）。结果 `return` 回来的 numpy 数组可一键上图作为 overlay。

### 3.6 自定义算法可插
写一个 Python 函数签名 `def my_peak_detect(x, y, **params) -> peaks: ...` 保存到 workbench → 命令面板出现 "detect peaks (my_peak_detect)"，和内置算法并列。

### 3.7 多曲线 + 批量
Workbench 可挂 N 条 spectrum（primary / references / compare set）。命令 `batch refine` 对每条跑同一流水线，结果汇总 diff 表。

### 3.8 单位感知
轴标签可点击循环（2θ ⇌ d ⇌ q；BE ⇌ KE ⇌ λ）。peak 表的 position 列也跟着切；fit params 保留原生单位但显示转换值。

### 3.9 可导出一切
每个面板每个表格都有 "Copy as JSON / CSV / Python"。命令面板支持 `export current spectrum as npz`。

### 3.10 Reproducibility
每 Run 的完整参数 + 输入 hash 都在历史里；导出 "recipe.json" 可在另一个 session 上"replay"，复现别人或者自己以前做过的分析。

---

## 4. 新信息架构

### 4.1 整体布局（桌面尺寸 ≥ 1440 宽）

```
┌─────────────────────────────────────────────────────────────────┐
│ [XRD] sample-A.xy   Run-04* (unsaved)     ⌘K ▸ command palette │  ← top command ribbon
├──┬──────────────────────────────────────────────────┬──────────┤
│  │                                                   │ Inspector│
│H │                                                   │          │
│i │          [ SpectrumChart                  ]      │ Selection│
│s │          primary (obs)  ─── smooth ─── bg        │   Peak 7 │
│t │          fit envelope ·· residual                │   2θ: 31.72│
│o │          overlay: ref TiO2 (anatase)             │   I: 1843│
│r │          cursor: 2θ=31.72  y_obs=1843  ...       │   FWHM:  │
│y │                                                   │   ...    │
│  │─── layer toggles: [✓obs] [✓bg] [smooth] [...] ──│──────────│
│ │                                                   │ Layers   │
│ │ [Spectrum] [Peaks (18)] [Fit] [Phases] [Vars]    │ Bindings │
│ │ ┌─ Peaks ─────────────────────────────────────┐  │ Axis: 2θ │
│ │ │ #  2θ       I     FWHM  SNR   Area   ...    │  │ ⇌ d ⇌ q │
│ │ │ 1  25.28   2103  0.12  45.3  ...             │  │          │
│ │ │ 2  27.44    895  0.08  22.1  ...   (edit)   │  │          │
│ │ │ ...  [sort by ▼] [filter] [copy] [send→script]│  │          │
│ │ └──────────────────────────────────────────────┘  │          │
├──┴───────────────────────────────────────────────────┴──────────┤
│ ▲ Script drawer (`` to toggle)                                  │
│ >>> peaks = detect_peaks(spectrum.y, prom=0.02, topk=200)       │
│ >>> peaks_sample_a.position - peaks_sample_b.position           │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 各区块职责

**Command Ribbon（顶部 32px）**：
- 左：workbench 类型 chip + 当前 spectrum 名 + Run 标识（`Run-04*` 未保存 / `Run-04 (pinned)` 已存档）
- 右：`⌘K ▸ command palette` 唤起 + 热切换 workbench type（XRD → Raman 同样 spectrum）

**History Rail（左侧 32px，悬停展开到 220px）**：
- 时间序 Run 列表
- 每个 Run 缩略：时间 + action + 关键结果 chip（`rwp 7.3%` / `18 peaks`）
- 点击 → 视图切到该 Run；右键 → Branch / Pin / Diff / Export recipe / Delete

**Main Viz（中上，chart）**：
- ECharts canvas, 但所有 layer 都是可 toggle 的 series（obs / bg / smooth / fit / residual / overlay_refN）
- 鼠标 hover：crosshair + multi-field readout
- 拖拽选中 region → command palette 默认 scope 变成 "current region"
- 右键 chart → context menu: "Send to script as numpy", "Fit in region", "Copy region as CSV"

**Data Tabs（中下，tabular）**：
- Spectrum（x/y 表，含派生列如 smoothed/bg/residual）
- Peaks（所有峰表，每个字段可改）
- Fit（fit params + residual 统计）
- Phases（候选相列表 + simulated pattern 开关）
- Vars（类似 Jupyter 的 watch 列表，用户可 pin 任意 payload 路径如 `payload.refineResult.data.phases[0].weight_pct`）

**Inspector（右侧 280px）**：
- 上半：当前选中对象（peak / region / phase / fit component）的全字段展示 + 编辑
- 中间：**Layers** 列表（所有可视化层 + 能见度 + 颜色 + z-order）
- 下半：**Bindings**（轴单位切换 + 映射快捷键）

**Script Drawer（底部抽屉，默认收起，\` 键或 F12 打开 240–480px 可拖）**：
- CodeMirror Python，和 Compute Pro workbench 共用引擎但独立会话
- 预绑定变量：`spectrum`、`peaks`、`fit_result`、`candidates`、`history[-1]` 等
- 返回值（numpy 数组 / dict）：自动作为 overlay 或 inspector 附加字段
- Run 按钮 + `Ctrl+Enter` 快捷 + stdout 输出展示在抽屉右侧

### 4.3 命令面板（⌘K/Ctrl+K）

Pro Workbench 级的命令面板（与 App 级的分层，不冲突）。示例命令：

```
run refine --twoTheta=10-80 --maxPhases=3 --amorphous=false
detect peaks --topk=200 --prominence=0.02 --engine=scipy
search phases --elements="Ti O" --tolerance=0.3 --topK=20
export peaks --format=csv --path=~/analysis/a-peaks.csv
send residual to script
branch from run-04
diff run-03 run-04
convert axis → d-spacing
overlay ref TiO2 anatase
apply recipe my-recipe.json
```

Autocomplete + 参数补全 + 最近命令历史。

---

## 5. 关键交互细节（用例）

### 用例 A：专家快手 fit + 导出 numpy

```
⌘K "run refine --twoTheta=8-90 --maxPhases=4"   ← 跑
⌘K "send y_calc y_obs y_diff to script"         ← 把三组数组塞进脚本 drawer
\` (开 drawer)                                     ← 看到 numpy 数组已绑定
>>> np.savez('~/sample-a-fit.npz', x=spectrum.x, obs=y_obs, calc=y_calc)
Ctrl+Enter                                         ← 脚本在 lattice-compute 容器跑完
```

**10 秒从 fit 到落盘**，零鼠标。

### 用例 B：对比两次 Refinement

```
Run-03: 2θ 5-90, amorphous=false        (已 Pin)
Run-04: 2θ 5-90, amorphous=true         (新)

右键 run-03 → "Diff with run-04"
→ 中央出对比视图: 两张 fit 图并列 + 参数 diff 表（红绿高亮）
→ 明显看到 R_wp 10.2% → 7.3%, 新增了 amorphous hump at 22°
```

### 用例 C：用自己的算法改 peak detection

```
\` 开脚本 drawer:
def my_detect(x, y, min_snr=5, min_fwhm=0.1):
    from scipy.signal import find_peaks
    ...
    return [{"position": ..., "intensity": ..., "fwhm": ...}]

Command: "register as peak_detect"
→ 命令面板多出 "detect peaks (my_detect) --min_snr=5"
→ 下次 ⌘K 就能用
```

保存到 workbench artifact → 分享给同组（export recipe 会带上算法源码）。

### 用例 D：批量跑 10 条样品

```
拖 10 个 .xy 文件进 workbench 的 spectrum list
⌘K "batch apply recipe my-standard-xrd-workflow"
→ 每条跑一遍，结果汇总表：
    sample  R_wp  phases          ...
    A       7.3%  anatase 92%    
    B       8.1%  anatase 80% rutile 17%
    ...
→ 单击任一行 → 切到该样品的 workbench 视图
```

---

## 6. 与现有架构的关系

### 6.1 保留什么（别重写）
- `ProLayout / ProSection / ProButton / ProSlider / ProSelect / ProNumber` 等原子组件 —— 低层继续用，只是在 Pro 模式下换成更精密的模式（`ProSlider` → 精确模式下附加文本输入；`ProSection` → 非折叠+可订阅）
- Action 处理函数（`handleRefine / handleSearchDb / handleDetectPeaks`）—— 这些是 IPC/后端胶水，Pro 版只是换触发入口（命令面板而非按钮）
- Artifact payload 结构 —— 数据仍在 `payload`，新增 `history: RunRecord[]` + `layers: LayerSpec[]` 等字段；现有字段不动
- Compute container + pip 基础设施（CP1–CP6）—— Script Drawer 直接复用

### 6.2 需要新建的子系统
1. **Command Palette（workbench 级）**：新组件，独立于 App 级命令面板
2. **History / RunRecord model**：新的 payload 字段 + 不可变快照逻辑
3. **Layer System**：当前 chart 的 series 是硬编码的 obs/peaks/fit/residual；需改成可注册 + toggle 的 layer 列表
4. **Axis / Unit conversion**：`@/lib/pro-axis.ts` 负责 2θ⇌d⇌q、BE⇌KE 转换
5. **Script Drawer**：CodeMirror + IPC bridge 到 Compute container + `spectrum` / `peaks` 变量序列化
6. **Branch / Diff renderer**：两个 RunRecord 的 side-by-side 对比 UI
7. **User algorithm registry**：workbench-scoped function registry, 持久化为 string 源码
8. **Recipe export / import**：RunRecord 链导出为可分享的 JSON（带数据 hash）

### 6.3 需要升级的现有组件
- `XrdProWorkbench / XpsProWorkbench / RamanProWorkbench` 顶层 shell：原地重写为新 IA（History rail + Main viz + Data tabs + Inspector + Script drawer），保持 action handler 不变
- `SpectrumChart`（在 `pro-chart.ts`）：从"固定 series" 改为 "按 layers 动态装"
- `ProSlider`：支持 `precise` 模式 —— 在 slider 旁边有文本 input，可以输入超范围值（warn 但不拒绝）

### 6.4 与 Pipeline Rail（旧报告）的取舍
**Pipeline Rail 完全不要**。那是小白版。
- 对 Pro 用户 Pipeline Rail 是反模式：规定顺序 = 限制
- 如果未来要做 "Guided" 小白模式，走独立 artifact kind（`xrd-guided`）或独立 tab，不占用 Pro Workbench 的视觉预算

### 6.5 与 Agent 协作（旧报告 §6）的取舍
Pro 模式下 Agent 协作**不是默认**。Pro 用户不喜欢被 "建议你把 2θ 改成 10–65" 打扰。保留 `propose_*` tool schema，但默认**关闭 Agent 的主动建议**；agent 只在用户明确 `⌘K "ask agent"` 时参与。

---

## 7. 信息架构细节（每个模块深潜）

### 7.1 History + RunRecord

**payload 新字段**：
```ts
interface XrdProPayload {
  ...existing fields,
  history: RunRecord[]
  activeRunId: string          // 当前视图对应的 run；null = latest working copy
  pinnedRunIds: string[]
}

interface RunRecord {
  id: string                    // 'run_xyz'
  parentId: string | null       // 分支来源；null = 从空白开始
  createdAt: number
  action: string                // 'refine' / 'detect_peaks' / 'search_phases' ...
  params: Record<string, unknown>
  resultSummary: {               // 轻量，能在 rail 里显示
    key: string                   // 'rwp'
    value: string | number        // 7.3
  }[]
  // 完整的快照：在 action 发生时的 payload 克隆，但只保留变动字段
  stateDelta: Partial<XrdProPayload>
  // 结果派生数据，例如 fit 的 x/y_calc/y_diff；体积大的放这里避免重复快照
  artifacts: {
    yCalcRef?: string             // 引用到 session-store 的 blob 缓存
    yDiffRef?: string
  }
}
```

**持久化策略**：
- RunRecord 全量存 session store（和其他 artifact 一样走 persist）
- 超过某阈值（50 条 / 10 MB）自动开始**折叠未 pin 的 run**（保留 summary + params，丢 stateDelta）
- Export recipe = 取 pinned runs 序列化

**UI**：
- 左侧 History rail 默认 32px 宽，hover 展开 220px
- 每行：时间戳（相对）+ action icon + 一个关键 result chip
- 点击 → "time travel"：当前视图显示那个 Run 的数据；顶部 banner "Viewing Run-03 (pinned). [Return to live]"
- 右键菜单：Branch from here / Pin / Duplicate / Diff with… / Export as recipe / Delete

### 7.2 Layer System

**Layer 类型**：
- `spectrum`: 原始 obs
- `derived`: 预计算的衍生数据（smoothed / background / residual / first-derivative）
- `overlay`: 外部数据（reference pattern / second spectrum）
- `annotation`: 峰标记 / region highlight / cursors
- `fit_component`: 拟合时每个 peak 的单独曲线
- `script_output`: Script drawer 返回的数组

**数据模型**：
```ts
interface LayerSpec {
  id: string
  kind: 'spectrum' | 'derived' | 'overlay' | 'annotation' | 'fit_component' | 'script_output'
  label: string
  visible: boolean
  color: string
  zOrder: number
  source: {
    type: 'payload_path' | 'ref' | 'inline'
    path?: string                 // e.g. 'refineResult.y_calc'
    ref?: string                  // session-store blob ref
    data?: { x: number[]; y: number[] }  // inline 小量
  }
}
```

Inspector "Layers" 面板：列出所有 layer，眼睛图标 toggle visibility，色块 click 改颜色，拖动改 zOrder。

**Chart 组件**重构：按当前激活的 layer 列表组装 ECharts series，而不是硬编码 obs/peaks/fit。

### 7.3 Script Drawer

**已有基础设施**：CP1–CP6 已经把 `lattice-compute` 容器 + Python stdio pipe 搭好（`electron/ipc-compute-container.ts` + `electron/compute-runner.ts`）。Script Drawer 直接复用，不新开容器。

**变量绑定**：drawer 打开时向容器注入一个 prelude 脚本：
```python
import numpy as np
import json, os

# 从环境变量读 workbench 当前状态
_state = json.loads(os.environ['LATTICE_WORKBENCH_STATE'])
spectrum = _DictObj(x=np.array(_state['spectrum']['x']), y=np.array(_state['spectrum']['y']))
peaks = [_DictObj(**p) for p in _state['peaks']]
fit_result = _state.get('refineResult')  # None if not run
candidates = _state['candidates']
```

Electron side: workbench 把当前 payload 序列化进 `env` 传给 docker exec 命令（已经用同样模式做了 `ACTIVE_CIFS / CURRENT_SPECTRUM` 注入）。

**返回值处理**：drawer 脚本结束时，检查 Python 环境里的 `_return` 变量；如果是 `dict`，提示用户 "作为 overlay 添加" / "作为新 peak 列表 replace"；如果是 `numpy.ndarray`，默认加 overlay。

**持久化**：drawer 的脚本内容持久化在 `payload.scriptDraft`（每个 run 独立），用户可以 "Save as recipe" 把当前脚本登记为命名操作。

### 7.4 Command Palette（Workbench 级）

**入口**：`⌘K` / `Ctrl+K`（与 App 级命令面板并存；workbench-scope 时 workbench 级优先）

**实现**：独立于 App `CommandPalette.tsx`；新文件 `src/components/canvas/artifacts/pro/ProCommandPalette.tsx`，接收 workbench context (当前 kind / payload)

**命令语法**：`command-name --flag=value --flag2=value2 positional`

**支持的命令范畴**：
- Action: `run <stage> [params]` — refine / detect / search / fit / quantify
- View: `show <layer>`, `hide <layer>`, `toggle residual`
- Axis: `convert axis <unit>` — d / q / 2theta / BE / KE / …
- Export: `export <target> <format>`
- Script: `send <expr> to script`, `apply recipe <name>`
- History: `branch from <runId>`, `pin run-XX`, `diff <run1> <run2>`
- Registry: `register script as <commandName>`

每个命令实现为函数 `(context, parsedArgs) => void | Promise<void>`，挂载到一个 `commandRegistry` module。用户自定义 script 命令也走同样注册。

### 7.5 Axis / Unit

**XRD**: 2θ (°) ⇌ d (Å) ⇌ q (Å⁻¹)  
λ 来自 `payload.params.refinement.wavelength`
- d = λ / (2 sin(θ))
- q = 4π sin(θ) / λ = 2π / d

**XPS**: BE (eV) ⇌ KE (eV)  
hν (光源能量) 来自 `payload.params.source?.photonEnergy` (新增字段，默认 1486.6 Al Kα)
- KE = hν - BE

**Raman**: Raman shift (cm⁻¹) — 通常不转；可能想要 λ_scattered (nm)：`λ_s = 1 / (1/λ_laser - Δν * 1e-7)`

**实现**：`src/lib/pro-axis.ts` 暴露 `convert(value, from, to, ctx): number` 和 `seriesInAxis(x: number[], from, to, ctx): number[]`。Chart 和 Peak 表都调用它。当前轴存 payload 里 `payload.viewAxis`，保存 run 时一起持久化。

### 7.6 User-defined operations

**注册流程**：
1. 用户在 drawer 里写 `def my_detect(x, y, **kwargs): ...`
2. `⌘K "register my_detect as detect_peaks_variant --args='min_snr,min_fwhm'"`
3. workbench artifact `payload.userOps` 存 `{name, source, signature, kind}`
4. 命令面板扫 `userOps` 生成额外命令
5. 执行时 drawer 注入该函数到 Python 会话并调用

**Security / Isolation**：用户脚本跑在 lattice-compute 容器内，已经隔离（CP1 架构）；不会污染主进程。

### 7.7 Recipes

**Recipe = 一条可在另一个 spectrum 上 replay 的 run 序列**。

```ts
interface Recipe {
  name: string
  workbenchKind: 'xrd-pro' | 'xps-pro' | 'raman-pro'
  createdAt: number
  version: 1
  steps: Array<{
    action: string
    params: Record<string, unknown>
    // 若此 step 依赖 userOp，内嵌算法源码保证可重现
    userOpSource?: string
  }>
  // 期望的输入条件（用于 precheck）
  inputSpec?: {
    xRange?: [number, number]
    axisUnit?: string
  }
}
```

导出 = 用户点 Pin 过的 Run 链；导入 = 粘 JSON / 拖文件 → preview steps → Apply。

---

## 8. 分阶段落地路线

本报告只做分析，不做承诺。把 Pro v2 分成 8 个 Phase，每个独立可合入：

| Phase | 内容 | 依赖 | LoC 估计 |
|-------|------|------|---------|
| **W1** Shell 置换 | 新的 4 区布局（Ribbon + History rail + Main + Data tabs + Inspector + Drawer toggle）；内容先填当前面板直接塞进去；**零功能变化** | — | 新 600 + 改 200 |
| **W2** 精确输入模式 | `ProSlider` 加 precise 文本输入；每个 workbench 的面板从 slider-first 改为 input-first；超范围 warn 不拒 | W1 | 改 500 |
| **W3** Layer system | SpectrumChart 改为 layer-driven；Inspector Layers 面板；obs/bg/smooth/fit/residual/overlay 全改 layer | W1 | 新 500 + 改 300 |
| **W4** RunRecord + History rail | payload.history schema + persist；left rail UI；time-travel 视图 | W1 | 新 700 + 改 300 |
| **W5** Workbench Command Palette | `⌘K` 命令解析器 + registry；把 action handler 都登记成命令；autocomplete + history | W1 | 新 800 |
| **W6** Axis / Unit conversion | `pro-axis.ts` + chart/peak 表支持 axis 切换 | W3 | 新 300 + 改 200 |
| **W7** Script Drawer | CodeMirror + 变量 prelude 生成 + Compute container 管道；返回值 → layer | W1, W3 | 新 800 |
| **W8** User ops + Recipes | userOps registry + recipe export/import + Pin/Diff UI | W4, W5, W7 | 新 1000 |

**总预算**：~5400 LoC 新增 / ~1500 LoC 改；单人 3-4 周全量，但可分批。

**推荐起跳**：**W1 + W2 + W5** 是"让 Pro 用户立刻觉得顺手"的最小组合：布局升级 + 精确输入 + 命令面板。W3/W4/W7 是最有魅力的升级但风险较高，建议 W1 稳定后再推进。

---

## 9. 风险与开放问题

### 9.1 风险

- **向后兼容**：已有 artifact payload 没有 `history / layers / viewAxis` 字段，需要 hydration time migration，不能硬 break
- **性能**：N 个 layer × 高密度 spectrum 渲染可能拖慢；需要 ECharts 的 data sampling + debounced re-render
- **Script drawer 的容器依赖**：如果 lattice-compute 没启 → drawer 禁用 + 清晰引导
- **Command palette 的命令设计是真正的产品**：乱设一通会比按钮还难用；需要和几位真实 Pro 用户跑 3 轮测试再定
- **User-defined algorithms 的分享**：recipe 嵌算法源码 = 有隐私/安全隐患（用户可能不想把本地试验代码发出去）；Export 时提供"scrub user code"选项
- **History 膨胀**：大 session 跑 50+ run 会把 session-store 撑到 MB 级；需要自动折叠策略

### 9.2 开放问题

- **Script drawer 和 Compute Pro Notebook 的关系**：二者都是 CodeMirror + container exec。要共享一个 runtime 会话 vs 每个 workbench 独立？倾向独立（否则 state 污染），但记忆型变量（例如 `my_utils`）可能希望共享
- **Recipe 是文件还是 artifact**：独立 JSON 文件（用户在 Library 里管理）还是 `recipe` artifact 放 Canvas？倾向前者，后者会把 Canvas 搞乱
- **Agent 完全默认关闭还是保留一个快捷入口**：我倾向保留 `⌘K "ask agent ..."` 作为可选，默认不主动建议
- **Multi-spectrum 存哪**：workbench artifact 里多一个 `spectra: Spectrum[]` 数组 vs 多个 artifact 用 "compare group" 元数据关联？前者简单但和 single-spectrum 的 artifact 形态冲突
- **Guided 模式留不留**：上一份报告的 Pipeline Rail 本身不坏，小白的确需要；但不能占用 Pro 的视觉预算。如果留，走独立 artifact kind

---

## 10. 成功指标

- **专家留存**：重度用户（跑 >20 次/周）使用率不降反升
- **键盘操作比例**：>50% 的 action 通过命令面板触发（不是鼠标点按钮）
- **脚本入口使用率**：>30% 的 run 链里至少出现一次 Script Drawer 调用
- **Recipe 复用**：导出过 recipe 的用户 > 20%；跨 session 导入 recipe 的用户 > 10%
- **参数突破率**：文本输入超出"旧滑块范围"的值占所有参数编辑 > 5%（证明滑块范围原本就压抑了合理诉求）
- **History utilization**：≥ 60% 的 session 有 ≥ 2 次 "Branch from past run" 操作

---

## 11. 与其他文档的关系

| 文档 | 关系 |
|------|------|
| `PRO_WORKBENCH_PRODUCT_REPORT_2026-04-14.md`（旧） | **本报告取代它**。旧报告定位为小白引导；Pro 是另一个人群 |
| `RESEARCH_SURVEY_PRODUCT_REPORT_2026-04-14.md` | 原则一致："过程可见、用户能介入"。Pro 版把"介入"强度拉满：不是被动介入 agent 流程，而是主动掌控每一步 |
| `SETTINGS_PRODUCT_REPORT_2026-04-14.md` | 同样走"合并表面 + 去冗余"思路；Pro 版则是"展开全部 + 给控制权"。两条路线互补，不冲突 |
| `CLAUDE.md` | Compute infra 小节（CP1–CP6）是 Script Drawer 的依赖 |

---

## 附录 A · 实现层面注意

- `ProSlider` 的精确模式：在 `common/pro/ProSlider.tsx` 内加一个 `precise?: boolean` prop，true 时 slider 右边多出一个 `<input type="number">`，**无 min/max**（只是建议），`onChange` 里对超范围值 `console.warn` 而非 clamp
- Chart hover readout：ECharts 的 `tooltip.formatter` 里拼装所有 layer 的 y 值，格式化为 monospace 列
- Region select：ECharts 的 `toolbox: { feature: { brush } }` 开启，监听 `brushSelected` 事件
- Command palette autocomplete：fuzzy match 命令名；参数 suggest 从命令 schema 静态声明

## 附录 B · 非目标

- 协作编辑（实时多用户）
- 完整的 Jupyter 替代（Script Drawer 是副脚手架，不是主编辑器）
- 移动端（Pro 桌面优先）
- 可视化仪表盘导出为 Web app（后续 "Snapshot → PDF/HTML" 足够）
