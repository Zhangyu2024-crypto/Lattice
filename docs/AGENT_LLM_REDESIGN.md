# Agent Composer 双模式 + LLM 配置面板 — 设计稿

> 版本: v0.1 | 日期: 2026-04-10
> 前置: `DESIGN_PURPOSE.md`, `NEXT_PHASES.md`
> 状态: **待确认**，审阅通过后进入实施
> 本文只定义**要做什么 / 怎么组成**，不含代码

---

## 1. 目标

1. **区分两种 AI 使用场景**
   - **Dialog 模式**：纯问答，快速、便宜、不触发工具调用。用于"这是什么意思" / "解释一下这个峰" / "头脑风暴 Fe 掺杂策略"
   - **Agent 模式**：自主规划 + 多步执行 + 工具调用 + 产出 artifact。用于"识别这段 XRD 的相" / "对这批文件跑批量分析"
2. **独立的 LLM 配置入口**：能看到 / 管理当前使用哪个模型、每次调用消耗了多少 token、累计花了多少钱、是否接近预算
3. **用户能理性决定每条请求的成本**：切换模式一目了然，模型切换有摩擦（因为会影响成本），token 使用实时可见

---

## 2. 现状与问题

### 2.1 当前 AgentComposer
- 单一输入框，所有消息都走 `submitAgentPrompt` → `sendChat(text)`
- 后端自行决定是否调用工具，前端不参与决策
- **问题**:
  1. 用户无法主动选择"我只想聊一句，不要启动 agent 流水线"
  2. Task Timeline 永远显示，即使只发了 "hello" 也挂着一条空 task
  3. 模型选择在 Settings 抽屉里埋得很深
  4. 用户完全看不到 token / 费用消耗

### 2.2 当前模型 / token 管理
- `prefs-store.ts` 有 `agentModel: string` — 纯字符串，没有 metadata
- `app-store.ts.updateStatus(...)` 会从后端 status 消息里取 `status.model`，但并不展示
- 既有的 `tokenUsage: { input, output }` 字段在 Phase A 清理时**已被删除**（MVP 瘦身）
- 完全没有成本估算、没有历史、没有限流、没有预算警告

---

## 3. UX 总览

### 3.1 Composer 双模式

**位置**：AgentComposer 顶部增加一个模式切换条，取代原来的 `Lattice AI` 标题。

```
┌──────────────────────────────────────────────────────┐
│ [💬 Dialog] [🤖 Agent]         ◈ Opus 4.6 · 12.3k ⚠  │  ← 52 px header
├──────────────────────────────────────────────────────┤
│                                                      │
│  <TaskTimeline>  (仅 Agent 模式显示)                  │
├──────────────────────────────────────────────────────┤
│  <transcript>                                        │
│  ...                                                 │
├──────────────────────────────────────────────────────┤
│  [ input..................................... ][▶]  │
└──────────────────────────────────────────────────────┘
```

**header 组件说明**:
- **模式切换**（左）：segmented tabs，`Dialog` / `Agent`，当前模式高亮。键盘快捷键 `Ctrl+1` / `Ctrl+2`
- **模型 chip**（右）：`◈ <model label> · <context-window-remaining>`，点击打开 LLM 配置模态
  - 数字是"当前 session 已用 token / 模型 context 上限"的简短展示
  - ⚠ 出现在接近预算或限流时
- 下方的 **TaskTimeline** 仅在 Agent 模式时渲染；Dialog 模式时隐藏，省垂直空间

### 3.2 模式差异

| 维度 | Dialog | Agent |
|---|---|---|
| 后端 API | `/api/chat/dialog` （新）或沿用 `/api/chat` 带 `mode: 'dialog'` | `/api/chat/agent` 或 `/api/chat` 带 `mode: 'agent'` |
| 允许工具调用 | ❌（或白名单只允许只读查询工具 如 `read_spectrum`, `list_files`） | ✅ 全部 77 个工具 |
| Task Timeline | 隐藏 | 显示，步骤实时流入 |
| Artifact 产生 | ❌（回复只更新 transcript） | ✅ |
| 默认 max_tokens | 1024 | 8192+ |
| 默认 max reasoning depth | 0 | 按模型 |
| Enter 键 | 发送 | 发送 |
| Shift+Enter | 换行 | 换行 |
| 系统 prompt | "You are a materials-science assistant. Answer concisely." | "You are a materials-science Agent with access to these tools: ..." |
| 默认模型建议 | 小模型（如 Haiku / GPT-4o-mini） | 大模型（如 Opus / GPT-4） |

