---
title: Settings 重设计产品报告 —— 合并 LLM Configuration，去掉三个冗余层
status: Draft v0.1（不含实现计划）
author: Claude (Lattice front-end)
date: 2026-04-14
related:
  - docs/PRO_WORKBENCH_PRODUCT_REPORT_2026-04-14.md
  - docs/AGENT_LLM_REDESIGN.md
---

# Settings 重设计产品报告

## 0. TL;DR

Lattice-app 现在有**两个 Settings 模态**（`SettingsModal` 569 LoC + `LLMConfigModal` 305 LoC + 5 个 tab 1954 LoC = **2828 LoC 的设置类 UI**），**三个设置类 store**（prefs / llm-config / compute-config），**五个入口**（ActivityBar 两个图标、StatusBar 模型片、Composer 齿轮、命令面板）。这些表面做着高度重叠的事 —— 尤其 `SettingsModal.Agent` 的"4 选 1 模型下拉" 和 `LLMConfigModal.Generation` 的"按 provider + model 选"是**同一个语义**的两个控件，数据还各占一个 store 字段（`prefs.agentModel` 与 `llmConfig.agent.modelId`）。

用户原话："LLM Configuration 有点多余"—— 他感受到的"多余"不是单个控件，是**整个设置体系的层层嵌套**。

**本命题：设置是一个单一的、分层披露的屏幕。** 把 LLMConfigModal 折进 SettingsModal，把 Usage 从设置里挪走（那是观测，不是配置），删掉 Appearance 的空壳，删掉 `prefs.agentModel` 这个幽灵字段。

---

## 1. 现状盘点

### 1.1 两个模态

| | **SettingsModal** | **LLMConfigModal** |
|---|---|---|
| 入口 | ActivityBar 齿轮图标 · Ctrl+, | ActivityBar Cpu 图标 · Ctrl+Shift+L · StatusBar 模型片 · Composer 齿轮 · 命令面板 |
| 组织 | 4 个顺序 `<Section>` | 5 个垂直 tab 轨道 |
| 代码体量 | 569 LoC（一个文件） | 305 + 5 tabs (721 + 359 + 286 + 234 + 354) = 2259 LoC |
| 存储 | `prefs-store` + `compute-config-store` | `llm-config-store` |

### 1.2 SettingsModal 的四个 Section

| Section | 控件 | 痛点 |
|---|---|---|
| **Agent** | 模型下拉（4 个硬编码选项：default / sonnet-4-6 / opus-4-6 / haiku-4-5）+ Backend URL 只读显示 | **和 LLMConfig.Generation 完全重叠**；4 个选项是幽灵列表，和 LLMConfig 的 provider.models 不同步；Backend URL 是自动检测的，没有交互价值 |
| **Compute Environment** | mode / containerName / timeoutSec / Test Connection | 刚做过重构，OK |
| **Appearance** | 一行只读文字 `"Laboratory Precision (dark)"` | **空壳** —— 主题功能根本没实现，section 本身是占位符 |
| **Parameter Presets** | 保存 / 删除当前 session 的 paramSnapshot | **放错了地方** —— 这是 session 级别的"快照库"，不是 global 设置；应该在 Session Explorer 或 artifact 右键菜单里 |

569 行里，真正在用的只有 Compute Environment (~180 行)。其他都是噪音或重复。

### 1.3 LLMConfigModal 的五个 Tab

| Tab | 做什么 | 代码 | 职责类型 |
|---|---|---|---|
| **Providers** | Add/Edit/Remove provider（Anthropic / OpenAI / openai-compatible），管 API key，test-connection | 721 LoC | 配置 ✓ |
| **Generation** | 双栏：Dialog 模式 + Agent 模式，各自选 provider+model、temperature、maxTokens、topP、systemPrompt、reasoningEffort | 286 LoC | 配置 ✓ |
| **Usage** | 当前 session 的 token / cost 历史 | 354 LoC | **观测**（不是配置） |
| **Budget** | daily/monthly token 上限、cost 上限 USD、warnAtPct、mode | 359 LoC | 配置 ✓ |
| **Rate Limit** | maxCallsPerMinute、maxTokensPerRequest、retry policy | 234 LoC | 配置 ✓（但可并入 Budget） |

