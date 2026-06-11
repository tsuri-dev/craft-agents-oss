# iOS 会话流对齐桌面端方案：折叠流式输出 + 点击弹详情

> 现状：iOS 把每个工具调用的 Input/Result 全文内联展开在对话流里。
> 目标：对齐桌面端 —— 中间工作默认折叠成一行，点击工具行才在弹层（iOS 用 sheet）里看详情。
> 原则：**交互模式对齐桌面端，视觉 token 按 iOS 既定灰阶体系**（两者冲突时以 iOS 体系为准，冲突点见 §4 决策点）。
> 桌面端行为的唯一事实源是 `packages/ui`（Electron 与 webui 共用同一套组件）。

---

## 0. TL;DR

桌面端的机制可以概括为三句话：

1. **按「回合 Turn」折叠**：一个回合 = 用户消息到最终回复之间的全部中间工作（thinking / 工具调用 / 中间文本）。中间工作默认折叠成一行「▸ 计数徽章 + 单行预览」，最终回复卡独立在折叠区下方、永不折叠。
2. **折叠头本身就是流式进度条**：运行中也保持折叠，靠计数徽章实时 +1、预览文案 crossfade（当前工具名 → "正在回复…" → "N 步完成"）来传达进展。这是"流式效果好"的真正来源，不是把内容摊开。
3. **点击工具行 → 按工具类型三路由的详情弹层**：diff 视图 / 文档视图 / 通用 Input·Output 卡。数据就在 activity 对象里（toolInput + toolResult），点击即开、零额外请求。

iOS 的改动是**纯展示层**：数据已齐（截图里已有 label、status、input、result），新增 3 个组件（回合折叠头、工具行、详情 sheet）+ 1 个路由函数，把现在内联的 Input/Result 移进按需打开的 sheet。

---

## 1. 桌面端机制拆解（代码依据）

### 1.1 时间线分组：回合（Turn）

入口 `groupMessagesByTurn()`（`packages/ui/src/components/chat/turn-utils.ts:360`），把按时间排序的扁平消息数组组装成回合，规则：

| 消息 | 处理 |
|---|---|
| user / system 消息 | 各自成项，**断组** |
| `role: 'tool'` | 进当前回合的 `activities` 数组 |
| assistant 文本且 `isIntermediate: true` | 作为 `intermediate` 活动进 `activities`（工具间的过渡叙述） |
| assistant 文本且非 intermediate | 设为回合的 `response`（最终回复），**封口** |
| plan 消息 | 作为 `plan` 活动，独立渲染成回复卡，不进折叠区 |

要点：分组靠 `isIntermediate` 标志而非 turnId —— 用户输入到最终回复之间的所有工作就是一个回合。

**二级分组（Task 子代理）**：若回合内有 Task 工具（`isParentTaskTool`，turn-utils.ts:1094），用 `groupActivitiesByParent()`（turn-utils.ts:1088）按 `parentToolUseId` 把子工具挂进父 Task，形成组内可再折叠的二级结构。

### 1.2 折叠头（关键组件）

`TurnCard.tsx:2962–3012`，**常驻渲染**（运行中也折叠，除非用户手动展开）：

```
[▸ chevron 12px，展开转90°] [计数徽章] [单行预览文案 crossfade] [⋯操作菜单]
```

- 计数徽章 = `activities.length`（工具 + thinking 全算，TurnCard.tsx:2984），白底 + 极轻投影、圆角 4、10px tabular 数字，流式期间实时跳数。
- 预览文案优先级（`getPreviewText()`，TurnCard.tsx:712）：
  1. 流式且已开始回复 → "正在回复…"
  2. 流式中 → 运行中工具的显示名 / 最近一条 intermediate 文本
  3. 显式 intent / 首个活动的 intent
  4. 完成 → "Steps completed"（+ 失败计数后缀）
- 文案切换带 200ms crossfade（AnimatePresence，TurnCard.tsx:2990–3001）。
- 展开/折叠状态**按 session 持久化**（`apps/electron/src/renderer/hooks/useTurnCardExpansion.ts`，localStorage，LRU 100 个 session），默认全折叠。
- 展开动画：高度 0→auto 250ms，子行 stagger 入场。

### 1.3 工具行 anatomy（ActivityRow，TurnCard.tsx:900–1204）

```
[状态icon] [显示名] [−N][+N] [文件chip] · [intent 单行截断]
```