### 3.3 模式持久化
- `prefs-store.composerMode: 'dialog' | 'agent'`，默认 `'dialog'`
- 每个 session 可以覆写：`session.composerMode?`（如果不设则继承全局）
- 切换时不清空 transcript / task timeline；两种模式共享同一个 transcript

### 3.4 空态
- Dialog 空态：`Ask anything about materials science — quick, no tools.`
- Agent 空态：`Describe what you want to analyze — the Agent will plan and execute.`

---

## 4. LLM 配置模态设计

### 4.1 入口（4 个，冗余是故意的）
1. **StatusBar 的 model chip** → 点击打开（最显眼的日常入口）
2. **ActivityBar 新增"⚡ LLM"图标** → 打开
3. **Command Palette**: `Open LLM Config` / `Ctrl+Shift+L`
4. **Settings Modal** 里的 "Manage LLMs..." 按钮

### 4.2 布局

全屏模态（90% 宽高），左侧 tab 列，右侧内容面板：

```
┌────────────────────────────────────────────────────────┐
│ LLM Configuration                                   ✕  │
├──────────────┬─────────────────────────────────────────┤
│              │                                         │
│ ▸ Providers  │  <内容>                                  │
│ ▸ Generation │                                         │
│ ▸ Usage      │                                         │
│ ▸ Budget     │                                         │
│ ▸ Rate Limit │                                         │
│              │                                         │
│              │                                         │
└──────────────┴─────────────────────────────────────────┘
```

### 4.3 Tab 1: Providers

**目的**: 管理能用哪些 LLM 后端。

