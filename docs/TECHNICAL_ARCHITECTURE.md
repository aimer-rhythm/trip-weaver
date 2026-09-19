# 织程 TripWeaver · 技术架构文档

- 项目名称：**织程 TripWeaver**（仓库名 `tripweaver`）
- 文档版本：v0.5
- 日期：2026-07-12
- 关联文档：[PRD](./PRD.md) · [开发计划](./DEVELOPMENT_PLAN.md)

> **修订记录**
> - v0.2：纯前端 → 前后端分离（Fastify API + SQLite + 会话认证）；单 Agent → 三 Agent 流水线；新增小红书 MCP 接入层。
> - v0.3：面向「开源 + 站长运营 + 非 IT 用户」——① LLM Key 双轨解析（站点 Key / BYOK）；② 邀请码 + 配额体系（新增 `generations` 用量表）；③ SSRF 私网黑名单升为强制；④ 小红书定为站长专用小号单账号模式；⑤ 新增开源工程与部署章节（Docker Compose / CI）。
> - v0.4：小红书抓取风控不可持续，**彻底移除该集成**——调研数据源替换为「高德搜索POI 2.0（结构化底座）+ Web 搜索 API（攻略语义层，默认 LangSearch）」双层方案 + 预约种子表；调研产物升级为结构化候选池（`Trip.overview`），SSE 新增 `candidate` 事件；`generations` 用量列泛化（`amap_calls`/`search_calls`）。
> - **v0.5（本版）**：**坐标决策反转**——Nominatim 在中国的 POI 级覆盖实测不可用，且 WGS-84 与高德 GCJ-02 混用不可行；行程坐标全面切换高德 GCJ-02（活动新增可选 `coordSystem`，缺省 wgs84 兼容旧数据）。新增高德地理编码/路径规划适配器与活动间通勤段 `TripDay.legs`（walk/transit/drive，`source=amap|heuristic`）；坐标解析与通勤估算移出 LLM 循环，改为审校后确定性后处理 pass（解析链：高德 POI text → v3 geocode → Nominatim+wgs84ToGcj02 → estimated 降级）。协议 3.5 缓解措施：只存活动坐标点值与通勤时长/距离数值、polyline 抽稀且 ≤4000 字符、不批量囤 POI、24h TTL 缓存、图片热链不转存不变。

---

## 1. 技术选型总览

| 层 | 选型 | 理由 |
|---|---|---|
| 仓库形态 | npm workspaces monorepo：`apps/web` + `apps/server` + `packages/shared` | 前后端共享领域类型与 TypeBox schema，杜绝双份定义漂移 |
| 前端 | React 18 + TypeScript + Vite + react-router-dom | 多页面 SPA；生态与 react-leaflet 匹配 |
| 状态 | @tanstack/react-query（服务端状态）+ zustand（编辑器交互态，不持久化） | 两类状态生命周期不同，分治 |
| **API 层** | **Fastify + `@fastify/type-provider-typebox`** | TypeBox 即 JSON Schema，shared schema 直接挂路由，校验零胶水 |
| **数据库** | **PostgreSQL 16 + pgvector + Drizzle ORM（node-postgres）** | 多实例部署 + JSONB 查询；pgvector 扩展让 RAG 向量检索与业务数据同库（09-18 自 SQLite 迁入，理由见 §4.3） |
| 认证 | 自实现：bcryptjs + 会话表 + httpOnly Cookie + **邀请码** | 需求简单；会话表支持吊销 |
| **LLM 调用层** | **`@mariozechner/pi-ai`**（服务端） | 统一多厂商；自定义 Model 适配任意 OpenAI 兼容端点 |
| **Agent 运行时** | **`@mariozechner/pi-agent-core`**（服务端） | 工具执行 + 事件流 + 循环控制，三 Agent 复用 |
| **调研数据源** | 高德搜索POI 2.0 + Web 搜索 API（LangSearch，博查同族可切换）—— HTTP 直连 | 免费额度内近零成本；官方 API 无风控包袱；适配器隔离 + Null 降级 |
| 地理编码 / 地图 | OSM Nominatim（服务端）/ Leaflet + react-leaflet | 免费免 Key；行程坐标统一 WGS-84（不用高德 GCJ-02 坐标） |
| 长图 / 弹层 | html-to-image / 原生 `<dialog>` | 轻量 |
| **部署** | **Docker Compose（app）+ Caddy（自动 HTTPS）** | 站长 30 分钟内可用（PRD 成功标准 2）；Caddy 免证书运维 |
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
│     ①调研 Agent ─▶ PoiSource(高德) / SearchSource(Web搜索)   │
│     ②编排 Agent ─▶ Nominatim / DraftTrip                    │
│     ③审校 Agent ─▶ DraftTrip / 预算聚合                      │
│   （Key 双轨解析：用户 BYOK → 站点 Key）                      │
├──────────────────────────────────────────────────────────┤
│  数据层：SQLite（users/sessions/user_settings/trips/         │
│           generations）                                    │
└──────────────────────────────────────────────────────────┘
   外部：站点或用户的 LLM 端点 · 高德 Web 服务 · LangSearch ·
         OSM(瓦片/Nominatim)
