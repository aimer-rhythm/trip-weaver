# External Integration Guidelines

## Scenario: Editor Route Options

### 1. Scope / Trigger

Editing one adjacent activity pair's transport mode, independently of generation jobs.

### 2. Signatures

- `POST /api/trips/:id/route-options`: `RouteOptionsRequestSchema` → `RouteOptionsResponseSchema`.
- `editor_geo_usage(day TEXT, source TEXT, calls INTEGER)`, composite primary key `(day, source)`; schema and startup migration must match.
- `reserveEditorGeoBudget(source, count)` returns an async finalizer or null.

### 3. Contracts

- Authenticate and check trip ownership before external work. Inputs are two validated draft activity snapshots and destination, allowing unsaved edits; querying never saves the trip.
- Reuse `resolveGeoProvider`; optional `mode` requests a single available/unavailable entry; omitting it returns all four. Never substitute heuristic estimates in selectable options. `refresh: true` bypasses the editor result cache for explicit retries.
- Convert legacy WGS84 inputs to GCJ02. Amap transit resolves endpoint adcodes, then calls routing. Missing city or provider result is unavailable with retry text.
- One active cache-miss request per user; route rate limit is 60/minute to support per-mode prefetch. Reserve one attempt per missing mode plus four possible geocode attempts if Amap transit is missing; finalizer refunds unused attempts, including pre-request skips.
- Cache each result by user ID, provider kind, credential revision, destination, endpoint identities and coordinates/system. Available results live five minutes, unavailable results 30 seconds, bounded to 1200 entries. Result-cache hits happen before concurrency/quota gates and consume no quota; lower adapter cache hits still count as accepted attempts. Credential revision is metadata, never key material.
- Amap route adapter successful cache TTL is five minutes (formerly 24 hours). Driving explicitly uses `strategy=32` (Amap recommended); transit keeps default `0`; adopt the first provider-ranked result. Official reference: `https://lbs.amap.com/api/webservice/guide/api/newroute`.
- Daily budget subtracts persisted editor reservations as well as generation usage. Generation's existing 60s aggregate and running-job approximation remains; crashes can conservatively retain reservations until next day. No new env keys.
- Amap transit geometry joins walking steps and the first bus alternative in segment order; absent geometry remains absent. Do not invent durations when provider duration is missing.

### 4. Validation & Error Matrix

- Missing session → 401; missing or other owner's trip → identical 404; invalid coordinate input → 400.
- Busy user or insufficient budget → 429 without new provider attempts.
- No credential, unsupported mode, missing coordinates/city or failed route → unavailable option; other options survive.
- Database failures remain errors, not successful empty results.

### 5. Good/Base/Bad Cases

- Good: one route becomes drive with its real duration and polyline; other pairs remain untouched.
- Base: Tianditu supports drive/transit while walk/cycle are unavailable.
- Bad: inserting editor calls as fake generations, silently exhausting budget, or labeling a heuristic as Amap.

### 6. Tests Required

- `routeOptions.test.ts`: partial failure, source labels, missing coordinates/city, WGS84 and unsupported modes.
- `amapRoute.test.ts`: transit geometry and missing-duration rejection.
- `node --import tsx scripts/verify-route-options.mts`: dedicated local PostgreSQL at port 18797, disposable database per run; asserts migrations, ownership, validation, quota atomicity/refund, persistence, free cache hits under quota exhaustion, credential/coordinate invalidation and TTL expiry. Upstream fetch is mocked.

### 7. Wrong vs Correct

- Wrong: check remaining budget then independently issue uncounted editor queries.
- Correct: atomically reserve, increment accepted attempts through the provider callback, refund the unused reservation in `finally`.

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
`apps/server/src/integrations/tianditu/route.ts`, `apps/server/src/integrations/tianditu/geo.ts`,
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

