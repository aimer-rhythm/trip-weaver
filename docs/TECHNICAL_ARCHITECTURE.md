# 织程 TripWeaver · 技术架构文档

- 项目名称：**织程 TripWeaver**（仓库名 `tripweaver`）
- 文档版本：v0.3
- 日期：2026-07-05
- 关联文档：[PRD](./PRD.md) · [开发计划](./DEVELOPMENT_PLAN.md)

> **修订记录**
> - v0.2：纯前端 → 前后端分离（Fastify API + SQLite + 会话认证）；单 Agent → 三 Agent 流水线；新增小红书 MCP 接入层。
> - **v0.3（本版）**：面向「开源 + 站长运营 + 非 IT 用户」——① LLM Key 双轨解析（站点 Key / BYOK）；② 邀请码 + 配额体系（新增 `generations` 用量表）；③ SSRF 私网黑名单升为强制；④ 小红书定为站长专用小号单账号模式；⑤ 新增开源工程与部署章节（Docker Compose / CI）。

---

## 1. 技术选型总览

| 层 | 选型 | 理由 |
|---|---|---|
| 仓库形态 | npm workspaces monorepo：`apps/web` + `apps/server` + `packages/shared` | 前后端共享领域类型与 TypeBox schema，杜绝双份定义漂移 |
| 前端 | React 18 + TypeScript + Vite + react-router-dom | 多页面 SPA；生态与 react-leaflet 匹配 |
| 状态 | @tanstack/react-query（服务端状态）+ zustand（编辑器交互态，不持久化） | 两类状态生命周期不同，分治 |
| **API 层** | **Fastify + `@fastify/type-provider-typebox`** | TypeBox 即 JSON Schema，shared schema 直接挂路由，校验零胶水 |
| **数据库** | **SQLite + Drizzle ORM（better-sqlite3）** | 单机自部署零运维；文件即状态 |
| 认证 | 自实现：bcryptjs + 会话表 + httpOnly Cookie + **邀请码** | 需求简单；会话表支持吊销 |
| **LLM 调用层** | **`@mariozechner/pi-ai`**（服务端） | 统一多厂商；自定义 Model 适配任意 OpenAI 兼容端点 |
| **Agent 运行时** | **`@mariozechner/pi-agent-core`**（服务端） | 工具执行 + 事件流 + 循环控制，三 Agent 复用 |
| **小红书接入** | MCP 客户端（`@modelcontextprotocol/sdk`）→ 自托管小红书 MCP | 零逆向；账号与风险边界在站长侧 |
| 地理编码 / 地图 | OSM Nominatim（服务端）/ Leaflet + react-leaflet | 免费免 Key |
| 长图 / 弹层 | html-to-image / 原生 `<dialog>` | 轻量 |
| **部署** | **Docker Compose（app + 可选 xiaohongshu-mcp）+ Caddy（自动 HTTPS）** | 站长 30 分钟内可用（PRD 成功标准 2）；Caddy 免证书运维 |
| CI | GitHub Actions：typecheck + build | 开源项目基础卫生 |

**明确不引入**：NestJS、Prisma、Redis/队列、图表库、@dnd-kit、UI 组件库、zod、K8s/水平扩展。

> ⚠️ 版本匹配：`react-leaflet@5.x` 要求 React 19（`npm ls react` 为准）；better-sqlite3 需匹配 Node LTS 预编译产物。

---

## 2. 系统分层架构

```
┌── 浏览器（手机/微信内置浏览器为一等目标） ────────────────────┐
│  React SPA：登录注册(邀请码) · 我的行程 · 规划表单 ·           │
│  生成进度页(SSE) · 行程编辑器(清单+地图+预算) · 导出           │
└───────────────┬──────────────────────────────────────────┘
                │ HTTPS(Caddy) · JSON API + SSE · httpOnly Cookie
┌───────────────▼──────────────────────────────────────────┐
│  API 路由层（Fastify）                                     │
│   /api/auth/*(邀请码) · /api/settings · /api/usage         │
│   /api/trips/* · /api/generations/*(配额检查/SSE/取消)      │
│   TypeBox 校验 · 会话守卫 · 限流 · 数据隔离                  │
├──────────────────────────────────────────────────────────┤
│  服务层                                                    │
│   Auth · Trip · Settings(Key加解密) · Quota(配额/用量)       │
│   GenerationJobManager(内存任务表+事件环形缓冲→SSE 重放)      │
├──────────────────────────────────────────────────────────┤
│  Agent 模型层（pi-agent-core / pi-ai）                      │
│   Orchestrator（代码级流水线）                               │
│     ①调研 Agent ─▶ ContentSource ─▶ 小红书 MCP(站长专用小号)  │
│     ②编排 Agent ─▶ Nominatim / DraftTrip                    │
│     ③审校 Agent ─▶ DraftTrip / 预算聚合                      │
│   （Key 双轨解析：用户 BYOK → 站点 Key）                      │
├──────────────────────────────────────────────────────────┤
│  数据层：SQLite（users/sessions/user_settings/trips/         │
│           generations）                                    │
└──────────────────────────────────────────────────────────┘
   外部：站点或用户的 LLM 端点 · 小红书 MCP · OSM(瓦片/Nominatim)
```

