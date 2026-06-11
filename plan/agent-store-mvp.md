# Agent Store 技术方案（MVP）：Agent 作为可下载数据包 + 外部服务器托管

> 背景：希望用户在 app 内浏览/下载/上传/更新「Agent 包」，托管在自有网站+服务器；
> 根本动机：craft-agents 部署到 server 端时 workspace 要从零配置。
> 本文基于真实代码验证后的修订方案。
> **2026-06-10 已拍板**：① 双入口；② 安装权限取 min(包声明, 'ask')；③ 包不携带 source 配置、只声明依赖；④ skill 完整打包 + 安装时按版本判定复用/更新（§2.1）；⑤⑥ skill 同时作为独立可装单元分发——**新立 craft 原生 skill 规范，git 仓库为底稿，网站服务端摄取后统一经 API 分发**（§2.2）。

---

## 0. 结论

**方向成立**：「先做 Agent Store（数据包），后做 Plugin Marketplace（代码包）」的两层拆分在代码层面得到验证。对照代码后的三处关键修正：

1. **「纯数据包 = 不执行代码 = 安全」要打折扣**。两个提权面：
   - source 的 MCP 配置支持 `transport: 'stdio'` + `command`/`args`/`env`（[sources/types.ts:242,273](packages/shared/src/sources/types.ts)）——携带 stdio source 等于安装即任意命令执行。**已拍板的「包不携带任何 source」直接消除了这个面**；stdio 禁令保留为未来任何 source 分发机制的红线。
   - skill 的 `alwaysAllow`（[skills/types.ts:19](packages/shared/src/skills/types.ts)）可自动放行工具（如 Bash）；skill 文件夹可携带任意文件，**app 不执行它们，但 agent 可以被 instructions 引导用 Bash 执行**。信任模型 = 安装确认屏逐项明示 + 权限上限（min 规则）。
2. **包格式不要发明新 schema**。现有 `AgentProfile`（[agent-profiles.ts:7-28](packages/shared/src/agent-profiles.ts)）、`SKILL.md` frontmatter 就是包内容的原生格式，manifest 只做「信封」（版本/作者/校验/依赖声明）。
3. **光有 Store 解不了 server 部署痛点**。需要 Phase 1.5：**workspace bootstrap from packages**——服务器启动时按声明清单自动从 Store 拉包；凭据（真正不可移植的部分，机器绑定加密 vault）通过 env 注入或 webui 首登补全。

**意外资产**（验证过，全部可直接复用）：

| 资产 | 位置 | 用途 |
|---|---|---|
| `skills:import` RPC（含 frontmatter 包装） | [channels.ts:301](packages/shared/src/protocol/channels.ts)、`skills/storage.ts:345` | 安装包内 skill |
| skill `requiredSources` 字段 | [skills/types.ts:28](packages/shared/src/skills/types.ts) | 依赖声明机制已存在 |
| source 创建 + 凭据分离存储（vault） | `sources/storage.ts:501`、`credential-manager.ts` | 依赖源的连接/认证流 |
| deeplink 已注册 `agents/sources/skills` 前缀 | `apps/electron/src/main/deep-link.ts:141` | 网站「在 App 中安装」链接 |
| 根依赖 `tar@7.5.2`、ui 包 `fflate` | package.json | 打包/解包零新增依赖 |
| zod 校验框架 | `packages/shared/src/config/validators.ts` | manifest/包内容校验 |
| `workspace.remoteServer` 绑定（存量 stub） | [config/storage.ts:698](packages/shared/src/config/storage.ts) | 本地 app ↔ server 部署关联（未启用） |
| RPC handler 层在 server-core | `packages/server-core/src/handlers/rpc/` | **Store 逻辑放这里，desktop + server/webui 双端同时获得** |

---

## 1. 代码现状验证（逐条对照）

