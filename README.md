# 织程 TripWeaver

> 多 Agent 协作的开源智能旅行助手 —— AI 替你刷小红书攻略、排行程、算预算，落到地图上，一键导出分享。

**织**：三个 AI Agent 像织机一样协作——调研 Agent 从小红书真实笔记中抽出「经线」（玩法、口碑、避雷），编排 Agent 织入地理与时间的「纬线」，审校 Agent 验布质检。**程**：交付一份可编辑、可导出的完整行程。

## 功能

- 🧵 **智能行程规划**：输入目的地/天数/预算/偏好，三阶段 Agent 流水线（调研 → 编排 → 审校）生成结构化多日行程，全过程工具调用实时可见
- 📕 **小红书数据源**：行程素材来自真实笔记（经自托管 MCP 服务只读获取），活动可回溯来源笔记；未部署时自动降级为模型知识
- 🗺️ **地图可视化**：Leaflet + OSM，按天配色的序号标记与动线折线，天数过滤，坐标来自真实地理编码（Nominatim）
- 💰 **预算计算**：按天/按类别聚合，超支实时预警
- ✏️ **行程编辑**：增删改活动、日内排序、跨天移动，编辑自动保存
- 📤 **导出**：长图（微信分享友好）/ JSON 备份导入 / 打印 PDF
- 👥 **多用户**：邀请码注册、行程历史云端留存、每日生成配额、站点供 Key 或用户自带 Key（BYOK）

## 架构

```
React SPA ──HTTP API + SSE──▶ Fastify 路由层 ──▶ 多 Agent 编排（pi-agent-core / pi-ai）
                                   │                 ├─ 调研 Agent ─▶ 小红书 MCP（只读）
                                   ▼                 ├─ 编排 Agent ─▶ OSM Nominatim
                                SQLite               └─ 审校 Agent ─▶ 预算/动线审查
```

技术栈：React 18 + Vite / Fastify + TypeBox / SQLite + Drizzle / zustand + TanStack Query / Leaflet。详见 [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md)。

## 快速部署（站长）

```bash
git clone https://github.com/<you>/tripweaver.git && cd tripweaver
cp .env.example .env
# 编辑 .env：至少填 MASTER_KEY（生成命令见文件内注释）、INVITE_CODE、站点 LLM Key
docker compose up -d
```

浏览器打开你的域名（或 `http://服务器IP`），用邀请码注册即可。

### 本地开发

```bash
npm install
cp .env.example apps/server/.env   # 填 MASTER_KEY / INVITE_CODE 等
npm run dev                        # server:3001 + web:5173
```

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `MASTER_KEY` | ✅ | 32 字节 hex，用户 API Key 的加密主钥 |
| `INVITE_CODE` | 建议 | 注册邀请码；留空 = 注册关闭 |
| `SITE_LLM_BASE_URL` / `SITE_LLM_API_KEY` / `SITE_LLM_MODEL` | 建议 | 站点供 Key（普通用户零配置使用）；留空 = 纯 BYOK 模式 |
| `GEN_DAILY_LIMIT` | | 每用户每日生成次数（默认 3） |
| `XHS_MCP_URL` | | 小红书 MCP 服务地址；留空 = 降级为模型知识调研 |
| `XHS_DAILY_BUDGET` | | 全站小红书调用日额度（默认 500） |
| `SSRF_ALLOWLIST` | | BYOK baseUrl 私网豁免（站长自有 Ollama 等） |

## 小红书数据源（重要）

本项目通过自托管的小红书 MCP 服务（如 [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)）**只读**获取笔记用于行程调研。部署纪律：

1. **务必使用专用小号**，不要用你的主账号；
2. 该小号**不要在其他网页端登录**（小红书网页会话互踢，会导致 MCP 掉线）；
3. 本项目内置串行限速、结果缓存、单次生成调用上限与全站日额度，请勿改造为批量采集工具；
4. 笔记内容仅作为行程规划参考，产出只保留短摘要与署名链接，不转存全文。

MCP 服务不可用时生成流程不会失败——自动降级为模型知识调研，行程会标注「未使用小红书数据」。

## 成本说明（站长）

- 地图 / 地理编码 / 小红书接入：**零费用**（感谢 OSM 与开源社区）
- LLM：一次生成约 5–15 万 token；以 DeepSeek 计约每次几分到一两毛钱。成本三道闸：邀请码（挡陌生人）、每日配额（限次数）、用量落库（`generations` 表可审计）
- 用户在高级设置里配置自己的 Key（BYOK）后，其生成不消耗站点 Key

## 安全设计

密码 bcrypt 哈希；API Key AES-256-GCM 加密存储、任何接口不回显明文；httpOnly Cookie 会话；登录/注册限流；BYOK baseUrl 私网黑名单（SSRF 防护）；用户数据严格隔离。详见架构文档 §9。

## 文档

- [产品需求 PRD](docs/PRD.md)
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [开发计划](docs/DEVELOPMENT_PLAN.md)

## 路线图

- [x] M1 全栈行程编辑器（认证/历史/编辑/地图/预算）
- [ ] M2 多 Agent 智能生成（调研/编排/审校 + SSE 进度）
- [ ] M3 导出三件套 + 微信浏览器适配
- [ ] M4 开源发布（Docker/CI/文档）
- [ ] V1.1 候选：对话式改稿、只读分享页、BYO-MCP、站长后台

## License

[MIT](LICENSE)