**关键原则**：前端只与 API 层对话；Key 只在服务端解密使用；Agent 产出经工具写入内存 `DraftTrip`，审校通过才一次性入库；**站长的钱包与小红书账号由「邀请码 + 双层配额 + 限速缓存」三道闸保护**。

---

## 3. Monorepo 结构

```
travel-planner/
├─ docs/                              # 三份文档
├─ docker-compose.yml · Caddyfile · .env.example
├─ .github/workflows/ci.yml           # typecheck + build
├─ LICENSE (MIT) · README.md
├─ package.json                       # workspaces: apps/*, packages/*
├─ packages/shared/src/
│  ├─ types.ts / schemas.ts / constants.ts
├─ apps/server/src/
│  ├─ index.ts · env.ts               # env 校验（见 §10 环境变量表）
│  ├─ db/ schema.ts · client.ts · migrate.ts
│  ├─ auth/ password.ts · session.ts · guard.ts · invite.ts
│  ├─ crypto/ secretBox.ts            # AES-256-GCM
│  ├─ routes/ auth.ts · settings.ts · trips.ts · generations.ts · usage.ts
│  ├─ services/ tripService.ts · settingsService.ts · quotaService.ts
│  ├─ generation/
│  │  ├─ jobManager.ts · orchestrator.ts · draft.ts
│  │  ├─ agents/ research.ts · planner.ts · reviewer.ts
│  │  ├─ tools/ xhsTools.ts · geoTools.ts · draftTools.ts · reviewTools.ts
│  │  ├─ model.ts                     # Key 双轨解析 + buildModel
│  │  └─ prompts.ts
│  ├─ integrations/
│  │  ├─ xhs/ contentSource.ts        # 接口 + XhsMcp 实现 + Null 降级
│  │  ├─ geocode.ts                   # Nominatim 限流+缓存
│  │  └─ ssrfGuard.ts                 # v0.3：baseUrl 私网黑名单
│  └─ lib/ budget.ts · id.ts
└─ apps/web/src/
   ├─ main.tsx · App.tsx · router.tsx
   ├─ api/ client.ts · hooks.ts
   ├─ pages/ Login · Register(邀请码) · TripList · Planner(表单+进度) · TripEditor
   ├─ store/ editorStore.ts
   ├─ components/ …（v0.2 组件族沿用；SettingsDialog 分级：普通视图+高级折叠区）
   └─ styles/ global.css · print.css
```

---

## 4. 数据模型

### 4.1 领域类型（`packages/shared`）

同 v0.2（Activity 含 `coordSource`/`sourceNotes`，Trip 含 `title`/`meta{usedXhs, reviewNotes}`）。JSON 导出 `{ version: 2, trip }`。

### 4.2 数据库表（Drizzle / SQLite）

| 表 | 字段要点 |
|---|---|
| `users` | id · email(unique) · password_hash · created_at |
| `sessions` | id · user_id(FK) · token_hash(unique) · expires_at |
| `user_settings` | user_id(PK/FK) · **byok_enabled(bool)** · base_url · api_key_ciphertext · api_key_last4 · model · updated_at |
| `trips` | id · user_id(FK+索引) · title · destination · days_count · activity_count · total_cost · used_xhs · data(JSON) · created_at · updated_at |
| `generations`（v0.3 新增） | id · user_id(FK+索引) · trip_id(可空 FK) · status(done/error/cancelled) · used_xhs · used_byok · tokens_in · tokens_out · xhs_calls · created_at —— **配额计数与用量核算的事实来源** |

