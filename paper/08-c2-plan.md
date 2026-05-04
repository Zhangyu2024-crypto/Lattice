# C2 详细方案 — Tool-grounded characterization workflows that shorten feedback loops

> Plan v1 — 2026-04-29
> 配合 `01-paper-plan.md` 的三贡献骨架；C1 系统层（已有 `07-c1-section.md` draft），C3 小规模对照评估（待定）。

---

## 1. C2 的角色与边界

### 1.1 它要回答什么问题

C1 给的是一个抽象主张：Lattice 把 LLM agent、tool catalog、Python worker、artifact workspace、approval gates 装进一个可审计的 workspace。C2 的任务是让审稿人**看到**这个主张兑现，并具体落到"降低专家门槛 + 加快产出"这两个谱图分析的核心好处上：

> 给定一个真实表征任务，用户（不必是该方法的资深专家）在 Lattice 中按一个 prompt 启动 agent，能否得到一个**每一处数值都回链到 tool step、每一处人工干预都留痕、最终能作为可信解读直接交付**的回答？

C2 不证明 Lattice 比 chat-only 好（那是 C3），也不重新解释架构（那是 C1）。它只承担一件事：**把抽象架构落到 4 个具体的、可复现的科学工作流上**。

### 1.2 与 C1 / C3 的分工

| 层 | 角色 | 关键证据 |
|---|---|---|
| C1 | 架构主张 | 代码结构 + 4 张架构图 |
| **C2** | **机制可见性** | **4 workflow walkthrough + tool trace + screenshots + supplementary tool-step dumps** |
| C3 | 量化对比 | 12 题 × Lattice / chat-only × 1 模型 × 2 repeats |

C2 是 C1 → C3 的桥。如果 C2 写不出干净的 workflow trace，C3 的 chat-only 对照就没有参照系。

### 1.3 不要做的事

- 把 C2 写成大 benchmark（让位给 C3）。
- 用 cherry-picked one-shot 成功案例（必须包含一处 review/edit 的真实暂停，否则 human-in-the-loop 主张不可信）。
- 把 W1 写成 full Rietveld（按既有决策只能写 approximate whole-pattern + pseudo-Voigt）。
- 在 C2 里给 chat-only 对照（C3 的事）。
- 假装 4 个 workflow 涵盖所有材料表征（明确说"representative"，不是"comprehensive"）。

---

## 2. 四个 workflow 的详细设计

每个 workflow 用同一个 6-字段 schema：

```
Input            → 用户面对的 spectrum 文件 + 自然语言任务
Tool path        → agent 实际调用的 tool 序列
Artifacts        → 产生 / 更新的 typed artifact
Review points    → approval card 弹出位置 + scientist 操作
Final answer     → 论文里粘出来的最终回复（含数值）
Trace anchor     → 每个数值/相/结论 → tool step 的回链
Practical use    → 拿到这个 interpretation 之后怎么用（reportable / cross-checkable / supporting evidence / triggers re-fit）
```

---

### 2.1 W1 — XRD phase identification + approximate fit

**Input**
- Spectrum：α-Al₂O₃ + α-SiO₂ 两相模拟谱（基于 Materials Project mp-1143 + mp-7000，泊松噪声 + 仪器展宽 → 模拟一台 Cu Kα 粉末衍射仪）
- Prompt：*"I have a powder XRD pattern from an aluminosilicate sample. Identify the phases present and give me an approximate phase ratio."*
- 选这个组合的原因：(a) 两相重叠峰够多以测试 ranking、(b) 全部公开 + ground truth 精确、(c) 命中 Lattice 自带的 MP XRD DB（worker/data/mp_xrd_database.db）。

**Tool path**

