# Compact Workflow Evaluation 设计 (v4)

## 概述

v4 不做 MatChar-Bench 大型 benchmark。改为一个小而硬的 workflow evaluation，专门验证 Lattice 是否能辅助人类更快完成实验迭代：

- 12 个代表性任务
- 覆盖 XRD / XPS / Raman / literature-compute assisted analysis
- 对应 characterize -> interpret -> decide next experiment 的循环
- 重点看 Lattice-app 的系统价值，而不是模型排行榜
- 可作为 supplementary workflow suite 公开

这个设计的目标是省力：
- ground truth 少
- 任务可人工复核
- 数据可选现有 demo / 公开谱图
- 结果图容易做
- 审稿人能看懂系统优点

---

## 设计原则

1. **任务少但覆盖核心能力**：每个任务都必须展示 Lattice 如何帮助实验反馈更快进入下一步判断。
2. **优先真实 workflow，不追求题量**：从谱图或论文开始，到 artifact / final answer 结束。
3. **评分简单**：人工 rubric + trace audit，不做复杂 LLM-judge。
4. **同模型对照**：Lattice agent vs chat-only baseline，避免模型差异干扰。
5. **可复现**：保存输入、prompt、final answer、tool steps、artifact ids、screenshots。

---

## Workflow suite 结构

```
lattice-workflow-eval/
└── tasks/
    └── <task_id>/
        ├── meta.yaml
        ├── inputs/
        ├── prompt.md
        ├── expected.md
        ├── rubric.md
        └── notes.md
```

### meta.yaml

```yaml
task_id: xrd-single-001
domain: materials_characterization
workflow: xrd_phase_identification
difficulty: medium
expected_tools:
  - open_spectrum_workbench
  - detect_peaks
  - xrd_search_phases
  - plot_spectrum
expected_artifacts:
  - xrd-pro
  - plot
review_points:
  - peak table
  - candidate phase list
  - final phase assignment
data_source: public_or_demo
redistributable: true
```

### expected.md

写人能读的标准答案，不需要复杂 JSON：
- expected final conclusion
- next-step implication
- acceptable alternatives
- required caveats
- numeric tolerances where relevant
- known ambiguous points

### rubric.md

每题 10 分：
- 4 分：最终科学结论
- 2 分：是否使用正确工具 / workflow
- 2 分：是否产生可审计 artifact
- 1 分：是否正确表达不确定性
- 1 分：下一步实验/分析建议是否被证据支持，且避免 unsupported numeric claims

---

## 12 个任务建议

### A. XRD workflows (4 tasks)

| ID | 任务 | Lattice 工具 | 评分重点 |
|---|---|---|---|
| xrd-single-001 | 单相 XRD phase identification | `open_spectrum_workbench` -> `detect_peaks` -> `xrd_search_phases` | 相名、主要峰匹配、是否给出候选排序 |
| xrd-single-002 | 有噪声单相 XRD | `detect_peaks` -> `assess_spectrum_quality` -> `xrd_search_phases` | 噪声下是否保守表达 |
| xrd-mix-001 | 双相 XRD 候选识别 | `detect_peaks` -> `xrd_search_phases` -> `xrd_refine` | 两个相是否识别；不把 heuristic wt% 写成严格 Rietveld |
| xrd-plot-001 | XRD 结果图与解释 | `detect_peaks` -> `xrd_search_phases` -> `plot_spectrum` | 是否产生 plot artifact；图注是否和工具结果一致 |

注意：当前 `xrd_refine` 是 approximate whole-pattern / pseudo-Voigt / isotropic fit，不写 full Rietveld。

### B. XPS workflows (3 tasks)

| ID | 任务 | Lattice 工具 | 评分重点 |
|---|---|---|---|
| xps-charge-001 | C 1s charge correction | `open_spectrum_workbench` -> `xps_charge_correct` | charge shift、是否说明校正基准 |
| xps-fit-001 | XPS peak fitting + chemical state | `xps_fit_peaks` -> `xps_validate_elements` | BE assignment、fit components、是否避免过度确定 |
| xps-quant-001 | 多元素相对定量 | `xps_fit_peaks` -> `xps_validate_elements` | atomic % 是否在容差内；是否说明 RSF / fitting caveat |

### C. Raman workflows (2 tasks)

| ID | 任务 | Lattice 工具 | 评分重点 |
|---|---|---|---|
| raman-id-001 | Raman compound identification | `open_spectrum_workbench` -> `detect_peaks` -> `raman_identify` | compound candidate、峰位匹配 |
| raman-ambiguous-001 | Raman ambiguous candidates | `detect_peaks` -> `raman_identify` | 是否给 ranked alternatives，而不是单一武断答案 |

### D. Literature / compute assisted workflows (3 tasks)

| ID | 任务 | Lattice 工具 | 评分重点 |
|---|---|---|---|
| paper-rag-001 | 从论文中提取实验条件 | `literature_search` / `paper_rag_ask` | structured fields、引用位置、是否 grounded |
| paper-rag-002 | 文献支持的谱图解释 | `paper_rag_ask` + spectrum tools | 是否把文献证据和谱图证据分开，并说明下一步判断 |
| compute-001 | 生成并运行一个轻量 Python 分析脚本 | `compute_check_health` -> `compute_create_script` -> `compute_run` | artifact 是否可复现；stdout / result 是否被正确解读 |

---

## Baseline 条件

### Condition 1: Lattice full agent

用户给同样 prompt，允许 agent 调用 Lattice tools。保存：
- final answer
- task steps / tool calls
- artifacts
- screenshots
- intervention count

### Condition 2: Chat-only baseline

同一个模型、同一个 prompt，但不允许工具调用。输入中只提供必要的文本化数据摘要或文件描述。

评分重点：
- 是否编造峰位、相名、binding energy、文献事实
- 是否承认缺少数据或工具
- final answer 是否可被复现

---

## 为什么这个设计能反映 Lattice-app 优点

| Lattice 优点 | 在任务中如何体现 |
|---|---|
| Tool-grounding | XRD/XPS/Raman 任务必须调用分析工具才能得出结论 |
| Artifact workspace | 每个 full-agent 任务都检查是否生成可审计 artifact |
| Traceability | 保存 task steps / tool input / tool output |
| Human-in-the-loop | 记录 approval / edit / review point |
| Experimental iteration | 从 characterization evidence 形成下一步实验/分析建议 |
| Reproducibility | 输入、工具链、artifact、final answer 形成 packet |
| Multi-modal scientific workflow | 谱图 + 文献 + compute 混合任务 |

---

## 最小数据来源策略

优先级：
1. repo 已有 demo 数据 / worker reference data
2. 可再发布的公开谱图数据
3. 自己合成的简单 XRD / Raman / XPS-like spectra，用于 workflow demonstration
4. 文献任务使用 open-access paper 或 repo 内可公开 PDF

避免：
- 需要复杂版权确认的数据
- NIST 等不能轻易再分发的原始数据
- 需要专家长时间复核的化学反应题
- 三相严格 Rietveld / 高精度定量任务

---

## 输出物

最终公开时只需要：
- `tasks/` 目录
- 每个 task 的输入和 rubric
- Lattice full-agent outputs
- chat-only outputs
- scoring sheet
- selected screenshots / trace diagrams

这不是要建立长期 leaderboard，而是服务第一篇 Lattice 系统论文。
