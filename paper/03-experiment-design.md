# 实验设计 (v4)

## Evaluation goal

v4 实验不回答“哪个模型最强”，而回答：

> 与同模型 chat-only 相比，Lattice 这种 tool-grounded workspace 是否能在材料谱图分析这一具体场景下，**降低专家门槛 + 加快从谱图到可信解读的产出**——即让非专家用户也能产出可由专家接受的解读，并让专家用户的单样本成本（时间 + 多工具切换）下降。

所以实验重点不是 autonomous discovery，而是 spectrum-analysis workspace 对专家门槛和时间成本的具体降低。

---

## Lattice 系统组件

论文中应准确描述当前 Lattice-app 架构。

| 组件 | 位置 | 论文中强调的角色 |
|---|---|---|
| Agent Orchestrator | `src/lib/agent-orchestrator.ts` | 多轮 tool-calling loop，支持 abort / loop detection / max iterations |
| Local Tool Catalog | `src/lib/agent-tools/` | 约 80 个 local agent tools，覆盖 spectroscopy、compute、literature、workspace |
| Python Worker | `worker/main.py` + `worker/tools/` | repo-local JSON-RPC worker，注册约 22 个 worker methods |
| Scientific Data | `worker/data/` | XRD/XPS/Raman reference data |
| LLM Proxy | `electron/llm-proxy.ts` | Anthropic / OpenAI / OpenAI-compatible provider path |
| Artifact Workspace | `src/types/artifact.ts` + UI cards | 保存谱图、结构、compute、paper、report 等中间和最终结果 |
| Approval / Permission | `src/types/permission-mode.ts` | normal / auto-accept / read-only / yolo；支持 human-in-the-loop |
| Task Steps | runtime task timeline | 保存工具名、输入摘要、输出、状态，可用于 trace audit |

注意：
- 不写 LLM Proxy 原生支持 Google，除非实际补了 provider adapter。
- 不写持久 transcript 天然保存完整 provider-level `tool_use/tool_result`。当前更稳的说法是：Lattice captures tool steps, tool inputs/outputs, artifacts, and assistant final responses during agent execution.

---

## 试验矩阵

### 主实验

| 维度 | 设置 |
|---|---|
| Tasks | 12 workflow tasks |
| Conditions | Lattice full agent vs chat-only |
| Model | 1 个主力 tool-capable 模型 |
| Repeats | 2 |
| Total | 12 × 2 × 1 × 2 = 48 trials |

### 可选补充

如果时间允许：
- 选 6 个任务
- 加第二个模型
- 6 × 2 conditions × 1 repeat = 12 extra trials

补充实验只用于说明结果不是某个模型的偶然现象，不作为主贡献。

---

## v4.1 narrative 补充实验

新叙事多出两个 claim——降低专家门槛 + 加快产出——主 48 trials 不能直接证明。补三个小实验，约 8 小时，挤进 W3。

### 补 1：Manual baseline（约 3h）

W1 / W2 / W3 各做一次手工流程，关掉 Lattice，用 GSAS-II / CasaXPS / Origin / RRUFF 网页这类传统工具跑，秒表计时；结论做到与 Lattice 同深度就停。**W4 不做**（文献/compute 没有可比 manual 路径）。

产出：`paper/supplementary/c2/manual_baseline/{w1,w2,w3}_log.md` + 一张 Lattice / chat-only / manual 三列时间对比表，进 Section 5.1。

为什么要做：现在 time-to-result 只有 Lattice vs chat-only，chat-only 不能跑工具，比快是 trivial。要支撑"加快产出"必须有 manual 锚点。

### 补 2：Expert blind review（你 1h + 评审 1.5h）

从 48 trials 抽 12 个（每任务 3 个，覆盖两条件）。把 final answer 复制出来，**删掉所有 "Lattice / chat-only / agent" 字样**，编号 T01–T12 随机打乱。映射 `mapping.csv` 自留。

发给一位跑过 XRD 或 XPS 的 postdoc / 高年级 PhD，让对方对每个填一行：

