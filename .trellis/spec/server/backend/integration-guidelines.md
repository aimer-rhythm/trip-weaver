# External Integration Guidelines

## Adapter Shape and Null Implementations

Optional research providers expose narrow interfaces with a `kind` discriminator, a normal
operation, and `selfCheck()`. Each provider has a Null implementation that returns empty
results and a structured disabled status. Missing optional keys must not prevent server
startup or generation.

Factory functions return a stable site-level provider or its Null equivalent. The
orchestrator can also force a Null provider when the site's remaining daily budget is below
the per-task reservation.

Representative paths: `apps/server/src/integrations/amap/poiSource.ts`,
`apps/server/src/integrations/websearch/searchSource.ts`,
`apps/server/src/generation/orchestrator.ts`.

## Timeouts, Queueing, and Cache

- Every provider `fetch` has an explicit timeout. Current Amap requests use 10 seconds and
  web search uses 15 seconds.
- Metered/rate-limited providers use `createSerialQueue` for one-at-a-time calls with a
  minimum interval. A failure must not poison the queue tail.
- Repeated searches use bounded in-memory `TtlCache` instances. Current research source
  caches retain up to 300 keys for 24 hours.
- Cache and queue state are process-local; they do not coordinate across replicas and are
  cleared on restart.
- Metered health checks are memoized at the route boundary for 60 seconds.

Representative paths: `apps/server/src/lib/serialQueue.ts`,
`apps/server/src/lib/ttlCache.ts`, `apps/server/src/routes/settings.ts`.

## Per-Task and Site Limits

Task wrappers cap one generation at `AMAP_MAX_PER_TASK` (8) and
`SEARCH_MAX_PER_TASK` (10). Null providers do not increment task statistics. Once the cap is
reached, the wrapper returns an empty result and does not invoke the provider.

Site budgets are read from centralized environment configuration. `quotaService` aggregates
the persisted `generations.amapCalls` and `generations.searchCalls` columns with a 60-second
in-memory aggregate cache. The orchestrator selects a Null provider for the whole task when
remaining budget is below that provider's per-task maximum.

This is intentionally approximate under concurrency: running jobs are not persisted until a
terminal state, so multiple simultaneous jobs can exceed the daily budget by a bounded amount.

When one provider serves multiple metered call kinds in a single task (e.g. Amap POI search +
geocoding + route planning), the daily-budget gate must reserve the SUM of all per-task caps
before enabling the provider for that task (`GEOCODE_MAX_PER_TASK + ROUTE_MAX_PER_TASK` = 70
in `geoPipeline`), and all kinds share one serial queue and count into the same
`generations.amap_calls` column.

Representative paths: `apps/server/src/services/quotaService.ts`,
`apps/server/src/generation/orchestrator.ts`, `apps/server/src/generation/geoPipeline.ts`,
`apps/server/src/db/schema.ts`.

## Tiered Estimators with Truthful Source Labeling

When real provider data has a cheaper deterministic fallback (route duration → haversine
heuristic; amap geocode → Nominatim+conversion), model the tiers explicitly and label every
persisted value with its origin (`source: 'amap' | 'heuristic'`, `coordSource`,
`coordSystem`). Consumers (feasibility checks, UI, evals) must be able to see the confidence
level; never present heuristic values as provider data. Degrade silently tier-by-tier — the
generation workflow must never fail because a tier is unavailable.

The heuristic speed model itself is a piecewise contract (`LEG_SPEED_MODEL` in
`packages/shared/src/constants.ts`, consumed by `estimateTransit` in `legs.ts`): distances at
or below the 20km breakpoint use urban speeds (transit 20km/h, drive 30km/h — byte-identical
to the pre-07-18 formula), the excess uses long-haul speeds (transit 45km/h, drive 70km/h,
modeling suburban rail/expressway). Walk never splits. The function must stay continuous and
monotonic across the breakpoint (unit-tested). Calibrate any retune against the golden set:
an intercity segment like 市区→八达岭 (~85km detour) must land in 120-200min, and urban
segments (≤20km) must not change at all — urban drift regresses every city case at once.

Representative paths: `apps/server/src/generation/legEstimator.ts`,
`apps/server/src/integrations/amap/route.ts`, `apps/server/src/integrations/amap/geocoder.ts`,
`packages/shared/src/legs.ts`, `packages/shared/src/constants.ts`.

## Task-Level Circuit Breaker for Cascading Provider Failure

**Scope/Trigger**: any metered provider called serially many times per task (route planning:
up to 30 calls × 10s timeout each) where sustained failure would burn the whole-job time
budget (10min) on doomed retries.

**Contract** (`createRouteBreaker` in `apps/server/src/integrations/amap/route.ts`,
`ROUTE_BREAKER_THRESHOLD = 5`):

- Consecutive *real-attempt* failures (timeout / network / HTTP !ok / status!=1 / no plan)
  reaching the threshold open the breaker for the REST OF THE TASK; subsequent calls skip the
  provider entirely and take the deterministic fallback (`source:'heuristic'`).