**布局**:
```
┌────────────────────────────────────────────┐
│ Providers                    [+ Add]       │
│                                            │
│ ┌ ● Anthropic              [Enabled ✓]  ┐ │
│ │   Base URL: https://api.anthropic.com │ │
│ │   API Key: sk-ant-...****             │ │
│ │   Models: 4 configured                │ │
│ │                                        │ │
│ │   [ Test connection ] [ Edit ] [ 🗑 ] │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ ┌ ○ OpenAI                 [Disabled]   ┐ │
│ │   ...                                  │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ ┌ ○ Ollama (local)         [Disabled]   ┐ │
│ │   Base URL: http://localhost:11434    │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

**支持的 provider 类型**:
- `anthropic` — 官方 API
- `openai` — 官方 API  
- `openai-compatible` — 任何 OpenAI-compatible 端点（Azure / Groq / Together / vLLM / …）
- `ollama` — 本地 Ollama
- `custom` — 完全自定义

**每个 provider 展开后显示**:
- Name / Base URL / API Key (masked after entry)
- 该 provider 下可用的 models 列表 + 每个 model 的 pricing 配置
- Test connection 按钮（发一次最小 ping 请求验证 key 有效）
- Enable/Disable toggle

**API key 存储**（平台安全）:
- Electron 主进程用 `safeStorage.encryptString(key)` 加密后存 localStorage
- 非 Electron 环境（浏览器开发模式）fallback 到明文 + 强警告
- 展示时永远 masked（只显示前 6 后 4）

### 4.4 Tab 2: Generation

**目的**: 全局生成参数。每种模式有独立覆写。

```
┌────────────────────────────────────────────┐
│ Active Model                                │
│ Dialog mode:  [ claude-haiku-4-5  ▼ ]      │
│ Agent mode:   [ claude-opus-4-6   ▼ ]      │
│                                             │
│ Dialog Generation                           │
│ Temperature    [=========○=] 0.7  ⓘ         │
│ Max tokens     [========○==] 1024 ⓘ         │
│ Top P          [===========○] 1.0 ⓘ         │
│                                             │
│ Agent Generation                            │
│ Temperature    [○==========] 0.0  ⓘ         │
│ Max tokens     [======○====] 8192 ⓘ         │
│ Top P          [===========○] 1.0 ⓘ         │
│ Reasoning effort [ Medium ▼ ]               │
│                                             │
│ System Prompts                              │
│ Dialog:  [ ...textarea... ]                 │
│ Agent:   [ ...textarea... ]                 │
└────────────────────────────────────────────┘
```

**关键设计**: 每种模式有独立的 model / temperature / max_tokens / 系统 prompt。这样 Dialog 默认走便宜小模型，Agent 默认走大模型，用户可以单独调。

### 4.5 Tab 3: Usage（**核心需求**）

**目的**: 管理 token 数 / 调用次数。

```
┌────────────────────────────────────────────────────────┐
│ Usage                          [Export CSV] [Reset]     │
│                                                         │
│ ┌── Today ──────────┐ ┌── This Session ─────────────┐  │
│ │ Calls:    42      │ │ Calls:   12                 │  │
│ │ Input:    28.4k   │ │ Input:   12.1k              │  │
│ │ Output:   14.1k   │ │ Output:  3.8k               │  │
│ │ Cost:     $0.38   │ │ Cost:    $0.09              │  │
│ └───────────────────┘ └─────────────────────────────┘  │
│                                                         │
│ ┌── Last 7 Days ────────────────────────────────────┐  │
│ │                                                    │  │
│ │  [ECharts bar chart: stacked input/output tokens] │  │
│ │                                                    │  │
│ └───────────────────────────────────────────────────┘  │
│                                                         │
│ Call History (last 100)                                 │
│ ┌─────┬─────────┬───────┬────────┬──────┬──────────┐   │
│ │time │model    │mode   │in/out  │cost  │status    │   │
│ ├─────┼─────────┼───────┼────────┼──────┼──────────┤   │
│ │12:04│Opus 4.6 │agent  │4.2k/1k │$0.04 │succeeded │   │
│ │12:02│Haiku 4.5│dialog │512/256 │$0.00 │succeeded │   │
│ │...  │         │       │        │      │          │   │
│ └─────┴─────────┴───────┴────────┴──────┴──────────┘   │
│                                                         │
│ All-time totals                                         │
│ 284 calls · 1.2M input · 345k output · $12.84          │
└────────────────────────────────────────────────────────┘
```

**数据规则**:
- 每次 `sendChat` 返回后记录一条 `UsageRecord`
- 滚动窗口保留最近 1000 条详细记录，更早的只保留日聚合
- Cost 由 `UsageRecord.tokens × provider.pricing` 本地计算
- Export CSV 导出全部明细

### 4.6 Tab 4: Budget

**目的**: 防止失控消费。

```
┌────────────────────────────────────────────┐
│ Daily limits                                │
│ Token limit    [ 500,000        ] ( ✓ )    │
│ Cost limit     [ $5.00          ] ( ✓ )    │
│ Warn at        [ 80% ▼ ]                   │
│                                             │
│ On limit reached:                           │
│ (•) Warn but allow                          │
│ ( ) Hard stop (block new requests)          │
│                                             │
│ Monthly limits                              │
│ Token limit    [              ] ( ○ )       │
│ Cost limit     [              ] ( ○ )       │
│                                             │
│ Per-request limits                          │
│ Max input tokens  [ 100,000 ]               │
│ Max output tokens [ 16,000  ]               │
│                                             │
│ Current progress today                      │
│ Tokens:  ████████░░ 42,510 / 500,000 (8%)  │
│ Cost:    ██░░░░░░░░ $0.38 / $5.00 (8%)     │
└────────────────────────────────────────────┘
```

**行为**:
- 达到 warn 阈值 → 右下角粘着 toast：`"Daily token budget 80% used"`
- 达到 limit（hard stop 模式）→ `sendChat` 直接抛 `BudgetExceededError`，AgentComposer 显示禁用状态
- limit reset 按本地时区的 00:00

### 4.7 Tab 5: Rate Limit

```
┌────────────────────────────────────────────┐
│ Client-side rate limit                      │
│ Max calls / minute  [ 30  ]                 │
│ Max tokens / request [ 150,000 ]            │
│ Retry on 429        [ ✓ ]                   │
│ Exponential backoff [ ✓ ] base 1s, max 30s │
│                                             │
│ Current window                              │
│ 4 / 30 calls used in last 60s               │
└────────────────────────────────────────────┘
```

---

## 5. 数据模型

### 5.1 新 store: `llm-config-store.ts`
```
interface LLMProvider {
  id: string                // 'anthropic-default'
  name: string              // 'Anthropic'
  type: 'anthropic' | 'openai' | 'openai-compatible' | 'ollama' | 'custom'
  baseUrl: string
  apiKeyCipher?: string     // Electron safeStorage 加密后
  enabled: boolean
  models: LLMModel[]
}

