# Lattice Desktop App — 功能迁移计划书

> 版本: v1.0 | 日期: 2026-04-10
> 目标: 将 lattice-cli 的全部功能迁移至 Electron + React 桌面应用

---

## 1. 现状评估

### 1.1 lattice-cli 功能总量

| 类别 | 数量 | 说明 |
|------|------|------|
| Agent 工具 | **77 个** | `src/lattice_cli/tools/*.py` |
| REST API 端点 | **132 个** | `web/server.py` |
| Pro Mode 参数 | **50+ 个** | 6 个域: peak/xrd/xps/raman/processing/plotting |
| 主 Dashboard 视图 | **4 个** | SPECTRUM / LIBRARY / KNOWLEDGE / COMPUTE |
| Pro Mode 模块 | **6 个** | XRD / XPS / Raman / FTIR / Compute / Structure |
| 底部工具栏 | **3 个** | Compare / Process / Export |

### 1.2 桌面 App 已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| Electron 框架 | ✅ 完成 | main.ts + preload.ts + python-manager.ts |
| VSCode 布局 | ✅ 完成 | ActivityBar + Sidebar + Editor + Chat + StatusBar |
| 基础光谱图表 | ✅ 完成 | ECharts 折线图 + 峰位标注 |
| 峰位表格 | ✅ 完成 | PeakTable 组件 |
| 峰位编辑器 | ✅ 完成 | PeakEditor 点击增删峰位 |
| AI Chat 面板 | ✅ 完成 | Markdown 渲染 + 工具调用卡片 |
| 文件浏览器 | ✅ 完成 | FileTree + demo 数据 |
| Command Palette | ✅ 完成 | Ctrl+Shift+P 命令面板 |
| 拖拽导入 | ✅ 完成 | DragOverlay 组件 |
| Settings 面板 | ✅ 完成 | 后端配置 + 模型选择 |
| Analysis FSM | ✅ 完成 | 阶段指示器 |
| Bottom Panel | ✅ 完成 | 日志 + 工具调用记录 |
| WebSocket 客户端 | ✅ 完成 | 自动重连 + 心跳 |
| Zustand 状态管理 | ✅ 完成 | app-store.ts |
| Python 后端管理 | ✅ 完成 | 子进程管理 + 健康检查 |

### 1.3 待迁移功能

以下是 lattice-cli 中已实现但桌面 App 尚未移植的功能，按优先级排列。

---

## 2. 迁移模块清单

### P0 — 核心光谱分析（必须）

#### 2.1 Pro Mode 光谱处理工具栏
**来源**: `pro.html` 的 XRD/XPS/Raman/FTIR 模块
**API**: `/api/pro/*` (20+ 端点)
**需要的组件**:

```
src/components/pro/
├── ProToolbar.tsx          # 顶部工具栏（检测峰位、平滑、基线校正、撤销）
├── XrdPanel.tsx            # XRD 数据库搜索 + CIF 上传 + Rietveld 精修
├── XpsPanel.tsx            # XPS 峰拟合 + 定量 + 数据库查找 + 电荷校正
├── RamanPanel.tsx          # Raman 数据库匹配 + 参考谱叠加
├── FtirPanel.tsx           # FTIR 分析（基线校正、峰检测）
├── ProParamEditor.tsx      # Pro 参数编辑器（50+ 参数、预设管理）
└── QualityBadge.tsx        # 数据质量评估指示器
```

**对应 API 端点**:
| 端点 | 功能 |
|------|------|
| `POST /api/pro/detect-peaks` | 自动峰检测 |
| `POST /api/pro/smooth` | 光谱平滑 |
| `POST /api/pro/baseline` | 基线校正 |
| `POST /api/pro/undo` | 撤销处理 |
| `POST /api/pro/xrd-search` | XRD 数据库搜索 |
| `POST /api/pro/upload-cif` | 上传 CIF 文件 |
| `POST /api/pro/xrd-refine` | Rietveld 精修 |
| `POST /api/pro/xps-fit` | XPS 峰拟合 |
| `POST /api/pro/xps-quantify` | XPS 定量分析 |
| `POST /api/pro/raman-identify` | Raman 数据库匹配 |
| `POST /api/pro/charge-correct` | XPS 电荷校正 |
| `POST /api/pro/xps-lookup` | XPS 数据库查找 |
| `POST /api/pro/assess-quality` | 数据质量评估 |
| `POST /api/pro/predict-xrd` | 理论 XRD 预测 |
| `POST /api/pro/math` | 光谱数学运算（归一化/求导/积分） |
| `GET /api/pro/params` | 获取参数列表 |
| `POST /api/pro/set` | 设置参数 |
| `POST /api/pro/load-preset` | 加载预设 |
| `POST /api/pro/save-preset` | 保存预设 |