```
T0X: [Yes / Conditional / No]  reason: ___
```

问的就一句：*"Would you accept this interpretation in a student's lab report?"*

产出：`paper/supplementary/c2/blind_review/T01..T12.md` + 解盲后的 2×2 接受率，进 Section 5.1。

为什么要做：interpretation quality 现在是自评。一个外人盲评就够，不必做 user study。

### 补 3：Cross-domain operator（约 3h）

不招第二个人。在 `paper/supplementary/c2/operator_expertise.md` 里诚实自评 XRD / XPS / Raman 各一个 1–5 分。

挑你**自评最低**的那个方法，跑 4 个 extra trials：
- 2 trials Lattice，permission mode 锁 `auto-accept`，**约束自己不编辑、不重试**
- 2 trials chat-only，相同任务

每个 trial 在 trace JSON 末尾追加：

```json
{
  "operator_expertise_self_rated": 2,
  "intervention_policy": "no_edit_no_retry",
  "post_task_confidence": <1-5>,
  "post_task_notes": "..."
}
```

这 4 个 trial 一并塞进补 2 的盲评。

产出：4 个 extra trial JSON + Section 5.3 Case Study 1 加一段 "low-expertise operator" 数据点。

为什么要做："降低专家门槛"是新叙事最 load-bearing 的 claim，但 48 trials 全是同一人跑的，没直接证据。自评低分 + no-edit 是最省事的非专家近似。

### 时间塞进 W3

| 步骤 | 时间 | 何时 |
|---|---|---|
| Pre-flight（确认主模型 + trace exporter） | 0.5h | W3 D1 AM |
| Manual baseline × 3 | 3h | W3 D1 PM |
| Cross-domain extra × 4 | 3h | W3 D2-D3 晚上，穿插 primary trials |
| Blind-review 包 prep + 发出 | 1h | W3 D4 AM |
| 评审回收 + 解盲 + 写 summary | 1h | W4 D1 |
| **合计你的时间** | **8.5h** |

W3 原 25h 预算够，不动 W4 写作。

### 不要做

- 招第二个人做 cross-domain
- W4 manual baseline
- IRB / consent form
- 多模型 ablation 作主实验
- 工具失败注入

---

## 模型选择

最省力原则：
1. 主模型选当前 Lattice-app tool-calling 最稳定的模型。
2. 同一个模型同时跑 Lattice condition 和 chat-only condition。
3. 不把模型名作为论文贡献。

论文写法：

> We used a tool-capable frontier LLM configured through Lattice's provider interface. The evaluation compares the same model under two interaction conditions: Lattice full-agent mode and chat-only mode.

如果投稿前需要具体模型名，再在 Methods 里填入当时实际跑的 provider/model/version。

---

## Conditions 细节

### Lattice full-agent condition

设置：
- composer mode: agent
- permission mode: `auto-accept` 或专用 evaluation workspace 下的 `yolo`
- localWrite tools 自动通过，减少点击成本
- hostExec / compute task 单独记录 approval，因为 `compute_run` 属于 hostExec

保存：
- final answer
- task steps: tool name, input, output, status
- artifacts created or modified
- screenshots of key artifacts
- number of approvals / edits / retries
- wall time

### Chat-only condition

设置：
- 同一个模型
- 不暴露 Lattice tools
- 输入同样的 user prompt
- 如果任务必须读取文件，给 baseline 一个公平的文本摘要或关键数据表，而不是让它凭空猜文件内容

保存：
- final answer
- unsupported numeric claims
- uncertainty statements
- whether it admits missing evidence

---

## 指标

### Primary metrics