**问题 1**：Usage tab 塞在 Settings 里，因为"点了看数据方便"；但它是**看**，不是**改**。把观察性信息塞进配置面板是类型混淆，每次用户点开 "LLM config" 其实只想看 token 烧多少，被迫在 tab 间找。

**问题 2**：Budget 和 Rate Limit 是一回事（"花多少、多快"），两个 tab 共 593 LoC 放六七个数字控件，拆得太细。

**问题 3**：`initialTab = 'usage'` —— 默认 tab 是观测 tab，说明产品其实也知道用户最常来这里是看数据，却用 modal 的形态提供这个体验。

### 1.4 入口点清单

五个入口都指向 `setLlmConfigOpen(true)`：

```
App.tsx:570    ActivityBar.onOpenLLMConfig
App.tsx:618    命令面板 CommandPalette.onOpenLLMConfig
App.tsx:712    AgentComposer.onOpenLLMConfig（Composer 齿轮）
App.tsx:719    （当前一处重复）
StatusBar:67   模型片点击
```

两个入口都指向 `setSettingsOpen(true)`：
```
ActivityBar.onOpenSettings
命令面板 `Open Settings`
```

**问题**：
- ActivityBar 同时有 Cpu 和 Gear 两个设置图标，用户要记住 "哪个图标对应哪个模态"
- 点 StatusBar 的模型片，用户期望"改模型"，得到的是五 tab 大窗口（其中 4 个 tab 和改模型无关）
- 修改 Dialog 模式的 provider 和 Agent 模式的 model 要去 LLMConfig.Generation，而 `prefs.agentModel`（SettingsModal.Agent 的那个下拉）又在**另一个地方**偷偷影响 status bar 显示 —— 两个数据源互相不知道

### 1.5 三个 store 的职责分布

| Store | 字段 | 谁读 |
|---|---|---|
| `prefs-store` | theme, layout.*, composerMode, **agentModel** ⚠️, presets, inspectorWidth... | SettingsModal, StatusBar |
| `llm-config-store` | providers[], dialog config, agent config, budget, rateLimit | LLMConfigModal 5 tabs, llm-client, agent-submit |
| `compute-config-store` | mode, containerName, timeoutSec, lastTest | SettingsModal.Compute, ComputeView, compute-runner |

**`prefs.agentModel` 是幽灵字段**：
- 只有 4 个硬编码候选（`SettingsModal.tsx:30-35`：`default / sonnet-4-6 / opus-4-6 / haiku-4-5`）
- StatusBar 用它显示"当前模型"
- 但 agent 实际调 LLM 用的是 `llmConfig.agent.providerId + modelId`
- 这两个字段**不同步**：用户在 LLMConfig.Generation 里切了模型，StatusBar 显示的还是 prefs 里的旧值
- 唯一在写这个字段的地方就是 SettingsModal.Agent section 的下拉

---

## 2. "多余"的五条具体证据

| 序 | 现状 | 冗余证据 |
|---|---|---|
| ① | `SettingsModal.Agent.Model` 下拉 + `LLMConfigModal.Generation` | 同一件事两处配，列表不一致，写入不同 store |
| ② | `prefs.agentModel`（4 选 1） + `llmConfig.agent.providerId/modelId`（无穷选） | StatusBar 和 agent runtime 看到不同"当前模型" |
| ③ | `SettingsModal.Appearance`（一行只读） | 功能未实现的空壳 section |
| ④ | `SettingsModal.Backend URL` 只读 | 用户改不了，显示意义低 |
| ⑤ | ActivityBar 两个独立设置图标 + StatusBar 模型片 + Composer 齿轮 + 命令面板 | 5 个入口两个目标 |

---

## 3. 目标与原则