配额查询即 `count(generations where user_id=? and status='done' and created_at>=今日零点)`——无需独立计数器表（KISS，且天然免「重置」逻辑）。

---

## 5. 多 Agent 协作设计

三 Agent 流水线（调研/编排/审校 + 代码级 Orchestrator + ≤2 轮修订循环）、工具集、终止条件、上下文隔离、SSE 事件映射、token 成本控制——**全部沿用 v0.2 §5 设计，此处不重复**。v0.3 仅改动模型解析入口：

### 5.1 Key 双轨解析（`generation/model.ts`）

```
resolveLlmConfig(userId):
  s = user_settings(userId)
  if s.byok_enabled && s 完整:   return { baseUrl: s.base_url, key: 解密(s.api_key), model: s.model, byok: true }
  elif env.SITE_LLM_* 完整:      return { ...站点配置, byok: false }
  else:                          throw NoLlmConfigured  → PRD F1 异常文案
```

- BYOK 的 `base_url` 在**保存时**与**使用时**均过 `ssrfGuard`（§9）；站点 Key 的 baseUrl 来自环境变量，属站长自配，不受黑名单限制（Ollama 内网场景合法）。
- `used_byok` 落入 `generations` 表——BYOK 生成不烧站点 Key，但**计入次数配额**（配额限的是小红书调用与服务资源，不只是钱）。

---

## 6. 小红书数据源接入层

接入方式（自托管 [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) 系服务，Streamable HTTP）、`ContentSource` 适配器、`NullContentSource` 降级链、串行限速与 TTL 缓存——沿用 v0.2 §6。v0.3 **落定账号策略**：

- **站长专用小号，单账号，服务级配置**（`XHS_MCP_URL`）。决策依据：① 非 IT 用户无法完成 MCP 扫码授权流程；② 小红书网页端会话互踢机制使「每用户绑定自己账号」必然频繁掉线；③ 避免服务器保管用户小红书凭据的责任。**README 明确要求使用专用小号而非主账号，且该小号不得在其他网页端登录**（防互踢）。
- **全站日额度**（`XHS_DAILY_BUDGET`，默认 500 次调用）：`quotaService` 维护当日计数（从 `generations.xhs_calls` 聚合 + 内存缓存），用尽自动注入 `NullContentSource` 降级，不阻断生成。
- 亲友规模量级评估：单次生成 ≤6 搜索 + ≤8 详情；目的地高度重合使 24h 缓存命中率高——真实外呼远低于额度，属保守只读姿态。
- **不做账号池**（偏离合规立足点）；**BYO-MCP**（用户高级设置自填 MCP 地址，风险自担）列 V1.1。

---

## 7. API 设计

| 方法 & 路径 | 说明 | 校验/限制 |
|---|---|---|
| `POST /api/auth/register` | 邮箱+密码+**邀请码**（比对 `INVITE_CODE` env） | 密码≥8；3 次/min/IP |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | 会话签发/销毁/查询 | 登录 5 次/min/IP；失败不泄露账号存在性 |
| `GET /api/settings` | 普通字段 + BYOK（key 仅 last4） | 需会话 |
| `PUT /api/settings` | 写 BYOK（**保存时过 ssrfGuard**，Key 加密入库） | 需会话 |
| `GET /api/settings/xhs-status` | 小红书 MCP 连接自检 | 需会话 |
| `GET /api/usage` | 今日剩余配额 / 已用次数 / 重置时间 | 需会话 |
| `GET /api/trips` · `POST /api/trips`(导入) · `GET/PUT/DELETE /api/trips/:id` | 历史/导入/详情/自动保存/删除 | TripSchema；user_id 归属校验 |
| `POST /api/generations` | **先查配额**（quotaService）→ 创建任务 `202 {jobId}` | GenerateFormSchema；并发 1/用户；配额尽 → 429 + 重置时间 |
| `GET /api/generations/:jobId/events` | SSE 进度（Last-Event-ID 重放） | 归属校验 |
| `POST /api/generations/:jobId/cancel` | 取消（丢弃草稿，**不计配额**） | 归属校验 |
| 生产 | `@fastify/static` 托管 web/dist + SPA fallback；开发 Vite proxy 同源 | |

**JobManager**：同 v0.2（内存任务表 + 512 条事件环形缓冲；单实例边界；重启则进行中任务置失败）。任务结束时把 status/tokens/xhs_calls/used_byok 写入 `generations`。

---

## 8. 前端架构要点