| 原判断 | 验证结果 | 证据 |
|---|---|---|
| PluginsHub 硬编码 TAPD | ✅ 属实（fork 自定义代码） | [PluginsHub.tsx:58-72](apps/electron/src/renderer/components/app-shell/PluginsHub.tsx) `featuredPlugins` 写死 tapd |
| Agent Profile 已是独立概念 | ✅ `agents/{id}/profile.json` + `instructions.md`，workspace 作用域 | [agent-profiles.ts:7-28](packages/shared/src/agent-profiles.ts)；CRUD 在 [server-core/.../agent-profiles.ts](packages/server-core/src/handlers/rpc/agent-profiles.ts) |
| Skills 是文件夹包 | ✅ `SKILL.md`(frontmatter) + icon + 任意文件；global/workspace/project 三级，project 优先 | `skills/storage.ts`，5 分钟缓存 |
| 「数据包不执行任意代码」 | ⚠️ 部分属实，见 §0 修正 1 | alwaysAllow、捆绑文件（source 已不入包） |
| 无既有市场/版本机制 | ✅ 无 semver、无 export/import、无 installedPackages —— 全部待建；**skill 也无 version 字段，需新增** | 全仓 grep 无命中 |
| server 部署丢配置 | ✅ 且更精确：目录/config/skills 走 volume 可保留；**真正丢的是凭据**（vault 按机器加密不可移植）+ 新 workspace 初始化为空 | `headless-start.ts:258-412`、`workspaces/storage.ts:292-347` |

字段级事实：`AgentProfile` = id / name / description / status(ready|draft) / visibility(固定 'workspace') / connectionSlug / model / thinkingLevel / permissionMode / skillSlugs / sourceSlugs / environmentVariables / createdAt / updatedAt；`instructions` 单独存 `instructions.md`。

---

## 2. 包格式（对齐原生 schema，manifest 只做信封）

```
{packageId}-{version}.tar.gz          # 用根依赖 tar，不引 zip 库
├── manifest.json                     # 信封（下方 schema）
├── agent/
│   ├── profile.json                  # AgentProfile 子集：剥离 id/status/visibility/createdAt/updatedAt
│   └── instructions.md
├── skills/{slug}/                    # 完整 skill 文件夹原样打包（含 icon 与辅助文件）
│   ├── SKILL.md                      # frontmatter 新增 version 字段（§2.1）
│   └── ...
├── README.md
└── CHANGELOG.md
# 注意：包内【不允许】sources/ 目录 —— source 只在 manifest 里声明依赖（已拍板 ③）
```

### manifest.json（zod schema 落在 `packages/shared/src/store/manifest.ts`）

```jsonc
{
  "schemaVersion": 1,
  "packageId": "code-reviewer",            // store 全局唯一 slug
  "version": "1.2.0",                      // semver，store 侧管理
  "name": "Code Reviewer",
  "description": "Reviews diffs and reports risks.",
  "author": { "id": "user_123", "name": "tsuri" },
  "compat": { "minAppVersion": "0.10.0" },
  "contents": {
    "agent": true,
    "skills": [ { "slug": "code-review", "version": "1.1.0" } ]   // 与 SKILL.md frontmatter 一致，安装器交叉校验
  },
  "requiredSources": [                     // 仅声明，不携带配置（已拍板 ③）
    { "slug": "github-api", "type": "api", "hint": "GitHub REST，需 PAT（repo scope）" }
  ],
  "requiredEnv": ["REVIEW_STRICTNESS"],    // 仅 key，不含值
  "permissionsSummary": {                  // 聚合包内权限面，供安装确认屏展示
    "alwaysAllow": ["Bash"],
    "permissionMode": "ask",
    "bundledFiles": ["skills/code-review/scripts/check.py"]   // 非 markdown/icon 的捆绑文件清单
  },
  "checksums": { "agent/profile.json": "sha256:...", "skills/code-review/SKILL.md": "sha256:..." }
}
```

### 包内容安全政策（安装器强制执行）

