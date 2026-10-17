# Journal - aimer (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-10-16

---



## Session 50: 遗留代码、本地产物与文档口径清理

**Date**: 2026-10-16
**Task**: 遗留代码、本地产物与文档口径清理
**Branch**: `master`

### Summary

清理 SQLite/本地媒体/SQLite 时代 verify 脚本遗留：删 35 文件 3123 行、本地回收 988MB，移除 better-sqlite3 依赖与已下线预算模块，架构图与 PRD 对齐确定性排程。typecheck 四包通过、verify-sql-first 90/90。

### Main Changes

### Main Changes

**本地产物清理（无 git 影响，约 988 MB / 8278 文件）**

按 `.trellis/spec/guides/workspace-cleanup.md` 的规程执行：`git status --porcelain -z -uall` + 字节级 UTF-8 解码枚举，与 `git ls-files -z` 全集求交集为空才删。清单留档在任务目录的 `cleanup-manifest.json`。

- `apps/server/data/*.db*`（含 5 套 `verify-generation-timing-*.db`）
- `apps/server/.env.tmp`
- 根 `data/` 下 16 个测试产物目录与散落 log / zip / db
- `verify-shots/`
- `data/backups`、`data/pgvector-build`

保留 `data/media`(307MB) 与 `data/photo-store`(18MB) —— README 指定的 S3 迁移回滚点。

**仓库内遗留删除（35 文件 / 3123 行）**

- `apps/server/scripts/migrate-sqlite-to-pg.ts` + 15 个根目录 `test-*.mts` 探针 + `apps/web/test-timeline-llm.mts`
- `apps/server/src/env.ts` 的 `env.databasePath`（唯一读者是被删的迁移脚本）与 `.env.example` 的 `DATABASE_PATH`
- `apps/server/package.json` 移除 `better-sqlite3` + `@types/better-sqlite3`（`npm install` 后 -35 packages）
- 9 个未迁移到 PG 的 `scripts/verify-*.mjs`
- `packages/shared/src/budget.ts` + `BudgetSummary` + `budget.test.ts`

**文档对齐**

- `docs/TECHNICAL_ARCHITECTURE.md` 架构图：②编排 Agent → ②确定性排程（纯代码）、③审校 Agent → ③审校+撰写；调研数据源「PoiSource(高德)」→「地点搜索(天地图)」
- `docs/PRD.md` 流水线表 ②③ 同步；护城河表「预算聚合」→「确定性排程」
- `README.md` 验证脚本清单删掉 3 条失效命令（**未随本任务提交，按用户决定并入 10-14-readme**）

### 判定修正记录

首轮报告有 4 处误判，均在实施中推翻，未造成损失：

1. `migrate-media-to-s3.mts` —— README 把它当长期运维工具（`--apply` / `--report`，幂等），保留
2. `LeafletCanvas.tsx` —— `MapView.tsx` 里的既定降级路径（未配 Key / SDK 失败 / 8s 超时都回落它），保留
3. `data/`、`verify-shots/`、`*.db`、`.env.tmp` —— 全在 `.gitignore` 内，删除不产生 git 改动
4. `install-curated-photos.py` —— 被 `apps/server/src/data/photography/README.md` 正式文档化为精选媒体校验/恢复工具，本机有 Python 3.13 + Pillow 12.2.0，保留

误判根因：首轮用 `Select-String -Path apps/web/src/**` 检索引用，PowerShell 该写法**不递归**，漏检了 `MapView.tsx` 的 import。后续全部改用 `Get-ChildItem -Recurse | Select-String`。

### 第二轮新发现（已处理）

12 个 `scripts/verify-*.mjs` 里有 8 个未随 SQLite→PG 迁移：

| 类别 | 脚本 | 症状 |
|---|---|---|
| 必然崩溃 | `verify-amap-settings`、`verify-websearch-settings` | import 已删除的 `integrations/amap/poiSource.ts`；读 `db/client.ts` 已不存在的 `.sqlite` 导出 |
| 静默打到真实 `DATABASE_URL` | `verify-amap-settings-browser`、`verify-websearch-settings-browser`、`verify-auth-modes`、`verify-d1`、`verify-generation-timing`、`verify-security` | 传 `DATABASE_PATH` 求隔离，但服务端已不读它 → 落到本机 dev 库 |

连同 `verify-m1.mjs` 共 9 个按用户决策全删。保留已迁移的 `verify-c2`（CI 在跑）、`verify-c3`、`verify-generation-browser`。

`apps/server/data/` 空目录**必须保留**：`.github/workflows/ci.yml:93` 的容器重启冒烟测试要在其中写 `restart-marker`。

### Testing

- `npm run typecheck` —— 四包（shared / server / web / eval）通过
- `node --import tsx scripts/verify-sql-first.mts` —— 90/90 pass
- `python ./.trellis/scripts/task.py validate .trellis/tasks/10-16-legacy-cleanup` —— implement.jsonl 9 条 / check.jsonl 5 条全部合法
- 逐提交核对 `git log --oneline -1` 确认变化，防止 `.git/index.lock` 竞态下的假成功
- 逐提交 `git show --stat` 确认无越界文件

### Status

[OK] **Completed**

### Next Steps