interface LLMModel {
  id: string                // 'claude-opus-4-6'
  label: string             // 'Claude Opus 4.6'
  contextWindow: number     // 200_000
  maxOutputTokens: number   // 16_384
  pricing: {
    inputPerMillion: number
    outputPerMillion: number
    cacheReadPerMillion?: number
    cacheCreatePerMillion?: number
  }
  supportsTools: boolean
  supportsVision: boolean
  supportsCaching: boolean
}

interface GenerationConfig {
  modelId: string           // 引用 LLMModel.id
  temperature: number
  maxTokens: number
  topP: number
  systemPrompt: string
  reasoningEffort?: 'low' | 'medium' | 'high'
}

interface BudgetConfig {
  daily: {
    tokenLimit: number | null
    costLimitUSD: number | null
  }
  monthly: {
    tokenLimit: number | null
    costLimitUSD: number | null
  }
  perRequest: {
    maxInputTokens: number
    maxOutputTokens: number
  }
  warnAtPct: number         // 0..1, default 0.8
  mode: 'warn' | 'block'    // warn-only or hard-stop
}

interface RateLimitConfig {
  maxCallsPerMinute: number
  maxTokensPerRequest: number
  retryOn429: boolean
  exponentialBackoff: {
    enabled: boolean
    baseMs: number
    maxMs: number
  }
}

interface LLMConfigState {
  providers: LLMProvider[]
  activeProviderId: string | null
  dialog: GenerationConfig
  agent: GenerationConfig
  budget: BudgetConfig
  rateLimit: RateLimitConfig

  // actions
  addProvider / removeProvider / updateProvider / enableProvider
  setActiveProvider
  updateDialogConfig / updateAgentConfig
  updateBudget / updateRateLimit
  getResolvedModel(mode: 'dialog'|'agent'): LLMModel | null
}
```

持久化到 localStorage key `lattice.llm-config`；API key 经 Electron safeStorage 加密。

### 5.2 新 store: `usage-store.ts`
```
interface UsageRecord {
  id: string
  timestamp: number
  providerId: string
  modelId: string
  mode: 'dialog' | 'agent'
  sessionId: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  durationMs: number
  costUSD: number
  success: boolean
  errorMessage?: string
  requestSnippet: string    // first 80 chars of user prompt
}

interface UsageState {
  records: UsageRecord[]    // rolling, capped at 1000
  dailyAgg: {
    date: string            // 'YYYY-MM-DD'
    calls: number
    inputTokens: number
    outputTokens: number
    costUSD: number
  }[]                       // capped at 90 days
  sessionAgg: Record<SessionId, {
    calls: number
    inputTokens: number
    outputTokens: number
    costUSD: number
  }>