#### 2.2 光谱比较
**来源**: `pro.html` 底部 Compare 面板
**API**: `/api/pro/compare-spectra`, `/api/compare/*`
**需要的组件**:

```
src/components/spectrum/
├── CompareView.tsx         # 2-10 条光谱叠加对比
├── SimilarityMatrix.tsx    # Pearson/Cosine 相似度热力图
└── DiffView.tsx            # 差谱显示
```

#### 2.3 报告生成与导出
**来源**: `tools/generate_report.py`, `tools/academic_figure.py`, `tools/export_data.py`
**API**: `/api/report/*`, `/api/pro/export-*`, `/api/pro/academic-figure`
**需要的组件**:

```
src/components/export/
├── ReportPreview.tsx       # 报告预览（Markdown 渲染）
├── ExportPanel.tsx         # 导出格式选择（CSV/JSON/PDF/LaTeX）
└── AcademicFigure.tsx      # 学术图表导出（Nature/ACS/RSC 样式）
```

---

### P1 — 文献知识管理

#### 2.4 论文库 (LIBRARY)
**来源**: `index.html` LIBRARY 视图, `knowledge_db.py`, `paper_reader.py`
**API**: `/api/library/*` (20+ 端点)
**需要的组件**:

```
src/components/library/
├── LibraryView.tsx         # 论文库主视图
├── PaperCard.tsx           # 论文卡片（标题、作者、摘要、标签）
├── PaperDetail.tsx         # 论文详情（PDF 预览 + 标注 + 提取数据）
├── PaperImport.tsx         # 导入（DOI/BibTeX/RIS/文件上传）
├── PaperSearch.tsx         # 全文搜索 + 标签过滤
├── CollectionManager.tsx   # 论文集合管理
├── PdfReader.tsx           # PDF 阅读器（pdf.js 集成）
└── AnnotationPanel.tsx     # PDF 标注面板
```

**对应 API 端点**:
| 端点 | 功能 |
|------|------|
| `GET /api/library/papers` | 论文列表 |
| `POST /api/library/papers` | 添加论文 |
| `POST /api/library/papers/doi` | 通过 DOI 导入 |
| `POST /api/library/import/bibtex` | BibTeX 批量导入 |
| `GET /api/library/paper/{id}/pdf` | 获取 PDF |
| `GET /api/library/paper/{id}/read` | PDF 文本内容 |
| `POST /api/library/paper/{id}/ask` | 向论文提问 |
| `GET /api/library/paper/{id}/annotations` | 获取标注 |
| `POST /api/library/paper/{id}/annotations` | 添加标注 |
| `GET /api/library/paper/{id}/extractions` | 提取的结构化数据 |
| `GET /api/library/paper/{id}/chains` | 推理链 |
| `GET/POST /api/library/collections` | 论文集合 CRUD |
| `GET /api/library/tags` | 标签列表 |
| `GET /api/library/stats` | 库统计信息 |

#### 2.5 知识图谱 (KNOWLEDGE)
**来源**: `index.html` KNOWLEDGE 视图, `knowledge_db.py`
**API**: `/api/knowledge/*` (15+ 端点)
**需要的组件**:

```
src/components/knowledge/
├── KnowledgeView.tsx       # 知识库主视图
├── KnowledgeGraph.tsx      # ECharts 力导向图（5 种节点类型）
├── ExtractionTable.tsx     # 提取数据表（成分-工艺-性能）
├── MaterialSearch.tsx      # 材料搜索（FTS5 全文检索）
├── ComparePanel.tsx        # 跨论文属性对比
├── HeatmapChart.tsx        # 属性分布热力图
├── TimelineChart.tsx       # 研究时间线
└── ExportPanel.tsx         # CSV/JSON 导出
```