- Task-local research POI coordinates follow this same exit, including their adcodes. A
  rejected reused point gets the ordinary lookup chain and another validation; never bypass
  the firewall because the data came from `search_pois`. Unchanged estimated points skipped
  by incremental resolution do not enter the median reference pool. See the
  [P0 generation contract](./generation-guidelines.md#scenario-research-place-reuse-and-local-planner-revisions-p0).
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
- adopting an already-counted research coordinate in `geocodeAll` makes no new geocoding
  attempt, so it adds zero to geo counters; the original research attempt remains counted;
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

## Scenario: Swappable Map Provider (Amap / Tianditu)

### 1. Scope / Trigger

- Trigger: adding a second geographic provider, or touching anything that decides which provider
  supplies POI search, route planning, or geocoding. Changed API payload, DB column, and env keys.
  **Revised 09-25 (second decision): the two vendors are COMPLEMENTARY, not a single-switch choice.**
  Tianditu owns POI search; Amap owns route planning + geocoding (with Tianditu as the fallback when
  `AMAP_KEY` is absent). `MAP_PROVIDER` was removed.
- Goal: each capability resolves its own vendor without the upper layers or the frontend noticing,
  and no capability may silently consume the other vendor's daily budget.

### 2. Signatures

- Env (`apps/server/src/env.ts`): `AMAP_KEY`, `TIANDITU_KEY`, `TIANDITU_DAILY_BUDGET` (default 150),
  `AMAP_DAILY_BUDGET`. **`MAP_PROVIDER` no longer exists** — do not reintroduce a site-level
  either/or switch; the capabilities are complementary and each key independently enables its chain.
  Both keys are expected to be configured. Missing `AMAP_KEY` → route/geocode fall to Tianditu;
  missing `TIANDITU_KEY` → POI search returns empty (no Amap fallback).
- Facade (`apps/server/src/integrations/geoProvider.ts`) — the ONLY module upper layers may import:
  ```ts
  resolveGeoProvider(userId: string): Promise<GeoProvider>   // route + geocoding chain
  resolvePoiSourceForUser(): ResolvedPoiSource                // POI search, ALWAYS Tianditu
  poiBudgetRemaining(): Promise<number>                       // Tianditu daily budget
  createNullGeoProvider(): GeoProvider

  interface GeoProvider {
    readonly kind: 'amap' | 'tianditu' | 'null';
    readonly enabled: boolean;                       // false = no usable credential
    geocodeActivity(name, city, tryAcquire): Promise<GeocodedPlace | null>;
    createRouteBreaker(): RouteBreaker;               // per generation task
    budgetRemaining(): Promise<number>;              // route/geocode chain budget
  }
  ```
  `createPoiSource` is NOT on `GeoProvider` — POI search is not part of this chain.
  `GeoSession.providerKind()` reports which vendor the route/geocode chain actually used, so the
  usage columns can be attributed per chain instead of guessed from one switch.
- Shared contracts (`apps/server/src/integrations/geoContracts.ts`): `GeoPoint`, `GeocodedPoint`,
  `GeocodedPlace`, `GeocodeOrigin` (`'amap-poi' | 'amap-geocode' | 'tianditu' | 'nominatim'`),
  `RouteEstimate`, `RouteOpts`, `RouteBreaker`, `SourcedPoi`, `PoiKind`, `PoiSource`.
- DB: `generations.tianditu_calls INTEGER NOT NULL DEFAULT 0` — must exist in BOTH
  `db/schema.ts` and `db/migrate.ts` (create-table column + `ADD COLUMN IF NOT EXISTS`).
- Shared constants: `LEG_SOURCES` and `DATA_SOURCE_KINDS` each gained `'tianditu'`. Persisted leg
  `source` and trip `dataSources` must carry the real vendor, never a stand-in.
- Settings API: `GET /api/settings/sources-status` returns `{ provider, geo, websearch }`
  (was `{ amap, websearch }`).

### 3. Contracts

- **Coordinate contract is GCJ-02 everywhere above the adapters.** Tianditu uses CGCS2000
  (≈WGS-84): outbound calls run `gcj02ToWgs84`, inbound values run `wgs84ToGcj02`, and the
  conversion stays entirely inside `integrations/tianditu/*`. `GeocodedPlace` / `RouteEstimate`
  are already GCJ-02, so no caller changes when the provider switches.
- **Asymmetric fallback by capability — do not unify it.** Route planning + geocoding are
  **Amap-first** (personal key → site key → Tianditu → Null). POI search is **Tianditu-only**: its
  unavailability (no `tk`, no 地名搜索 permission, request failure) yields an empty result set and
  the research agent falls back to model knowledge — it must NOT fall back to Amap, because Amap's
  `v5/place/text` is shared with the geocoding primary path and would re-squeeze the quota that this
  split just freed.
- **The two budget gates are separate and must stay separate.** `provider.budgetRemaining()` gates
  `geoPipeline`'s per-task reservation (route + geocoding); `poiBudgetRemaining()` (always Tianditu)
  gates the orchestrator's POI-source injection. One shared check would let an exhausted Tianditu
  search budget disable Amap route planning.
  Defaulting (variable unset) is derived from key presence: `AMAP_KEY` → amap, else `TIANDITU_KEY`
  → tianditu, else Null. Existing deployments behave byte-identically.
- **Route-mode coverage differs by vendor, and Tianditu's endpoints/params are NOT what secondary
  sources claim — cross-check the official doc pages AND probe endpoint existence.** The doc pages are
  server-rendered (`/server/drive.html`, `/server/bus.html`, `/server/search.html`); probing with a
  length-valid but unusable `tk` tells existence apart (a real endpoint answers `403 301001 非法key`,
  an absent one `404` + HTML). Result: only `/geocoder`, `/drive`, `/transit`, and `/v2/search` exist;
  `/walk`, `/bus`, `/search`, `/transfer`, `/busline`, and every `/v2/{drive,walk,bus,transit}` return
  404. Therefore:
  - `drive` = `/drive` + `style=0`, postStr `{orig,dest,style}`
  - `transit` = `/transit` with **`type=busline`** and postStr `{startposition,endposition,linetype}`
    (lowercase keys as in the working official example, NOT the doc table's camelCase) — and **no city
    parameter**: Tianditu infers it from coordinates, so `RouteOpts` is unused on this chain.
  - `walk` and `cycle` have no usable endpoint at all → pre-request skip → heuristic (see the
    walking bullet below). Note `style=3` is NOT walking despite the doc claiming it.
  `ROUTE_ENDPOINTS` is the single table for this, and the breaker's `skip` derives from it so the two
  cannot disagree. Do NOT trust blogs/tutorials: they uniformly document `/walk` and `/bus`.
- **Response shape and units differ per endpoint, and only live measurement settles them.** Measured
  with a real `tk` (09-25): `/drive` returns **XML** (`<distance>` in **km**, `<duration>` in
  **seconds**, `<routelatlon>` as the whole polyline), `/transit` returns **JSON** (`segmentDistance`
  in **metres**, `segmentTime` in **minutes**). The docs omit every unit; guessing seconds for
  `segmentTime` produces 804 km/h. Every parsed estimate still passes an implied-speed gate
  (`1`–`150` km/h) — out-of-range means a wrong unit assumption, so it returns null instead of writing
  a 60×-off duration into the itinerary.
- **Tianditu has no walking route planning — `style=3` is a driving shortcut, not a pedestrian mode.**
  Measured with a real `tk`: `style` 0/1/2 return **identical** results, and `style=3` is a
  shorter-but-slower **driving** route (0.9 km in 97 s = 33 km/h; 17.3 km in 27 min = 38 km/h; true
  walking is 11 min and 4 h). Wiring `walk` to it handed walking legs driving durations — 10× under on
  a 15 km leg — and those values PASSED the speed gate, so the bad numbers reached the timeline. That
  is strictly worse than heuristic, so `walk` was removed from `ROUTE_ENDPOINTS`. Generalization:
  a vendor silently substituting a different transport mode is the worst failure shape, because no
  plausibility gate can catch it. Verify the mode, not just the numbers.
- **Tianditu transit's JSON nesting is a trap; verify it layer by layer.** `results[]` → `lines[]` is
  **up to 5 mutually exclusive complete itineraries** (doc: 「数组中每个对象为一条由起点到终点的公交规划线路」),
  so exactly one is taken — summing all five yields 53 km in 4 min. Within one line, `segments[]` are
  serial, but `segmentLine[]` within one segment are **parallel alternatives** (measured: 特12外 and
  44外 side by side) — taking all of them doubles that leg's duration. Negative values mark an unusable
  segment (measured: the preferred metro itinerary is entirely negative), so a plan with no usable
  amounts falls through to the next one. No polyline is produced: joining transfer sub-routes would
  draw a fake straight line across the city.
- **Tianditu POI search derives its own `mapBound`.** `queryType=1` (普通搜索) REQUIRES `mapBound`
  (measured: omitting it returns `infocode 2003 缺少参数：mapBound`), but callers only supply a city
  name. The adapter geocodes the region once through the same `tk` and takes ±0.5° around the
  centre, cached per region for 24 h. Consequence to keep in mind: one extra geocoder request per
  new region per process, which is NOT counted in `generations.tianditu_calls` — the persisted
  counter remains "accepted `searchPois` attempts", not a strict HTTP-request count (see
  Truthful Call-Attempt Accounting). Region resolution failure returns `[]` without issuing the
  search request.
- **Tianditu transit parses one itinerary, not every itinerary.** JSON only (measured); the XML-shape
  fallback was removed once a real `tk` proved the format.
- **Provider-aware labels.** Leg `source`, trip `dataSources`, the timeline banner, the usage line,
  and the settings self-check card must all name the vendor that actually ran.
- Frontend map tiles are NOT part of the switch: Leaflet renders Amap tiles, which share the
  GCJ-02 frame with stored coordinates. Pointing the basemap at Tianditu (WGS-84) would offset
  every marker by ~500 m.

### 4. Validation & Error Matrix

- `AMAP_KEY` empty → one `console.warn` at import; the route/geocode chain falls to Tianditu, then
  Null. `TIANDITU_KEY` empty → one warn; POI search returns `[]` and **no Amap fallback** happens.
  There is no `MAP_PROVIDER`.
- Tianditu geocoder `status !== '0'` (it is a STRING), HTTP failure, or unparsable location →
  fall through to Nominatim with `origin: 'nominatim'`.
- Tianditu devolves errors through BOTH the HTTP status and a JSON body, and the codes are NOT
  interchangeable — surface the body (use `describeHttpFailure` in
  `integrations/tianditu/http.ts`), never a bare `HTTP <status>`: `400 + 308011` = a parameter or
  **`tk` length** is non-compliant; `400 + infocode 2003` = a required parameter is missing
  (`mapBound`); `403 + 301001 非法key` = valid-length but unusable key; `418` = CloudWAF HTML block
  page (typically an empty `tk`). Ordering matters for diagnosis: the key is validated BEFORE the
  parameters, so a placeholder key can never reveal a parameter problem.
- Tianditu search `status.infocode !== 1000` (e.g. permission not granted) → `searchPois` returns
  `[]`; `selfCheck()` reports `ok:false` with the vendor message. Missing `pois` field → `[]`, ok.
- Drive/walk XML lacking `<distance>`/`<duration>`, or bus segments summing to ≤ 0 → null → heuristic.
- Implied speed outside 1–150 km/h → null → heuristic (never a repaired number).
- Breaker `skip` predicate is true (walking/cycling — no usable endpoint, budget refused, breaker open) →
  null, zero failures, zero quota consumed.
- 5 consecutive real route failures → breaker opens for the rest of the task, exactly one warn.
- Daily budget below the per-task reservation → Null provider for the whole task (no calls).

### 5. Good / Base / Bad Cases

- Good: both keys configured — POI search hits Tianditu (`tianditu_calls` grows), route planning +
  geocoding hit Amap (`amap_calls` grows), stored coordinates stay GCJ-02, and the settings card
  reads 「地点搜索（天地图）」＋「路线与地理编码 … 当前走高德」.
- Base: `AMAP_KEY` present, no `TIANDITU_KEY` — route/geocode behave exactly as before; POI search
  returns empty and research falls back to the knowledge base + model knowledge.
- Bad: routing the POI source through Amap as a fallback (re-squeezes the shared `v5/place/text`
  quota this split exists to protect); one shared budget check for both chains; attributing Tianditu
  calls to `amap_calls`; giving Tianditu transit an adcode (it takes none);
  emitting a Tianditu `drive` estimate for a `cycle` request; trusting the raw `<distance>` unit;
  putting `walk` back on `/drive?style=3` (driving durations that pass the speed gate).

### 6. Tests Required

- `apps/server/src/__tests__/geo.test.ts`: `gcj02ToWgs84` inverse — known vector within 1e-5 and
  forward/inverse round-trip within 1e-6 across five cities; out-of-China passthrough.
- `apps/server/src/__tests__/tianditu.test.ts` (all mock-fetch, no real `tk`): WGS→GCJ inbound
  conversion; `ds` is a JSON string with the city prefix; geocoder failure → Nominatim; null key and
  refused `tryAcquire` skip the vendor; drive km/s → m/min with per-point polyline conversion;
  `transit` maps to `/transit?type=busline` with `startposition`/`endposition`/`linetype`, picks a
  single itinerary out of `lines[]`, takes only the first usable `segmentLine[]` alternative, reads
  `segmentTime` as **minutes**; `walk` and `cycle` both return null with zero requests; speed-gate
  rejection; missing-XML null;
  24 h cache hit; bus positive-only summing / all-negative → null / no polyline;
  breaker skips walking and cycling without counting failures; 5 failures trip with the `[tianditu-route]` prefix;
  POI field gaps left empty, `mapBound` present and centred on the geocoded region, region resolution
  failure → `[]` with no search request, `infocode` failure → `[]` + `ok:false`, missing `pois` → ok,
  HTTP failure message carries the vendor body, `resolveTiandituPoiSource(null).kind === 'null'`.
- `apps/server/src/__tests__/amapRoute.test.ts`: the same breaker contract via
  `createAmapRouteBreaker(apiKey)` — threshold trip, mid-streak success reset, skip paths.
- `scripts/verify-c2.mjs`: the migration assertion must list `tianditu_calls`, and the Null-source
  row must still record zero calls in BOTH provider columns.
- `scripts/verify-amap-settings-browser.mjs` / `verify-websearch-settings-browser.mjs`: their
  `sources-status` mocks must serve the `{ provider, geo, websearch }` shape.

### 7. Wrong vs Correct

#### Wrong

```ts
// Upper layer reaching into one vendor, and letting a structural gap look like an outage.
import { geocodeActivity } from '../integrations/amap/geocoder';

if (mode === 'transit' && (!city1 || !city2)) return heuristicLeg();   // Tianditu can never pass this

const route = await routeEstimate(apiKey, from, to, mode);
leg.source = 'amap';                                                    // lie when Tianditu ran
```

## Attraction Cover Sources (stored library → Pexels → Amap POI photos → Wikimedia)

**Scope/Trigger**: an `attraction` candidate reaches `add_candidate`, or the cover order/URL
acceptance/budget rules change. Four sources serve one `coverUrl`; the order is fixed and each
source must degrade to the next. Full stored-cover manifest/route/deploy contract lives in the RAG
retrieval guidelines under *Attraction Cover Images*.

**Contract** (`createStoredCoverLookup` in `apps/server/src/generation/storedCover.ts`,
`createPexelsCoverLookup` in `apps/server/src/integrations/pexels/cover.ts`,
`createAmapPoiPhotoLookup` in `apps/server/src/integrations/amap/poiPhotos.ts`,
`createWikiCoverLookup` in `apps/server/src/integrations/wikimedia/cover.ts` — all wired in
`generation/orchestrator.ts`):

- Order: **stored library** (`payload.coverImage` → `MEDIA_BASE_URL`, default `/media`) → **Pexels**
  (keyword search, strict textual match) → **Amap POI `photos`** (keyword search, name match) →
  **Chinese Wikipedia** (name + 2 km coordinate check) → empty. Only `attraction`. Food and hotel are
  never queried.
- Why that order: the stored library is real photography but only ships for Beijing/Guangzhou/Hangzhou;
  Pexels covers any city but its alt-text gate measures ~45–50% hit rate; Amap is the only source that
  is both reachable from mainland China and reliably tied to the exact POI — and it burns the scarce
  search quota, so it goes last among the "has an image" sources. `upload.wikimedia.org` is blocked in
  mainland China, so the wiki lookup is an overseas/proxy fallback only.
- Pexels has no coordinates. The accuracy gate is textual: a result is accepted only when its `alt`
  or photo-page slug contains the place's normalized key **or the core key** — the name with a generic
  tail (`村/街/路/寺/塔/山/湖/园/公园/景区/...`) stripped, keeping at least 2 characters. That second
  form is what lets «龙井村» match alt «杭州龙井茶园», while «虎跑公园» still rejects an alt that merely
  says «公园» (its core is «虎跑»). The candidate pool is `per_page=15` — many correct photos sit past
  the first five. No match → `null` → fall through. Never take "first result": a generic lake photo must
  not be captioned as a named scenic spot. Measured on 20 real names: strict gate 9/20, relaxed gate
  11/20, with no gate regression (nothing that used to pass now fails).
- Amap gate is two-stage, and both must pass:
  1. **Name**: equal to, end with, or contain the place's normalized key segments **in order**
     («杭州西湖风景名胜区» → ends with «西湖»; «西溪国家湿地公园» → segments 西溪 / 湿地 appear in
     order, so «西溪湿地» matches). `endsWith` rather than `includes` for the plain case so «西湖区××»
     cannot pass as «西湖».
  2. **Type**: the first segment of the POI's `type` must be in
     `['风景名胜', '体育休闲服务', '科教文化服务', '购物服务']`; a missing type is rejected. This is a
     whitelist on purpose — searching «龙井村» returns «龙井村(公交站)» with photos, and «宋城» returns road
     entries; without it those images get captioned as scenic spots.
- Images always get rewritten to `https://` — Amap mixes http and https, and an http image on an
  https page is blocked as mixed content.
- Amap quota is separate and much scarcer than the geocode chain's: `v5/place/text` belongs to
  「基础搜索服务」 (personal: 5,000/month) while `v3/geocode/geo` belongs to 「基础LBS服务」
  (150,000/month). Hence: only after the first two sources miss, **≤3 calls per generation**, a shared
  `amapQueue`, a 24 h cache, and a process-level 40/24 h window. Real call counts are exposed as
  `calls` and added into `generation.amap_calls` by `providerCallCounts()`.
- **A hit is written back** to `canonical_places.payload.amapPhoto` (full https URL) via
  `saveAmapPhoto(city, name, url)` — matched by normalized key, never overwriting an existing value,
  failures only warn. `createStoredAmapPhotoLookup(city)` reads it back inside the Amap stage (same
  position in the order, NOT moved ahead of Pexels), so a place that ever resolved costs nothing
  afterwards. Negative results are NOT written back — a miss must stay retryable.
- URL acceptance differs per source: Pexels, Amap and Wikipedia must be `https://`; stored covers may
  also be a same-origin path starting with `/`.
- Budgets are separate and do not share counters: Pexels 8 requests per generation + a process-level
  180/hour window (its published limit is 200/hour; restart resets the window); Amap POI photos ≤8 per
  generation + 100 per 24 h; Wikipedia 8 per generation, serial with ≥1 s spacing.
- Pexels API terms require a visible link back to Pexels wherever its photos are shown. The frontend
  renders `Photos provided by Pexels` (`PexelsCredit` in `apps/web/src/components/PoiCard.tsx`) on the
  generation page, the candidate drawer, and the trip editor — it renders nothing when no Pexels URL
  is present in the list.
- Any failure (missing key, timeout, non-2xx, budget exhausted, no textual match) returns `null` and
alogs one warn at most; nothing throws into generation. A `null` from a confirmed miss is cached for
  24 h, a transport failure is not.
- A missing key, a failed `canonical_places` query, or a failed file fetch all degrade to `null`; the
  frontend falls back to the category icon.
- Accept an article only when it has a thumbnail AND coordinates within 2 km of the place. The
  place coordinate is GCJ-02 and is converted with `gcj02ToWgs84` before comparing.
- Coordinate source: the research-phase capture (`search_pois`) first, then `loadPlaceFacts` for
  knowledge-base candidates. Names match through `normalizePlaceKey` so 「故宫」hits 「故宫博物院」.
- The hit is written to the candidate's `coverUrl` only. It is NOT written back to
  `canonical_places`. The model's own `coverUrl` argument is ignored.
- A confirmed miss (no usable article) is negative-cached 24 h. A transport failure (timeout, non-2xx)
  is NOT cached, so the next generation retries.
- One generation makes at most 8 real lookups, serial, ≥1 s apart, 8 s timeout. Anything past the cap
  returns null without a request. Every failure returns null and logs one `[wiki-cover]` warn; it
  never throws into generation.

**Why not the nearest geotagged file**: measured on Beijing — the closest file to 故宫 was an interior
pavilion, and the closest to 鸟巢 was an Olympics ceremony photo. Title search plus a coordinate check
hit 9 of 10.

**Tests** (`apps/server/src/__tests__/wikimediaCover.test.ts`, `pexelsCover.test.ts`,
`amapPoiPhotos.test.ts`, `placeLookup.test.ts`, `storedCover.test.ts`): `pickCover` keeps the nearest
in-range article and drops the rest; the adapter caches both hits and confirmed misses; HTTP failure
returns null and is not cached; the 9th lookup makes no request; a food candidate and a candidate with
a stored cover never call the lookup; a stored `/media/...` path is accepted and skips the wiki
request; `mediaUrl` joins keys against `/media`, an absolute CDN base, and an empty base. Pexels:
alt-based acceptance (full name and generic-tail-stripped core, e.g. «龙井村» → alt «杭州龙井茶园») and
normalized-key alignment, a generic alt («城市公园里跑步») not fooling «虎跑公园», non-https and empty
`src` rejected, no request
without a key, cache and negative cache, 429 not cached, per-generation cap. Amap: name-suffix
gate («西湖区××» rejected, «西溪国家湿地公园» accepted for «西溪湿地»), type whitelist (公交站/路名/餐厅
rejected, missing type rejected), http→https rewrite, cache/negative cache, `status≠1` not cached, per-
generation cap, `calls` only counts real requests. `placeLookup.test.ts` asserts the four-stage
short-circuit order (stored hit skips Pexels and Amap; Pexels hit skips Amap; Amap hit skips the wiki).
Both new suites must stay free of DB imports.

#### Correct

```ts
// Upper layer only knows the facade; the adapter owns credentials, units, coordinates,
// and which modes it can actually serve.
import { resolveGeoProvider } from '../integrations/geoProvider';

const provider = await resolveGeoProvider(userId, destination);
const leg = await provider.createRouteBreaker().estimate(from, to, mode, { city1, city2 }, tryRoute);
leg.source = provider.kind;   // 'amap' | 'tianditu'
```
