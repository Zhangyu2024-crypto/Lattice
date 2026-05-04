# Lattice 论文计划 v4

> **路线**：系统论文 + 小规模实证验证  
> **核心目标**：把叙事从“AI 直接发现新材料”转向“AI 辅助人类快速进行实验迭代”  
> **主投方向**：*Digital Discovery*；若更偏软件系统，可转 *SoftwareX* / journal software article  
> **周期**：6 周左右  
> **日期**：2026-04-29 (v4 lean system-paper route)

---

## 文档

| 文件 | 内容 |
|------|------|
| [00-decision-log.md](./00-decision-log.md) | 关键路线决策 |
| [01-paper-plan.md](./01-paper-plan.md) | 论文主叙事、贡献、大纲、figures |
| [02-benchmark-design.md](./02-benchmark-design.md) | 小规模 workflow evaluation：12 题，不做大 benchmark |
| [03-experiment-design.md](./03-experiment-design.md) | 实验矩阵、指标、trace 捕获、评分方式 |
| [04-timeline-budget.md](./04-timeline-budget.md) | 6 周时间线、工时、预算、风险 |
| [05-introduction.md](./05-introduction.md) | Introduction 草稿：AI 辅助实验迭代主线 |
| [06-system-design.md](./06-system-design.md) | System Design 草稿：Lattice 架构与工具链 |
| [07-c1-section.md](./07-c1-section.md) | C1 正文 draft：human-in-the-loop workspace for experimental iteration |
| [08-c2-plan.md](./08-c2-plan.md) | C2 详细方案：4 workflow 设计 + demo 数据 + figures + supplementary + 时间安排 |

---

## 一句话版本

Lattice 论文不主打“AI 自动发现新材料”或“我们做了一个大 benchmark”，而主打：

> Lattice 是一个面向材料实验迭代的 tool-grounded scientific agent workspace。它不替代科学家直接“发现材料”，而是把 LLM、XRD/XPS/Raman 工具、Python compute、文献检索、artifact workspace 和可审计 tool trace 放进同一个循环，帮助人类更快完成 characterize -> interpret -> decide next experiment。

这样最省精力，也最贴合 Lattice-app 真正的优点。