| 规则 | 处理 |
|---|---|
| 包内出现 `sources/` 目录或任何 source 配置（含 stdio） | **拒绝安装**（source 只声明依赖；本地 stdio 源只能用户手建，受 `localMcpServers.enabled` 门控） |
| 任何凭据形态字段（token/secret/Authorization 值）、`environmentVariables` 的值 | 打包时剥离，安装时扫描到即拒绝 |
| agent `permissionMode` | 安装写入时取 `min(包声明, 'ask')`（已拍板 ②），用户装后可手动调高 |
| skill `alwaysAllow`、`permissionsSummary.bundledFiles` | 不禁止，但**安装确认屏必须逐项明示**（已拍板 ④：skill 完整带入） |
| icon | 沿用现有规则：仅 emoji 或 URL（`skills/storage.ts:93` 已拒绝相对路径/内联 SVG） |

### 2.1 Skill 版本与共享判定（已拍板 ④ 的机制设计）

**前提改造**：`SkillMetadata` 新增可选 `version?: string`（semver），`parseSkillFile()` 透传（[skills/types.ts:11-72](packages/shared/src/skills/types.ts)、`skills/storage.ts:82-109`）。存量/手作 skill 无 version 时，以 **skill 文件夹内容 sha256** 作为等价判据。

安装时对包内每个 skill 按 slug 判定：

1. **workspace 无该 slug** → 直接安装，回执记录 hash。
2. **已存在该 slug**：
   - 版本相同（或双方都无 version 且内容 hash 相同）→ **复用现有，不写文件**，回执登记共享引用（`reused: true`）。
   - 版本不同 → **更新到包内版本**，但有两道保护：
     - **本地改动保护**：现有 skill 与其安装回执的 hash 不一致（被用户改过），或它本来就不是 store 装的（手作 skill）→ 弹确认：覆盖 / 保留现有 / 装为副本（`{slug}-2`，agent 的 skillSlugs 指向副本）。
     - **共享回退提示**：其他已装包引用同 slug 且声明了更旧版本 → 默认仍更新（假设 skill 向后兼容），但提示受影响的 agent 清单，可选装为副本。
3. **卸载**：按回执聚合做引用计数——仅当 skill 系 store 安装、且不再被任何已装包/agent 引用时才删除文件夹。
4. **遮蔽警告**：现有解析优先级为 project > workspace > global（`skills/storage.ts`）。安装只写 workspace 层；若检测到 project 层存在同 slug，提示「该 skill 会被项目级同名 skill 遮蔽」。

> 以上 2 的两道保护与 3/4 是我补充的派生规则（默认行为），可再调整。

### 2.2 Skill 独立分发：新 skill 规范 + git 底稿 + 服务端摄取（2026-06-10 二次拍板）

> 演进记录：最初设计为客户端 claude-marketplace git 适配器直读 qn-market（受限于 Claude 格式的插件级版本）；拍板修订为——**网站服务端可访问 git 仓库，skill 不沿用 Claude 插件格式，新立 craft 原生 skill 规范**，由服务端摄取后统一经 §3 API 分发。客户端从头到尾只面对一种 registry 协议。

**新 skill 规范（推荐：craft 原生格式 + version，安装端零转换）**

```
skills/{slug}/
├── SKILL.md          # frontmatter：name、description、version（semver，必填）、icon?、requiredSources?、alwaysAllow?、globs?
├── icon.svg|png      # 可选
├── CHANGELOG.md      # 可选，Store 详情页展示
└── assets/...        # 任意辅助文件（受 §2 政策约束：确认屏列清单）
```

关键选择：规范主体就是 craft 现有 SKILL.md 格式（`parseSkillFile`，`skills/storage.ts:82-109`）+ 新增 `version` 字段——**客户端零格式转换**，服务端摄取校验、app 上传校验、安装校验三处共用同一套规则（「能导出的必能装”原则延伸到 skill）。

**统一包模型**：manifest 增加 `type: 'agent' | 'skill'`。skill 包 = 信封 manifest + 单个 skill 文件夹（**包 version 即 skill version**，权威值与 frontmatter 一致，摄取时交叉校验）；§3 API、状态机、下载、回执、§2.1 判定全部复用，仅列表接口加 `type` 过滤。agent 包内联 skill（决策 ④）不变；P2+ 可加 `skillRefs`（packageId + versionRange）声明对 skill 包的依赖。

**发布管线（git → 网站）**

