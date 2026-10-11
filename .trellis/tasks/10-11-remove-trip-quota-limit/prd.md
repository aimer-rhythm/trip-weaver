# 移除单用户行程数量上限

## Goal

对话内修订行程时出现 409「行程数量已达上限（100 条），请先清理历史行程」，导致整轮对话回滚。根因是 `MAX_TRIPS_PER_USER` 计数口径在 09-23 版本链上线后从「行程数」漂移成「表行数（含全部历史版本）」，名实不符。用户决定移除该上限：个人自用场景下历史版本量可控，不值得为它保留一个会误伤正常使用的判据。

## Requirements

* 移除 `createTrip` 中的行数判据与 409 抛错分支（`apps/server/src/services/tripService.ts:147-150`）
* 移除 `MAX_TRIPS_PER_USER` 常量定义（`packages/shared/src/constants.ts:12`）及其 import（`tripService.ts:5`）
* 补一行注释记录「为什么不再限制」，避免后续会话当作遗漏而重新加回
* 同步更新 `tripService.ts` 顶部 doc 注释中残存的「单用户上限」表述（若存在）

## Acceptance Criteria

* [ ] 单用户在 `trips` 表累计超过 100 行时，`createTrip` 不再抛 409
* [ ] 对话内修订行程不再出现「行程数量已达上限」错误
* [ ] 全仓 `grep MAX_TRIPS_PER_USER` 无命中（除 `.trellis/` 历史文档）
* [ ] `npm run typecheck` 通过

## Definition of Done

* typecheck / lint 绿色
* server 测试通过
* `.trellis/spec/` 中依赖该限额的表述已同步（见 Open Questions）
* 无遗留死代码（无用 import、无引用常量）

## Technical Approach

改 2 个文件、删约 6 行：

1. `packages/shared/src/constants.ts` — 删除常量；在该位置留一行说明性注释（常量区风格已有同类注释）
2. `apps/server/src/services/tripService.ts` — 删除 import 成员、删除 `count(*)` 查询与 409 分支

不需要改数据库：`idx_trips_user` / `idx_trips_root` 保留，判据消失不影响索引。

## Decision (ADR-lite)

**Context**：`MAX_TRIPS_PER_USER = 100` 在首次提交 `233f6ee`（M1+M2，SQLite 时期一行 = 一条行程）引入，用于兜住当时无分页的列表接口（一次全取 + JS 归并）。09-23 `c516655` 引入版本链后，一行语义变为「一个版本快照」，`count(*)` 随之变成行数上限，但常量名、错误文案、判据三处都未同步。10-03 分页任务的 PRD 已把它记为「行数上限，含版本链」并明确决定不改。

**Decision**：直接移除限额，不做计数口径修正（`count(distinct root_id)`）。

**Consequences**：
* 解除对话修订被 409 打断的问题，且不需要为「版本留存策略」先做设计
* `listTripsPage` 内层 `distinct on (root_id)` 的扫描行数随历史版本累积增长，`createTrip` 的 `count(*)`（若保留）同理 —— 移除判据后前者仍是唯一随行数增长的读路径，后续若变慢再评估
* `listTripVersions` 不分页 + `HistoryPanel` 全量渲染，理论上可被超长版本链拖慢；已确认个人使用量级下可接受，不预先优化

## Out of Scope

* `deleteTrip` 只删单行、不级联整条版本链的行为
* `listTripVersions` 分页 / 历史版本面板虚拟滚动
* 版本留存策略（保留最近 N 版 + 里程碑版）
* 生成路径（`orchestrator.ts`）把非白名单错误统一替换成「生成失败，请稍后重试」导致真实原因被吞的问题

## Open Questions

* `place-identity.md:109` 的测试账号纪律以「会撞 100 条上限」为论据，是否本次一并改写
* 是否补一条回归验证锁定「超 100 行仍可创建」

## Technical Notes

**引用点（全仓 grep `MAX_TRIPS_PER_USER`，仅 2 个源文件）**

| 位置 | 内容 |
|---|---|
| `packages/shared/src/constants.ts:12` | `export const MAX_TRIPS_PER_USER = 100;`（无注释） |
| `apps/server/src/services/tripService.ts:5` | import 成员 |
| `apps/server/src/services/tripService.ts:148-149` | `count(*)` 判据 + 409 抛错 |

前端（`apps/web`）无任何引用；无单元测试或 e2e 断言覆盖该上限，移除不需要连带修改测试。

**相关索引**（`apps/server/src/db/migrate.ts`）

* `:120 idx_trips_user ON trips(user_id, updated_at DESC)`
* `:285 idx_trips_root ON trips(root_id, version DESC)`

**下游影响路径**（已核实）

* `detailChatService.ts:186` — 对话修订成功后 `createTrip(..., trip.id, tx)`，409 在此抛出，整轮 `commitOperation` 事务回滚
* `routes/detailChat.ts:58-60` — SSE error 只掩盖 `statusCode >= 500`，409 原文透传给前端
* `generation/orchestrator.ts:492` — 生成路径同样走 `createTrip`，但 catch 后 `failJob` 把真实原因替换为「生成失败，请稍后重试」

**历史证据**

* `233f6ee` feat: 织程 TripWeaver M1+M2 —— 常量与判据首次引入
* `c516655` feat(server): 对话内修订与行程版本链（09-23）—— `createTrip` 增加 `revisionOf`，`count(*)` 语义漂移
* `.trellis/tasks/archive/2026-10/10-03-trip-list-scroll-pagination/prd.md:15,104` —— 已记录该口径问题并决定不改
* `.trellis/spec/server/backend/place-identity.md:109` —— 「同城50个以上场景共用账号会累计触发产品100条行程上限；不得提高产品限额或清除中途数据来掩盖测试污染」