- **状态 icon 5 态**：pending=空心圆 / running=spinner / completed=✓（或工具自定义 icon）/ error=✕ / backgrounded=spinner（强调色）。状态切换 icon crossfade（200ms）。
- **显示名**：来自模型在 toolInput 里生成的 `_displayName`/`_intent` 字段（SSE 拦截提取，`packages/shared/src/agent/tool-matching.ts`）。"Inspect Config"、"Fix Auth Config" 这类短标签**不是前端造的**——iOS 直接消费事件里的 `toolDisplayName`/`toolIntent` 字段即可，无 fallback 时显示原始工具名。
- **diff 徽章**（仅 Edit/Write）：前端本地计算（`computeEditWriteDiffStats()`，TurnCard.tsx:140–187）——Edit 用 old_string/new_string 做 diff，Write 视为全新增。红 `−N`、绿 `+N`。
- **文件 chip**：只显示文件名，不带路径（取自 `toolInput.file_path`）。
- **MCP 工具**：显示来源名（如 "TAPD"）+ 工具 slug。
- **thinking 行**（TurnCard.tsx:905–952）：虚线圆 icon + 去 markdown 的单行文本，前景 75%。
- **可点击条件**：`status ∈ {completed, error}` 才可点进详情（TurnCard.tsx:1031）；pending/running 不可点、无 hover 态。

### 1.4 点击 → 详情弹层（三路由）

路由决策在 `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:1961–1995`：

| 条件 | 弹层 | 内容 |
|---|---|---|
| Edit / Write（非 .md/.txt） | Multi-diff 视图（`MultiDiffPreviewOverlay`） | 同回合相关文件改动的 diff 堆叠，行级 +/− 标记（@pierre/diffs + Shiki） |
| Write .md/.txt、plan、回复全屏 | 文档视图（`DocumentFormattedMarkdownOverlay`） | markdown 排版后的文档卡 |
| 其余全部 | 通用 Input/Output 卡（`ActivityCardsOverlay`） | Input 卡 = 参数（JSON / 命令预览）；Output 卡按内容自适配 |

Output 自适配逻辑在 `extractOverlayCards()`（`packages/ui/src/lib/tool-parsers.ts:486`）：

- Read / Write 其他文件 → **代码视图**：行号槽 + 语法高亮（ShikiCodeViewer）
- Bash / Grep / Glob → **终端样式**：mono、ANSI 解析、grep 命中高亮
- 输出是 JSON → JSON 树
- 其余 → markdown / 纯文本兜底

数据流关键点：**activity 对象自带 `toolInput` + `toolResult` 全文，点击即开、零额外请求**；弹层 header 48pt = 工具类型 pill + 文件路径 chip + ✕；关闭 = ✕ / ESC / 点背板。

### 1.5 流式更新

- 回复文本 300ms 节流刷新 + smart buffering（凑够 40 词或 2.5s 超时才上屏，避免开头闪烁，TurnCard.tsx:453–510）。
- 工具行状态原地更新（icon crossfade），新行 stagger 入场，列表不虚拟化。

---

## 2. 给设计师的 UI 规格（Figma 落稿清单）

硬约束沿用已定稿体系：纯灰阶（禁暖灰）、功能色仅 #34A853 / #D93025 且只用于小元素、hairline 分割、行高 ≥44pt、Dynamic Type 到 AX1、dark mode 按既定映射表。

### 2.1 组件 A：回合折叠头 TurnHeaderRow（核心新组件）

**折叠态（默认，运行中也折叠）**，44pt 行：

- ▸ chevron 12pt `#8A8A8A`，展开顺时针转 90°（150ms）
- 计数徽章：`#FFF` 底 + hairline 描边，圆角 4pt，11pt tabular `#555`；流式期间数字实时跳（带 numeric 滚动过渡）
- 预览文案：15pt `#555`，单行尾截断；内容随状态实时切换并 crossfade（200ms）——运行中=当前工具显示名/intent → 回复中=「正在回复…」→ 完成=「N 步完成」；有失败时追加「· N 失败」（`#D93025` 文字，语义不只靠颜色）
- 运行中：行尾 14pt micro-spinner（`#8A8A8A`），完成后淡出（决策点 ④）
- 点击整行 toggle，selection haptic；展开后头部样式不变（仅 chevron 朝下）