**对应 API 端点**:
| 端点 | 功能 |
|------|------|
| `GET /api/knowledge/stats` | 知识库统计 |
| `GET /api/knowledge/extractions` | 提取记录列表 |
| `GET /api/knowledge/search` | 全文搜索 |
| `POST /api/knowledge/compare` | 跨论文对比 |
| `GET /api/knowledge/heatmap` | 属性热力图数据 |
| `GET /api/knowledge/timeline` | 时间线数据 |
| `GET /api/knowledge/peaks` | 峰位知识库 |
| `GET /api/knowledge/export/csv` | 导出 CSV |

---

### P2 — 计算模拟

#### 2.6 计算执行 (COMPUTE)
**来源**: `pro.html` Compute 模块, `tools/compute_exec.py`, `tools/coding_agent.py`
**API**: `/api/pro/compute/*`, `/api/sim/*`
**需要的组件**:

```
src/components/compute/
├── ComputeView.tsx         # 计算主视图
├── CodeEditor.tsx          # Python 代码编辑器（Prism.js 语法高亮）
├── ConsoleOutput.tsx       # 执行输出面板
├── FigureGallery.tsx       # matplotlib 图表画廊
├── SnippetLibrary.tsx      # 代码片段库
├── ScriptManager.tsx       # 脚本保存/加载
└── ContainerStatus.tsx     # 计算容器健康状态
```

**对应 API 端点**:
| 端点 | 功能 |
|------|------|
| `POST /api/pro/compute/exec` | 执行 Python 代码 |
| `GET /api/pro/compute/health` | 容器健康检查 |
| `GET /api/pro/compute/snippets` | 获取代码片段 |
| `POST /api/pro/compute/save-script` | 保存脚本 |
| `GET /api/pro/compute/scripts` | 脚本列表 |

#### 2.7 结构建模 (STRUCTURE)
**来源**: `pro.html` Structure 模块, `tools/structure_tools.py`
**API**: `/api/pro/struct/*`
**需要的组件**:

```
src/components/structure/
├── StructureView.tsx       # 结构主视图
├── MolViewer.tsx           # 3Dmol.js 3D 结构可视化
├── StructureBuilder.tsx    # AI 结构生成（prompt → code → CIF）
├── TransformPanel.tsx      # 超胞/掺杂/表面/缺陷操作
└── CifEditor.tsx           # CIF 文件编辑器
```

**对应 API 端点**:
| 端点 | 功能 |
|------|------|
| `POST /api/pro/struct/transform` | 结构变换操作 |
| `POST /api/pro/struct/ai-build` | AI 结构生成 |

#### 2.8 模拟任务管理
**来源**: `sim/` 模块, `index.html` COMPUTE 视图
**API**: `/api/sim/*`
**需要的组件**:

```
src/components/sim/
├── JobList.tsx             # 任务列表（状态、进度条、ETA）
├── JobDetail.tsx           # 任务详情（能量收敛曲线、日志）
├── DftSetup.tsx            # DFT 任务配置（CP2K）
├── MdSetup.tsx             # MD 任务配置（LAMMPS/ASE）
└── JobStats.tsx            # 任务统计汇总
```

**对应 API 端点**:
| 端点 | 功能 |
|------|------|
| `GET /api/sim/jobs` | 任务列表 |
| `GET /api/sim/jobs/{id}` | 任务详情 |
| `POST /api/sim/jobs/{id}/cancel` | 取消任务 |
| `GET /api/sim/stats` | 任务统计 |

---

### P3 — 研究辅助

#### 2.9 深度研究 / 文献综述
**来源**: `tools/invoke_research.py`, `tools/survey.py`, `tools/survey_pipeline.py`
**需要的组件**:

```
src/components/research/
├── ResearchPanel.tsx       # 文献综述入口（/research 命令）
├── SurveyPanel.tsx         # 网络调研入口（/survey 命令）
├── ResearchProgress.tsx    # 研究进度（章节进度条）
└── ResearchReport.tsx      # 报告预览 + LaTeX PDF 导出
```

#### 2.10 批量分析
**来源**: `tools/batch_analyze.py`
**API**: `/api/batch/*`
**需要的组件**:

```
src/components/batch/
├── BatchSetup.tsx          # 批量分析配置（目录选择、并发数）
├── BatchProgress.tsx       # 批量任务进度
└── BatchResults.tsx        # 结果汇总 + JSONL 导出
```

---

### P4 — 高级功能

#### 2.11 Copilot 底部面板
**来源**: `pro.html` 底部工具栏的 AI 助手
**API**: `/api/copilot/ask`