- `README.md` 的验证脚本修正留在工作区，并入 `10-14-readme` 提交
- 线上库 `place_identity_imports`（300 行 / 2.6GB JSONB 快照）未处理，用户决定另开任务
- 历史/策略文档保留原样：`TECHNICAL_ARCHITECTURE.md:132`（v0.5 ST3 变更记录提到已删的 `BudgetSummary`）、`COMPETITIVE_ANALYSIS.md:97/104`（把「预算聚合」当护城河）—— 改写等于改动历史


### Git Commits

| Hash | Message |
|------|---------|
| `6fed00d` | (see git log) |
| `a77818c` | (see git log) |
| `be00848` | (see git log) |
| `e9c5242` | (see git log) |
| `b3146ce` | (see git log) |
| `3effae2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 51: place_identity_imports 归档与截断

**Date**: 2026-10-17
**Task**: place_identity_imports 归档与截断
**Branch**: `master`

### Summary

本机 WSL dev 库该表 2636MB / 300 行已归档到 data/db-archive（1.03GB，恢复校验行数与 content_hash 全量一致）后 TRUNCATE，库 2791MB→155MB、表 24kB；线上库实测 0 行无需处理。verify-place-identity 22/22 通过。

### Main Changes

### Main Changes

**前提纠正**

原始诉求是「线上库 `place_identity_imports` 300 行占 2.6GB」。实测两边：

| | 库总大小 | 该表 |
| --- | --- | --- |
| 线上库（VPS `trip-weaver-db-1`） | 78 MB | **0 行** |
| 本机 WSL（`tripweaver-pg`） | 2791 MB | **2636 MB（占 94%）** |

线上库没有可清理内容，2.6GB 全在本机开发库。原判断把两侧混为一谈，已同步修正 memory。

**目标表构成**（截断前实测）

- 300 行，2026-10-06 ~ 10-12
- 111 行 payload > 10MB，最大 27MB，平均 8.6MB
- 14 行已回滚（payload 仅 24MB），286 行未回滚（2516MB）
- 城市：北京 26/641MB、厦门 44/524MB、济南 87/368MB、成都 32/230MB、重庆 20/221MB
- 日期：**10-09 一天 114 行 / 1213MB** 是大头

写入方 `goldsetPlaceImport.ts` / `seed-xhs-places.ts` / `seed-xhs-relations.ts`；
读取方只有 `rollback-place-identity.ts` 与测试，Web 运行时不碰。

**归档 → 校验 → 截断**

| | db 大小 | 表大小 | 行数 |
| --- | --- | --- | --- |
| 前 | 2791 MB | 2636 MB | 300 |
| 后 | **155 MB** | **24 kB** | **0** |

归档 `data/db-archive/place-identity-imports-20261016.dump`（1.03GB，`sha256 40f4001c…`），
在 `.gitignore` 的 `data/` 内不进版本库。恢复命令已写进 PRD。

### 踩坑记录

**1. 直接 dump 到 /mnt/d 会失败**

首次把 `pg_dump -Z9` 输出重定向到 D 盘，900 秒只写 784MB —— WSL `/mnt/d` 是 9p 挂载，
实测写入速率约 **0.9MB/s**。且 PowerShell 调用超时中断后，容器内 `pg_dump` 变成孤儿进程
（宿主 `pkill` 因命名空间隔离报 Operation not permitted，须 `docker exec` 进容器终止）。

改为两步后正常：先 dump 到 WSL 本地盘 `/tmp`，再整文件 `cp` 到 `/mnt/d`。
压缩参数从 `-Z9` 换成 `--compress=zstd:3`：**53 秒**完成（gzip -9 十几分钟仍未完）。

**2. `pg_restore --list` 不能验证 dump 完整性**

custom 格式的 TOC 写在文件头部，数据被截断时 `--list` 依然成功。必须实际恢复到临时库比对。

本次校验两条断言同时成立才继续：行数 300 = 300，`md5(string_agg(content_hash,…))`
源库与恢复库同为 `600c5290cb48c4113f95c84bde82da3a`。

### Testing

- 恢复校验：300 行 + content_hash 全量 md5 一致
- 结构校验：`\d place_identity_imports` 7 列齐全，`place_identity_imports_pkey` 与
  `idx_place_identity_imports_city` 两个索引都在
- 回归：`node --import tsx scripts/verify-place-identity.mts` → **22/22 pass**
  （自建 `place_identity_test_*` 库，覆盖审计写入 / 事务预演 / 幂等 / 回滚全链路）
- 临时库无残留（`tw_restore%` 匹配 0 行）
- WSL `df`：24G → 20G used

### Status

[OK] **Completed**

### Next Steps

- **Windows 侧空间未回收**：`ext4.vhdx` 仍是 28.02GB，而 WSL 内 `df` 只报 20G，差值是 vhdx 内部空洞。
  要在 Windows 看到回收需 `wsl --manage Ubuntu --set-sparse true`（或 `Optimize-VHD`），
  **要求先关闭 WSL**，而当前 WSL 内跑着 `tripweaver-pg`、`dataease`、`mysql-det` 三个容器。未执行。
- **会再长回来**：每次城市导入都写整城 JSONB 前后快照（北京 26 行就 641MB）。本轮只清存量，未改写入侧。
- **VPS 磁盘占比真因不是数据库**：`/` 29G 用 23G（80%），但 DB 只 78MB；真因是 docker
  images 6.271GB（4.861GB 可回收）与 build cache 681.4MB。用户决定本轮不处理。


### Git Commits

| Hash | Message |
|------|---------|
| `2b76ec2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