**展开态**：下方活动列表左缩进对齐徽章，高度展开动画 250ms，子行 stagger（约 30ms/行）；活动区与最终回复卡之间不加分割线（留白分隔）。

**展开记忆**：用户手动 toggle 按 session 记住（重进会话恢复）。

### 2.2 组件 B：工具行 ToolRow

44pt 单行，左→右：

| 元素 | 规格 |
|---|---|
| 状态 icon | 16pt：pending 空心圆 `#D9D9D9` / running spinner `#8A8A8A` / 完成 ✓（颜色见决策点 ②）/ 失败 ✕ `#D93025` / backgrounded spinner |
| 显示名 | 15pt `#1A1A1A` medium；MCP 工具 = 来源名 + slug（slug `#8A8A8A`） |
| diff 徽章 | `−N` `#D93025`、`+N` `#34A853`，11pt tabular，**纯文字无底色**（小元素，合规）；仅 Edit/Write |
| 文件 chip | `#F2F2F2` 填充、圆角 4pt、12pt `#555`，只显示文件名 |
| intent | 「·」+ 13pt `#8A8A8A`，单行尾截断 |

- thinking 行：虚线圆 icon 16pt + 13pt `#8A8A8A` 单行（无 chip/徽章）
- 可点态：completed/error 整行可点（进详情 sheet），按压底 `#F7F7F7`；pending/running **不可点**、无按压反馈
- 长按：复制（文件路径 / 命令），符合通则
- AX：icon 状态都有 accessibilityLabel 文字

### 2.3 组件 C：详情 Sheet ToolDetailSheet（替代桌面的全屏 overlay）

- `UISheetPresentationController`：初始 **large** detent（代码/diff 需要高度，见决策点 ③），可拖到 medium，下滑关闭，显示 grabber
- Header 48pt：左=工具类型 pill（icon+名，`#F2F2F2` 填充）；中=文件路径 chip（单行中部截断，**长按复制完整路径**）；右=✕ 28pt
- Body 三种（对齐桌面三路由）：
  1. **代码视图**（Read / Write 非文档）：`#FFF` 卡 + hairline；行号槽右对齐 mono 11pt `#B0B0B0`，hairline 分隔；代码 mono 13pt `#1A1A1A`，横向滚动；MVP 不做语法高亮（P2），**行号必须有**
  2. **diff 视图**（Edit / Write 代码文件）：行级 +/− 标记，方案见决策点 ①；行首固定 `+`/`−` 符号列（文字语义兜底）
  3. **通用 Input/Output**：两张卡上下排，卡题「输入」「输出」12pt `#8A8A8A`；Input=参数键值 mono（Bash 类显示命令预览）；Output 自适配——终端类 `#F2F2F2` 底 mono（ANSI 剥离）/ JSON mono 原文（树形折叠 P2）/ 其余 markdown 排版
- 超长内容：默认渲染前 500 行 + 底部「显示全部（共 N 行）」；header 下副标题显示「N 行」
- dark mode：按既定映射（`#FFF`→`#1C1C1E`、`#F2F2F2`→`#2C2C2E` 等）

### 2.4 其余时间线元素

- **最终回复卡**：markdown 排版，流式时尾部光标；卡底操作行「复制 / Markdown」（对齐桌面截图）；**不参与折叠**
- **系统 pill**（取消/中断）：✕ icon + 文案，白底 + hairline 胶囊，独立一行左对齐
- **auth/状态通知**：右对齐 `#8A8A8A` 短文案（对齐桌面「Authentication cancelled for …」样式）
- 现状 → 目标对照：现在 iOS 是"每个工具一张大卡、Input/Result 全文内联"；目标是"回合一行折叠头 + 工具一行 + 详情进 sheet"。建议 Figma 里放桌面截图同帧对照。

---

## 3. 给 codex 的实现方案

### 3.1 原则：数据层不动，纯展示层重构

iOS 已拿到 toolDisplayName、status、toolInput、toolResult（现版本截图证实）。协议与桌面完全一致：`SessionEvent` union 见 `packages/shared/src/protocol/dto.ts:507–553`（`tool_start`/`tool_result`/`text_delta`/`text_complete(isIntermediate)`/`status`/`interrupted`…），webui 走 WebSocket 同协议，无移动端特殊分支。需要确认 iOS 模型已透传：`isIntermediate`、`toolDisplayName`、`toolIntent`、`parentToolUseId`、`toolStatus` 五个字段。

