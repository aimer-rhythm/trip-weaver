# Journal - aimer (Part 1)

> AI development session journal
> Started: 2026-07-06

---



## Session 1: Phase C0–C3 完成：多 Agent 智能生成全链路（M2 达成）

**Date**: 2026-07-07
**Task**: Phase C0–C3 完成：多 Agent 智能生成全链路（M2 达成）
**Branch**: `master`

### Summary

C0 双冒烟（pi/MCP 离线核对+映射表）；C1 集成层（XhsMcpContentSource/Null 降级/geocode/系统代理坑）；C2 三 Agent 流水线+SSE+双层配额（verify-c2 28/28）；C3 生成前端时间线+刷新恢复+异常文案（verify-c3 14/14，verify-m1 回归 18/18）。仓库首次提交。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `233f6ee` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Phase D1+D2 完成：导出三件套与安全走查（M3 达成）

**Date**: 2026-07-07
**Task**: Phase D1+D2 完成：导出三件套与安全走查（M3 达成）
**Branch**: `master`

### Summary

D1 导出三件套（PrintView/print.css/toPng 2x/JSON v2/微信长按兜底/列表导出，verify-d1 6/6）；D2 安全走查 23 项全过 + 微信真机清单交付 + 全量回归（m1 18/18、c2 28/28、c3 14/14）。剩余 E1 开源工程化。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `924e036` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Phase E1 完成：开源工程化（M4 达成，全计划收官）

**Date**: 2026-07-07
**Task**: Phase E1 完成：开源工程化（M4 达成，全计划收官）
**Branch**: `master`

### Summary

CI 分支修正、README 完善（截图/推荐模型/验证脚本）、干净目录部署演练全通（无 Docker 环境限制已记录）。A0–E1 十二个 Phase 全部完成，M1–M4 里程碑达成；遗留：微信真机清单回填、真实 LLM Key 联调、Docker compose 烟测。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `bd0abf8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Open registration and GitHub login, invite code as fallback

**Date**: 2026-07-07
**Task**: Open registration and GitHub login, invite code as fallback
**Branch**: `master`

### Summary

Implement three-mode registration system (open/invite/closed) with REGISTRATION_MODE env var, GitHub OAuth web application flow (authorize / exchange / fetch identity / auto-bind by verified email), and password-free OAuth-only accounts. Frontend: AuthConfig API, conditional GitHub button, OAuth error handling. Verification: verify-auth-modes.mjs covers 16 scenarios across all modes and GitHub routes. Docs updated: README, PRD, TECHNICAL_ARCHITECTURE, .env.example.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `62167df` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: ST1 geo data layer: Amap GCJ-02 stack + transit legs

**Date**: 2026-07-12
**Task**: ST1 geo data layer: Amap GCJ-02 stack + transit legs
**Branch**: `master`

### Summary

Competitive-analysis-driven pivot executed: geo stack switched to Amap GCJ-02 (geocoder+route adapters under four-gate discipline), TransitLeg schema added, deterministic geocodeAll+computeLegs post-pass in orchestrator (abort-aware after High fix), 24 unit tests, spec updated with 4 new conventions. ST2 (frontend merge+map) next.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6d8b4b4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: ST2 frontend: itinerary/overview merge + leg chips + Amap map

**Date**: 2026-07-12
**Task**: ST2 frontend: itinerary/overview merge + leg chips + Amap map
**Branch**: `master`

### Summary

Overview merged into activity cards + CandidateDrawer, transit LegChips with heuristic badge, MapView on Amap tiles with day-colored real-route polylines and legacy wgs84 conversion. 2 High fixed in check (containment-match guard, stale verify-c3 assertions); C3 browser gate 27/27. ST3 (ota demotion) next.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c3e5522` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: ST3 OTA demotion + parent geo-stack task complete (3/3)

**Date**: 2026-07-12
**Task**: ST3 OTA demotion + parent geo-stack task complete (3/3)
**Branch**: `master`

### Summary

transportMode form preference feeding computeLegs, lodging anchor with 'lodging' sentinel legs (generation-time area suggestion + geocode, editor rename invalidation), budget demoted to per-person/day range with disclaimer, cost made optional with full consumer audit. All gates green (33 unit tests, verify-c2, verify-c3 31/31). Parent task 07-12-switch-geo-stack archived 3/3. Next: feasibility engine (M0-A remainder).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e9e4e73` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: Feasibility engine (M0-A): time-space simulator with violation report

**Date**: 2026-07-14
**Task**: Feasibility engine (M0-A): time-space simulator with violation report
**Branch**: `master`

### Summary

Pure-code simulateDay/simulateTrip in shared feasibility.ts (transit_infeasible/overpacked hard, backtrack/anchor_missing soft, closed_on_arrival reserved). orchestrator timing shift: geoPipeline per-round so engine simulates on real legs before review. planner check_feasibility tool + hard-only submit_plan gate, exhausted-hard degrades to reviewNotes (job still done). High fix: final notes recomputed post-review. 55/55 tests, verify-c2 pass. LLM-proposes-solver-disposes now real. Next: public deploy or eval harness.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d1894e2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: Archive beijing hard anchor

**Date**: 2026-07-19
**Task**: Archive beijing hard anchor
**Branch**: `master`

### Summary

Verified the beijing-hard-anchor task quality records and archived the completed task. Left unrelated local .claude/settings.local.json untouched.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9e4f287` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: Verify release CI and Docker Compose