```
open_spectrum_workbench(file)            → xrd-pro artifact 创建
spectrum.assess_quality(xrd-pro)         → SNR / step / range 检查
spectrum.detect_peaks(xrd-pro)           → peak table（patch xrd-pro）
xrd.search(peaks)                        → top-5 phase candidates per peak group
                                            ↓ review point 1：scientist 锁定 keep set
xrd.refine(peaks, kept_candidates,
           profile="pseudo-voigt")       → scale factors + Rwp + residual
                                            ↓ review point 2：fit 质量是否接受
plot_spectrum(xrd-pro, overlay=fit)      → 独立 plot artifact 输出
cif_db.get(matched_mp_ids)               → 把 CIF 拉到 workspace 做 supplementary
```

**Artifacts**
- `xrd-pro`（含 raw、peak table、candidate list、fit 结果、覆盖图）
- 1× `plot` artifact（fit overlay 图，PDF-quality）
- 2× `structure` artifact（matched CIF）

**Review points**
- RP1（candidate keep）：`xrd.search` 是 `info` cardMode，scientist 在 Pro workbench 中勾选保留候选，不阻塞 agent，但被 transcript 记录。
- RP2（fit accept）：`xrd.refine` 完成后 fit overlay 图弹出 review card；scientist 接受 / 重跑 / 调整起始参数。

**Final answer 模板**
> "The pattern is consistent with **α-Al₂O₃ (corundum, mp-1143)** and **α-SiO₂ (quartz, mp-7000)** as primary phases. Approximate scale factors give ≈ 67 wt% Al₂O₃ and 33 wt% SiO₂ (Rwp = 8.4%, profile = pseudo-Voigt). Largest residual is at 2θ ≈ 26.6°, consistent with quartz (101) but slightly under-fit; refining preferred orientation may close the gap. **This is an approximate whole-pattern fit, not a Rietveld refinement** — wt% numbers should be treated as ratios, not absolute quantitatives."

**Trace anchor**
- 相身份 → `xrd.search` step 输出的 `mp_id` 字段
- wt% → `xrd.refine` step 的 `scale_factors` 字段
- Rwp → `xrd.refine` step 的 `goodness_of_fit.Rwp`
- "approximate, not Rietveld" 这句话来自 worker 的工具元数据（worker 自己声明的 disclaimer）

**Practical use**
- 如果 wt% 用于报告：先做严格 Rietveld 而非引用此结果。
- 如果用于"是否需要重测样品"：当前结果足够支持"组成符合预期、不必重测"。

---

### 2.2 W2 — XPS charge correction + 量化 + 化学态判别

**Input**
- Spectrum：anatase TiO₂ 的 survey + Ti 2p region scan（来自 NIST XPS 数据库或公开文献，附 DOI）。可选 mix：含少量 Ti³⁺ 缺陷的还原态 TiO₂，使 W2 触发 review/edit。
- Prompt：*"Process this XPS data: charge-correct against C 1s, fit the Ti 2p region, and tell me whether there is reduced Ti³⁺ besides Ti⁴⁺."*

**Tool path**

```
open_spectrum_workbench(file)             → xps-pro artifact
xps.lookup("C 1s adventitious", "Ti 2p") → reference BE table
xps.charge_correct(spectrum, ref=C-C)    → BE shift（patch xps-pro）
xps.fit(region=Ti 2p,
        constraints=[doublet 5.7 eV,
                     Ti4+ ≈ 458.8,
                     Ti3+ ≈ 457.2])      → component list（patch xps-pro）
                                            ↓ review point 1：scientist 在 fit 卡片里改 component
xps.quantify(components, rsf="Scofield") → atomic %
xps.validate(components)                 → 检查 doublet 比例、FWHM 合理性 → flags
```

**Artifacts**
- `xps-pro`（含 raw、charge-corrected curve、fit components、quant table、validation flags）