#### 2.12 实验优化
**来源**: `tools/optimize_tools.py`, `tools/experiment_data.py`
**需要的组件**: 贝叶斯优化 UI + 实验数据管理

#### 2.13 假设管理
**来源**: `tools/hypothesis_tools.py`, `tools/hypothesis_report.py`
**需要的组件**: 假设记录/评估/报告生成

#### 2.14 逆向设计
**来源**: `tools/inverse_design_tools.py`
**需要的组件**: 目标属性 → 材料组成推荐

#### 2.15 合成可行性评估
**来源**: `tools/synthesis_feasibility.py`
**需要的组件**: 合成路线评估面板

---

## 3. 实施路线图

### Phase A — Pro Mode 光谱工具 (P0)
**预计工作量**: 最大模块

| 步骤 | 任务 | 涉及组件 |
|------|------|---------|
| A1 | Pro 工具栏（检测峰位/平滑/基线/撤销） | ProToolbar.tsx |
| A2 | XRD 分析面板（数据库搜索 + Rietveld） | XrdPanel.tsx |
| A3 | XPS 分析面板（峰拟合 + 定量 + 数据库） | XpsPanel.tsx |
| A4 | Raman 分析面板（数据库匹配） | RamanPanel.tsx |
| A5 | Pro 参数编辑器 + 预设管理 | ProParamEditor.tsx |
| A6 | 数据质量评估 | QualityBadge.tsx |
| A7 | 光谱比较 + 相似度矩阵 | CompareView.tsx |
| A8 | 报告生成 + 导出 | ReportPreview.tsx, ExportPanel.tsx |

### Phase B — 文献知识管理 (P1)

| 步骤 | 任务 | 涉及组件 |
|------|------|---------|
| B1 | 论文库视图 + 搜索 + 标签 | LibraryView.tsx |
| B2 | 论文导入（DOI/BibTeX/文件） | PaperImport.tsx |
| B3 | PDF 阅读器 + 标注 | PdfReader.tsx |
| B4 | 论文提问（RAG） | PaperDetail.tsx |
| B5 | 知识图谱可视化 | KnowledgeGraph.tsx |
| B6 | 提取数据表 + 跨论文对比 | ExtractionTable.tsx |

### Phase C — 计算模拟 (P2)

| 步骤 | 任务 | 涉及组件 |
|------|------|---------|
| C1 | Python 代码执行器 | CodeEditor.tsx + ConsoleOutput.tsx |
| C2 | 3D 结构可视化 (3Dmol.js) | MolViewer.tsx |
| C3 | AI 结构生成 | StructureBuilder.tsx |
| C4 | 模拟任务管理 | JobList.tsx + JobDetail.tsx |
| C5 | DFT/MD 配置面板 | DftSetup.tsx + MdSetup.tsx |

### Phase D — 研究与高级功能 (P3+P4)

| 步骤 | 任务 | 涉及组件 |
|------|------|---------|
| D1 | 文献综述 / 网络调研 | ResearchPanel.tsx |
| D2 | 批量分析 | BatchSetup.tsx |
| D3 | 实验优化（贝叶斯） | 未定 |
| D4 | 假设管理 | 未定 |

---

## 4. 技术要点

### 4.1 后端复用策略

所有功能通过 REST API 与 Python 后端通信，**不重写 Python 逻辑**：

```
React 组件 → useApi() hook → fetch(/api/xxx) → FastAPI → lattice_cli 模块
```

后端已有 132 个 API 端点，覆盖全部功能。桌面 App 仅需实现前端 UI。

### 4.2 新增依赖

| 库 | 用途 | Phase |
|---|------|-------|
| `3dmol` | 3D 分子/晶体结构可视化 | C |
| `pdfjs-dist` | PDF 阅读器 | B |
| `@monaco-editor/react` | 代码编辑器（Python） | C |
| `prismjs` | 轻量代码高亮 | C |

### 4.3 布局扩展

当前 VSCode 风格布局的 Sidebar 需要从 4 个视图扩展为：

```
ActivityBar 图标:
├── Explorer (文件浏览器)      ← 已有
├── Search (搜索)              ← 已有
├── Analysis (分析工具)        ← 已有，需扩展为 Pro Mode
├── Library (论文库)           ← 新增
├── Knowledge (知识图谱)       ← 新增
├── Compute (计算)             ← 新增
├── Structure (结构建模)       ← 新增
├── AI Chat                    ← 已有
└── Settings                   ← 已有
```

