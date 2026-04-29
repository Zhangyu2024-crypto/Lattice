# Bug：WSL2 / WSLg 下 Electron 窗口空白

## 现象
- `npm run dev` 启动正常，Vite (5173) ready，Electron 主进程构建完成
- Electron 窗口能打开，但窗口内**完全空白**（一片深灰 `#1e1e1e`，无 UI）
- 渲染进程已连接 Vite HMR（`[vite] connected.`），无 JS 报错
- 主进程日志含：`Exiting GPU process due to errors during initialization`

## 根因
WSL2 + WSLg 环境下 Chromium 的 GPU 进程初始化失败。窗口本身能创建，但没有任何光栅化器把 React 渲染好的 DOM 画到屏幕上，因此用户看到一片纯色背景。

调试链：
1. 在 `src/main.tsx` 的入口、`Promise.all` 前后加了 `console.error('[LATTICE_BOOT] ...')` 三处探针
2. 重启 dev server 后日志显示三条探针**全部触发**，并有 `Download the React DevTools ...` 警告
3. 证明：JS 模块加载、Promise 链、`mountRoot.render()` 都成功执行；问题不在 React 也不在 boot 链，而在 **Chromium 渲染管线本身没有可用的光栅化器**

## 修复
在 `electron/main.ts` 的 `app.whenReady()` 之前加入由环境变量控制的开关：

```ts
if (process.env.LATTICE_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  // 注意：绝对不要再加 'disable-software-rasterizer'。
  // 那会把仅剩的软件光栅化器也关掉，窗口又会变空白。
}
```

启动方式：
```bash
LATTICE_DISABLE_GPU=1 npm run dev
```

## 调试中我自己引入又自己修掉的子 bug

第一次写补丁时我同时加了 `disable-gpu` **和** `disable-software-rasterizer`，结果：
- 硬件加速被禁 → GPU 路径关闭
- 软件光栅化也被禁 → CPU 路径也关闭
- 没有任何路径能把帧画出来 → 窗口仍然空白

**正确组合是只禁 GPU、保留软件光栅化器**。Chromium 在 `disable-gpu` 后会自动 fallback 到 SwiftShader / 软件路径。第二个开关只在生产里"已经知道软件渲染会让 CPU 100%"时才用，调试空白窗口时绝不能加。

## 设计决策
- **不写死禁用 GPU**：用环境变量门控。有真实 GPU 的开发者（macOS / 原生 Linux / 启用 GPU 的 Windows）不应被强制走软件路径，否则性能会显著退化。
- **不在 main.ts 里检测 WSL**：检测逻辑容易漏判（不同 WSL 发行版、用户自定义 distro）。环境变量更显式可控。
- **README 应补一句**：在 WSL 下运行加上 `LATTICE_DISABLE_GPU=1` 前缀。（待补）

## 未解决但已确认无关的噪音
- `Failed to connect to the bus: ... /run/dbus/system_bus_socket` — WSL2 没有系统 D-Bus，正常现象
- `Request Autofill.enable failed` — DevTools 协议在某些 Electron 版本里少几个端点，benign
- 这两类错误在修复前后都存在，与空白窗口无关