1. git 仓库为底稿与评审场——**MR 即审核**：git 摄取通道的包 merge 后直接 published（跳过 pending_review）；app 上传通道（P2）仍走原状态机。
2. 仓库内 skill 目录按上述规范组织；版本权威 = frontmatter `version`，作者在 MR 中手动升版，服务端校验 semver 单调递增。
3. 网站服务端 webhook/轮询拉取 → diff 变更的 skill → 跑与客户端同源的校验（zod + parseSkillFile 规则 + §2 安全政策）→ 不可变版本快照入库 → published。
4. **与 qn-market 共存零成本**：同一仓库 `plugins/` 继续服务 Claude Code（现状不动），新增目录按新规范服务 craft，两边互不影响；也可以新开仓库，服务端只约定摄取目录。

**对客户端的简化**：claude-marketplace git 适配器移出 MVP（`StoreRegistry` 接口保留，将来要直连任意 Claude 市场再加回）；客户端只实现 http-api registry。

---

## 3. 服务端 API（你的网站，REST 草案）

```
GET  /api/v1/packages?type=agent|skill&q=&sort=&page=     → 列表（id/type/name/desc/author/version/downloads/updatedAt/compat）
GET  /api/v1/packages/{packageId}                          → 详情 + 版本列表 + README/CHANGELOG 渲染
GET  /api/v1/packages/{packageId}/{version}/download       → tar.gz；响应头/详情体携带 sha256
POST /api/v1/packages                  (auth, multipart)   → 上传，落为 draft
POST /api/v1/packages/{id}/{ver}/submit|publish|yank       → 状态机：draft → pending_review → published / rejected；published 可 yank
GET  /api/v1/me/packages               (auth)              → My Uploads
```

- **鉴权**：网站生成 PAT → 用户粘贴进 app 设置 → 存现有加密 vault（key 形如 `store_pat::{registryHost}`）。浏览/下载匿名可用，上传需 PAT。
- **审核**：published 前审核（重点查 §2 政策项、bundledFiles、instructions 恶意引导），配合 yank + 举报。
- **git 摄取通道**（§2.2）：服务端 webhook/轮询同步底稿仓库，变更包经服务端校验后直接 published（MR 即审核）；与 app 上传通道并存。
- **目录即服务端数据，客户端零发版**：agent/skill 包以不可变版本快照托管在网站侧（DB + 对象存储），客户端是通用浏览器+安装器——新增包、升版本、改元数据均不需要发布客户端版本。包格式演进由 `schemaVersion` + `compat.minAppVersion` 兜底：老客户端对不兼容包「可见但标记需升级 App」，不会误装。
- registry 地址可配置（默认你的站点），为将来私有部署留口。

---

## 4. 客户端实现（文件级改造清单）

### 4.1 放置原则（关键架构决策）

- **RPC handlers 放 `packages/server-core/src/handlers/rpc/store.ts`** —— 与 agent-profiles 同层，Electron main 和 headless server 共用注册，**desktop 与 server/webui 双端同时获得**；server 场景下用户直接在 webui 里给服务器 workspace 装 agent。
- **Store UI 放 `packages/ui`** —— 被 Electron renderer 和 webui 复用。
- 所有外网请求走 main/server 进程（network-proxy + vault 取 token），renderer 不直连。