**Date**: 2026-07-19
**Task**: Verify release CI and Docker Compose
**Branch**: `master`

### Summary

Deferred the WeChat in-app browser device checklist, added Docker Compose config and app image build gates to CI, verified typecheck/build locally, pushed master, and confirmed GitHub Actions run 6 succeeded.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `77add45` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: 行程生成 P0：坐标复用、定位名与局部修订

**Date**: 2026-09-14
**Task**: 行程生成 P0：坐标复用、定位名与局部修订
**Package**: server
**Branch**: `master`

### Summary

完成三项 P0，保留地理与餐次可行性检查。167 单测、31 末次回归、C2、类型检查、构建与 9/9 离线评测通过；模拟定位请求 4→1，线上耗时尚未测量。

### Main Changes

# P0 verification — 2026-09-14

## Implemented scope

1. Reuse task-local research POI coordinates and adcodes through the existing geocode sanity
   firewall. Invalid, ambiguous, missing, and rejected matches retain the normal lookup chain.
2. Separate display names from lookup names with generation-only `placeName` / `poiId` hints;
   legacy meal names extract the actual area. Internal hints do not enter persisted Trip JSON.
3. Give the second planner round the current draft and a revision-specific prompt/tool set.
   Remove skeleton creation from that round; preserve activity IDs and validated unchanged data.

Location edits invalidate coordinates and affected routes. Time/description-only edits retain
them. The post-review pass resolves changed states without retrying unchanged failed queries.
Repeating the same lodging preserves resolved data; changing lodging invalidates sentinel legs.

## Reproducible provider-call comparison

Command:

```text
node --import tsx --test apps/server/src/__tests__/geoPipeline.test.ts
```

The fixture contains one city center, one museum, and two meal areas. It uses the real
GeoSession/geocoder/route adapters with fully intercepted HTTP and an isolated temporary
SQLite database. Separate destination keys prevent the baseline from warming the reuse
scenario's geocoding cache.

| Observation | No research index | Research reuse |
| --- | ---: | ---: |
| Geocoding HTTP requests (city + activities) | 4 | 1 |
| Geo geocoding attempt count | 4 | 1 |
| Activity coordinates and source labels | Same fixture result | Same fixture result |

The three reused activity lookups disappear; city-center validation remains. Research calls
and route calls are excluded from this comparison. A separate assertion checks two transit
requests use the corresponding activity adcodes (`city1` / `city2`) and remain counted.

This is a measured mock call-count reduction, not an online wall-clock speedup. End-to-end
latency still depends on provider response times, adopted-candidate coverage, model turns,
and any normal-chain fallbacks.

## Regression results

- `npm run typecheck`: passed for shared, server, web, and eval.
- `node --import tsx --test apps/server/src/__tests__/*.test.ts`: 167 tests passed.
- `node scripts/verify-c2.mjs`: passed; includes reviewer-turn exhaustion, an actual second
  planning round, one skeleton across both rounds, all six original activity IDs retained,
  requested local time/description edits persisted, both daily meals, no internal place hints
  in Trip JSON, cancellation, SSE replay, quota, BYOK, and legacy DB migration.
- `npm run eval`: 9/9 historical snapshots passed; hard=0, soft=54, no skipped cases.
  Local output: `eval/reports/2026-09-14T11-38-56-360Z.json` (ignored generated report).
- `npm run build`: passed. Existing Vite >500 kB chunk-size advisory remains.
- The final lodging-leg invalidation adjustment is additionally covered by 31 passing draft,
  geocoding, and long-haul-fixer regression tests plus a fresh typecheck.

The new geo tests also cover missing references, duplicate-name ambiguity, invalid research
coordinates, wrong-city reuse/fallback, stale adcodes after replacement, coordinate-only
invalidation, skipping unchanged failed lookups, excluding estimated reference points, and
cancellation before adoption.

## Quality boundary

No credential-bearing live-provider checks were run. Historical snapshots were not regenerated
with the revised prompts; eight of nine lack Amap route data, and these old snapshots do not
cover the current meal-completeness contract. Their green result establishes compatibility,
not live planning-quality equivalence. New meals and local revision behavior are covered by
the mocked generation and deterministic regression tests above.

Provider limits, queues, timeout values, model selection, Agent runtime, public schemas, and
database structure remain unchanged. No LangGraph dependency was added.


### Git Commits

| Hash | Message |
|------|---------|
| `fafce25` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: LLM 请求上下文快照模块 + 生成时间线实时展示

**Date**: 2026-09-21
**Task**: LLM 请求上下文快照模块 + 生成时间线实时展示
**Branch**: `master`

### Summary

新增 llm_request_logs 表与 recorder 模块（streamFn 包装），生成时间线实时展示 LLM 请求摘要+可展开全文；借快照定位 plan 阶段失败根因（maxTokens 8192 被隐藏推理烧光，stopReason=length）；spec 沉淀调试契约

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `65a1b72` | (see git log) |
| `6761efd` | (see git log) |
| `c6b579b` | (see git log) |
| `381103a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