| 指标 | 定义 | 为什么体现 Lattice 优点 |
|---|---|---|
| Correctness | 按 rubric 给 0-10 分 | 基本科学结果 |
| Tool-grounded answer rate | final answer 中关键结论是否能回链到 tool output / artifact | Lattice 核心价值 |
| Unsupported numeric claims | 未由工具或输入支持的数值断言数量 | 检验 chat hallucination |
| Artifact completeness | 是否产生预期 artifact，如 xrd-pro、plot、compute artifact | 检验 workspace 价值 |
| Reproducibility packet | 是否保存 input + tool steps + artifact + final answer | 检验可审计性 |
| Interpretation quality | 结论是否可作为可信解读直接交付（reportable, cross-checkable, supporting evidence），且说明证据和限制 | 检验 workspace 是否产出"可用"结果 |
| Expertise required (proxy) | 完成任务所需 human intervention / edit / retry 数量；越低越体现 workspace 把专家约定吸收进工具 | 检验是否降低专家门槛 |
| Time-to-result | 从 prompt 到 final answer 的 wall time | 检验是否加快产出 |

### Secondary metrics

| 指标 | 定义 |
|---|---|
| Uncertainty quality | 低置信度场景下是否表达合理不确定性 |
| Failure recoverability | 失败后能否从 trace 定位工具层/LLM层原因 |

---

## 评分方式

不使用复杂 LLM-judge。每个 trial 手动/半自动评分即可。

### Per-task rubric

每题 10 分：
- 4 分：科学结论正确性
- 2 分：证据链完整性
- 2 分：artifact / trace 完整性
- 1 分：不确定性表达
- 1 分：interpretation 是否完整、可由 trace 复现、且避免 unsupported claims

### Unsupported claim 标注

标注 final answer 中所有：
- 未由 input 提供
- 未由 tool output 支持
- 未由文献/RAG证据支持
- 但被模型写成确定事实的数值或科学结论

例子：
- 没跑 peak detection 却给出精确 peak positions
- 没有 XPS fit 却给出 atomic %
- 没有文献证据却写具体合成条件
- 把 `xrd_refine` heuristic `weight_pct` 写成 rigorous Rietveld phase fraction

---

## Trace capture

最省力实现：
1. 先用 UI 手动跑 12 tasks，保存 session / artifacts / screenshots。
2. 用一个小脚本从 exported session 或 runtime dump 中整理 task steps。
3. 只为最终论文选择 3 个 case study 做精细 trace diagram。

需要保存的字段：

```json
{
  "task_id": "xrd-single-001",
  "condition": "lattice-agent",
  "model": "filled-at-runtime",
  "repeat": 1,
  "final_answer": "...",
  "tool_steps": [
    {
      "tool_name": "detect_peaks",
      "input_summary": "...",
      "status": "succeeded",
      "output_summary": "..."
    }
  ],
  "artifacts": ["..."],
  "score": {
    "correctness": 0,
    "tool_grounded": true,
    "unsupported_claims": 0,
    "artifact_complete": true
  }
}
```

---

## Case studies

选 3 个就够：

### Case 1: Successful tool-grounded workflow
推荐 XRD 或 XPS。展示完整 tool path 和 final answer 如何引用工具证据，并形成下一步实验或分析判断。

### Case 2: Ambiguity handled correctly
推荐 Raman ambiguous 或 noisy XRD。展示 Lattice 产生 ranked alternatives，而不是武断结论。

### Case 3: Chat-only unsupported claim
同一任务下，chat-only 给出没有证据的峰位/相名/定量；Lattice 因工具输出避免或暴露了问题。

---

## 统计展示

样本小，不做过度统计。使用：
- paired comparison table
- bar chart with bootstrap CI if needed
- per-task dot plot
- unsupported-claim counts

写法要克制：

> The compact evaluation is not intended as a model benchmark. It tests whether the system design changes the evidence structure of scientific agent outputs.

---

## 关键实现注意事项

1. `xrd_refine` 写成 approximate whole-pattern fitting，不写 full Rietveld。
2. LLM providers 写 Anthropic / OpenAI / OpenAI-compatible，不写 Google unless implemented.
3. 如果使用 compute task，必须把 `compute_create_script` / `compute_from_snippet` 和 `compute_run` 区分清楚；`compute_run` 只运行已有 compute artifact。
4. 公开前移除硬编码 API key、本地代理和不可公开数据。
5. 论文里不要承诺 70+ / 21 这种模糊旧数字；以实际代码为准，写 "approximately"。