### 4.2 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/shared/src/protocol/channels.ts`（+ dto.ts） | 新增 `store:*`：list / getDetail / install / uninstall / checkUpdates / export / upload / setToken / getStatus |
| 2 | `packages/shared/src/store/`（新建） | `manifest.ts`（zod）、`packager.ts`（导出→tar.gz）、`installer.ts`（管线见 4.3）、`receipts.ts`、`skill-resolution.ts`（§2.1 判定）、`registries/`（StoreRegistry 接口 + http-api 实现；claude-marketplace 适配器移出 MVP，§2.2） |
| 3 | `packages/shared/src/skills/types.ts` + `storage.ts` | SkillMetadata 增加 `version?`，parseSkillFile 透传 |
| 4 | `packages/server-core/src/handlers/rpc/store.ts`（新建） | RPC handlers，调 shared/store |
| 5 | `apps/electron/src/transport/channel-map.ts` | 映射新 channel |
| 6 | `packages/ui/src/components/store/`（新建） | StoreBrowser（列表/搜索/详情）、InstallConfirmSheet（权限面+skill 判定结果+缺失源清单）、MyUploads、UpdateBanner |
| 7 | [AgentProfiles.tsx](apps/electron/src/renderer/components/app-shell/AgentProfiles.tsx) | Agents 页新增 **Store tab**（已拍板 ①） |
| 8 | [PluginsHub.tsx](apps/electron/src/renderer/components/app-shell/PluginsHub.tsx) | 新增 **Agent Store 卡片**作为别名入口，同一路由（已拍板 ①） |
| 9 | `apps/electron/src/main/deep-link.ts` | `craftagents://store/package/{id}[@version]` → 打开详情/安装确认 |
| 10 | `packages/shared/src/workspaces/types.ts` | WorkspaceConfig 新增 `installedPackages` 回执（4.3） |
| 11 | 设置页 | Store registry 地址 + PAT 录入（凭据走 vault） |

### 4.3 安装管线与回执

```
download(tar.gz) → sha256 比对 → 解包到临时目录
→ zod 校验 manifest + 逐项校验（profile 走 normalizeProfile 同款逻辑；skill 走 parseSkillFile；manifest.contents 与实际文件交叉核对）
→ 安全扫描（§2 政策：sources 目录拒绝 / 凭据字段拒绝 / 权限面收集）
→ skill 判定（§2.1）：得出 安装 / 复用 / 更新（含冲突确认项）三类结果
→ source 依赖检查：requiredSources 对照 workspace 现有 source slug → 产出「缺失源清单」（不自动创建）
→ 安装确认屏：model、permissionMode(min 后值)、skills 判定结果、alwaysAllow、bundledFiles、缺失源、requiredEnv
→ 写入：createAgentProfile（生成本地 id，permissionMode 取 min）＋ skill 按判定落盘 ＋ 回执
→ 收尾引导：缺失源 → 跳转新建/连接源（复用现有 sources 创建+saveCredentials/OAuth 流）；已有但未认证的源 → 直接进认证流
```

回执结构（更新检测 + 改动保护 + 引用计数的依据）：

```ts
installedPackages?: Record<string, {
  version: string
  registry: string
  installedAt: number
  agentProfileId?: string   // skill 包（type:'skill'，§2.2）安装时为空
  skills: Array<{ slug: string; version?: string; hash: string; reused: boolean }>
  requiredSources: Array<{ slug: string; satisfiedAt?: number }>
  contentHashes: Record<string, string>   // 包内各文件 sha256
}>
```

### 4.4 更新机制（P3）

- `store:checkUpdates`：按回执批量查 registry 最新版本（手动触发 + 打开 Store 时顺带，不做后台轮询）。
- 更新前用 `contentHashes` 对比本地：未改动 → 干净覆盖；已改动 → **Modified**，三选项：覆盖 / 装为副本（新 id）/ 查看 diff（桌面端复用 ShikiDiffViewer，`packages/ui/src/components/code-viewer/`）。
- 包更新内的 skill 同样走 §2.1 判定（含共享回退提示）。
- 不自动更新，永不静默覆盖用户改动。

### 4.5 上传/打包（P2）

- 「从本地 Agent 导出」= 安装的逆过程：取 profile + instructions + 引用的 workspace skills（完整文件夹，写入/确认 version）；引用的 sources **仅生成 requiredSources 声明**（slug + type + hint），不打包配置 → 生成 manifest（聚合 permissionsSummary）→ tar.gz → `POST /packages`。
- 客户端预校验 = 安装校验同一套代码（shared/store 复用），保证「能导出的必能装」。
- My Uploads 页展示状态机（draft / pending_review / published / rejected / yanked）。

---

## 5. Phase 1.5：server 部署打通（解决原始痛点）