- Any success (including a cache hit) resets the consecutive counter.
- Skipped calls (breaker open / missing adcode / budget-rejected) count NEITHER as failures
  NOR against the per-task cap — no request was made.
- Breaker state is per-generation-session memory (created with the geo session), never
  persisted, never cross-task: the next job gives the provider a fresh chance.
- Exactly one `console.warn` at the open transition (prefix `[amap-route]`), stating reason
  and count.

**Why (validated 2026-07-18)**: removing the old 24h negative cache gave failed segments a
retry chance (correct), but under a proxy-black-holed AMAP every retry burned 10.35s serially
— revision rounds + the deterministic fixer re-request failed segments, worst case ~5.2min of
route black hole, and live beijing died at the 10min whole-job timeout (`cancelled`). The
breaker caps sustained-failure cost at ~52s (5×10.35s) while keeping per-pair retries alive
when the provider is healthy.

**Wrong**: negative-caching failures for 24h (pins a transient outage onto a coordinate pair
for a day; revision rounds can never recover real routes). **Correct**: no negative cache +
task-level breaker (fast-fail during sustained outage, full retry freedom across tasks).

**Tests** (`apps/server/src/__tests__/amapRoute.test.ts`): threshold trip stops real requests
and spends no quota with exactly one warn; mid-streak success resets the counter; budget-
rejected and missing-adcode paths count as neither failure nor attempt.

## Geo Result Sanity Firewall (accept-or-reject, never "fix")

**Scope/Trigger**: any externally geocoded coordinate (AMAP or Nominatim fallback) before it
is adopted into the draft. A WRONG coordinate is far more damaging than a MISSING one:
missing only lowers `located` (geo gate catches it); wrong coordinates fabricate absurd legs
(observed live: 上海「人民广场」→嘉兴 108km made every day 17.5h overpacked; chengdu POIs
resolved 372-1962km away produced a 2246min leg). Nominatim's global fuzzy matching on short
Chinese POI names is the dominant source of these mismatches when AMAP is degraded.

**Contract** (`apps/server/src/generation/geoSanity.ts`, wired at the single exit of
`geocodeAll` in `geoPipeline.ts` — results are STAGED, validated, then adopted):

- Reference point resolution: ① city-level geocode of `form.destination`
  (`resolveCityPlace`, memoized, one call shared with the transit adcode fallback);
  ② cross-check against the median center of already-resolved activity coordinates
  (≥ `MIN_LOCATED_POIS` = 3); if both exist and disagree by more than
  `REFERENCE_CONFLICT_KM` (60km), the city geocode itself is deemed drifted and the median
  center takes over (observed live: Nominatim returns the municipal GEOMETRIC center for
  大市域 cities — 重庆's is ~138km from 解放碑, which got the CORRECT downtown lodging
  coordinate rejected until the cross-check landed); ③ neither available → skip validation
  entirely (never block generation on the firewall itself; whole check wrapped in try/catch).
- Thresholds by kind: activities `GEOCODE_SANITY_MAX_KM` = 200km (must tolerate genuine
  far-suburb anchors: 八达岭 60km, 崂山/兵马俑 35km); lodging `LODGING_SANITY_MAX_KM` = 50km
  (a lodging anchor is semantically an in-city area; a wrong one is amplified ×2 legs ×every
  day).
- Rejection = treat as geocode failure (activity stays uncoordinated, lodging stays
  name-only → existing `anchor_missing` soft + no sentinel legs). NEVER attempt to "correct"
  a coordinate. One `[geo-sanity]` warn per rejection with name, coordinate, distance,
  threshold.

**Wrong**: adopting whatever the provider chain returns because "geocode succeeded".
**Correct**: staged adoption behind distance sanity against a self-validated reference point.

**Tests** (`apps/server/src/__tests__/geoSanity.test.ts`): cross-province mismatch rejected /
far-suburb anchor passes / lodging 108km rejected while same-distance activity passes /
reference conflict → median takeover un-rejects a correct downtown lodging / <3 located
points skips validation.

## Truthful Call-Attempt Accounting

Current `stats.calls` means an accepted non-Null task-wrapper call attempt. The wrapper
increments before the underlying source performs its internal cache lookup and before any
network or parsing failure is handled. Therefore:

- a Null-source call counts as zero;
- a call rejected by the task limit counts as zero;
- a cache hit still counts as one;
- a provider attempt that returns an empty result or degrades after failure counts as one;
- the value is not a guaranteed count of successful HTTP requests.

Persist and describe these fields as source call attempts unless the implementation is
redesigned to expose separate cache-hit and network-attempt counters. Do not repeat the old,
inaccurate claim that cache hits are free in current accounting.

Representative paths: `apps/server/src/integrations/amap/poiSource.ts`,
`apps/server/src/integrations/websearch/searchSource.ts`,
`apps/server/src/generation/orchestrator.ts`.

## Failure and Result Semantics

Normal search operations catch provider/network/parse failures and return empty arrays so
the generation workflow can continue with model knowledge. `gotResults` is separate from
`calls`; only a non-empty result marks a source as actually used in trip metadata and the
terminal event. `selfCheck()` may perform a real metered request and must return status rather
than throw through the settings route.