Editor Area 需要支持更多标签页类型：

```
Tab 类型:
├── Spectrum 光谱图表           ← 已有
├── Peaks 峰位表               ← 已有
├── Peak Editor 峰位编辑       ← 已有
├── Compare 光谱比较           ← 新增
├── Paper PDF 论文阅读         ← 新增
├── Knowledge Graph 知识图谱   ← 新增
├── Code Editor 代码编辑       ← 新增
├── 3D Viewer 结构可视化       ← 新增
├── Report 报告预览            ← 新增
├── Job Detail 任务详情        ← 新增
└── Batch Results 批量结果     ← 新增
```

---

## 5. 文件结构预览（完整版）

```
src/components/
├── layout/              # 布局组件（已有）
├── chat/                # AI Chat（已有）
├── spectrum/            # 光谱分析（已有，扩展）
│   ├── SpectrumChart.tsx
│   ├── PeakTable.tsx
│   ├── PeakEditor.tsx
│   ├── CompareView.tsx        ← Phase A
│   └── SimilarityMatrix.tsx   ← Phase A
├── pro/                 # Pro Mode 工具（Phase A 新增）
│   ├── ProToolbar.tsx
│   ├── XrdPanel.tsx
│   ├── XpsPanel.tsx
│   ├── RamanPanel.tsx
│   ├── FtirPanel.tsx
│   ├── ProParamEditor.tsx
│   └── QualityBadge.tsx
├── export/              # 导出工具（Phase A 新增）
│   ├── ReportPreview.tsx
│   ├── ExportPanel.tsx
│   └── AcademicFigure.tsx
├── library/             # 论文库（Phase B 新增）
│   ├── LibraryView.tsx
│   ├── PaperCard.tsx
│   ├── PaperDetail.tsx
│   ├── PaperImport.tsx
│   ├── PaperSearch.tsx
│   ├── PdfReader.tsx
│   └── AnnotationPanel.tsx
├── knowledge/           # 知识图谱（Phase B 新增）
│   ├── KnowledgeView.tsx
│   ├── KnowledgeGraph.tsx
│   ├── ExtractionTable.tsx
│   └── MaterialSearch.tsx
├── compute/             # 计算执行（Phase C 新增）
│   ├── ComputeView.tsx
│   ├── CodeEditor.tsx
│   ├── ConsoleOutput.tsx
│   └── FigureGallery.tsx
├── structure/           # 结构建模（Phase C 新增）
│   ├── StructureView.tsx
│   ├── MolViewer.tsx
│   └── StructureBuilder.tsx
├── sim/                 # 模拟任务（Phase C 新增）
│   ├── JobList.tsx
│   ├── JobDetail.tsx
│   └── JobStats.tsx
├── research/            # 研究工具（Phase D 新增）
│   ├── ResearchPanel.tsx
│   └── SurveyPanel.tsx
├── batch/               # 批量分析（Phase D 新增）
│   ├── BatchSetup.tsx
│   └── BatchResults.tsx
├── explorer/            # 文件浏览器（已有）
└── common/              # 通用组件（已有）
```

---

## 6. 验收标准

每个 Phase 完成后需满足：

1. **功能对齐**: 对应的 lattice-cli 功能在桌面 App 中可用
2. **API 覆盖**: 该 Phase 涉及的所有 REST API 端点已对接
3. **UI 完整**: 所有交互元素可操作，数据正确显示
4. **离线可用**: 无后端时显示友好提示，不崩溃
5. **构建通过**: `tsc --noEmit` 零错误, `vite build` 成功

---

## 附录 A: lattice-cli 完整工具列表 (77 个)

### 光谱分析工具
| 工具 | 文件 | 功能 |
|------|------|------|
| detect_type | detect_type.py | 自动光谱类型检测 |
| read_spectrum | read_spectrum.py | 读取光谱文件 (15+ 格式) |
| find_peaks | find_peaks.py | 峰检测 |
| assign_peaks | assign_peaks.py | 峰位归属 |
| edit_peaks | edit_peaks.py | 交互式峰编辑 |
| assess_quality | assess_quality.py | 数据质量评估 (SNR/饱和/尖峰) |
| correct_baseline | correct_baseline.py | 基线校正 |
| smooth_spectrum | smooth_spectrum.py | 光谱平滑 |
| spectrum_math | spectrum_math.py | 归一化/求导/积分 |
| compare_spectra | compare_spectra.py | 多光谱对比 + 相似度 |
| plot_spectrum | plot_spectrum.py | 光谱绘图 |
| plot_data | plot_data.py | 通用数据绘图 |