**Review points**
- RP1（fit edit）：`xps.fit` 是 `cardMode: "edit"`，scientist 可以拖动 component 中心、改 FWHM 上下限、勾掉 spurious component → applier registry 应用编辑后才提交到 xps-pro。这是 C1 "post-exec proposal-first" 闸的代表展示。
- RP2（validation flag）：如果 validate 返回 warning（例如 FWHM 太宽），agent 不能强行下结论，必须在 final answer 中报告 flag。

**Final answer 模板**
> "Charge correction shifted the spectrum by +1.2 eV (C 1s adventitious set to 284.8 eV). The Ti 2p₃/₂ region is best fit by two components: **Ti⁴⁺ at 458.7 eV (FWHM 1.1 eV, 78% area)** and **Ti³⁺ at 457.1 eV (FWHM 1.3 eV, 22% area)**. Doublet splitting (5.74 eV) and intensity ratio (2:1) are within literature constraints. Quantification gives Ti:O ≈ 1:1.85 (atomic), consistent with sub-stoichiometric anatase TiO₂₋ₓ. Validation flag: Ti³⁺ FWHM is at the upper bound of the literature range — re-fit with stricter constraint advisable if the Ti³⁺ ratio is the main reportable result."

**Trace anchor**
- BE shift → `xps.charge_correct` step
- 各 component → `xps.fit` step + scientist 在 RP1 的 edit log（task step 记录 `editedOutput`）
- atomic % → `xps.quantify` step
- 警告 → `xps.validate` step 的 `flags` 字段

**Practical use**
- Ti³⁺ 是关键报告 → 重 fit 加紧 FWHM 约束，或用 high-resolution 重测。
- Ti³⁺ 仅作 supporting evidence → 当前结果足够。

---

### 2.3 W3 — Raman peak detection + library 匹配

**Input**
- Spectrum：rutile TiO₂ 的 Raman 谱（RRUFF R040049 或类似公开 ID）。
- Prompt：*"Identify this Raman spectrum."*

**Tool path**

```
open_spectrum_workbench(file)        → raman-pro artifact
spectrum.detect_peaks(raman-pro)     → peak list（patch raman-pro）
raman.identify(peaks,
               library=bundled)       → ranked matches with confidence
                                         ↓ review point：scientist 选 top match 在 UI 中 overlay
```

**Artifacts**
- `raman-pro`（含 raw、peaks、ranked matches、reference spectrum overlay）

**Review points**
- RP1（candidate selection）：scientist 在 ranked list 中点 top-3 之一查看 overlay。这是 **info cardMode**，不阻塞 agent；但选择被记录为 task step。

**Final answer 模板**
> "Best match: **rutile TiO₂** (confidence 0.92, library: bundled-Raman v2024.1). Detected peaks at 447 cm⁻¹ and 612 cm⁻¹ correspond to the Eg and A1g modes of rutile, both within 3 cm⁻¹ of the reference (449, 614). A weak peak at 235 cm⁻¹ is consistent with second-order scattering rather than anatase contamination (which would give 144 cm⁻¹, not detected here). **Single-modality identification — confirm with XRD if quantitative phase purity is required.**"

**Trace anchor**
- match identity + confidence → `raman.identify` step 的 `top_matches[0]`
- 模式归属（Eg / A1g）→ raman library reference data 的 `mode_assignments`
- 二阶散射判读 → agent 推理；fact-check 由 RAG 或人工确认

**Practical use**
- 仅做 phase ID：足够。
- 要 quantitative purity：交叉到 W1（XRD）做主相 + 杂相定量。

---

### 2.4 W4 — Literature / compute-grounded next step

**Input**
- Carry-over：W1 留下的 "26.6° 残差" 问题，scientist 想搞清楚是不是常见的合成杂质。
- Prompt：*"From the XRD result above, the residual at 26.6° is concerning. Is there a commonly reported impurity in α-Al₂O₃ + α-SiO₂ samples that gives a peak around there? Suggest a way to confirm or rule it out."*

**Tool path**