- 路由：`/login` `/register` `/trips` `/trips/new` `/trips/:id`；未登录守卫。
- react-query 管 `me/settings/usage/trips/trip(id)`；zustand 管编辑器态；防抖 800ms PUT 自动保存 + 指示器。
- 生成进度页 EventSource 断线重连 + Last-Event-ID 重放 + 刷新恢复。
- **SettingsDialog 分级**：普通视图（账号 + 今日配额）默认；「高级选项」折叠区收纳 BYOK 全部字段——非 IT 用户全程不见技术概念（PRD F6）。
- **移动端基准**：核心流程按 <768px 设计再放大到桌面；微信内置浏览器实测入 D2 验收（长图保存/分享、SSE、地图手势）。

## 9. 安全设计

| 项 | 方案 |
|---|---|
| 密码 / 会话 | bcryptjs(cost 12)；256bit token 存 sha256；Cookie `httpOnly+SameSite=Lax+Secure(生产)`；TTL 30 天滑动 |
| **注册管控** | 邀请码（env 配置，可更换；泄露即换）——站点 Key 成本与小红书账号的第一道闸 |
| **配额** | 用户日配额 + 全站小红书日额度（§6）——第二道闸；生成并发 1/用户 |
| LLM Key | AES-256-GCM（`MASTER_KEY` env）；仅回 last4；日志禁 Key |
| **SSRF（v0.3 升为强制）** | `ssrfGuard`：BYOK baseUrl 仅允 http(s)，**解析后 IP 落私网/环回/链路本地段一律拒绝**（保存与请求时双查，防 DNS 重绑定）；`SSRF_ALLOWLIST` env 供站长豁免自有内网端点 |
| 越权 | trips/generations 全量 user_id 过滤；jobId uuid + 归属校验 |
| 输入 | 全路由 TypeBox；React 转义；外链 `rel="noopener noreferrer"` |
| 限流 | 注册 3/min/IP · 登录 5/min/IP · 生成配额制 |

## 10. 开源工程与部署（v0.3 新增）

- **Docker Compose**：`app`（多阶段构建：web build → server 托管）+ 可选 `xiaohongshu-mcp` 服务 + `caddy`（自动 HTTPS 反代，`Caddyfile` 已含 SSE 所需 `flush_interval -1`）。数据卷：SQLite 文件 + MCP 会话。
- **环境变量**（`.env.example` 全量注释）：

| 变量 | 说明 |
|---|---|
| `PORT` / `DATABASE_PATH` | 服务端口 / SQLite 路径 |
| `MASTER_KEY` | 32 字节 hex，Key 加密主钥 |
| `INVITE_CODE` | 注册邀请码 |
| `SITE_LLM_BASE_URL` / `SITE_LLM_API_KEY` / `SITE_LLM_MODEL` | 站点供 Key（可留空=纯 BYOK 模式） |
| `GEN_DAILY_LIMIT` | 用户日生成配额（默认 3） |
| `XHS_MCP_URL` / `XHS_DAILY_BUDGET` | 小红书 MCP 地址（可留空=降级模式）/ 全站日额度（默认 500） |
| `SSRF_ALLOWLIST` | 逗号分隔的内网豁免地址 |

- **CI**（GitHub Actions）：push/PR → 三包 `tsc --noEmit` + `npm run build`。
- **开源卫生**：MIT LICENSE；README（截图 + 三分钟部署指引 + 小红书小号声明 + 安全说明）；语义化版本 + CHANGELOG。

## 11. 风险与后备方案

| # | 风险 | 概率 | 缓解 / 后备 |
|---|---|---|---|
| R2 | 小参数模型多轮工具调用弱 | 中 | prompt 强约束 + 工具纠错自愈 + 完整性兜底；README 标注推荐模型量级 |
| R3 | Nominatim 限流 | 中 | 服务端限流队列 + 缓存 + estimated 降级 |
| R7 | 小红书 MCP 外部依赖不稳（含小号被踢/被限） | 中高 | 适配器隔离 + 自检 + Null 降级不断服务 + 专用小号不他处登录 + 全站日额度 |
| R8 | 多 Agent token 成本 | 确定 | 摘要化返回/轮次上限/用量落库透明化 |
| **R11** | **开源后站点被滥用（Key 盗刷/爬注册）** | 中 | 邀请码默认必填 + 双层配额 + 限流 + 用量表审计——三道闸缺一不可 |
| **R12** | **微信内置浏览器兼容性怪癖**（下载/长按保存/SSE） | 中 | D2 真机实测；长图导出用「长按保存」引导而非 download 属性兜底 |
| R9 | SSE 被反代缓冲 | 低 | 官方 Caddyfile 已配置；README 注明 nginx 等价配置 |
| R10 | better-sqlite3 构建 | 低 | Node LTS 预编译；后备 `node:sqlite` |
| R6 | react-leaflet 版本 | 低 | §1 规则 |

