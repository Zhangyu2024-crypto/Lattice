# 时间线 + 预算 (v4)

## 6 周路线

```
W1          W2          W3          W4          W5          W6
│           │           │           │           │           │
└─Scope+Data┘           │           │           │           │
            └─Run Eval──┘           │           │           │
                        └─Analyze+Figures──────┘           │
                                                └─Write+Submit
```

---

## P1: Scope + 数据准备 (W1)

**交付**:
- 最终确定 12 个 workflow tasks
- 每个 task 写好 `prompt.md / expected.md / rubric.md`
- 选定公开或 demo 输入数据
- 确定主模型
- 决定 permission mode 和 trace capture 方式

**重点**:
- 不为“大 benchmark”扩题
- 不选需要复杂专家复核的数据
- 不选版权不清的数据
- 不做严格 Rietveld / 高精度定量 claim

**工时**: 12-15h

---

## P2: 跑实验 + 保存 trace (W2-W3)

**交付**:
- 12 tasks × 2 conditions × 2 repeats = 48 trials
- 每个 Lattice trial 保存 final answer、tool steps、artifact、screenshots
- 每个 chat-only trial 保存 final answer
- 初步 scoring sheet

**最省力执行方式**:
- 先手动/半自动从 UI 跑，不急着写完整 headless runner
- 只写一个很小的整理脚本或表格模板
- 对最终 3 个 case studies 再补精细 trace 图

**工时**: 18-22h

---

## P3: 分析 + Figures (W4-W5)

**交付**:
- Fig 1 architecture diagram
- Fig 2 workflow lifecycle diagram
- Fig 3 app screenshots / workflow panels
- Fig 4 compact evaluation result
- Fig 5 case-study trace
- Table 1 components
- Table 2 tasks
- Table 3 metrics/results

**分析重点**:
- Lattice 是否减少 unsupported claims
- Lattice 是否更常产生可复现 artifact
- 哪些任务仍失败，以及 trace 能否定位失败点

**工时**: 20-25h

---

## P4: 写作 + 投稿准备 (W6)

**交付**:
- 论文 v1
- supplementary workflow suite
- scoring sheet
- selected trace artifacts / screenshots
- 数据与代码公开清理
- cover letter

**必须清理**:
- 硬编码 API key
- 本地代理配置
- 不可再发布数据
- 任何把 approximate fit 写成 full Rietveld 的措辞

**工时**: 20-25h

---

## 总工时

| 阶段 | 周期 | hours |
|---|---|---|
| P1 Scope + Data | W1 | 12-15 |
| P2 Run Eval | W2-W3 | 18-22 |
| P3 Analyze + Figures | W4-W5 | 20-25 |
| P4 Write + Submit | W6 | 20-25 |
| **总计** | **6 周** | **70-87** |

平均约 12-15 h / week。

---

## 预算

| 项 | 金额 |
|---|---|
| API: 48 trials | $10-25 |
| 补跑 / prompt 调整 | $10-20 |
| 可选第二模型小子集 | $10-20 |
| 数据存储 / release | $0-20 |
| **总计** | **~$30-80** |

无本地 GPU。无大规模 benchmark。无用户研究。无 IRB。

---

## 风险与应对

| 风险 | 应对 |
|---|---|
| 审稿人觉得实验太小 | 明确定位为 system paper；实验是 workflow validation，不是 benchmark |
| 数据不够漂亮 | 选能展示 trace 和 artifact 的任务，而不是追求高难度 |
| Chat-only baseline 不公平 | 给 baseline 同样 prompt 和合理文本摘要；只是不允许工具 |
| Lattice 工具失败 | 失败也是 case study：trace 能定位 tool layer / LLM layer |
| Compute task 太麻烦 | compute 只保留 1 个轻量任务；必要时砍掉 |
| Google/Gemini provider 不支持 | 不写 Google 主实验；只写当前支持的 provider path |

---

## v3 -> v4 对比

| | v3 | v4 |
|---|---|---|
| 论文类型 | benchmark/evaluation paper | system paper + compact workflow evaluation |
| 核心卖点 | X% undetected error rate | tool-grounded auditable scientific workspace |
| 任务数 | 60 | 12 |
| Trials | ~540 | ~48 |
| 模型 | 3 | 1 主模型，可选第 2 模型小子集 |
| 工时 | ~180h | ~70-87h |
| 周期 | 12 周 | 6 周 |
| 主要风险 | ground truth / 统计 / 大规模重跑 | 审稿人是否接受小实验 |
| 最能体现 Lattice 的点 | 部分体现 | 直接体现 orchestrator + tools + artifacts + trace |

---

## 当前推荐

按 v4 走。先做 12 个 workflow 和 3 个 case studies，把 app 的真实优点拍清楚、画清楚、写清楚。等第一篇系统论文成型后，再把 workflow suite 扩展成真正的 MatChar-Bench。