```
literature.search(query="alumina silica
                  XRD impurity 26.6 degree")  → Crossref / arXiv hits
literature.fetch(top_hits)                     → PDF imports → paper artifacts
paper.rag_ask(papers,
              question="impurities at ~26.6°
              in alumina-silica systems")     → RAG answer with citations
                                                  ↓ review point 1：scientist accept paper into library
                                                  ↓ review point 2：proposal card before
                                                                    accepting RAG answer into report
compute.create_script(
    "simulate XRD of mullite Al6Si2O13
     and overlay on observed pattern")        → compute artifact
                                                  ↓ review point 3：proposal-first
                                                                    review of script before run
compute.run(script)                            → simulated XRD pattern overlay
plot_spectrum(overlay)                         → final plot artifact
```

**Artifacts**
- 多个 `paper` artifact（被引文献）
- 1 个 `compute` artifact（模拟脚本 + 输出）
- 1 个 `plot` artifact（observed + simulated 叠图）
- 可选 1 个 `research-report` artifact（把 W1 + W4 串起来的小报告）

**Review points**
- RP1（paper accept）：`literature.fetch` 是 sandboxed，但 paper 进 library 是 localWrite，scientist 在 normal mode 下要确认。
- RP2（RAG answer accept）：proposal-first，scientist 可以编辑 agent 给的 RAG 总结再保存为引用。
- RP3（compute script approve）：`compute.create_script` 是 `cardMode: "edit"`，scientist 看 diff card 决定是否运行。这是 **C1 "trustLevel = hostExec" 闸的代表展示**（permission_mode 不是 yolo 时一定弹）。

**Final answer 模板**
> "Three peer-reviewed sources [DOI:..., DOI:..., DOI:...] identify **mullite (Al₆Si₂O₁₃, mp-...)** as the dominant secondary phase formed in alumina-silica mixtures sintered above 1200 °C. Its strongest reflection at 2θ ≈ 26.3° (Cu Kα) is consistent with the observed 26.6° residual. To confirm, I generated a simulated mullite pattern (compute artifact `cmp-23a4`) and overlaid it on your observed pattern: residual peak position and relative intensity match within 0.4° and 8% respectively. **Suggested next step:** rerun phase search with mullite added to the keep set; if Rwp drops by >1.5%, mullite is likely real."

**Trace anchor**
- 文献结论 → `paper.rag_ask` step 的 citations field（每个 DOI 都来自一个 fetched paper artifact）
- 模拟峰位置 → `compute.run` 输出 + Materials Project entry
- 建议数值（Rwp 阈值）→ agent 自己给的判据（**必须在 Discussion 里点出"这是 agent heuristic，不是 ground truth"**）

**Practical use**
- 把 mullite 加入 keep set 重跑 W1 的 `xrd.refine`；若 Rwp 下降明显则确认；否则归因为 minor texture / instrument artifact。

---

## 3. Demo 数据选型（解决 Q-003）

按"公开 + 可复现 + 可重新发布"原则锁定。

| Workflow | 数据来源 | 许可 / 引用 | 文件大小 | 备注 |
|---|---|---|---|---|
| W1 | MP-simulated 2-phase XRD（mp-1143 α-Al₂O₃ + mp-7000 α-SiO₂） | CC-BY 4.0（Materials Project） | < 200 KB CSV | 用脚本生成、随论文 supplementary 发布；脚本本身也是 reproducibility 证据 |
| W2 | NIST XPS database 的 anatase TiO₂ + 一个轻度还原样品（fabricate Ti³⁺ component 用 Voigt sum） | NIST public domain | < 50 KB CSV | 还原态那张可以人工合成（已知比例混入 Ti³⁺）使 ground truth 精确 |
| W3 | RRUFF rutile R040049（或同等公开 ID） | RRUFF terms（attribution） | < 30 KB | 直接下载 |
| W4 | W1 carry-over + 3 篇真实开放文献（OpenAlex/arXiv） | CC-BY / arXiv | < 5 MB（PDFs） | RAG retrieval 在 supplementary 公开 query+answer pair |