### 3.2 纯逻辑移植对照表（桌面 → Swift）

| 桌面代码 | 位置 | iOS 对应物 |
|---|---|---|
| `groupMessagesByTurn()` | `packages/ui/src/components/chat/turn-utils.ts:360` | `TurnGrouper`：§1.1 五条规则直译 |
| `getPreviewText()` | `packages/ui/src/components/chat/TurnCard.tsx:712` | `TurnPreviewText`：同优先级 |
| `computeEditWriteDiffStats()` | `TurnCard.tsx:140` | Swift `CollectionDifference`（按行 diff）算 +N/−N |
| 详情三路由 | `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:1961` | `enum DetailRoute { case diff, document, cards }` |
| `extractOverlayCards()` | `packages/ui/src/lib/tool-parsers.ts:486` | `ToolPayloadPresenter`：Output 内容嗅探（JSON/代码/终端/markdown） |
| 可点击条件 | `TurnCard.tsx:1031` | `status == .completed || status == .error` |
| 展开持久化 | `apps/electron/src/renderer/hooks/useTurnCardExpansion.ts` | UserDefaults `[sessionId: Set<turnKey>]`，保留最近 50 个 session 即可 |

### 3.3 组件树（SwiftUI）

```
SessionStreamView (List / LazyVStack)
├─ UserBubbleRow
├─ TurnSection
│   ├─ TurnHeaderRow              // 常驻折叠头
│   └─ if expanded:
│       ├─ ThinkingRow*
│       └─ ToolRow*               // Task 子代理本期平铺（见不做清单）
├─ ResponseCardRow                 // markdown，最终回复，不折叠
├─ SystemPillRow / AuthNoticeRow
```

- 行 identity 稳定：工具行用 `toolUseId`、文本用 messageId —— 状态变化原地 diff 更新，不重建列表
- 详情：`.sheet(item: $selectedActivity) { ToolDetailSheet(activity: $0) }`，数据就地取自 activity，**不发新请求**

### 3.4 流式细节（体验关键）

- 回复文本节流合并刷新（对齐桌面 300ms），避免 SwiftUI 每个 delta 触发整列 diff
- 折叠头：预览文案 `withAnimation` crossfade；计数徽章 `contentTransition(.numericText())`
- smart buffering（40 词缓冲）P2，本期不做
- 性能红线：**列表层任何行组件不得渲染 toolResult/toolInput 全文**（只渲染摘要字段）；详情视图在 sheet 打开时才构建

### 3.5 交付验收（可机器验证）

1. grep：列表行组件源码中无 `toolResult` 全文绑定（仅 ToolDetailSheet 引用）
2. 截图三件套 × 浅/深：折叠默认态（流式中）/ 展开态 / 详情 sheet 三种 body
3. 既定项：grep 无暖灰残留、设计 token diff 零改动
4. 压测：模拟 1000 行 Bash 输出的会话——列表滚动不掉帧，sheet 首屏 <300ms（500 行截断生效）
5. 状态矩阵截图：工具行 5 态 + thinking 行
6. 行为验证：running 行不可点；用户展开的回合在重进会话后保持展开

### 3.6 不做清单（本期）

- Task 子代理二级折叠组（数据层保留 `parentToolUseId`，UI 先平铺）
- 语法高亮、JSON 树形折叠（mono 原文兜底）
- smart buffering、annotation/批注、全屏 markdown 导出、回合 ⋯ 操作菜单
- 展开状态 LRU 100 的完整实现（简化为最近 50）

---

## 4. 需要拍板的决策点

| # | 问题 | 推荐 | 备选 |
|---|---|---|---|
| ① | diff 行底色 | 低透明度红/绿行底（4–6%）+ 行首 +/− 符号列——语义必需场景，作为功能色约束的明确豁免写进规范 | 纯灰阶：删除行删除线+`#8A8A8A`，新增行左侧 2pt 绿条 |
| ② | 完成态 ✓ 颜色 | 灰 `#8A8A8A`（绿专属 running/已连接，体系更干净；与桌面的绿 ✓ 有意差异） | 跟桌面用绿 `#34A853` |
| ③ | 详情 sheet 初始 detent | large（代码/diff 阅读需要高度；与通则「medium 起步」的偏离点明在规范里） | medium 起步 |
| ④ | 折叠头运行中指示 | 行尾 14pt micro-spinner + 预览文案 crossfade | 仅预览文案（完全照搬桌面） |
