# Electron 继续用 vs. 换 Rust 壳 — 技术评估

> 日期：2026-04-16
> 结论先行：**短期保留 Electron；业务迁移稳定后再对 Tauri 做 PoC**。本文档记录判断依据与迁移映射表，作为后续决策锚点。

---

## 1. 项目当前形态

Lattice-app 是一个**极薄的 Electron 外壳 + 纯 React 前端**：

- 渲染层：310 个 TS/TSX 文件、约 74,500 行，**零 Node 调用**（`fs`/`path`/`child_process` 全部在 `electron/` 下）。
- 主进程：只做「拉起 Python 后端 + 转发 IPC」，`electron/main.ts` 注册了 11 个 IPC 域。
- `npm run dev` 纯 Vite 即可启动（`window.electronAPI` 全处可选链守护），外壳可脱离调试。

真实性能瓶颈在外部 `lattice-cli` Python 后端，Electron 外壳本身不是热点。

---

## 2. Electron 在本项目里实际吃到的红利

不是泛谈，按代码里落地的依赖列：

| 红利 | 证据 |
|---|---|
| **Chromium 渲染一致性** | `pdfjs-dist`（PDF 阅读器）、`3dmol`（WebGL 分子可视化）、`ECharts`、`codemirror`、`react-markdown` 装上即跑，无 WebView 分裂风险 |
| **Node 生态直连主进程** | `dockerode`（compute 容器）、`webdav` + rclone（云同步）、`child_process.spawn`（Python 后端 / Claude Code 子代理）、`http` 健康检查 |
| **IPC 面宽且全量 TS 化** | preload 暴露 **80+ 个方法**（compute 24、library 18、sync 7、workspace / worker / claude-code / windows 若干），两端共享 `src/types/electron.d.ts` |
| **多窗口 + 自定义协议** | 3 个常驻窗 + 动态 workbench 窗、`lattice-pdf://` 流式协议（`electron/main.ts:27-38, 476-493`） |
| **打包链路闭环** | `electron-builder` + Vite + TS，`npm run build` 一条命令产三平台安装器 |
| **渲染器可脱壳运行** | `npm run dev` 模式下不依赖 Electron，调试成本低 |

---

## 3. 换 Rust 的两种路径

### 3.1 路径 A：UI 层换 Rust 原生（egui / Slint / iced / Dioxus）

**不推荐。** 74k 行 React 代码、`3dmol` / `pdfjs-dist` / `ECharts` / `codemirror` 在 Rust 原生 GUI 生态下**无对等物**，等同于重写整个产品。收益远小于成本。

### 3.2 路径 B：只换外壳（Electron → Tauri，前端保留）

**技术可行，当前时机不佳。** 迁移映射：

| Electron 现状 | Tauri 对应 | 难度 |
|---|---|---|
| `ipcMain.handle` × 80+ | `#[tauri::command]` + `tauri-specta` 生成 TS 绑定 | **中**，机械但量大 |
| `dockerode` | `bollard` | 中，API 对齐但成熟度略低 |
| `webdav` + rclone | `reqwest_dav` / 直调 rclone 二进制 | 中 |
| `child_process.spawn`（Python / Claude Code） | `tokio::process::Command` | 低 |
| `lattice-pdf://` 自定义协议 | `register_uri_scheme_protocol` | 低 |
| 多窗口 + `webContents.send` | `WindowBuilder` + `emit` / `listen` | 低 |
| `pdfjs-dist` / `3dmol` / `ECharts` | **需在 WebKit（macOS）/ Edge WebView2（Win）上重新验证** | **风险点** |

**预期收益**

- 包体：约 150 MB → 约 15 MB
- 内存：300–600 MB → 80–150 MB
- 冷启动：1–3 s → 300–600 ms

**代价与风险**

- `electron/` 下 5–10k 行 TS IPC 胶水全部 Rust 重写，保守 **3–6 人周**。
- WebView 分裂：`pdfjs` 的 worker blob、`3dmol` 的 WebGL2、字体 / codec 需在 WebKit 与 WebView2 上逐一回归，这是最容易咬人的暗坑。
- `docs/MIGRATION_PLAN.md` 还有 77 个 agent 工具 + 6 个 Pro 模块待从 `lattice-cli` 迁入，此时动外壳会**冻结业务推进**。
- 外壳性能从来不是瓶颈，换壳优化的是"感觉更精致"，不是"跑得更快"。

---

## 4. 最终建议

### 4.1 短期（当前至业务迁移收敛）

**保留 Electron**，理由三条：

1. `MIGRATION_PLAN.md` 的业务迁移尚未收敛，外壳稳定性的边际价值 > 重写的收益。
2. 外壳非性能瓶颈，用户感知主要来自 Python 后端响应。
3. 换 Tauri 的 WebView 兼容性需要独立工期验证，不适合与业务并行。

### 4.2 中期（业务稳定后）

若届时用户开始抱怨**包体 / 内存 / 启动速度**，做一个 **2–3 天 PoC**：

1. 把 `electron/python-manager.ts` + 3–5 个最热 IPC 命令移植到 Tauri 跑通。
2. 在 macOS WebKit 与 Windows WebView2 上回归 `pdfjs` PDF 渲染 + `3dmol` 分子可视化 + `ECharts` 大数据量绘图。
3. 通过后再评估全量迁移的工期与 ROI。

### 4.3 长期（不建议）

把 UI 层也换成 Rust 原生 GUI。除非产品形态彻底转向高频实时渲染（例如做大规模 3D 晶体模拟的实时交互），否则 74k 行 React 的重写成本不可回收。

---

## 5. 一句话决策

> **现在不换。等 `lattice-cli` 迁移收尾、用户真提出包体/内存诉求后，做 Tauri PoC 再论。**