  recordCall(record: UsageRecord): void
  clearHistory(): void
  exportCSV(): string
  getTodayTotals(): Totals
  getSessionTotals(sessionId: string): Totals
  getAllTimeTotals(): Totals
}
```

持久化 key `lattice.usage`。对大型 records 数组 partialize 时裁剪。

### 5.3 prefs-store 扩展
```
composerMode: 'dialog' | 'agent'   // 默认 'dialog'
llmConfigCollapsed: string[]        // UI 状态：哪些 provider 卡展开
```

### 5.4 session-store 扩展（可选）
```
Session.composerMode?: 'dialog' | 'agent'  // 会话级覆写
```

---

## 6. 集成点

### 6.1 AgentComposer 改造
- Header 重画：模式切换 segmented control + 右侧 model chip
- `submitAgentPrompt(text, ctx)` 扩展 ctx 为：
  ```
  ctx.mode: 'dialog' | 'agent'
  ctx.generation: GenerationConfig (来自 llm-config-store)
  ctx.onUsageReported: (record) => void
  ```
- `TaskTimeline` 的渲染条件从 `task != null` 改为 `mode === 'agent' && task != null`
- Dialog 模式发送后直接在 transcript 里追加 assistant 回复，不开 task

### 6.2 useApi / sendChat 扩展
- 新签名 `sendChat({ message, mode, model, generation })`
- 返回包装 `{ content, usage: { inputTokens, outputTokens, ... }, durationMs }`
- 把 usage 写入 usage-store
- 需要**后端协议对齐**：lattice-cli 的 `/api/chat` 要开始返回 structured usage

### 6.3 StatusBar
- 替换当前的 `{model}` 展示为交互式 chip：`◈ <model-label> · <todayTokens>k · $<cost>`
- 点击打开 LLM 配置模态（Usage tab）
- 预算接近时加 ⚠ 徽章

### 6.4 LLMConfigModal（新组件）
- 位置：`src/components/llm/LLMConfigModal.tsx`
- 子组件：`ProvidersTab.tsx` / `GenerationTab.tsx` / `UsageTab.tsx` / `BudgetTab.tsx` / `RateLimitTab.tsx`
- 使用 ECharts 画 7 日 usage bar chart

### 6.5 ActivityBar
- 新增第 3 个顶栏图标：`⚡ LLM`（或 `Cpu` icon）→ 打开 LLMConfigModal

### 6.6 Command Palette
- 新命令：
  - `Open LLM Config` (Ctrl+Shift+L)
  - `Switch to Dialog Mode` (Ctrl+1)
  - `Switch to Agent Mode` (Ctrl+2)
  - `Clear Usage History`
  - `Show Today's Usage`

---

## 7. 后端协议依赖

这一块**需要 lattice-cli 对齐**，类似 Phase C1。

### 7.1 请求侧
前端在调用 `/api/chat` 时需要携带：
```json
{
  "message": "...",
  "mode": "dialog" | "agent",
  "model": "claude-opus-4-6",
  "provider": "anthropic",
  "generation": {
    "temperature": 0.7,
    "max_tokens": 1024,
    "top_p": 1.0,
    "system_prompt": "..."
  },
  "session_id": "...",
  "api_key_ref": "encrypted-or-pass-through"
}
```

### 7.2 响应侧
必须返回 structured usage 对象（而不是只返回 content）：
```json
{
  "content": "...",
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 567,
    "cache_read_tokens": 0,
    "cache_create_tokens": 0,
    "model_used": "claude-opus-4-6",
    "duration_ms": 2345,
    "provider": "anthropic"
  },
  "tool_calls": [...]   // only in agent mode
}
```

### 7.3 API key 管理
开放问题：
- **选项 A**: Frontend 持有 key，每次请求时注入 `X-Lattice-API-Key` header 发给后端，后端代发出去（后端不持久化 key）
- **选项 B**: Frontend 把 key POST 到 `/api/llm/providers`，后端持久化，之后仅用 `providerId` 调用
- **选项 C**: Env variable only — frontend 不管 key，只做展示

**推荐 A**：最少假设，最大用户控制。代价：每次请求多传 header。

---

## 8. 实施阶段（建议拆分）

### Phase LLM-1: 纯前端骨架（无后端依赖，可先做）
- llm-config-store.ts + usage-store.ts
- LLMConfigModal 全部 5 个 tab UI + mock 数据
- AgentComposer header 改造（模式切换 + model chip）
- StatusBar 升级
- ActivityBar ⚡ 图标
- prefs-store 加 composerMode
- 工作量：~2 天

### Phase LLM-2: 本地 usage 估算（无后端协议）
- 在 `sendChat` 拦截层做字符数 → token 估算（粗略，英文 ~4 字符/token，中文 ~2 字符/token）
- 每次发送后根据 `content.length` 反推 `outputTokens`
- 接入 usage-store 的 `recordCall`
- Budget 警告逻辑（client-side only）
- 工作量：~0.5 天