现状事实：fresh server 上 workspace 目录/config/skills 可经 volume 保留，**真正不可移植的是凭据**（`credentials.dat` 按机器加密）；全新 workspace 初始化为空（`createWorkspaceAtPath()`，[workspaces/storage.ts:292-347](packages/shared/src/workspaces/storage.ts)）。

1. **声明式 bootstrap**：`headless-start.ts` 启动序列尾部增加一步——读 `CRAFT_BOOTSTRAP_PACKAGES="code-reviewer@^1.2,handoff-agent"`（env）或 workspace config 的 `bootstrapPackages`，对未安装/版本不满足的包调用同一个 `installer.ts`（无人值守模式：跳过确认屏，按安全政策硬校验）。
2. **Setup Checklist（webui 首登）**：包不带 source（已拍板 ③），所以 bootstrap 后把回执里的「缺失源 + 未认证源 + requiredEnv」聚合成首登任务清单，复用现有 auth_request 卡片流逐项补全。
3. **凭据 env 注入**（CI/容器场景）：`CRAFT_SOURCE_CRED_{SLUG}` 启动时写入 vault——仅对已存在的源生效；若要全自动建源，将来可加 `CRAFT_BOOTSTRAP_SOURCES` 只读种子目录（独立机制，不走包）。
4. 最终形态：**新 server = docker run + token + 包清单 env（+ 可选凭据 env）→ webui 首登按清单补全源和凭据**，几分钟内得到配置完整的 workspace。

---

## 6. 阶段划分（修订版）

| 阶段 | 内容 | 备注 |
|---|---|---|
| **P0.5 Skill 包先行** | 服务端：git 摄取 + skill 包 API 子集；客户端：Skills 页签（浏览/安装/更新 skill 包） | 范围远小于完整 Store；先打通「git 改 skill → merge → app 内可更新」闭环；复用 §2.1 判定 |
| **P1 Store MVP** | 浏览/搜索/详情/安装（含 §2.1 skill 判定、缺失源清单）/回执 + 设置页 | handlers 进 server-core、UI 进 packages/ui，webui 自动获得 |
| **P1.5 Server bootstrap** | env 包清单 + Setup Checklist + 凭据注入 | **原始痛点在此闭环** |
| **P2 上传与管理** | 导出打包、上传、My Uploads、状态机 | 校验复用安装那套 |
| **P3 更新机制** | checkUpdates、hash 改动保护、diff/副本 | diff 复用 ShikiDiffViewer |
| **P4 Plugin Marketplace** | 带 UI/运行时代码的真插件：签名、沙箱、权限、回滚 | 维持原判断：后置 |

iOS 一句话：Store 浏览页天然符合 iOS 端「仅浏览 + 用对话修改」哲学，P1 之后可作为 iOS 插件 tab 的一个卡片（浏览 + 触发安装到 server workspace），本文不展开。

---

## 7. 已确认决策（2026-06-10）与派生规则

| # | 决策 | 落点 |
|---|---|---|
| ① | **双入口**：Agents 页 Store tab + PluginsHub 卡片别名，同一路由 | §4.2 #7/#8 |
| ② | **安装权限 = min(包声明, 'ask')**，用户装后可手动调高 | §2 政策表、§4.3 |
| ③ | **包不携带 source 配置，只声明依赖**；包内出现 sources/ 即拒绝 | §2、§4.3 缺失源清单、§5 Setup Checklist |
| ④ | **skill 完整打包**；安装时按 slug+version 判定：一致→复用现有，不一致→安装/更新 | §2.1 |
| ⑤ | skill 作为独立可装单元分发（最初定为 claude-marketplace 直装，**已被 ⑥ 取代**） | §2.2 演进记录 |
| ⑥ | **新立 craft 原生 skill 规范（SKILL.md + version，per-skill 粒度）**；git 仓库为底稿（MR 即审核），网站服务端摄取后经 API 分发；客户端只对接 http-api | §2.2、§3、§6 P0.5 |

派生规则（默认行为，可调）：skill 更新的**本地改动保护**与**共享回退提示**、卸载**引用计数**、project 层同名 skill 的**遮蔽警告**（§2.1 第 2–4 条）。