### 3.1 单个面板，分层披露

一个 `Settings` 面板（抛弃"LLM Configuration"名词），默认 3 个 tab：

```
┌────────────────────────────────────────────────────┐
│ Settings                                       [×] │
├─────────────┬──────────────────────────────────────┤
│ Models      │ [ Models & Providers content ]       │
│ Compute     │                                      │
│ Budget      │                                      │
│ ─────────── │                                      │
│ (Advanced)  │  → 点开展开：                         │
│             │    · Rate Limit                      │
│             │    · Generation internals            │
│             │    · Appearance                      │
│             │    · Session Presets                 │
└─────────────┴──────────────────────────────────────┘
```

### 3.2 观测 ≠ 配置

Usage 移出 Settings，给它独立位置：
- 选项 A：BottomPanel 新增 "Usage" tab（与 Console / Problems 并列）
- 选项 B：StatusBar 模型片 → 点出 popover（provider 切换 + 当日 tokens 快览 + "View full usage" 链接）
- 选项 C：独立一个 `/usage` view 在 ActivityBar 里

推荐 B + 后续考虑 C。**Settings 里不再有 Usage tab。**

### 3.3 一个入口

ActivityBar 只保留**齿轮**一个图标（删掉 Cpu 图标）。进设置后默认显示 Models tab。上下文入口（StatusBar 模型片 / Composer 齿轮 / 命令面板 "Change LLM provider"）都 deep-link 到 `Settings.Models`。

### 3.4 数据模型收敛

- 删除 `prefs.agentModel` 字段
- StatusBar 显示模型直接从 `llmConfig.agent.modelId`（+ provider 名称）读
- `SettingsModal.tsx` 里的 `const MODELS = [...]` 硬编码列表删除
- `prefs.presets`（Session paramSnapshot）移到 session-store 自身或一个新的 `session-presets-store`，从设置里拿走

### 3.5 名字匹配心智

- 去掉"LLM Configuration"这个短语 —— 对用户来说就是"设置里的模型"
- ActivityBar 的 tooltip 改为 "Settings"（不是 "LLM config"）
- 命令面板：`Open Settings`、`Open Settings: Models`、`Open Settings: Compute` —— 统一前缀

---

## 4. 重设计 tab 结构

### 4.1 主（默认显示）

#### **Models** tab（合并自 LLMConfig.Providers + LLMConfig.Generation）

```
┌───────────────────────────────────────────────────┐
│ ACTIVE MODELS                                     │
│ Dialog mode:   [Anthropic / Sonnet 4.6] [Edit]   │
│ Agent mode:    [Anthropic / Opus 4.6]  [Edit]    │
├───────────────────────────────────────────────────┤
│ PROVIDERS                           [+ Add]       │
│ ✓ Anthropic    [sk-ant-....abcd] [Test] [···]    │
│ ✓ OpenAI       [sk-....xyz]      [Test] [···]    │
│ ○ Claw-D proxy [sk-....qwer]     [Test] [···]    │
│   (disabled)                                      │
├───────────────────────────────────────────────────┤
│ DEFAULTS (click "Edit" above to tune)             │
│   Dialog · temp 0.7 · max 1k · reasoning low      │
│   Agent  · temp 0.0 · max 8k · reasoning medium   │
└───────────────────────────────────────────────────┘
```

点 Active Models 的 `[Edit]` 抽屉式展开 Generation 参数（temperature / maxTokens / topP / reasoningEffort / systemPrompt），不再需要独立 tab。

#### **Compute** tab

照 Phase A 已做的版本，不变。

#### **Budget** tab（合并 Budget + RateLimit）

```
┌───────────────────────────────────────────────────┐
│ SPEND LIMITS                                      │
│ Daily      [500k tokens] [$5.00 USD] [warn 80%]   │
│ Monthly    [—] [—]                                │
│ Per request [100k in / 16k out]                   │
│                                                   │
│ When limit hit:  (○) Warn  (●) Block  (○) Ignore  │
├───────────────────────────────────────────────────┤
│ RATE LIMITS                                       │
│ Max calls/minute:        [30]                     │
│ Retry on 429:            [✓]                      │
│ Exponential backoff:     [1.0s → 30s]             │
└───────────────────────────────────────────────────┘
```

