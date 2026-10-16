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