### XRD 专用工具
| 工具 | 文件 | 功能 |
|------|------|------|
| xrd_database | xrd_database.py | 58k 条 XRD 数据库搜索 |
| xrd_refine | xrd_refine.py | Rietveld 精修 (via dara) |
| predict_xrd | predict_xrd.py | 理论衍射谱预测 |
| compare_theory | compare_theory.py | 实验 vs 理论对比 |
| dara_bridge | dara_bridge.py | dara 服务通信 |
| dara_peaks | dara_peaks.py | dara 峰检测 |
| dara_predict | dara_predict.py | dara 相鉴定 |
| dara_cif | dara_cif.py | CIF 解析 |
| dara_convert | dara_convert.py | 格式转换 |

### XPS 专用工具
| 工具 | 文件 | 功能 |
|------|------|------|
| xps_fit_spectrum | xps_fit_spectrum.py | XPS 峰拟合 (lmfit) |
| xps_quantify | xps_quantify.py | 元素定量分析 |
| xps_database | xps_database.py | XPS 结合能数据库 |
| xps_validate | xps_validate.py | 峰归属验证 |

### Raman 专用工具
| 工具 | 文件 | 功能 |
|------|------|------|
| raman_database | raman_database.py | RRUF Raman 数据库 |

### 结构建模工具
| 工具 | 文件 | 功能 |
|------|------|------|
| structure_tools | structure_tools.py | 8 个 pymatgen 工具 (build/supercell/dope/surface/defect) |

### 模拟计算工具
| 工具 | 文件 | 功能 |
|------|------|------|
| dft_tools | dft_tools.py | 6 个 CP2K DFT 工具 |
| md_tools | md_tools.py | 7 个 MD 工具 (LAMMPS/ASE) |
| optimize_tools | optimize_tools.py | 贝叶斯实验优化 |
| compute_exec | compute_exec.py | Python 代码远程执行 |
| coding_agent | coding_agent.py | 编码代理 |

### 研究工具
| 工具 | 文件 | 功能 |
|------|------|------|
| invoke_research | invoke_research.py | 学术文献综述 (/research) |
| survey | survey.py | 网络深度调研 (/survey) |
| survey_pipeline | survey_pipeline.py | 调研管线 (OpenAlex + arXiv) |
| paper_extract | paper_extract.py | 论文数据提取 |
| paper_rag | paper_rag.py | 论文 RAG 问答 |
| paper_reader_tool | paper_reader_tool.py | 论文获取 |
| ref_library_tools | ref_library_tools.py | 参考文献管理 |
| search_tools | search_tools.py | 深度搜索 |

### 文件/通用工具
| 工具 | 文件 | 功能 |
|------|------|------|
| list_files | list_files.py | 列出文件 |
| read_file | read_file.py | 读取文件 |
| write_file | write_file.py | 写入文件 |
| preview_data | preview_data.py | 数据预览 |
| inspect_columns | inspect_columns.py | 列检测 |
| convert_file | convert_file.py | 格式转换 |
| export_data | export_data.py | 数据导出 |
| view_image | view_image.py | 图片查看 |
| generate_report | generate_report.py | 报告生成 |
| academic_figure | academic_figure.py | 学术图表 |
| candidate_ranker | candidate_ranker.py | 候选排序 |
| image_gen | image_gen.py | 图片生成 |
| get_datetime | get_datetime.py | 获取时间 |

### 高级工具
| 工具 | 文件 | 功能 |
|------|------|------|
| hypothesis_tools | hypothesis_tools.py | 假设管理 |
| hypothesis_report | hypothesis_report.py | 假设报告 |
| inverse_design_tools | inverse_design_tools.py | 逆向设计 |
| synthesis_feasibility | synthesis_feasibility.py | 合成可行性评估 |
| experiment_data | experiment_data.py | 实验数据管理 |
| project_tools | project_tools.py | 项目管理 |
| plan_mode | plan_mode.py | 规划模式 |
| invoke_developer | invoke_developer.py | 开发者代理 |
| developer | developer.py | 代码搜索/编辑 |