一个 tab，上下两块，共用 ~12 个字段。

### 4.2 Advanced（点开才显示，默认折叠）

- **Generation internals**：exposed when advanced toggle ON — same set that `[Edit]` drawer shows, plus systemPrompt large textarea
- **Appearance**：只在有实际主题切换时出现（当前没有 → 这个 tab 根本不该显示）
- **Session Presets**：sessionsStore 驱动的"快照库" —— 也可以降级到 Session Explorer 上下文菜单

---

## 5. 入口点精简

| 入口 | 去留 | 去之后 |
|------|------|--------|
| ActivityBar **Gear** 图标 | **保留** | 打开 Settings（默认 Models tab） |
| ActivityBar **Cpu** 图标 | **删除** | — |
| StatusBar 模型片点击 | **改**：不再直接开 modal | 弹 popover：当前 provider/model + 切换选项 + "Open Settings" |
| Composer 齿轮 | **改**：deep link | Deep link to Settings.Models |
| 命令面板 `Open LLM Config` | **删除** | — |
| 命令面板 `Open Settings` | 保留 | 默认打开 |
| 命令面板 `Open Settings: Models / Compute / Budget` | 新增 | 三个 deep link |

键盘：`Ctrl+,` → Settings；`Ctrl+Shift+L` → Settings.Models（保留 muscle memory）

---

## 6. 数据模型收敛计划

### 6.1 删除

- `prefs-store.agentModel` 字段 + `prefs-store.setAgentModel` action
- `SettingsModal.tsx` 里的 `const MODELS = [...]` 硬编码
- `LLMConfigModal.tsx` 里的 `activeTab = 'usage'` 默认值（Usage tab 将被移除）

### 6.2 迁移

```
persist version 4 → 5 migrate:
  if (persistedPrefs.agentModel && persistedLLMConfig.agent.modelId == null) {
    // User had set a model via old SettingsModal.Agent — seed new location
    map prefs.agentModel → llmConfig.agent.{providerId, modelId}
    using the 4-entry MODELS array as reference
  }
  drop persistedPrefs.agentModel
```

### 6.3 外移

- `prefs-store.presets` → 新 store `session-presets-store`（或合并入 session-store 的 persist slice）
- `llm-config-store.usage history` → 维持在 llm-config-store（不是要 delete，只是 Settings UI 不再消费它；BottomPanel Usage tab 或 popover 消费）

---

## 7. 分阶段落地（建议，非本报告承诺）

| Phase | 内容 | 风险 | LoC 变化估计 |
|---|---|---|---|
| S1 | 删 `SettingsModal.Agent` section + `prefs.agentModel` + hardcoded MODELS | 低 | -120 |
| S2 | 合并 Providers + Generation → Models tab（with `[Edit]` drawer） | 中 | -400（dedup），新组件 ~200 |
| S3 | 合并 Budget + RateLimit → Budget tab | 低 | -150 |
| S4 | Usage tab 移出到 StatusBar popover + BottomPanel tab | 中（位置变化） | 拆 + 组装 ~0 |
| S5 | 入口点精简：删 ActivityBar.Cpu，删 `Open LLM Config` 命令 | 低 | -40 |
| S6 | Advanced toggle + Appearance/Presets 外移 | 低 | -100 |

**S1 是最省事的 quick win**：零功能退化、立即去掉用户感知到的冗余。推荐作为下一 PR。

---

## 8. 成功指标

- **设置类 UI LoC**：3603 → **目标 ≤ 1800**（砍半）
- **Settings 模态数**：2 → **1**
- **ActivityBar 设置图标数**：2 → **1**
- **首次使用路径**："我要换 agent 的模型" 的 click 数 3（齿轮 → LLM Config → Generation tab → Agent 列的下拉）→ **2**（齿轮 → Models.Agent.Edit）
- **数据模型一致性**：StatusBar 显示的模型名与 agent 实际调的模型 **同步**（单字段源）

