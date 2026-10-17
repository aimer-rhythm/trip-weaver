# 织程 TripWeaver

**在线体验：[https://sakiiko.com](https://sakiiko.com)**

> 多 Agent 协作的开源智能旅行助手 —— AI 替你查真实地点、搜全网攻略、排行程，落到地图上，一键导出分享。

**织**：三个 AI Agent 像织机一样协作——调研 Agent 从真实地点数据与全网攻略中抽出「经线」（玩法、口碑、预约政策），确定性排程织入地理与时间的「纬线」，审校 Agent 验布质检。**程**：交付一份可编辑、可导出、可继续对话修改的完整行程。

## 功能

- 🧵 **智能行程规划**：输入城市 / 日期 / 节奏 / 偏好 / 人数 / 交通方式，三阶段 Agent 流水线（调研 → 编排 → 审校）生成结构化多日行程，全过程工具调用实时可见
- 🧭 **结构由代码算，文案才走模型**：入选哪些点、每个点属于哪一天、当天内什么顺序，全部由纯代码的确定性排程算出。实测（09-20）让 LLM 直接推行程结构要烧 4.7 万输出 token / 432 秒且第二轮修订撞超时，代码算则稳定可复现。详见 [确定性排程算法](docs/DETERMINISTIC_SCHEDULING.md)
- 🗂️ **行程概览候选池**：调研产出按景点/美食/住宿分类的候选卡片（预览图、简介、**是否需要预约**三态徽章、来源链接），生成中实时长出，随行程留存
- 💬 **行程内对话**：详情页流式问答与改稿——按天增删活动、把检索到的**真实餐厅**一键加到指定日期餐次、调整位置；过程可折叠回看，支持随时中止，重复提交幂等
- 🕘 **历史版本**：每次手动修改保存为新版本，原版本冻结，可只读查看并恢复为新版本
- 🌤️ **行程天气**：和风天气逐日预报（15 天、中国 1km 分辨率），按出行日期展示，强天气风险置顶
- 🧠 **行程专属建议**：第三阶段依据知识库证据撰写建议与提醒（附来源链接），行程内容变化后自动标记为待更新
- 🔎 **双层调研数据源**：地点搜索（真实名称/地址/坐标）+ Web 搜索 API（玩法/避雷/预约政策）；内置约 50 条全国热门预约景点种子表；任一源缺失自动降级，不影响生成
- 🧮 **知识库检索**：pgvector 向量召回 + 关键词混合排序，为调研、对话与建议提供已验证地点材料；未配置 embedding 时静默退化为纯关键词，绝不阻塞生成
- 🗺️ **地图可视化**：Leaflet + 高德栅格瓦片，配了高德 JS API 凭据自动升级渲染；按天配色的序号标记与动线折线，天数过滤
- ✏️ **行程编辑**：增删改活动、日内排序、跨天移动，编辑自动保存
- 📤 **导出**：AI 行程分享图（内置旅行手账 / 水墨写意两种风格提示词）/ 打印 PDF / JSON 备份导入
- 🏠 **首页选城**：SVG 中国地图 + 磨砂玻璃胶囊表单，只列已验证地点数 ≥ 100 的覆盖城市，未覆盖城市不提供生成入口
- 👥 **多用户**：开放注册 / GitHub 登录，邀请码模式可随时切回（防滥用备选），行程历史云端留存，生成与对话双配额独立计数，站点供 Key 或用户自带 Key（BYOK）

## 架构

```
React SPA ──HTTP API + SSE──▶ Fastify 路由层 ──▶ 多 Agent 编排（pi-agent-core / pi-ai）
                                   │                 ├─ 调研 Agent ─▶ 地点搜索 / Web 搜索
                                   ▼                 ├─ 确定性排程（纯代码算结构，不走模型）
                          PostgreSQL + pgvector      └─ 审校 / 撰写 Agent ─▶ 地理编码 · 动线 · 天气
```

技术栈：React 18 + Vite + Tailwind CSS / Fastify + TypeBox / PostgreSQL + pgvector + Drizzle / zustand + TanStack Query / Leaflet。详见 [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md)。

样式约定：新页面用 Tailwind 原子类，颜色取 `apps/web/src/styles/tailwind.css` 里 `@theme` 定义的语义色；存量页面继续用 `global.css`，不做迁移。约束全文见 [docs/TECHNICAL_ARCHITECTURE.md §8](docs/TECHNICAL_ARCHITECTURE.md)。

## 截图

| 首页选城（SVG 中国地图） | 智能生成（三阶段时间线 + 候选卡片） |
|---|---|
| ![首页选城](docs/screenshots/home.jpg) | ![生成进度](docs/screenshots/generation.jpg) |
| **行程详情**：总览 / 逐日路线 / 天气 / 地图动线 | **我的行程**：一本本旅行手册 |
| ![行程详情](docs/screenshots/trip-detail.jpg) | ![我的行程](docs/screenshots/trips.jpg) |

<p align="center"><img src="docs/screenshots/mobile.jpg" width="300" alt="移动端" /></p>

## 快速部署（站长）

```bash
git clone https://github.com/<you>/tripweaver.git && cd tripweaver
cp .env.example .env
# 编辑 .env：至少填 MASTER_KEY（生成命令见文件内注释）、站点 LLM Key
docker compose up -d
```

默认拉取 `ghcr.io/aimer-rhythm/trip-weaver:latest` 预构建镜像；镜像不可用时用 `TRIPWEAVER_IMAGE='' docker compose up --build -d` 本地构建。app 只绑 `127.0.0.1:3001`，由宿主机 Nginx 转发，站点配置参考 `nginx.host.conf`（含 SSE 关键参数）；想用容器内自带反代则改用 `docker-compose.release.yml`。

浏览器打开你的域名（或 `http://服务器IP`），注册即可（默认开放注册；想收紧时设 `REGISTRATION_MODE=invite` + `INVITE_CODE`）。

### 本地开发

```bash
npm install
cp .env.example apps/server/.env   # 填 MASTER_KEY 等
npm run dev                        # server:3001 + web:5173
```

PostgreSQL + pgvector 用 `docker compose up -d db` 起（或指向已有的本机 / Neon / Supabase 实例）。

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `MASTER_KEY` | ✅ | 32 字节 hex，用户 API Key 的加密主钥 |
| `REGISTRATION_MODE` | | 注册模式 `open` / `invite` / `closed`；**未设置时自动推断**：`INVITE_CODE` 非空 → `invite`，否则 `open`（存量部署升级后行为不变） |
| `INVITE_CODE` | | 邀请码，仅 `invite` 模式使用（该模式下必填）；遇滥用时切 `REGISTRATION_MODE=invite` 即可收紧注册 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | | GitHub OAuth App 凭据；留空 = 不显示 GitHub 登录 |
| `APP_BASE_URL` | | 站点对外地址（如 `https://trip.example.com`），启用 GitHub 登录时必填，用于构造回调 URL |
| `SITE_LLM_BASE_URL` / `SITE_LLM_API_KEY` / `SITE_LLM_MODEL` | 建议 | 站点供 Key（普通用户零配置使用）；留空 = 纯 BYOK 模式 |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` / `EMBEDDING_DIMS` | 可选 | 知识库向量召回。留空即不生成向量、检索退化为纯关键词；未填时回落到 `SITE_LLM_*`（OpenAI 兼容端点普遍同址提供 `/embeddings`）。`DIMS` 必须为 1024，与库内 `vector(1024)` 列对齐 |
| `GEN_DAILY_LIMIT` | | 每用户每日生成次数（默认 3） |
| `CHAT_DAILY_LIMIT` | | 每用户每日对话轮数（默认 40），与生成配额相互独立、不互相占用 |
| `AMAP_KEY` | 建议 | 站点默认高德 Web 服务 Key；用户可在设置页保存仅自己可用的个人 Key，优先级为“个人 Key → `AMAP_KEY` → Null 降级”。[申请入口](https://console.amap.com/dev/key/app)，个人认证约 5000 次搜索/月 |
| `AMAP_LBS_MONTHLY_BUDGET` / `AMAP_SEARCH_MONTHLY_BUDGET` | | 个人认证默认 150000 / 5000，按 31 天折算服务日预算，详见[高德限额与日志](docs/AMAP_QUOTAS.md) |
| `AMAP_{GEOCODE,PLACE,WALK,CYCLE,DRIVE,TRANSIT}_DAILY_BUDGET` | | 六项独立上限；默认 POI 搜索 161，其余各 967。0 禁用；五项 LBS 合计不得超过月预算 / 31 |
| `AMAP_DAILY_BUDGET` | | 旧配置兼容：仅压低未独立配置项的默认值；新部署留空 |
| `TIANDITU_KEY` | 建议 | 站点天地图 Web 服务 Key（参数名 `tk`）。**地点搜索固定用它**（高德 `v5/place/text` 与地理编码主路径共用一份个人配额，实测会被打满）。[申请入口](https://console.tianditu.gov.cn/api/key)。差异：地名搜索需单独申请权限，POI 无评分/人均/营业时间/图片，**无步行/骑行路径规划** |
| `TIANDITU_DAILY_BUDGET` | | 全站天地图调用日额度（默认 150，与高德分别计数、互不影响） |
| `SEARCH_API_KEY` | 建议 | 站点默认 Web 搜索 Key；用户可在设置页保存仅自己可用的个人 Key + Base URL，优先级为“个人配置 → 站点 `SEARCH_API_*` → Null 降级”。默认 [LangSearch](https://langsearch.com/) 免费申请 |
| `SEARCH_API_BASE_URL` | | 站点搜索端点，默认 `https://api.langsearch.com`；个人新配置留空时也使用该默认值，博查同族接口可改 URL+Key 切换 |
| `SEARCH_DAILY_BUDGET` | | 全站搜索调用日额度（默认 500，超出自动降级） |
| `QWEATHER_API_HOST` | 可选 | 和风天气**专属 API Host**（控制台-设置，形如 `abcxyz.qweatherapi.com`）。它也是身份认证的一部分，只泄露凭据而不知道 Host 也无法请求；公共域名 `api/devapi/geoapi.qweather.com` 自 2026 年起逐步停服，**不要回落**。免费档每月 5 万次 |
| `QWEATHER_JWT_{KEY_ID,DEVELOPER_ID,PROJECT_ID,PRIVATE_KEY}` | 可选 | **推荐**：Ed25519 私钥现签 JWT（token 最长 24 小时，静态串过期即 401，必须现签）。四项须同时配置，缺一即 JWT 不可用 |
| `QWEATHER_KEY` | 可选 | 备选：API Key（走 `X-QW-Api-Key`）。填成已签好的 JWT（`eyJ` 开头三段）时自动改走 `Authorization: Bearer`，仅供临时排查 |
| `QWEATHER_DAILY_BUDGET` | | 全站和风调用日额度（默认 200，应用上限非官方套餐额度）。每个目的地最多 2 次请求，城市缓存 24h、预报缓存 1h |
| `IMAGE_API_BASE_URL` / `IMAGE_MODEL` / `IMAGE_API_KEY` | 可选 | AI 分享图：默认第三方 OpenAI Images 兼容地址 `https://xjbh.lol/v1`，模型 `gpt-image2.5`，需独立密钥。可用 `_2` / `_3` 后缀追加中转站（最多 3 个，按序降级）。[配置说明](docs/AI_SHARE_IMAGES.md) |
| `AMAP_JS_KEY` / `AMAP_JS_SECURITY_CODE` | 可选 | 前端地图渲染用的高德 **「Web端(JS API)」** Key（与 Web 服务 Key **不通用**）与配套安全密钥。两者都会下发到浏览器（JS API 的设计，靠域名白名单限权）。留空则前端地图走 Leaflet + 栅格瓦片 |
| `SSRF_ALLOWLIST` | | BYOK baseUrl 私网豁免（站长自有 Ollama 等） |
| `MEDIA_STORE` | | 图片与图源索引的存储后端：`local`（默认，宿主机 `./data`）或 `s3`（Cloudflare R2 / MinIO / 任意 S3，桶内布局与 `data/` 一致）。改这一个值即切换读写两侧，不用重导数据库 |
| `MEDIA_S3_ENDPOINT` / `MEDIA_S3_BUCKET` / `MEDIA_S3_ACCESS_KEY_ID` / `MEDIA_S3_SECRET_ACCESS_KEY` / `MEDIA_S3_REGION` | `MEDIA_STORE=s3` 时必填 | endpoint 只到域名层级（R2：`https://<account_id>.r2.cloudflarestorage.com`）；region 留空即 `auto`。缺任一项启动即报错 |
| `MEDIA_BASE_URL` | | 展示用 URL 前缀，默认 `/media`（同源）。挂 CDN 时填完整前缀，R2 自定义域名映射桶根所以是 `https://media.example.com/media` |

### 图片存储（可选：对象存储 + CDN）

默认图片落在宿主机 `./data/media`，由容器**只读挂载**并在 `/media/` 下托管 —— 图片不随镜像发布，首次部署或上游重导后需自行同步（`rsync -a --delete data/media/ user@host:/path/to/deploy/data/media/`）。

想免掉这一步、并让线上运行时缓存的新图（Pexels / 维基）能真正落盘，可改用 S3 兼容对象存储（以 Cloudflare R2 为例）：

```bash
# .env
MEDIA_STORE=s3
MEDIA_S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
MEDIA_S3_BUCKET=tripweaver-media
MEDIA_S3_ACCESS_KEY_ID=...
MEDIA_S3_SECRET_ACCESS_KEY=...
MEDIA_BASE_URL=https://media.example.com/media   # R2 自定义域名映射桶根，/media 是 key 的一部分
```

在有仓库的机器上先迁移再切换（镜像部署的机器没有 `tsx`；预演不写入，`--apply` 才上传）：

```bash
node --import tsx apps/server/scripts/migrate-media-to-s3.mts
node --import tsx apps/server/scripts/migrate-media-to-s3.mts --apply
```

迁移是幂等的（比对象 ETag 与本地文件 md5，一致则跳过），本地与线上各跑一遍即可补齐各自新增的文件。切换后宿主机 `data/` 不再被读写，建议**保留**作为回滚点：把 `MEDIA_STORE` 改回 `local` 并同步回目录即恢复。历史行程快照里的 `/media/...` 路径不需要改写。

`MEDIA_BASE_URL` 同时决定海报成品的域名（海报也是内容寻址，库里只存文件名，换前缀不用动数据库）。海报走 CDN 后，浏览器点「下载」需要读跨域字节，所以桶要配一条 CORS 规则：`origins: ["*"]`、`methods: ["GET","HEAD"]`（图片本来就公开可读、请求不带凭据）。没配 CORS 时前端会自动退回同源 `/media/...`（服务端从同一个桶转发），功能不受影响；微信里「长按保存」走的是 `<img>`，不受影响。

看用量（只读、不清理）：

```bash
node --import tsx apps/server/scripts/migrate-media-to-s3.mts --report
```

没有任何自动过期策略：唯一会被删的是「同一行程同一风格被替换掉的旧海报」。`media/remote-photos` 与 `photo-store/**` 只增不减，到接近免费额度时再考虑清理。

### GitHub 登录（可选）

1. 到 GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App（不是 GitHub App）；
2. Authorization callback URL 填 `<APP_BASE_URL>/api/auth/github/callback`（OAuth App 只允许一个 callback，**本地开发请另注册一个 App**，callback 填 `http://localhost:5173/api/auth/github/callback`）；
3. 把 Client ID / Client Secret 与 `APP_BASE_URL` 写入 `.env` 并重启。

登录只申请 `user:email` 权限，access token 拉取一次身份后即丢弃、不落库；GitHub 已验证邮箱与站内账号相同时自动绑定。`invite`/`closed` 模式下 GitHub 仅允许既有用户登录，不允许创建新账号。

### 推荐模型量级

三 Agent 流水线依赖**可靠的多轮工具调用**。推荐 `deepseek-chat`、`gpt-4o-mini`、`glm-4-air` 及以上量级；小参数本地模型（<7B）容易在工具调用上反复失败——系统有轮次熔断与完整性校验兜底，但体验会明显变差。

## 调研数据源（地图服务商 + 全网搜索）

调研 Agent 采用「结构化底座 + 攻略语义层」双层数据源，模型知识兜底：

1. **地点搜索**：真实地点的名称、地址与坐标。**搜索固定走天地图**——高德 `v5/place/text` 与地理编码主路径共用同一份个人配额，实测会被打满、两者互相挤占。需在[天地图控制台](https://console.tianditu.gov.cn/api/key)申请 **服务端** Key，并在同一处**单独开通「地名搜索」权限**；不可用时回空结果、由模型知识兜底（**不回落高德**）
2. **Web 搜索 API**：玩法、避雷与「是否需要预约」等攻略信息，带来源链接。用户可保存个人 API Key 与 Base URL（Key 以 AES-256-GCM 加密、仅显示尾号），只用于自己的自检与新生成任务；个人配置优先，清除后回退站点 `SEARCH_API_KEY` + `SEARCH_API_BASE_URL`，两者都不可用时 Null 降级。默认 [LangSearch](https://langsearch.com/)（免费）；[博查](https://open.bochaai.com)为同族接口（约 ¥0.036/次）
3. **预约种子表**：仓库内置约 50 条全国热门「需预约」景点（故宫/国博/莫高窟/陕历博等），命中即直接标注预约方式与官方链接，离线可用（`apps/server/src/data/reservationSeeds.json`，随仓库维护）

地图侧两家是**互补分工**，不是二选一（**没有 `MAP_PROVIDER` 开关**）：地点搜索固定天地图；路线规划 + 地理编码**高德优先**（个人 Key → 站点 `AMAP_KEY` → 天地图 → Nominatim 降级）。两个 Key 都建议配置。天地图无步行/骑行路径规划（回落启发式）、POI 无评分/人均/营业时间/图片，两家的调用额度分别计数、互不影响。

前端底图**默认走 Leaflet + 高德栅格瓦片**；配了高德 **JS API** 凭据后自动切成高德 JS API 渲染 —— 这样才能隐藏未编入行程的 POI 文字（栅格瓦片把文字烘焙进图片，关不掉）。Key 缺失、接口未取到、或 SDK 加载失败/超时都**静默降级**回 Leaflet，编辑器不会出现没有地图的情况。

启用 JS API 渲染需要在[高德控制台](https://console.amap.com/dev/key/app)单独申请一个 **「Web端(JS API)」** 类型的 Key（**与上面的 Web 服务 Key 不通用**）：创建时填**域名白名单**（本地开发填 `localhost`，线上填自己的域名），再把配套的**安全密钥**一起填到 `AMAP_JS_KEY` / `AMAP_JS_SECURITY_CODE`。两个值都会明文下发到浏览器 —— 这是 JS API 的设计，安全性靠域名白名单而不是保密，**不要当成秘密**。前端底图无论走哪条路都是 GCJ-02（与库内坐标同系），不受上述分工影响。

内置纪律与合规边界：

- 串行限速、结果缓存（路线 5 分钟）、单次生成调用上限、全站预算；高德按服务在实际请求前持久化原子扣减，超出自动降级
- 任一数据源缺失/超额**不影响生成**：自动降级为「仅高德」「仅搜索」或纯模型知识调研，行程会标注实际所用数据源
- 遵守高德服务协议：地点图片仅**热链实时展示、不转存文件**；候选落库只保留名称、短摘要与来源链接；请勿改造为批量采集工具
- 预约信息为搜索抽取 + 种子表，**以官方渠道为准**（卡片附来源链接与免责提示）

## 成本说明（站长）

- 地图 / 地理编码：OSM 与开源社区部分**零费用**；高德与 LangSearch 免费额度内**近零成本**（单次生成约 3–6 次高德 + 4–8 次搜索调用）
- 天气：和风天气免费档每月 5 万次请求（单次生成每目的地最多 2 次），远超个人站点用量
- LLM：一次生成约 5–15 万 token；以 DeepSeek 计约每次几分到一两毛钱。成本三道闸：注册管控（默认开放，可切 `invite` 模式挡陌生人）、每日配额（生成与对话分别限次）、用量落库（`generations` 表可审计，含数据源调用数）
- 用户在高级设置里配置自己的 Key（BYOK）后，其生成不消耗站点 Key

## 安全设计

密码 bcrypt 哈希；LLM、高德与个人搜索 API Key 均以 AES-256-GCM 加密存储、任何接口不回显明文；httpOnly Cookie 会话；登录/注册限流；用户提供的 LLM 与搜索 Base URL 保存和使用时双重 SSRF 校验；用户数据严格隔离。详见[架构文档 §9](docs/TECHNICAL_ARCHITECTURE.md)。

## 评测与验证

`eval/` 是一套独立的评估框架：历史快照离线回归、当前生成链路 live 评估、版本比较与显式基线接纳，每次运行写入独立目录（`eval/runs/<时间-随机ID>/`）不覆盖历史。报告含门槛、逐例指标与问题列表，并记录输入/检查器/提示词/代码的 hash 与 Git HEAD，保证结果可复现。详见 [eval/README.md](eval/README.md)。

```bash
npm run eval:test                 # 评估器单测
npm run eval                      # 离线检查历史最终行程（不调模型、不连库）
npm run eval:live -- --suite smoke   # 执行当前生成链路（真实模型）
EVAL_PG_ADMIN_URL=... npm run eval:flow   # 当前功能全流程验证（12 环节，含浏览器）
npm run eval:retrieval            # 字面层检索质量基线
```

零散的功能验证脚本在 `scripts/`（多数自带隔离库、可在空库跑）：

```bash
npm run typecheck                 # 四包类型检查
node scripts/smoke-pi.mjs         # 冒烟：LLM 端点连通（读 apps/server/.env 的 SITE_LLM_*）
node scripts/smoke-sources.mjs    # 冒烟：地点搜索 + Web 搜索数据源连通（未配 Key 时提示并跳过）
node scripts/verify-c2.mjs        # 端到端：生成流水线 + 候选池 + 配额 + BYOK（内置 mock LLM，离线可跑）
node --import tsx scripts/verify-sql-first.mts   # 检索/调研/排程等 server 测试（自建隔离库）
node --import tsx scripts/verify-place-identity.mts  # 地点实体身份与别名治理（独立隔离库）
npm run build && node scripts/verify-c3.mjs   # 浏览器级验收（需 Playwright）
```

CI 见 `.github/workflows/`：`ci.yml` 跑类型检查与测试，`docker.yml` 构建发布镜像，`eval-live.yml` 跑 live 评估。

## 文档

- [产品需求 PRD](docs/PRD.md)
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [确定性排程算法](docs/DETERMINISTIC_SCHEDULING.md)
- [API 响应与请求约定](docs/API_CONTRACT.md)
- [开发计划](docs/DEVELOPMENT_PLAN.md)
- [竞品与差异化分析](docs/COMPETITIVE_ANALYSIS.md)
- [高德预算与日志](docs/AMAP_QUOTAS.md)
- [AI 行程分享图](docs/AI_SHARE_IMAGES.md)
- [城市地标素材](docs/CITY_LANDMARK_ASSETS.md)
- [评估运行说明](eval/README.md)

## 路线图

- [x] M1 全栈行程编辑器（认证/历史/编辑/地图）
- [x] M2 多 Agent 智能生成（调研/编排/审校 + SSE 进度）
- [x] M3 导出三件套 + 安全走查（微信真机清单见 [docs/WECHAT_CHECKLIST.md](docs/WECHAT_CHECKLIST.md)）
- [x] M4 开源发布（Docker/CI/文档）
- [x] M5 确定性排程 + 详情对话改稿 + 历史版本
- [x] M6 知识库混合检索 + 评估框架与流程验证
- [x] M7 行程天气与专属建议 + 媒体对象化/CDN
- [ ] V1.1 候选：只读分享页、BYO-MCP、站长后台

## License

[MIT](LICENSE)