## 12. 待实现期确认清单

> C0 核对方式说明（2026-07-06）：本机 `.env` 暂无 `SITE_LLM_*` 与 `XHS_MCP_URL`，真实端点在线冒烟延后；已按已安装包（pi-agent-core / pi-ai 0.73.0、MCP SDK 1.29.0）的类型声明完成**离线核对**，并落地可复跑脚本 `scripts/smoke-pi.mjs`、`scripts/smoke-mcp.mjs`（站长填好 env 即可在线复验）。API 形状全部与设计吻合，**无需启用手写工具循环后备**；小红书按计划以 `NullContentSource` 先行。

- [x] pi-agent-core：`Agent` 构造形状 / `getApiKey` / 中止方式 / 工具返回与 `terminate` —— 已核对（v0.73.0）：
  - 构造：`new Agent({ initialState: { systemPrompt, model, thinkingLevel, tools, messages }, getApiKey, transport })`
  - Key：`getApiKey(provider)`（按 `model.provider` 回查，可返回 Promise）
  - 中止：`agent.abort()` + `agent.waitForIdle()`；中止后 assistant 消息 `stopReason: "aborted"`
  - 工具：`AgentTool.execute(toolCallId, params, signal, onUpdate)` → `{ content, details, terminate? }`；失败**抛异常**（勿在 content 里编码错误）；`terminate: true` 需**整批**工具皆置位才提前终止
  - 事件：`subscribe()` → `agent_start/turn_start/message_start|update|end/tool_execution_start|update|end/turn_end/agent_end`；SSE 映射齐备
- [x] pi-ai 自定义 `Model` 最小必填集 + compat 探测 —— 已核对：必填 `id/name/api("openai-completions")/provider/baseUrl/reasoning/input/cost/contextWindow/maxTokens`；`compat` 缺省按 baseUrl 自动探测；用量在 `AssistantMessage.usage`（`input/output/totalTokens`），apiKey 走 `StreamOptions.apiKey`（Agent 内部经 `getApiKey` 注入）
- [x] `@modelcontextprotocol/sdk` 与 xiaohongshu-mcp 的 Streamable HTTP 握手 —— SDK 侧已核对：`Client` + `StreamableHTTPClientTransport(new URL(XHS_MCP_URL))`，`listTools()/callTool()`；在线握手待部署后跑 `scripts/smoke-mcp.mjs`
- [x] 所选小红书 MCP 的实际工具名与返回结构 → 见下方 §12.1 映射表（源自上游 xpzouying/xiaohongshu-mcp 文档，13 工具；在线核对 `xsec_token` 字段路径待部署后复验）
- [x] better-sqlite3 本机安装（A0 已过）
- [ ] 微信内置浏览器：长图保存路径、EventSource 行为（D2 真机）

### 12.1 小红书 MCP 适配器映射表（上游 13 工具 → TripWeaver 只读子集）

| ContentSource 方法 | MCP 工具 | 入参 | 返回要点 |
|---|---|---|---|
| `selfCheck()` | `check_login_status` | 无 | 登录态；`GET /api/settings/xhs-status` 数据源 |
| `search(keyword)` | `search_feeds` | `keyword`（必填）；可选 `filters.sort_by/note_type/publish_time` | feed 列表，含 **`feed_id` + `xsec_token`**（后续调用必带的配对凭据） |
| `getDetail(feedId, xsecToken)` | `get_feed_detail` | `feed_id` + `xsec_token`（必填）；`load_all_comments` 默认 false | 正文/作者/互动数/首批评论 |

- 端点：`http://<host>:18060/mcp`（Docker 内访问宿主用 `host.docker.internal`）；Streamable HTTP。
- 发布/点赞/评论/用户主页等其余 10 个工具**明确不用**（只读姿态，README 小号纪律）。
- 详情返回体量大 → 适配器需做摘要化裁剪（标题/正文截断/高赞评论 topN），控 token 成本（R8）。