### Phase LLM-3: 后端协议对齐（与 lattice-cli 团队）
- 请求/响应 schema 谈判
- 后端实现 usage 返回
- 前端切换到真实 usage
- 工作量：前端 0.5 天 + 后端窗口

### Phase LLM-4: Dialog 模式的后端支持
- 后端 `/api/chat` 接 `mode` 参数分流
- Dialog 模式跳过工具链
- 工作量：前端 0 天 + 后端窗口

### Phase LLM-5: 多 provider 支持
- Provider CRUD UI
- Electron safeStorage 接入
- 多 provider 测试
- 工作量：~1.5 天

**总体**: **~4.5 天前端** + 后端协议窗口。Phase LLM-1 + LLM-2 可立即开工。

---

## 9. 开放问题（请审阅时决定）

| ID | 问题 | 默认建议 |
|---|---|---|
| Q1 | 默认 Composer 模式？ | **Dialog**（轻量）|
| Q2 | LLM 配置模态 vs ActivityBar 常驻面板？ | **模态**（不占用日常视觉空间） |
| Q3 | Budget 达到 limit 的默认行为？ | **Warn + 允许**（避免误伤正在跑的实验）; Hard stop 为可选 |
| Q4 | Usage records 上限？ | **1000 条详细 + 90 天聚合** |
| Q5 | Token 估算 in Phase LLM-2：是自己估还是等后端？ | **先自己估（粗糙但立即可用），Phase LLM-3 切换到真实值** |
| Q6 | 多 provider 支持的初始范围？ | **Anthropic + OpenAI + openai-compatible 三个**，Ollama 留到后续 |
| Q7 | API key 存储位置？ | **Electron safeStorage**，fallback 到明文 + 警告 |
| Q8 | Dialog 模式是否完全禁用工具？ | **默认禁用**，高级设置里可开白名单（如 read_spectrum / list_files） |
| Q9 | 系统 prompt 是否暴露给用户编辑？ | **是**（在 Generation tab），带 reset-to-default 按钮 |
| Q10 | Pricing 表的来源？ | **硬编码内置**（Claude / GPT / ...），用户可手动覆写；不自动拉取 |

---

## 10. 成功标准

- [ ] 用户打开窗口第一眼就能看到当前是 Dialog 还是 Agent 模式
- [ ] 在 Agent 模式下发一条消息 → TaskTimeline 正常运转；切到 Dialog 模式 → TaskTimeline 隐藏，发消息不创建 task
- [ ] 点 StatusBar 的 model chip → LLM 配置模态打开到 Usage tab
- [ ] 配一次 API key → 能在 Providers 看到 masked 显示 + Test connection 工作
- [ ] 发 5 条消息后 Usage tab 的 Today 计数从 0 涨到 5，cost 能算出来
- [ ] 设置 daily token limit = 1000 → 消耗到 800 时弹 warn toast，继续消耗到 1000 时（如选 hard stop）禁止发送
- [ ] 重启 app → 所有 provider 配置 + 历史 usage 都还在

---

## 11. 与现有设计的一致性检查

- ✅ 符合 DESIGN_PURPOSE §P1（意图优先）：Dialog 和 Agent 是两种意图的具体化
- ✅ 符合 §P2（过程透明）：Agent 模式保留 Timeline，Dialog 模式因为无过程所以不需要
- ✅ 符合 §P5（专家有出口）：LLM 配置是专家级设置，模态形式、默认隐藏
- ✅ 不破坏 Artifact 体系：消息产生的 artifact 仍然走 session-store，usage 记录是旁路
- ⚠️ 需要后端配合：§7 的协议对齐是硬依赖，但 Phase LLM-1/LLM-2 可先跑 mock

---

## 12. 审阅后需要确认的 3 件事

**审阅通过后，请回答**:

1. **方向认可？** Composer 双模式 + 独立 LLM 配置模态，这个路子 OK 吗？还是想要其他形态（比如 LLM 配置直接塞进 Settings 模态）？
2. **Phase 顺序？** LLM-1 → LLM-2 → LLM-3 → LLM-4 → LLM-5，OK 吗？还是想先出某个部分？
3. **Q1–Q10 开放问题** 有要覆盖的默认答案吗？

确认后我拆任务开工。