**所有数据 + 生成脚本 + 完整 tool-step JSON dump 一起放 `paper/supplementary/c2/` 并在论文 Data Availability 段引用。**

---

## 4. 正文结构与字数预算

总目标 1000 - 1200 词（按 `01-paper-plan.md` 第 3 节"Materials-Characterization Workflows"的预算 1000-1200）。

| 子节 | 字数 | 内容 |
|---|---|---|
| 3.0 Overview | 120 | 4 个 workflow 的 motivation；明确"representative not comprehensive" |
| 3.1 W1 XRD | 260 | input → tool path → review point → answer → trace |
| 3.2 W2 XPS | 260 | 同上；强调 review/edit cardMode 演示 |
| 3.3 W3 Raman | 150 | 较短；强调 cross-modality referral |
| 3.4 W4 Lit/compute | 230 | 强调 hostExec gate；展示 W1 → W4 carry-over |
| 3.5 Cross-cutting observations | 150 | tool grounding visibility / review touch points / traceability 的统一观察 |

**写作要求**
- 每个 workflow 至少给 1 个数值结论 + 它对应的 tool step id。
- 每个 workflow 至少描述 1 处 review/edit 触发，避免 "agent 一路顺通" 的 cherry-pick 嫌疑。
- 不在 C2 里写 chat-only 对照。
- 引用 figures（3.1 → Fig 5a；3.2 → Fig 5b；etc）。
- 写 W1 时写 "approximate whole-pattern fit, not Rietveld"，与 worker tool docstring 保持一致。

---

## 5. Figures 清单

C2 新增 4 张图（沿用 C1 已有的 grayscale-flat-Arial 风格 + matplotlib pipeline）。

| Fig | 主题 | 内容 | 来源 |
|---|---|---|---|
| **Fig 5** | Pro workbench triple panel | XRD-Pro / XPS-Pro / Raman-Pro 真实 app screenshot 拼图（每栏标注 input / tools called / artifact / review point / next-step） | Lattice 实拍 |
| **Fig 6** | W4 multi-modal trace | characterization → literature → compute → cited next-step 的时间线图（横轴 = task step index，纵轴 = subsystem） | matplotlib 重画 |
| **Fig 7** | Workflow taxonomy | 一张抽象图：input → tool chain → artifacts → review → answer → next-step 的统一 schema | matplotlib，用 C1 已有 block style |
| **Fig 8** | Annotated trace timeline | W1 完整 task step 序列的横向时间线，标注 review point + artifact emission（一张图压实"可审计"主张） | matplotlib + 真实 trace JSON |

**Fig 5 是 C2 最重要的图**：审稿人对一个 system paper 最直接的怀疑是"做出来了吗"，截图直接打消这个疑虑。

---

## 6. Supplementary

完整放在 `paper/supplementary/c2/`：

```
c2/
├── README.md                            ← 数据来源 + 复现说明
├── data/
│   ├── w1_xrd_alumina_quartz.csv
│   ├── w1_generate.py
│   ├── w2_xps_tio2_anatase.csv
│   ├── w2_xps_tio2_reduced.csv
│   ├── w3_raman_rutile_R040049.csv
│   └── w4_papers/                       ← 3 篇 PDF（如许可允许）
├── traces/
│   ├── w1_session.json                  ← 完整 task-step dump
│   ├── w2_session.json
│   ├── w3_session.json
│   └── w4_session.json
├── screenshots/
│   ├── fig5a_xrd_pro.png
│   ├── fig5b_xps_pro.png
│   └── fig5c_raman_pro.png
└── reproducibility.md                    ← 模型版本、Lattice 提交 hash、permission mode、每步预期输出
```

每个 trace 文件应包含：所有 task step 的 raw input、raw output、approval state、edited output、artifact ids、timestamps。这样审稿人能自己回放 W1-W4。