```

**关键原则**：前端只与 API 层对话；Key 只在服务端解密使用；Agent 产出经工具写入内存 `DraftTrip` 与候选池，审校通过才一次性入库；**站长的钱包与数据源额度由「注册管控 + 双层配额 + 限速缓存」三道闸保护**。

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
│  ├─ data/ reservationSeeds.json(.ts)   # 预约种子表（~50 条热门需预约景点）
│  ├─ generation/
│  │  ├─ jobManager.ts · orchestrator.ts · draft.ts
│  │  ├─ agents/ runner.ts
│  │  ├─ tools/ researchTools.ts · geoTools.ts · draftTools.ts · reviewTools.ts
│  │  ├─ model.ts                     # Key 双轨解析 + buildModel
│  │  └─ prompts.ts
│  ├─ integrations/
│  │  ├─ amap/ poiSource.ts           # 高德搜索POI 2.0 适配 + Null 降级
│  │  ├─ websearch/ searchSource.ts   # LangSearch(博查同族) 适配 + Null 降级
│  │  ├─ geocode.ts                   # Nominatim 限流+缓存
│  │  └─ ssrfGuard.ts                 # v0.3：baseUrl 私网黑名单
│  └─ lib/ serialQueue.ts · ttlCache.ts · proxy.ts
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

同 v0.2 基础上（Activity 含 `coordSource`/`sourceNotes`，Trip 含 `title`/`meta{usedXhs, reviewNotes}`），v0.4 新增：`ResearchPoi{id, name, category(attraction|food|hotel), coverUrl?, intro, reservation(required|none|unknown), reservationNote?, sourceLinks}`；`Trip.overview?: ResearchPoi[]`（≤40，调研候选池）；`TripMeta.dataSources?: ('amap'|'websearch')[]`（实际用到的数据源）。全部为可选字段，旧行程 JSON 原样可读；`usedXhs` 仅作旧数据只读兼容，新生成恒 `false`。JSON 导出 `{ version: 2, trip }`。

**v0.5 ST3（OTA 场景降级）增量**（均为可选字段，旧行程/导入导出 v2 完全兼容）：

- `Trip.transportMode?: 'transit'|'drive'|'walk'`（出行方式基调，缺省 transit；`GenerateForm.transportMode?` 同构。geoPipeline 通勤段 >1.5km 按基调选 mode，<1.5km 恒 walk）。
- `Lodging{name(≤60), area?, lat?, lng?, coordSystem?}`：`Trip.lodging?`（整程默认）+ `TripDay.lodging?`（day 级覆盖，多城市场景）。住宿仅是**通勤锚点**，不做酒店推荐/比价/预订；用户留空时规划 Agent 经 `set_lodging` 建议一个区域（禁止具体酒店与价格）。坐标由 geoPipeline 同一解析链补全（计入 GEOCODE_MAX_PER_TASK），成功才生成住宿 leg；编辑器改名即清空坐标并丢弃相关住宿 leg。
- **TransitLeg 哨兵契约**：`fromActivityId`/`toActivityId` 允许哨兵值 `'lodging'`（leg 挂在 day 上，作用域限当天）——`{from:'lodging', to:首活动id}` 与 `{from:末活动id, to:'lodging'}`；前端经 `lodgingLegsForDay(day)` 严格 id 匹配，失配（重排/删改）静默丢弃。
- `Activity.cost` 必填 → **可选**（粗估档位值：免费=0，不确定缺省；旧数据带值照读，读取方 `?? 0` 兜底）。派生 `BudgetSummary` 改区间 `{perPersonPerDayMin, perPersonPerDayMax, coveredDays}`（日成本=当天 cost 求和÷partySize，区间=[0.8×,1.3×] 十位取整），删除精确总额与 `overBudget` 超支判定；`trips.total_cost` 冗余列保留（列表页「约 ¥」展示）。

### 4.2 数据库表（Drizzle / PostgreSQL）

| 表 | 字段要点 |
|---|---|
| `users` | id · email(unique) · password_hash · created_at |
| `sessions` | id · user_id(FK) · token_hash(unique) · expires_at |
| `user_settings` | user_id(PK/FK) · **byok_enabled(bool)** · base_url · api_key_ciphertext · api_key_last4 · model · **amap_api_key_ciphertext · amap_api_key_last4 · amap_key_revision** · **search_api_key_ciphertext · search_api_key_last4 · search_api_base_url · search_credential_revision** · updated_at |
| `trips` | id · user_id(FK+索引) · title · destination · days_count · activity_count · total_cost · used_xhs · data(**JSONB**) · created_at · updated_at |
| `generations` | id · user_id(FK+索引) · trip_id(可空 FK) · status(done/error/cancelled) · used_xhs(旧数据) · used_byok · tokens_in · tokens_out · xhs_calls(旧数据) · **amap_calls · search_calls（v0.4）** · created_at —— **配额计数与用量核算的事实来源** |
| `canonical_places` | id · city · name · category · lng/lat · source(goldset/xhs/amap/manual) · **verified** · payload(JSONB) · **embedding vector(1024) 可空** —— 已验证地点池，金集 9 城 POI 资产化（RAG 地基，09-18） |
| `research_evidence` | id · place_id(可空 FK) · city · kind · content · source_url · fetched_at · **embedding vector(1024) 可空** —— 调研语料（小红书口碑/价格/预约/避坑），挂载到地点池 |

配额查询即 `count(generations where user_id=? and status='done' and created_at>=今日零点)`——无需独立计数器表（KISS，且天然免「重置」逻辑）。

### 4.3 向量检索选型：pgvector 而非独立向量数据库（09-18）

**决策**：RAG 的向量与业务数据存同一个 PostgreSQL（pgvector 扩展），**不引入** Qdrant/Milvus/Pinecone 等独立向量数据库。

**存储模型**：向量不是独立数据集，而是已有行的派生列——`canonical_places.embedding` / `research_evidence.embedding` 与原文、verified、city 等业务列**同一行、同事务写入**。一条 SQL 同时完成语义召回与结构化过滤：

```sql
SELECT ... FROM research_evidence
WHERE verified_place AND city = $1 AND kind IN ('xhs_warning','xhs_reservation')
ORDER BY embedding <=> $query_vec LIMIT 8
```

**理由**：

1. **规模不匹配专用库**：全量语料为万级（当前 ~1.7k 行），pgvector 在百万级内与专用向量库无实质性能差距；<1000 行时顺序扫描已足够，连 ivfflat/hnsw 索引都暂不建（YAGNI）。
2. **混合过滤是刚需**：本项目检索永远附带 `verified=true`、`city=X`、`kind IN (...)` 等 SQL 谓词。pgvector 原生表达；专用向量库需两次查询 + 应用层合并，或依赖其私有过滤语法。
3. **数据一致性**：独立向量库意味着「向量库存 (id, vector)，PG 存原文」的双写架构——多一次网络往返，且需自行保证两套存储的一致性。pgvector 下向量列与事实列天然同事务。
4. **部署哲学**：开源自部署定位下，compose 多一个向量库服务 = 部署门槛 +1；pgvector 只是把镜像从 `postgres:16` 换成 `pgvector/pgvector:pg16`，零新增组件。
5. **可演进**：若未来数据量破百万或检索 QPS 过百，`canonical_places`/`research_evidence` 作为一等公民表可直接导出迁移，pgvector 层不构成锁定。

**明确不引入**：独立向量数据库服务、向量索引（数据量达标前）、Repository 抽象层。

**降级链**：pgvector 扩展不可用 → 启动告警不阻断，retrieveContext 退化为纯关键词召回；EMBEDDING_* 未配置 → 跳过向量生成与向量层检索；embedding HTTP 失败 → 单批置 null 继续。

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
- `used_byok` 落入 `generations` 表——BYOK 生成不烧站点 Key，但**计入次数配额**（配额限的是外部数据源调用与服务资源，不只是钱）。

---

## 6. 调研数据源接入层（高德 + Web 搜索，v0.4）

小红书抓取因风控与账号纪律包袱于 v0.4 移除（ADR 见任务 `07-09-replace-xhs-research-with-amap-web-search-add-trip-overview-page`）。现行方案为「结构化底座 + 攻略语义层」双层数据源，模型知识兜底：

- **高德搜索POI 2.0**（`integrations/amap/poiSource.ts`）：`GET /v5/place/text`，`show_fields=business,photos`，按类目码搜索（景点 110000 / 餐饮 050000 / 住宿 100000）。每次自检或新生成任务按当前用户动态解析“个人加密 Key → 站点 `AMAP_KEY` → Null 源”，不把个人凭据放入全局单例；用户更新或清除后无需重启。返回名称/类型/地址/评分/人均/营业时间/图片热链，**v0.5 起并返回 `location`（GCJ-02）与 `adcode`**——v0.4「不返回坐标」决策已反转（Nominatim 中国 POI 覆盖不可用、坐标系混用不可行），行程活动坐标统一 GCJ-02，Nominatim 仅作兜底并经 `wgs84ToGcj02` 转换。
- **高德地理编码/路径规划**（`integrations/amap/geocoder.ts` · `route.ts`，v0.5）：v3 `geocode/geo` 地名编码 + v5 `direction/{walking,driving,transit/integrated}` 通勤估算（`show_fields=polyline,cost`，折线抽稀 ≤4000 字符否则丢弃）。与 POI 共用 350ms 串行队列 + 24h TTL 缓存；任务级上限 geocode ≤40 / route ≤30，全部计入 `amap_calls` 与 `AMAP_DAILY_BUDGET`；失败/超额/无 Key 静默降级（坐标走 Nominatim 转换、通勤走 `legEstimator` 启发式：haversine×1.4，walk 4.5km/h / transit 20km/h+10min / drive 30km/h+5min）。坐标解析与通勤段生成在审校完成后由 orchestrator 确定性后处理 pass 执行（机械工作移出 LLM 循环）。
- **Web 搜索**（`integrations/websearch/searchSource.ts`）：`POST {baseUrl}/v1/web-search`（Bearer 认证，`{query, summary, count, freshness}`）。每次自检或新生成任务动态解析“个人加密 Key + Base URL → 站点 `SEARCH_API_KEY` + `SEARCH_API_BASE_URL` → Null 源”；个人 Base URL 保存与使用时均执行 SSRF 校验，用户更新或清除后无需重启。默认 LangSearch（免费）；博查同族 schema 可直接切换。承担玩法/避雷/**预约政策**的语义检索，带来源链接。
- **预约种子表**（`data/reservationSeeds.json`，~50 条）：全国热门「需预约」景点（故宫/国博/莫高窟/陕历博等），`add_candidate` 命中即强制 `reservation=required` 并附官方渠道链接；离线可用、随仓库维护（数据截至 2026-07）。
- **调研产物**：结构化候选池 `ResearchPoi[]`（挂 `Trip.overview` 持久化）+ 文本摘要；候选写入时经 SSE `candidate` 事件实时推送前端概览卡片。
- **纪律四道闸**（沿用原 ContentSource 骨架）：串行限速（高德 350ms / 搜索 1s）+ 24h TTL 缓存 + 任务级上限（高德 ≤8 / 搜索 ≤10 次）+ 全站日额度（`AMAP_DAILY_BUDGET` 默认 150 / `SEARCH_DAILY_BUDGET` 默认 500，从 `generations` 用量列聚合 + 60s 内存缓存）。
- **降级链**：某源未配置/超额/故障 → 该源注入 Null 实现（搜索回空、自检变红），生成流程**永不因数据源失败而失败**；两源皆缺时纯模型知识调研，`phase_start` note 与 `meta.dataSources` 明示实际来源。
- **合规红线**（高德服务协议 3.5/3.4）：结果仅供展示，图片**热链不转存**；候选落库只留名称+短摘要+来源链接；不做批量采集，不用于模型训练。

---

## 7. API 设计

| 方法 & 路径 | 说明 | 校验/限制 |
|---|---|---|
| `POST /api/auth/register` | 邮箱+密码（`REGISTRATION_MODE=invite` 时另需邀请码，比对 `INVITE_CODE` env） | 密码≥8；3 次/min/IP |
| `GET /api/auth/config` | 公开：注册模式 + GitHub 登录是否启用（前端据此渲染） | 无需会话 |
| `GET /api/auth/github` · `GET /api/auth/github/callback` | GitHub OAuth 登录（state 防 CSRF；verified 邮箱自动绑定；token 用完即弃） | 5 次/min/IP；未配置时 404 |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | 会话签发/销毁/查询 | 登录 5 次/min/IP；失败不泄露账号存在性 |
| `GET /api/settings` | 普通字段 + LLM BYOK + 个人高德/搜索配置状态（仅 Key 存在性、尾号、个人搜索 Base URL 与站点回退存在性） | 需会话 |
| `PUT /api/settings` | 写 LLM BYOK、个人高德 Key 与个人搜索 Key + Base URL；搜索配置用显式 `clearSearchConfig` 同时清除 Key 与 URL（Key 均加密入库） | 需会话 |
| `GET /api/settings/sources-status` | 调研数据源自检 `{amap, websearch}`（真实探测；结果按 userId + Amap/search credential revision 隔离记忆化） | 需会话 |
| `GET /api/usage` | 今日剩余配额 / 已用次数 / 重置时间 | 需会话 |
| `GET /api/trips` · `POST /api/trips`(导入) · `GET/PUT/DELETE /api/trips/:id` | 历史/导入/详情/自动保存/删除 | TripSchema；user_id 归属校验 |
| `POST /api/generations` | **先查配额**（quotaService）→ 创建任务 `202 {jobId}` | GenerateFormSchema；并发 1/用户；配额尽 → 429 + 重置时间 |
| `GET /api/generations/:jobId/events` | SSE 进度（Last-Event-ID 重放） | 归属校验 |
| `POST /api/generations/:jobId/cancel` | 取消（丢弃草稿，**不计配额**） | 归属校验 |
| 生产 | `@fastify/static` 托管 web/dist + SPA fallback；开发 Vite proxy 同源 | |

**JobManager**：同 v0.2（内存任务表 + 512 条事件环形缓冲；单实例边界；重启则进行中任务置失败）。任务结束时把 status/tokens/amap_calls/search_calls/used_byok 写入 `generations`。

---

## 8. 前端架构要点

- 路由：`/login` `/register` `/trips` `/trips/new` `/trips/:id`；未登录守卫。
- react-query 管 `me/settings/usage/trips/trip(id)`；zustand 管编辑器态；防抖 800ms PUT 自动保存 + 指示器。
- 生成进度页 EventSource 断线重连 + Last-Event-ID 重放 + 刷新恢复。
- **SettingsDialog 分级**：普通视图（账号 + 今日配额）默认；「高级选项」折叠区收纳 LLM BYOK、个人高德 Key，以及个人 Web 搜索 API Key + Base URL。两类个人数据源凭据均支持保存、更新、空 Key 保留和显式清除；搜索清除会同时删除个人 Key 与 URL。
- **移动端基准**：核心流程按 <768px 设计再放大到桌面；微信内置浏览器实测入 D2 验收（长图保存/分享、SSE、地图手势）。

## 9. 安全设计

| 项 | 方案 |
|---|---|
| 密码 / 会话 | bcryptjs(cost 12)；256bit token 存 sha256；Cookie `httpOnly+SameSite=Lax+Secure(生产)`；TTL 30 天滑动 |
| **注册管控** | 三态 `REGISTRATION_MODE`：open（默认开放）/ invite（邀请码，可随时切回的防滥用刹车）/ closed；未设置时按 `INVITE_CODE` 是否非空推断（向后兼容）。GitHub 登录仅信 verified 邮箱做账号绑定，invite/closed 下不创建新账号 |
| **配额** | 用户日配额 + 全站数据源日额度（§6）——第二道闸；生成并发 1/用户 |
| 用户凭据 | LLM、个人高德与个人搜索 Key 均用 AES-256-GCM（`MASTER_KEY` env）；API 仅回存在性与 last4；日志禁 Key；个人数据源凭据和源实例不进入全局单例或跨用户缓存 |
| **SSRF（v0.3 升为强制）** | `ssrfGuard`：用户提供的 LLM/搜索 baseUrl 仅允 http(s)，**解析后 IP 落私网/环回/链路本地段一律拒绝**（保存与使用时双查，防 DNS 重绑定）；`SSRF_ALLOWLIST` env 供站长豁免自有内网端点 |
| 越权 | trips/generations 全量 user_id 过滤；jobId uuid + 归属校验 |
| 输入 | 全路由 TypeBox；React 转义；外链 `rel="noopener noreferrer"` |
| 限流 | 注册 3/min/IP · 登录 5/min/IP · 生成配额制 |

## 10. 开源工程与部署（v0.3 新增）

- **Docker Compose**：`app`（多阶段构建：web build → server 托管）+ `caddy`（自动 HTTPS 反代，`Caddyfile` 已含 SSE 所需 `flush_interval -1`）。数据卷：SQLite 文件。
- **环境变量**（`.env.example` 全量注释）：

| 变量 | 说明 |
|---|---|
| `PORT` / `DATABASE_PATH` | 服务端口 / SQLite 路径 |
| `MASTER_KEY` | 32 字节 hex，Key 加密主钥 |
| `REGISTRATION_MODE` / `INVITE_CODE` | 注册三态 open/invite/closed（未设置时按 INVITE_CODE 推断）/ 邀请码（invite 模式必填） |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `APP_BASE_URL` | GitHub OAuth 登录（可留空=隐藏该入口）/ 站点对外地址（启用 GitHub 时必填） |
| `SITE_LLM_BASE_URL` / `SITE_LLM_API_KEY` / `SITE_LLM_MODEL` | 站点供 Key（可留空=纯 BYOK 模式） |
| `GEN_DAILY_LIMIT` | 用户日生成配额（默认 3） |
| `AMAP_KEY` / `AMAP_DAILY_BUDGET` | 站点默认高德 Web 服务 Key（用户个人 Key 优先；均为空=该源降级）/ 全站日额度（默认 150） |
| `SEARCH_API_KEY` / `SEARCH_API_BASE_URL` / `SEARCH_DAILY_BUDGET` | Web 搜索 Key（可留空=该源降级）/ 端点（默认 LangSearch，博查同族可切）/ 全站日额度（默认 500） |
| `SSRF_ALLOWLIST` | 逗号分隔的内网豁免地址 |

- **CI**（GitHub Actions）：push/PR → 三包 `tsc --noEmit` + `npm run build`。
- **开源卫生**：MIT LICENSE；README（截图 + 三分钟部署指引 + 小红书小号声明 + 安全说明）；语义化版本 + CHANGELOG。

## 11. 风险与后备方案

| # | 风险 | 概率 | 缓解 / 后备 |
|---|---|---|---|
| R2 | 小参数模型多轮工具调用弱 | 中 | prompt 强约束 + 工具纠错自愈 + 完整性兜底；README 标注推荐模型量级 |
| R3 | Nominatim 限流 | 中 | 服务端限流队列 + 缓存 + estimated 降级 |
| R7 | 外部数据源不稳（高德配额/搜索 API 无 SLA） | 中 | 适配器隔离 + 自检 + Null 降级不断服务 + 全站日额度 + 预约种子表离线兜底 |
| R8 | 多 Agent token 成本 | 确定 | 摘要化返回/轮次上限/用量落库透明化 |
| **R11** | **开源后站点被滥用（Key 盗刷/爬注册）** | 中 | 三态注册开关（滥用时一键切回 invite）+ 双层配额 + 限流 + 用量表审计——三道闸缺一不可 |
| **R12** | **微信内置浏览器兼容性怪癖**（下载/长按保存/SSE） | 中 | D2 真机实测；长图导出用「长按保存」引导而非 download 属性兜底 |
| R9 | SSE 被反代缓冲 | 低 | 官方 Caddyfile 已配置；README 注明 nginx 等价配置 |
| R10 | better-sqlite3 构建 | 低 | Node LTS 预编译；后备 `node:sqlite` |
| R6 | react-leaflet 版本 | 低 | §1 规则 |

## 12. 待实现期确认清单

> C0 核对方式说明（2026-07-06）：本机 `.env` 暂无 `SITE_LLM_*`，真实端点在线冒烟延后；已按已安装包（pi-agent-core / pi-ai 0.73.0）的类型声明完成**离线核对**，并落地可复跑脚本 `scripts/smoke-pi.mjs`（站长填好 env 即可在线复验）。API 形状全部与设计吻合，**无需启用手写工具循环后备**。
> v0.4 变更（2026-07-09）：小红书 MCP 集成整体移除（含其冒烟脚本与 SDK 依赖），调研数据源改为高德 + Web 搜索，连通冒烟脚本为 `scripts/smoke-sources.mjs`。

- [x] pi-agent-core：`Agent` 构造形状 / `getApiKey` / 中止方式 / 工具返回与 `terminate` —— 已核对（v0.73.0）：
  - 构造：`new Agent({ initialState: { systemPrompt, model, thinkingLevel, tools, messages }, getApiKey, transport })`
  - Key：`getApiKey(provider)`（按 `model.provider` 回查，可返回 Promise）
  - 中止：`agent.abort()` + `agent.waitForIdle()`；中止后 assistant 消息 `stopReason: "aborted"`
  - 工具：`AgentTool.execute(toolCallId, params, signal, onUpdate)` → `{ content, details, terminate? }`；失败**抛异常**（勿在 content 里编码错误）；`terminate: true` 需**整批**工具皆置位才提前终止
  - 事件：`subscribe()` → `agent_start/turn_start/message_start|update|end/tool_execution_start|update|end/turn_end/agent_end`；SSE 映射齐备
- [x] pi-ai 自定义 `Model` 最小必填集 + compat 探测 —— 已核对：必填 `id/name/api("openai-completions")/provider/baseUrl/reasoning/input/cost/contextWindow/maxTokens`；`compat` 缺省按 baseUrl 自动探测；用量在 `AssistantMessage.usage`（`input/output/totalTokens`），apiKey 走 `StreamOptions.apiKey`（Agent 内部经 `getApiKey` 注入）
- [x] 高德搜索POI 2.0 请求参数与字段（2026-07-09 官方文档核对）→ 见 §12.1 适配器速查
- [x] LangSearch / 博查 web-search 同族 schema（2026-07-09 官方页面核对；在线连通跑 `scripts/smoke-sources.mjs`）
- [x] better-sqlite3 本机安装（A0 已过）
- [ ] 微信内置浏览器：长图保存路径、EventSource 行为（D2 真机）

### 12.1 调研数据源适配器速查（v0.5）

| 适配器方法 | 端点 | 关键入参 | 返回要点 |
|---|---|---|---|
| `PoiSource.searchPois(category, keyword, region)` | `GET https://restapi.amap.com/v5/place/text` | `key` · `keywords`(≤80字) · `types`(110000/050000/100000) · `region`+`city_limit=true` · `show_fields=business,photos` · `page_size` | `pois[]`：name/type/address + business.rating/cost/opentime_today/opentime_week + photos[].url + **location（「lng,lat」串，GCJ-02）+ adcode（v0.5 反转）** |
| `amapGeocode(key, name, city)`（v0.5） | `GET https://restapi.amap.com/v3/geocode/geo` | `key` · `address`(city+name) · `city` | `geocodes[0]`：location（GCJ-02）+ adcode；失败回 null |
| `routeEstimate(key, origin, dest, mode, opts)`（v0.5） | `GET /v5/direction/walking` · `/v5/direction/driving` · `/v5/direction/transit/integrated` | `origin`/`destination`（「lng,lat」）· `show_fields=polyline,cost` · transit 另需 `city1`/`city2`（adcode） | `paths[0]`/`transits[0]`：cost.duration（秒）+ distance（米）+ steps[].polyline（抽稀 ≤4000 字符，超长丢弃）；失败回 null → 启发式降级 |
| `SearchSource.search(query)` | `POST {SEARCH_API_BASE_URL}/v1/web-search` | Bearer `SEARCH_API_KEY`；body `{query, summary: true, count, freshness}` | `data.webPages.value[]`：name/url/snippet/summary/siteName/datePublished（LangSearch 与博查同族） |
| `selfCheck()`（两源各一） | 同上（最小探测请求） | — | `SourceStatus{configured, checked, ok, message}`；`GET /api/settings/sources-status` 数据源 |

- 高德 `rating`/`cost` 仅餐饮/酒店/景点/影院类返回；无「简介」字段——候选 intro 由调研 Agent 综合搜索摘要与模型知识撰写。
- 高德评分/人均/营业时间仅作调研工具输出文本供 Agent 参考，**不入候选池、不落库**（PRD 裁剪决策 + 协议 3.5 存储限制）。