---

## 9. 风险与开放问题

### 9.1 风险

- **Usage 挪位用户找不到**：需要过渡期在 Settings 首次打开时显示一次"Usage moved to status bar" 提示，类似 VSCode 的 "this has moved" toast
- **Composer 齿轮语义变化**：当前是"打开 LLM 配置"，改为"打开 Settings.Models"后体验上是一致的（用户本来就是要改模型），但要保证 deep link 能精准定位
- **Settings v4→v5 migrate**：prefs-store 的 persist 迁移要处理 agentModel 字段清理，不清理会在 localStorage 里留痕 —— 不影响功能但污染存储；建议 migrate 同时清
- **"LLM Configuration" 已形成术语**：docs/CLAUDE.md 等处可能有引用，需同步更新

### 9.2 开放问题

- **Dialog / Agent 两种模式的 provider 可以不同吗？** 现状是独立字段（`llmConfig.dialog` vs `llmConfig.agent`）—— 是否保留这个灵活性？推荐保留但默认两者共用一个 provider，点 `[Edit]` 才分化
- **Appearance section 要不要彻底删除？** 主题切换是 roadmap 功能还是已废弃？本报告倾向删除（如果未来要加再重建）；用户确认
- **Session Presets 的正确归宿**：放 Session Explorer 右键菜单 vs 独立 side-panel vs 保留在 Settings 但放 Advanced？ 倾向放 Session Explorer（这是 session 级别的功能）
- **StatusBar popover 的实现**：Lattice-app 当前没有 popover primitive；先用 simple dropdown（position: absolute 挂在 anchor 元素下方）足够

---

## 10. 与其他文档的关系

| 文档 | 关系 |
|------|------|
| `PRO_WORKBENCH_PRODUCT_REPORT_2026-04-14.md` | 两份报告都在做"去冗余" —— Workbench 是去代码冗余，Settings 是去交互冗余。原则一致：**一个功能只有一个入口、一份数据模型**。 |
| `AGENT_LLM_REDESIGN.md` | 数据模型的依据 —— 本报告保留 llm-config-store 的 dialog/agent 双轨设计，仅调整 UI 呈现 |
| `CHAT_PANEL_REDESIGN.md` | Composer 齿轮按钮行为变更（deep link to Settings.Models）要对齐 |
| 后续可能的 `LLM_USAGE_DASHBOARD.md` | Usage tab 挪位后可能需要独立小报告定义 StatusBar popover + BottomPanel tab 的具体形态 |

---

## 附录 A · 现状 LoC 速览

| 文件 | LoC |
|---|---|
| `src/components/layout/SettingsModal.tsx` | 569 |
| `src/components/llm/LLMConfigModal.tsx` | 305 |
| `src/components/llm/tabs/ProvidersTab.tsx` | 721 |
| `src/components/llm/tabs/GenerationTab.tsx` | 286 |
| `src/components/llm/tabs/UsageTab.tsx` | 354 |
| `src/components/llm/tabs/BudgetTab.tsx` | 359 |
| `src/components/llm/tabs/RateLimitTab.tsx` | 234 |
| `src/stores/llm-config-store.ts` | 359 |
| `src/stores/prefs-store.ts` | 180 |
| `src/stores/compute-config-store.ts` | 111 |
| **合计** | **3478** |

Phase S1–S6 落地后目标：≤ 1800。

## 附录 B · 非目标

不涉及：
- LLM provider 协议层（OpenAI-compatible 适配、Anthropic native tool schema 等）——`llm-client.ts` / `llm-proxy.ts` 不动
- Compute Environment UI（已在 Phase A 做完）
- Workbench 设置（那是 artifact 级别的事，在 PRO_WORKBENCH 路线图里）
- 多账户 / 多工作区（单机单用户假设）