---

## 7. 写作 checklist（避免审稿陷阱）

✅ 必做
- 每个 workflow 含至少 1 处 review/edit 触发
- 每个数值/相/化学态都标 tool-step anchor
- W1 显式声明 "approximate, not full Rietveld"
- W3 显式声明 "single-modality, recommend cross-check"
- W4 显式区分 "literature-grounded fact" vs "agent heuristic suggestion"
- Fig 5 用 真实 app screenshot，不用模型化示意图

❌ 不要
- 把 4 个 workflow 排成 "4 个完美成功案例"（必须有一处 validation flag 或 review edit）
- 在 C2 里跑 chat-only 对照
- 给 wt% / atomic % 数值时不附 trace anchor
- 写 "Lattice automatically discovered..." → 改成 "Lattice surfaced ... for the scientist to confirm"
- 把 Fig 5 做得太理想化（要真实，包含 review/edit 卡片）

---

## 8. 依赖项与开放问题

| 项 | 依赖 | 状态 |
|---|---|---|
| Q-002 主模型 | C2 跑哪个 LLM | 未定 → 建议 W2 之前选定，按 tool-calling 稳定性挑（Claude / GPT-4o） |
| Q-003 demo 数据 | 4 workflow 数据来源 | **本方案已锁定上面的清单**，待用户确认后写入决策日志 |
| 模型 token 用量 | W4 RAG 上下文较大 | 估算每 workflow ~30-50K tokens × 2 repeats × 12 trials（C3 估算） |
| 截图 quality | Fig 5 需要 retina 截图 | 跑 `npm run electron:dev` + macOS / Win 高 DPI 截图工具；必须包含 review card 状态 |
| Trace JSON exporter | C2 supplementary 依赖完整 task-step dump | Lattice **当前 transcript 持久化不是完整 provider-level replay log**（已在 06-system-design.md §11 标注）。如果要严格 supplementary，需要补一个 `exportTaskTrace(sessionId)` 工具 |

⚠️ Trace exporter 这条是隐藏阻塞项：现有代码可能把 task step 与 transcript 分开存。建议在 W3 之前先验证一次 `runtime-store.ts` 里的 task step 是否能完整序列化（含 raw input / raw output / approval state / edited output）；若不能，工程上得加。

---

## 9. 时间安排（嵌入 6 周整体计划）

按 `04-timeline-budget.md` 的整体节奏，C2 占 W3 - W4 大部分精力。

```
W3 (~ 25h)
  D1-2: 锁 demo 数据；写 W1 / W2 / W3 / W4 数据生成脚本；放进 supplementary/data/
  D3:    跑 W1 + W2 + W3 + W4 各 1 次完整通跑（dev 环境）；验证 trace 完整可导出
  D4:    Fig 5 截图（每个 Pro workbench 抓一张含 review card 的状态）
  D5:    完成 supplementary/traces 的 4 个 JSON dump

W4 (~ 22h)
  D1-2:  写 3.0 - 3.5 正文（约 1100 词）
  D3:    渲染 Fig 6 / 7 / 8（matplotlib，复用 C1 figure pipeline）
  D4:    内审：每个 trace anchor 都能在 supplementary/traces 找到对应字段
  D5:    交付 C2 完整 draft；交接给 C3 evaluation harness 启动
```

**风险缓冲**：W4 留 4-6h 给 trace exporter 工程修补（若 W3 D3 暴露 transcript 不完整）。

---

## 10. 一句话总结

> C2 = 用 4 个真实可复现的表征工作流，把 C1 的"可审计 tool-grounded workspace"主张落地成审稿人可点开 supplementary 自己回放的证据。它的成败取决于：(a) demo 数据足够公开干净；(b) 每个 workflow 都展示一处真实 review/edit；(c) trace JSON 能完整导出，让 supplementary 不是空话。
