# Generation Jobs and SSE Guidelines

## Boundary and Lifecycle

`apps/server/src/routes/generations.ts` owns HTTP admission, quota/conflict responses, job
snapshots, SSE transport, and cancellation requests. `apps/server/src/generation/orchestrator.ts`
is the single generation entry point and owns the research, planning, review, persistence,
usage recording, and terminal outcome sequence.

The route starts `runGeneration` without awaiting it and immediately returns 202 with a job
ID. Always attach a rejection handler that logs an otherwise unhandled detached failure.
The orchestrator must catch normal workflow failures and converge the job to exactly one of
`done`, `error`, or `cancelled`.

Representative paths: `apps/server/src/routes/generations.ts`,
`apps/server/src/generation/orchestrator.ts`, `apps/server/src/generation/jobManager.ts`.

## In-Memory Job Model

Jobs, running-job ownership, listeners, event buffers, provider caches, and quota aggregate
caches are process memory. The job manager permits one running job per user, keeps the latest
512 events, and removes terminal jobs after 30 minutes.

These guarantees are single-process only:

- restart loses running and recently finished job state;
- another replica cannot read, cancel, or stream a job created elsewhere;
- per-user running-job exclusion is not cluster-wide;
- the event ring is recovery convenience, not durable event storage.

Do not deploy multiple active replicas without replacing these maps with shared durable job,
lock, and pub/sub infrastructure or accepting broken semantics.

## Ownership and Cancellation

Every snapshot, SSE subscription, and cancellation lookup passes both `jobId` and the
authenticated `userId` to `getJob`; missing and non-owned jobs return the same 404.

Cancellation calls the job's `AbortController`. The orchestrator observes the signal,
publishes `job_cancelled`, records a `cancelled` generation row, and does not consume the
successful-generation quota. Publish the authoritative in-memory terminal state before a
later audit write can fail.

The `job_cancelled` event carries `reason: 'user' | 'timeout'` so the client can tell a
manual cancel from the whole-job timeout. The cancel route sets `job.cancelReason = 'user'`
before aborting; the orchestrator's timeout timer sets `job.cancelReason = 'timeout'`. The
field is optional in the shared type so legacy buffered events replay cleanly, and missing
`reason` renders as a user cancel on the client.

Representative paths: `apps/server/src/routes/generations.ts`,
`apps/server/src/generation/jobManager.ts`, `apps/server/src/services/quotaService.ts`.

## SSE Contract

- Use `text/event-stream`, disable transformation/buffering, and keep the connection alive.
- Assign monotonically increasing event IDs per job.
- Replay buffered events after `Last-Event-ID` or the `lastEventId` query fallback, then
  subscribe to live events.
- Send heartbeat comments every 25 seconds.
- End the stream after `job_done`, `job_error`, or `job_cancelled`.
- On connection close or write failure, unsubscribe and clear the heartbeat without affecting
  generation.

Event payloads are shared contracts in `packages/shared/src/types.ts`. Preserve compatibility
fields until coordinated shared/web removal. Current `xhsEnabled`, `xhsCalls`, and `usedXhs`
are historical fields with documented compatibility meanings.

Eval harness collection semantics (eval snapshot v2): `usage` events are cumulative — the
last one carries final totals. `phase_end.durationMs` must be keyed `<phase>#<round>` (plan
and review can span multiple rounds). `candidate` events carry `ResearchPoi` without
coordinates (Amap protocol 3.5), and persisted trips strip `placeName`/`poiId` — pool
adoption metrics therefore match by name, extracting meal lookup names
(`午餐｜春熙路 · 川菜` -> `春熙路`, the same rule geoPipeline uses). New metric dimensions
enter reports as observational fields first and only join the gate after proving stable.

Representative paths: `apps/server/src/routes/generations.ts`,
`apps/server/src/generation/jobManager.ts`, `packages/shared/src/types.ts`.

## Scenario: Replay-Stable Generation Timing

### 1. Scope / Trigger

Apply this contract when adding generation performance diagnostics, changing SSE lifecycle
events, or rendering elapsed time in the generation timeline. Timing is task-local operational
data: it is visible during the in-memory job lifetime and in server logs, but is not persisted
into `Trip` or a performance-history table.

### 2. Signatures

- Every `GenerationEvent` may carry `at?: number` (Unix milliseconds).
- `phase_end`, `tool_end`, and terminal events may carry `durationMs?: number`.
- `GenerationPerformance(job.createdAt)` records phase keys (`research:1`, `plan:1`, etc.)
  and aggregates tool/task keys by count, total, and maximum duration.
- `runGeneration(job, form, cfg, logger?)` accepts the Fastify/Pino logger from the route.

### 3. Contracts

- `jobManager.emit` fills a missing `at` on every emitted event. Producers may supply an
  earlier authoritative time, such as `job_start.at = job.createdAt`.
- The server computes completed durations once. The web client uses those fixed values after
  completion and uses its local clock only to animate an item that is still running.
- Deterministic post-passes reuse `tool_start` / `tool_end` with stable non-sensitive tool keys;
  do not add a second progress event family.
- Terminal logs contain only `jobId`, status, total/phase/task milliseconds, token counts, and
  provider call-attempt counts. Never log destination, form data, prompts, tool args, provider
  responses, credentials, or settings objects.
- Timing fields stay optional so old buffered/manual recovery events remain readable.

### 4. Validation & Error Matrix

- Old event has no `at` / `durationMs` -> render the existing timeline without that duration.
- End event has no explicit duration but both endpoint timestamps exist -> derive a non-negative
  duration from the timestamps.
- Task ends as `error` or `cancelled` with active work -> terminal log includes active phase/task
  elapsed time; the SSE terminal event still carries fixed total duration.
- Optional deterministic pass throws -> emit an errored timed tool item, then preserve the
  pass's existing degrade-or-cancel behavior.
- Browser refresh -> replayed completed durations must be identical to the pre-refresh values.

### 5. Good / Base / Bad Cases

- Good: a running route pass increments once per second, then freezes at the server-provided
  duration; the terminal log identifies it as the slowest task without exposing inputs.
- Base: a legacy event stream has no timing fields and looks exactly as it did before timing was
  added.
- Bad: the web client stamps receipt time and recomputes completed durations after replay, or the
  server logs the full form/tool arguments to explain a slow task.

### 6. Tests Required

- Unit-test phase/task aggregation with an injected deterministic clock, including active work.
- Unit-test `jobManager` timestamp filling and terminal duration for a non-success outcome.
- Unit-test timeline reconstruction for explicit timing and legacy missing fields.
- Run `npm run typecheck`, all server tests, `npm run build -w apps/web`, and
  `node scripts/verify-c2.mjs` to cover the shared union, SSE replay, cancellation, and full flow.

### 7. Wrong vs Correct

```typescript
// Wrong: receipt time changes after reconnect and leaks arguments into diagnostics.
const startedAt = Date.now();
console.info({ form, args, durationMs: Date.now() - startedAt });

// Correct: server lifecycle events are authoritative and logs use stable classifications only.
emit(job, { type: 'tool_end', toolCallId, tool, durationMs, at, /* existing safe fields */ });
logger.info({ jobId: job.id, status, phases, tasks, usage }, 'generation timing summary');
```

## Deterministic Post-Pass (Mechanical Work Out of the LLM Loop)

Bulk mechanical work with deterministic rules — batch geocoding, transit-leg computation —
must NOT be delegated to agent tool loops (burns turns, unreliable on weak models). Run it as
a code-level pass in the orchestrator.

**Timing (M0-A shift)**: the geoPipeline pass runs INSIDE each plan⇆review round — after the
planner phase and BEFORE the reviewer phase — not once after the whole loop. This is what lets
the feasibility engine (below) simulate on real resolved coordinates/legs and hand the reviewer
a code-computed violation report. Revision rounds therefore re-run resolution incrementally:
`geocodeAll` skips already-`geocoded` activities, and `computeLegs` reuses a session-level
`legMemo` (keyed by endpoint ids + rounded coords) so unchanged pairs do NOT spend the ROUTE
cap twice. Verify `GEOCODE_MAX_PER_TASK` / `ROUTE_MAX_PER_TASK` still hold across rounds when
changing this.

- Progress goes through the existing `thought` sink events (e.g. `正在解析坐标与通勤 (12/18)`);
  do not invent new SSE event types for internal passes.
- Degradation inside the pass must never fail the job; skip items truthfully instead of
  fabricating data.
- Agent tools remain available for judgment calls only (e.g. `geocode_place` for ambiguous
  key places); the pass skips items the agent already resolved (`coordSource==='geocoded'`).

Representative paths: `apps/server/src/generation/geoPipeline.ts`,
`apps/server/src/generation/orchestrator.ts`.

### Feasibility Engine (M0-A: LLM proposes, solver disposes)

Itinerary feasibility is computed by pure code, not judged by the LLM. `simulateDay` /
`simulateTrip` in `packages/shared/src/feasibility.ts` are IO-free pure functions (no server,
DOM, or network imports) so the same engine serves server generation, future eval harnesses,
and the web client. They take a `Trip`/`TripDay` and return
`FeasibilityReport { dayReports, violations }` where each `Violation` has
`code`, `severity: 'hard'|'soft'`, `dayIndex`, optional `activityId`, `message`, and optional
`detail`.

Violation codes and severities (thresholds live in the named `FEASIBILITY_THRESHOLDS`
constant, tuned to commonsense defaults, adjustable in one place):

- `transit_infeasible` (hard): a leg's duration exceeds the time gap between two timed
  adjacent activities — physically cannot fit.
- `overpacked` (hard): day total (activity occupancy + transit) > 14h. Also (soft): > 8
  activities, > 15km cumulative walking, or < 10% time-window buffer.
- `backtrack` (soft): three adjacent coordinates turn back > 90° AND the back-jump > 2km.
- `anchor_missing` (soft): lodging is named but its coordinates are unresolved. Suppressed
  until resolution has been attempted (`simulateTrip` infers this from any `geocoded` activity
  or any day having legs) so the pre-geoPipeline planner gate does not emit un-actionable noise.
- `closed_on_arrival` (hard, enabled 09-22-opentime): the activity carries Amap `openTime`
  text (auto-attached by `add_candidate`, never transcribed by the model) and the text declares
  closure on the day's weekday (`isClosedOnDate` in `packages/shared/src/openHours.ts`).
  `DaySimContext.date` is the only input; `simulateTrip` derives it from `trip.startDate +
  dayIndex`. No `openTime` or no `startDate` -> the check is skipped entirely (never block on
  missing data; never fabricate open hours). The scheduling pass avoids closed days at
  segment->day assignment time (whole-segment move, preserving chain contiguity); this
  violation is the backstop when avoidance is impossible.

Degradation is truthful (never fail the job, never fabricate): an activity missing coordinates
skips that segment's transit/backtrack checks; a missing leg is estimated with `estimateTransit`
(the shared speed model, also backing `legEstimator`) and the violation `detail` is labeled
low-confidence.

Three reuse points, all via `@tripweaver/shared`:

1. **Planner** — the `check_feasibility` tool returns `describeFeasibility(report)`; `submit_plan`
   gates on HARD violations only (soft passes through). Because `submit_plan` fires BEFORE that
   round's geoPipeline (draft has model-filled coords but no legs), the gate judges on best
   available data with haversine fallback, then bounded self-heal: after `MAX_HARD_BLOCKS`
   consecutive hard blocks it lets the plan through rather than looping into `maxTurns` failure.
   The orchestrator's post-geoPipeline report on real legs is the authoritative judgment.
2. **Reviewer** — `reviewerUserPrompt(form, round, describeFeasibility(report))` appends the
   engine report so the reviewer judges structural issues against computed facts, not vibes.
3. **Degrade-not-fail** — if revision rounds exhaust with hard violations still present,
   `feasibilityReviewNotes(report)` folds them (and soft ones) into `reviewNotes` truthfully and
   the job STILL converges to `done`. Feasibility problems are a gate/hint, never a thrown error
   (generation-never-fails principle).

**Common Mistake: persisting a pre-review feasibility snapshot.** The reviewer keeps
`update_activity`/`remove_activity` and mutates the same draft in place (trimming an overpacked
day is its designed case). Notes folded into the persisted trip must be recomputed from the
FINAL draft (`draft.feasibility()` after the review phase), not the per-round snapshot handed to
the reviewer prompt — otherwise the notes claim a violation the reviewer just fixed, or miss one
it introduced, breaking the "truthful" contract. Found as a Medium/High issue in
`07-13-feasibility-engine`.

Representative paths: `packages/shared/src/feasibility.ts`,
`apps/server/src/generation/tools/draftTools.ts`, `apps/server/src/generation/prompts.ts`,
`apps/server/src/generation/orchestrator.ts`, `apps/server/src/__tests__/feasibility.test.ts`.

### Long-Haul Day Discipline (M0-B: prevent + deterministically repair)

Far-suburb anchors (八达岭式) mixed with downtown activities on one day were the last hard
blocker in the golden set. Two code layers bracket the LLM (planner prompts alone were
insufficient — the planner assigns `dayIndex` before any coordinates exist):

1. **Pre-planning intel (prevention)** — during research, `search_pois` coordinates are
   captured into task-memory (`ResearchOutcome.locations`; NOT persisted, NOT on
   `ResearchPoi` schema — Amap ToS + schema minimalism). Before the planner phase,
   `classifyLongHaulPois` (`apps/server/src/generation/longHaul.ts`) computes each candidate's
   `estimateTransit` duration to the candidate pool's median center and tiers it against
   `LONG_HAUL_THRESHOLDS` (shared constants: ≥60min long-haul, ≥90min exclusive-day).
   Tiered intel is consumed by CODE, not by a prompt: `classifyLongHaulPois` feeds
   `applyDeterministicSchedule`'s `longHaul` input and the scheduling layer enforces the
   exclusive-day discipline structurally. (The old `plannerUserPrompt` injection died with the
   LLM planner in 09-21; the prompt builders were deleted in 09-25.)
2. **Deterministic fixer (repair)** — `longHaulFixer.ts` runs INSIDE each plan⇆review round,
   after geoPipeline+feasibility and before the reviewer. Trigger: hard
   `transit_infeasible`/`overpacked` on a day that has an exclusive-tier long-haul activity
   (re-identified from REAL resolved coordinates, not the name-keyed research intel) plus
   mixed-in urban activities (>45min from the long-haul point AND closer to the trip median
   center). Action: move urban activities out (`draft.moveActivityToDay`, also used by the
   revision-only `move_activity` tool) to the lightest-load day with a derivable time slot.
   Accept per-move only if no new hard violations and no newly-dirtied day; accept the day's
   batch only if total hards STRICTLY decreased, else roll the whole day back
   (three-level `structuredClone` snapshots). Bounded: ≤3 moves/day, ≤8 attempts/task;
   multi-far-suburb days are handled per-day by the same rule, never specially. Fixer
   exceptions degrade to "not fixed" and the reviewer proceeds (generation-never-fails).
- Recomputation after each move uses
  `computeLegs(draft, onProgress, signal, onlyDayIndexes)` — the targeted-day variant;
  omitting `onlyDayIndexes` preserves the full recompute.

Representative paths: `apps/server/src/generation/longHaul.ts`,
`apps/server/src/generation/longHaulFixer.ts`, `apps/server/src/generation/draft.ts`,
`apps/server/src/generation/prompts.ts`, `packages/shared/src/constants.ts`.

### Common Mistake: auto-fix notes surviving rounds they did not survive

**Symptom**: persisted `reviewNotes` said "系统自动调整：X 自第 3 天移至第 1 天" while the
final trip had X back on day 3.

**Cause**: round-1 fixer moves were recorded as prose and accumulated across rounds; the
round-2 revision planner rebuilt the day and reversed the move, but the stale note was still
folded into the final trip (found as High in the 07-18 closing check — the trip lied to the
user, breaking the truthful contract the same way the pre-review feasibility snapshot did).

**Fix / Prevention**: fixer returns structured `applied: AppliedFixMove[]`
(`activityId`/`toDayIndex`/`note`), and `verifiedFixNotes(draft, applied)` re-validates each
move against the FINAL draft right before persistence — a note is kept only if the activity
is actually on its claimed day. Reversed/deleted/rebuilt-with-new-id moves are dropped:
under-report before you ever mis-report. Any future "the system did X for you" note must
follow the same persist-time re-verification pattern.

Representative paths: `apps/server/src/generation/longHaulFixer.ts`,
`apps/server/src/generation/orchestrator.ts`,
`apps/server/src/__tests__/longHaulFixer.test.ts`.

### TransitLeg Lodging Sentinel Contract (ST3)

`TransitLeg.fromActivityId` / `toActivityId` allow the sentinel value `'lodging'` — the day's
lodging anchor. A leg lives on its `TripDay`, so the sentinel scope is naturally that day:
`{from:'lodging', to:<first activity id>}` is "depart from lodging",
`{from:<last activity id>, to:'lodging'}` is "return to lodging". The schema stays a plain
string; the contract is documented on `TransitLegSchema` and matched strictly by
`lodgingLegsForDay(day)` in `@tripweaver/shared` (stale legs after reorder/delete are silently
dropped by consumers). Lodging legs are generated by the post-pass only when the lodging
geocode succeeded; a failed geocode means no lodging legs and no job failure. Editing the
lodging name invalidates its coordinates: clear them and drop the affected days' lodging legs
(there is no client re-geocode endpoint yet).

Representative paths: `packages/shared/src/schemas.ts`, `packages/shared/src/legs.ts`,
`apps/server/src/generation/geoPipeline.ts`, `apps/web/src/store/editorStore.ts`.

## Scenario: Deterministic Plan Phase and Copy-Only Writer (09-21, phase 2)

### 1. Scope / Trigger

Apply when changing `generation/scheduling/*`, the plan-phase orchestration in `orchestrator.ts`,
`WRITER_SYSTEM_PROMPT` / `writerUserPrompt`, or the writer-phase description tools. This REPLACES the
LLM planner/reviewer loop for the live pipeline.

### 2. Signatures

- `visitMinutes(facts): { minutes, basis: 'canonical' | 'type_estimate' }` in
  `scheduling/visitMinutes.ts` — pure, no IO
- `loadPlaceFacts(names, city): Promise<Map<string, PlaceFacts>>` in `scheduling/placeFacts.ts`
- `buildSchedule(candidates, options): { days, droppedCount }` in `scheduling/schedule.ts` — pure
- `applyDeterministicSchedule(input): { schedule, written, skippedNoCoord }` in
  `scheduling/buildDraft.ts`
- `draft.setSkeleton(...)` / `draft.addActivity(...)` / `draft.setLodging(...)` — the only writers
- `WRITER_SYSTEM_PROMPT`, `writerUserPrompt(form, draftRender)` in `generation/prompts.ts`
- `update_descriptions(entries: {activityId, description}[])` in `tools/draftTools.ts` — the
  writer-phase write path, located by `activityId` (NOT `dayIndex`/`position`); the write goes
  through `draft.updateDescriptionById`, which replaces the field in place. Position-based writes
  were removed because the writer runs CONCURRENTLY with the plan phase, where
  `repairLongHaulMixedDays` / `optimizeCrossDayGrouping` move activities to other days and
  invalidate every position number. `update_description(dayIndex, position, description)` remains
  for `buildDraftTools(draft, 'revision')` and other single-row callers

### 3. Contracts

- **The plan phase makes zero LLM calls.** Day assignment, intra-day order, and the time axis are
  computed from knowledge-base facts plus the heuristic transit model. Do not reintroduce an agent
  loop there; the measured cost of letting an LLM do it was 47228 output tokens / 432s, and the
  round-2 revision blew the 15-minute job timeout.
- Scheduling IS a hard dependency (unlike RAG enrichment): if `draft.validate()` fails after
  scheduling, throw `GenerationFailure`. There is no degraded path — no structure means no trip.
- Coordinates are OPTIONAL per candidate. Candidates without coordinates skip spatial clustering
  and are distributed round-robin by score to the emptiest non-exclusive day; `geoPipeline`
  resolves their coordinates afterwards (this matches the pre-existing rule that coordinates are
  never required from the planner). Never drop a candidate merely for lacking coordinates at
  scheduling time.
- `visitMinutes` is a two-track value: `payload.typicalVisitMinutes` when present (basis
  `canonical`), otherwise the `xhsPlaceType` table, then the 8-category table, then 75 minutes.
  Do not make the real value mandatory — coverage is ~3.5% (32 of 912 Beijing rows).
- The day timeline is built by SEGMENTING around meal windows when `foodFocused` is true:
  `[open → lunch]`, `[lunch end → dinner]`, `[dinner end → close]`. This is what guarantees meals
  exist, no activity straddles a meal window, and the day never runs past 21:30.
- An empty day gets ONE placeholder activity named `自由安排｜<destination>` — never a fabricated
  venue. This keeps the pre-existing "every day needs at least one activity" completeness gate
  satisfiable when the knowledge base has no coverage for a city.
- `lodging` is derived by code when the form leaves it empty: the hotel candidate nearest the
  median centre of the scheduled activities, falling back to the highest-scored hotel candidate.
  No candidates means no lodging suggestion (do not invent an area name).
- The writer phase reuses the `review` phase name on the SSE stream (frontend contract unchanged)
  but is semantically "write the copy". Its tool surface is EXACTLY `get_draft`,
  `update_descriptions`, `submit_review` — it cannot reach any structural tool, which is how D4
  ("审校只审文案") is enforced rather than merely requested. `submit_review` takes ONLY `notes`:
  it used to also require `approved` + `revisionRequests`, which no caller ever read while forcing
  the model to reason about structure it cannot change (measured: ~85% of the writer's output
  tokens on the longest turn were reasoning, not copy).
- **The writer runs CONCURRENTLY with geo/repair (09-25).** It starts right after
  `draft.validate()` passes and is `await`ed after `endPhase('plan')`. Measured effect: the writer's
  42–82s (reasoning-dominated, high variance) no longer queues behind geo, and `plan`'s ~4s leaves
  the critical path. Total wall clock ≈ `research + max(plan, review) + tail`, NOT
  `research + plan + review`. Do NOT re-serialize it: nothing in the copy path needs coordinates or
  legs. Concurrent structural moves are safe because copy is written by `activityId`; the fixers
  only move (never delete) activities and they touch `day`/`position`/`startTime`, never
  `description`.
- The old "batch reduces turns" rationale is dead: measured 3 turns either way (`get_draft` →
  write → `submit_review` is the protocol floor). The single-call batch form is kept for shape
  only — one submit instead of N batches — not for speed. The writer's wall clock is decided by
  reasoning volume, not by turn count or by the length cap on `description` (raising/lowering the
  cap changed nothing measurable).
- The writer is an enhancement path: an LLM error or turn limit degrades to the candidate `intro`
  text already written into each activity and the job still succeeds.
- `describeFeasibility`, `repairLongHaulMixedDays`, `ensureMealCoverage` (food-focused only),
  `optimizeCrossDayGrouping`, and `repairTransitTiming` all still run; only the LLM planner and the
  LLM reviewer loop are gone.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| `loadPlaceFacts` query fails | warn, empty map, schedule falls back to the type table |
| no candidate has coordinates | every day gets one placeholder activity; job still succeeds |
| candidates exceed days × 6 | lowest-scored overflow dropped, reported in `phase_end` summary |
| food-focused with no food candidate | meal stop anchors on the destination name |
| writer LLM error / turn limit | keep drafted copy, `job_done` unaffected |
| cancellation during scheduling | propagates as on any other phase |

### 5. Wrong vs Correct

```typescript
// Wrong: let the model decide the order again because "it writes nicer itineraries".
// (A planner agent with `plannerSystemPrompt` used to do exactly this; both were deleted in 09-25.)
const plannerRun = await runPhaseAgent({ systemPrompt: '<a planner prompt>', ... });

// Correct: structure is code's job; the model only writes descriptions.
const scheduleOutcome = await runSystemTask('plan', 'schedule_itinerary', '排定每日行程', () =>
  applyDeterministicSchedule({ draft, form, pool, locations, longHaul, foodFocused, facts }),
);
```

Representative paths: `apps/server/src/generation/scheduling/`,
`apps/server/src/generation/orchestrator.ts`, `apps/server/src/generation/tools/draftTools.ts`.
Measurement scripts: `cd apps/server && npx tsx test-gen-timing.mts`, plus `test-kb-shape.mts` for
what the knowledge base can actually support.

## Scenario: Research Place Reuse and Local Planner Revisions (P0)

### 1. Scope / Trigger

Apply when changing research POI capture, draft activity edits, automatic geocoding, or the
second planning round. Keep this within the existing research -> plan -> review runtime;
public Trip schemas, persistence, provider queues, timeouts, and quotas are unchanged.

### 2. Signatures

- `PlaceHint { placeName?: string; poiId?: string }` and `DraftActivity = Activity & PlaceHint`.
- `ResearchOutcome.locations: Map<string, ResearchLocation>`; a `ResearchLocation` is a
  readonly `{ lat: number; lng: number; adcode: string }` from an Amap POI result.
- `GeoSession.useResearchPlaces(pool, locations): void` binds the finished research to one
  generation session.
- `GeoSession.geocodeAll(draft, onProgress, signal?, changedOnly?: boolean): Promise<void>`.
- `DraftTrip.updateActivity(dayIndex, position, patch: Partial<DraftActivityInput>): string`.
- `buildDraftTools(draft, mode: 'plan' | 'revision' = 'plan'): AgentTool[]`.
- Revision tool: `move_activity({ fromDayIndex, activityId, toDayIndex })`, with 1-based days.
- ~~`plannerUserPrompt(form, research, revisionRequests?, longHaulIntel?, currentDraft?): string`~~
  — deleted in 09-25 together with the other LLM-planner prompt builders.

### 3. Contracts

- `search_pois` captures exact trimmed names, GCJ-02 coordinates, and adcodes privately.
  Conflicting coordinates or nonempty adcodes for the same name permanently disqualify that
  name from reuse for this research instance. Non-finite, out-of-range, and `(0, 0)` points
  cannot enter the reusable index.
- Candidate `poiId` resolves to its canonical name. An explicit conflicting `placeName`
  wins over a stale ID. Otherwise lookup uses the exact place name, including legacy meal
  extraction: `午餐｜春熙路 · 川菜` queries `春熙路` while its display name stays intact.
  Do not fuzzy-match candidate names or use a restaurant ID to represent an entire meal area.
- Reused points are staged and pass the same `rejectFarGeocodes` firewall as fresh lookups.
  A rejected research point gets one normal lookup-chain attempt in that pass and another
  validation; its research name is disabled for subsequent reuse in the session. Reference
  unavailability and validation exceptions retain the existing firewall degradation behavior.
- The median reference pool contains already-geocoded activities plus staged results. An
  unchanged failed/estimated activity skipped by `changedOnly` must not become a reference.
- Reuse makes no new provider attempt and spends no extra `geo.stats.calls`; the original
  research attempt remains counted. Ordinary fallback calls keep existing accounting,
  limits, source labels, and GCJ-02 conversion. Accepted adcodes populate route `city1/city2`.
- Renaming a place, changing a reference, or changing coordinates invalidates old coordinates
  and affected activity legs. Clear inherited conflicting hints; clear old source notes on a
  place replacement unless replacements are supplied. Re-resolution deletes the old adcode.
  A time/description-only patch preserves the ID, references, coordinates, coordinate system,
  source notes, and routes. Coordinate patches are re-resolved, not treated as verified points.
- Repeating the same normalized lodging suggestion preserves its resolved data. Changing
  lodging clears its coordinates and all lodging-sentinel legs, preserving activity legs.
- Round 1 uses creation tools and `PLANNER_SYSTEM_PROMPT`. Round 2 uses
  `PLANNER_REVISION_SYSTEM_PROMPT`, receives `draft.render()` with IDs/places/lodging, and has
  no `set_trip_skeleton`. `move_activity` appends the same activity to the target day; the
  planner adjusts its time and the post-pass recomputes routes. Unaffected content stays put.
- After the last review, `geocodeAll(..., true)` resolves new/invalidated states before final
  route recomputation. It skips unchanged failed queries, including unchanged failed lodging.
  The state key includes coordinates/source as well as the place reference, so invalidating
  coordinates without changing the name still triggers resolution. Regular planning-round
  passes retain the existing opportunity to retry unresolved items.
- `DraftTrip.toTrip()` strips internal `placeName`/`poiId`; no public schema or DB migration.
  Final meal coverage, route coherence, feasibility, SSE, and cancellation still run.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Valid unambiguous research point | Validate, then adopt without repeated geocoding. |
| No reusable exact match, ambiguous name, invalid point | Normal geocoding chain and truthful fallback. |
| Reused point fails sanity | Normal lookup, revalidate; still invalid -> keep unresolved. |
| Time or description edited | No new location query or route attempt for unchanged verified pairs. |
| Place or coordinates changed | Old location data invalidated; final review pass resolves again. |
| Move has missing activity/day or same source/target day | Error text, no draft mutation. |
| Signal aborted | Stop starting new work items; throw before adopting in-flight results. |

### 5. Good / Base / Bad Cases

- Good: research located a museum and two meal areas; the post-pass only looks up the city
  center, retains identical verified activity coordinates, and routes with each area's adcode.
- Base: a model-only candidate has no research coordinates; the usual lookup chain resolves it.
- Bad: a revision recreates the skeleton, a renamed activity keeps the old museum's coordinates,
  or a skipped estimated point makes the sanity reference drift to the wrong city.

### 6. Tests Required

- `placeLookup.test.ts`: meal queries, reference priority, ambiguity, invalid coordinates, and
  private research adcode capture without candidate-schema leakage.
- `draftRevision.test.ts`: non-location edit preservation, location/route invalidation, lodging
  idempotence, ID-preserving moves, invalid moves, and stripping internal hints on persistence.
- `geoPipeline.test.ts`: mocked HTTP counts (unseeded 4 vs reuse 1 for city + 3 places), identical
  coordinates, transit adcodes, safe fallback, failed-query skipping, reference-pool hygiene,
  coordinate-only invalidation, and cancellation. Use isolated env/SQLite and intercept all
  provider fetches, including Nominatim.
- `scripts/verify-c2.mjs`: reviewer overrun fallback plus an actual second planning round;
  assert one skeleton, all original activity IDs, both daily meals, local edits, and clean Trip JSON.
- Keep typecheck, full server tests, and offline eval green. Mock counts and historical snapshot
  replay do not establish online latency or newly generated itinerary quality.

### 7. Wrong vs Correct

```typescript
// Wrong: discard the researched location and rebuild the draft on every review round.
await geocodeActivity(apiKey, activity.name, destination, tryGeocode);
const tools = buildDraftTools(draft);

// Correct: bind task-local evidence and restrict the revision to the existing draft.
geo.useResearchPlaces(research.pool, research.locations);
const tools = buildDraftTools(draft, 'revision');
const prompt = plannerUserPrompt(form, research, requests, intel, draft.render());
await geo.geocodeAll(draft, onProgress, signal, true);
await geo.computeLegs(draft, onProgress, signal);
```

## Scenario: Final Route Coherence After Model Review

### 1. Scope / Trigger

Apply this contract after the final reviewer turn. Reviewer tools can update, remove, or reorder
activities, and model-authored day boundaries can separate nearby places while pairing each with
a distant place. Both cases make pre-review legs or grouping unsafe to persist unchanged.

### 2. Signatures

- `computeLegs(draft, onProgress, signal?, onlyDayIndexes?): Promise<void>`
- `optimizeCrossDayGrouping(draft, context): Promise<RouteCoherenceResult>`
- `repairTransitTiming(days): number[]`

### 3. Contracts

- Recompute all legs immediately after review. If this optional recompute fails, delete every
  day's legs; missing routes are truthful, stale routes are not.
- Resolve reviewer-invalidated places with `geocodeAll(..., true)` before recomputing final
  legs; otherwise a replacement activity could retain missing or stale location data.
- Cross-day grouping swaps only same-category visit blocks and keeps following meal activities
  attached to their attraction. A candidate needs a strong proximity signal in either direction:
  at most 20km from a target-day peer, at least 40km from its current-day peers, and at least
  30km closer to the target cluster.
- Rank candidates heuristically, try at most three, then targeted-recompute both affected days.
  Accept only when all required current-adjacency/lodging legs exist, total computed route time
  drops by at least 30 minutes, and hard feasibility violations do not increase.
- Snapshot the complete day array before attempts. Any rejected or failed attempt restores the
  snapshot exactly. Non-cancellation failures degrade to the original itinerary; cancellation
  propagates to the orchestrator.
- Run final meal repair after grouping, recompute days receiving inserted meals, then push
  activities forward using current legs. A shifted meal must remain fully inside its meal window.

### 4. Validation & Error Matrix

- Reviewer deletes/reorders an activity -> full recompute replaces stale endpoint ids.
- Initial or post-swap required leg is missing -> skip/reject optimization; never count it as
  zero-minute travel.
- Real route gain is under 30 minutes or hard count rises -> restore the attempt snapshot.
- Targeted recompute throws -> restore the entry snapshot and continue generation without a swap.
- `AbortSignal` is aborted -> restore state and rethrow so the job converges to `cancelled`.

### 5. Good / Base / Bad Cases

- Good: 乌兰察布's 辉腾锡勒 and 黄花沟 are grouped on one day only after the real route total
  improves by at least 30 minutes and hard violations do not increase.
- Base: no candidate passes the conservative thresholds; persist the reviewed day grouping with
  freshly recomputed legs.
- Bad: accept a swap because a missing leg was summed as zero, or retain legs that reference an
  activity removed by the reviewer.

### 6. Tests Required

- `routeCoherence.test.ts` covers the Ulanqab grouping regression, affinity in both day
  directions, per-day-valid leg ids, minimum route gain, no new hard violations, exact rollback,
  cancellation propagation, and transit-aware timing repair.
- Orchestrator integration verification must still reach `job_done` when optional geo/grouping
  work degrades, and persisted days must contain no stale leg endpoint ids.

### 7. Wrong vs Correct

```typescript
// Wrong: reviewer mutations leave stale routes, and missing post-swap legs look artificially fast.
await runReviewer(draft);
const gain = oldMinutes - sumPresentLegsOnly(draft);
persist(draft);

// Correct: resolve changed places, then rebuild routes and validate bounded grouping changes.
await geo.geocodeAll(draft, onProgress, signal, true);
await geo.computeLegs(draft, onProgress, signal);
await optimizeCrossDayGrouping(draft, { mode, recomputeLegs, signal });
ensureMealCoverage(draft.mutableDays(), destination);
repairTransitTiming(draft.mutableDays());
persist(draft);
```

## Scenario: Meal Completeness and Legacy Budget Compatibility

### 1. Scope / Trigger

Apply this contract when changing planner/reviewer prompts, draft validation, final generation
post-passes, or the legacy `GenerateForm` / `Trip` budget fields. TripWeaver owns meal timing,
area, and cuisine planning; it does not claim live restaurant price, rating, opening-hours,
queue, reservation, or transaction capability.

### 2. Signatures

- `missingMeals(days): Array<{ dayIndex: number; kind: 'lunch' | 'dinner' }>`
- `isFoodFocused(preferences): boolean` — `preferences.includes('美食')`, the ONLY source of the meal mandate
- `mealCoverageProblems(days, { foodFocused }): string[]`
- `ensureMealCoverage(days, destination): MealRepair[]`
- `prompts.ts` exports ONLY `formBrief`, `RESEARCH_SYSTEM_PROMPT`, `WRITER_SYSTEM_PROMPT`, and
  `writerUserPrompt`. The conditional-meal prompt builders (`plannerSystemPrompt` /
  `plannerRevisionSystemPrompt` / `reviewerSystemPrompt`), their user-prompt counterparts,
  `renderPoolIndex` / `renderLongHaulIntel` / `renderRagContext`, and the shared
  `activityRequirements` helper were all deleted in 09-25 — meal and long-haul discipline is
  enforced by the deterministic scheduler, not by prompt wording.
- `DraftTrip.validate(): string[]` includes `mealCoverageProblems`.
- `GenerateForm.budgetLevel`, `GenerateForm.totalBudget`, `Trip.budgetLevel`,
  `Trip.totalBudget`, and `Activity.cost?` remain compatibility fields.

### 3. Contracts

- **The meal mandate is preference-driven (09-21 decision D3/D6).** Only when
  `isFoodFocused(form.preferences)` is true must every generated day contain both lunch and
  dinner; otherwise a day with no meals at all is a complete itinerary. Explicit meal names
  count; otherwise only `category === '美食'` starting in 11:00-14:30 or 17:00-21:30 counts.
- `submit_plan` rejects a draft with a day-specific missing-meal problem before review — but
  only for food-focused forms, because `mealCoverageProblems` returns `[]` otherwise. Callers
  must pass `{ foodFocused }` explicitly; there is no default, so a new call site cannot
  silently inherit the old hard gate.
- The orchestrator computes `foodFocused` ONCE at the top of `runGeneration` and threads it
  through the planner/reviewer prompts and the `ensureMealCoverage` gate. Do not re-derive it
  per phase from partial state.
- Non-food-focused forms still keep the anti-fabrication rule: if a meal activity is present
  its `description` must name the dining area/cuisine and defer live price/rating/hours to
  Dianping or Meituan. Non-food-focused forms simply are not required to invent one.
- `set_lodging` is an OPTIONAL step, not a mandatory one: the planner prompt calls it
  “住宿（可选）” and says it is not a required step. Keep the area-only / no-hotel-brand rule.
- After the final review, `ensureMealCoverage` runs again (food-focused forms only). It inserts
  slot with a 15-minute transfer buffer on both sides and invalidates that day's legs, or, when
  no slot exists, integrates the meal into an activity spanning the meal window so it does not
  create an overlap.
- Deterministic repair creates no `cost`. Its copy recommends an area, local cuisine, or
  representative dish and sends live price/review/hours/queue confirmation to Dianping or
  Meituan.
- New model tool schemas do not expose `cost`, and budget fields do not influence planner or
  reviewer decisions. Existing stored budget/cost values still parse and round-trip unchanged.

### 4. Validation & Error Matrix

- Missing lunch/dinner at `submit_plan` -> return explicit day/meal problems; do not submit.
- Reviewer removes the last meal and a slot is free -> insert the missing meal, recompute legs
  for the changed day, continue generation.
- Reviewer removes the last meal and no slot is free -> integrate into a spanning activity,
  continue without adding an overlapping activity.
- Restaurant live data is absent or stale -> keep advice generic and require external-platform
  confirmation; never invent dynamic facts.
- Legacy JSON contains budget or activity cost -> accept and preserve it; do not use it to steer
  a new generation.

### 5. Good / Base / Bad Cases

- Good: a day has `午餐｜前门片区 · 京味小吃` at 12:00 and a replaceable dinner area at 18:30.
- Base: review deletes dinner; the post-pass inserts a nearby 18:00-19:15 dinner suggestion.
- Bad: treat one generic food stop at 15:00 as both meals, or claim a restaurant's current
  rating/price/queue without a live authoritative integration.

### 6. Tests Required

- Unit-test explicit-name and time-window meal detection, per-day problem messages, insertion
  ordering, leg invalidation, no-cost output, and the no-free-slot integration fallback.
- Prompt tests assert both meals and external-platform boundaries, and assert budget/cost tools
  are absent.
- `scripts/verify-c2.mjs` must complete the full generation/SSE/persistence flow with mock days
  that include both meals.

### 7. Wrong vs Correct

```typescript
// Wrong: prompt-only completeness can be undone by review.
await runReviewer(draft);
persist(draft);

// Correct: validate before submit, then deterministically enforce after review.
draft.validate();
await runReviewer(draft);
ensureMealCoverage(draft.mutableDays(), form.destination);
persist(draft);
```

### Common Mistake: AbortSignal only checked at phase boundaries

**Symptom**: after cancellation the job stays "running" for tens of seconds while a post-pass
loop drains serial external calls (350ms–1.1s each).

**Cause**: `assertAlive(signal)` was only called between phases; loops with metered serial
calls did not observe the signal per iteration.

**Fix / Prevention**: any loop performing serial external calls (post-pass, batch jobs) must
accept `signal?: AbortSignal` and check it at the top of every iteration, then let the
orchestrator's catch converge to the authoritative `cancelled` terminal state. Found as a
High issue in task `07-12-geo-data-layer`.

## Time and Resource Limits

The orchestrator applies a 10-minute whole-job timeout through the job abort controller and
limits review to two rounds. Individual agent turns and external provider calls have their own
limits. Keep a whole-job limit even when adding narrower timeouts so a stalled phase cannot
leave a user permanently marked as running.

The review phase keeps its 12-turn per-agent bound. If that bound is exceeded, stop the reviewer,
preserve any draft mutations it already completed, add an explicit degraded-review note, and
continue through deterministic meal coverage, final feasibility notes, and persistence. Review
turn exhaustion is a quality degradation, not a reason to discard an otherwise usable plan;
after successful persistence it follows normal successful-generation quota accounting. Other
model/provider errors remain visible failures.

Validation paths: `scripts/verify-c2.mjs` covers API/SSE replay, cancellation, quota, BYOK,
and migration behavior; `scripts/verify-c3.mjs` covers the production browser flow and
refresh recovery after `npm run build`.

## Scenario: LLM Request Context Snapshots

### 1. Scope / Trigger

Apply this contract when debugging generation misbehavior (model ignoring tools, empty
responses, prompt regressions) or changing `agents/runner.ts` / phase prompts. Every LLM API
request made by the three phase agents is persisted as a full context snapshot so the exact
system prompt, message history, and tool definitions can be inspected after the fact.

### 2. Signatures

- `createLlmRequestRecorder(scope: { jobId, userId, phase, round }): LlmRequestRecorder`
  in `apps/server/src/generation/llmRequestLog.ts`
- `RunAgentOptions.recorder?: LlmRequestRecorder` in `apps/server/src/generation/agents/runner.ts`
- Table `llm_request_logs`: `id, job_id, user_id, phase, round, turn, model, system_prompt,
  messages JSONB, tools JSONB, response JSONB NULL, created_at TIMESTAMPTZ`;
  indexes `(job_id)` and `(user_id, created_at DESC)`.

### 3. Contracts

- The runner wraps the agent's `streamFn` (pi-agent-core defaults to pi-ai `streamSimple`;
  see `agent.js` constructor). The wrapper inserts one row per API request with a per-phase
  `turn` counter starting at 1, then delegates to `streamSimple` unchanged.
- The same wrapper also drives the live debug view: `PhaseEventSink.onLlmRequest/onLlmResponse`
  forward SSE `llm_request` (full context) / `llm_response` (stopReason, tokens) events,
  emitted whenever a recorder OR the trace callback exists. Web rebuilds one timeline node per
  turn (`generationTimeline.ts` `LlmRequestItem`, paired by phase+turn) with expandable full
  prompt/messages/tools; replay from the event buffer restores the nodes.
- `messages`/`tools` are the normalized pi-ai context objects, stored verbatim as JSONB.
  API keys never enter the snapshot: keys flow through `getApiKey`, not the context.
- On each assistant `message_end`, the runner writes `response =
  { stopReason, usage, errorMessage, text }` back to the pending row. The assistant message
  itself also appears in the next turn's `messages` snapshot; the write-back covers the final
  turn and error stops.
- Recording is an enhancement path: insert/update failures only `console.warn` and skip the
  row; generation must never fail because logging failed.

### 4. Validation & Error Matrix

- Snapshot insert throws -> warn, return null row id, skip response write-back, continue.
- Response write-back throws -> warn, continue.
- No recorder passed -> runner behaves exactly as before (no streamFn override).
- Request errors before any assistant `message_end` -> row keeps `response = NULL`.
- `llm_response` matching no open phase block (legacy replay) -> event ignored.

### 5. Good / Base / Bad Cases

- Good: a failing plan phase shows turn=1 with `response.stopReason = 'length'` and
  `usage.output = maxTokens`, directly revealing output-budget exhaustion.
- Base: research phase logs ~10-16 rows with `messages` growing each turn as tool results
  are appended.
- Bad: swallow a generation exception because the recorder threw, or store api keys / BYOK
  material in the snapshot.

### 6. Tests Required

- Run `apps/server/test-beijing-rag.mts` (or any generation), then query
  `llm_request_logs` for the job: assert turn sequence per phase, growing message counts,
  and non-null `response` on completed turns. `test-llm-log-check.mts` prints this summary.
- `npm run typecheck` must pass; schema.ts and migrate.ts must stay in dual-update sync.

### 7. Wrong vs Correct

```typescript
// Wrong: subscribe to events and reconstruct the context from pieces.
agent.subscribe((ev) => { if (ev.type === 'turn_start') guessContext(); });

// Correct: wrap streamFn — the exact (model, context, options) tuple per API request.
const streamFn: StreamFn = async (model, context, options) => {
  await recorder.recordRequest({ turn: ++seq, model: model.id, ...context });
  return streamSimple(model, context, options);
};
```

### Common Mistake: weak models burn the whole output budget before emitting tool calls

**Symptom**: plan phase ends with "行程草稿不完整" (0 tool calls, 0 visible text); the gateway
may surface HTTP 500 "empty response content".

**Cause**: `buildModel` sets `maxTokens`. pi-ai's `streamSimple` clamps it to
`min(model.maxTokens, 32000)` (`providers/simple-options.js`), so `model.maxTokens` is the wire
`max_tokens` ceiling. The old `8192` let a reasoning-heavy tool-calling model consume the whole
budget on hidden reasoning (`stopReason = 'length'`, no tool call). Verify with
`llm_request_logs.response.stopReason = 'length'` and `usage.output = maxTokens`.

**Fix / Prevention**: `generation/model.ts` now uses `maxTokens: 32000` (= the pi-ai clamp, so
writing `1000000` changes nothing). Do **not** expect large values to reach the wire: the gateway
may reject them anyway (a New API relay answered `field MaxTokens invalid, should be in [1, 384000]`
for `max_tokens: 1000000`). Trade-off seen live (09-20): a 32k budget let one plan turn emit
21k output tokens and take ~3.7 min, so research + plan + review together can exceed the job
timeout. Decision (09-20): keep `maxTokens: 32000` and raise the cap —
`GENERATION_TIMEOUT_MINUTES = 15` in `packages/shared/src/constants.ts` is the single source for
both `JOB_TIMEOUT_MS` and the frontend `timeout` copy. Diagnose with the snapshot table first
instead of hand-writing curl repro scripts. Found in task `09-20-llm-context-logging`.

### Common Mistake: reasoning tokens, not tool arguments, dominate a phase's wall clock

**Symptom**: the plan phase takes 7-10 minutes while every tool call is instant and the visible
assistant text is a few hundred characters. Measured live (09-20): plan 597.8s of a 793.4s job,
47228 output tokens across 14 turns, **392 characters of visible text**. Two turns alone
(144.6s + 182.4s) carried 60275 + 30105 characters of hidden `thinking`.

**Cause**: a reasoning model's `usage.output` counts hidden reasoning. Output speed is roughly
constant (~150-166 tok/s here), so turn latency ≈ thinking length ÷ output speed — the tool
arguments (14 `add_activity` = 5116 characters) are noise by comparison.

**Measure before optimizing**: `cd apps/server && npx tsx test-gen-timing.mts` prints the
phase / tool-union / LLM-wait split, and `npx tsx test-llm-output-probe.mts` breaks each turn's
output into `thinking` vs `toolCall` vs `text` characters. (`llm_request_logs.response.text`
only holds text parts, so a near-zero char count with a large `usage.output` is the tell.)
Do NOT raise `maxTokens` for this — the budget is not the constraint; reasoning volume is.
Ref: `.trellis/tasks/09-20-gen-timing/research/2026-09-20-phase-timing.md`.

### Common Mistake: a dead geocoding fallback silently costs ~22s per unresolved place

**Symptom**: `geo_geocode_all` takes 165.7s and produces zero coordinates.

**Cause**: two stacked failures. (1) `geoPipeline.init()` gates the Amap credential on daily
budget `remaining >= GEOCODE_MAX_PER_TASK + ROUTE_MAX_PER_TASK` (= 60); with
`AMAP_DAILY_BUDGET=150` mostly spent, `apiKey` becomes `null` and the whole chain skips Amap.
(2) The fallback is Nominatim, which is unreachable from some networks: `integrations/geocode.ts`
times out at 10s and returns `null`, and `geocodeActivity` calls it **twice** per place
(`${city} ${name}` then `name`), so each unresolved activity costs ~22.3s (measured
22315 / 22247 / 22257ms) — with `GEOCODE_PIPELINE_CONCURRENCY = 2`, 14 activities ≈ 166s.

**Prevention**: when a fallback provider is expected to be unreachable, fail fast rather than
wait for the timeout, and add a circuit breaker in the spirit of `createRouteBreaker`. Diagnose
with `cd apps/server && npx tsx test-geo-latency.mts` (per-level latency + the budget gate
verdict). Note the gate is a daily-budget policy knob, not a code bug: check
`AMAP_DAILY_BUDGET` against the per-task reservation before blaming the geocoder.

### Measured: what actually moves the wall clock (09-20 verification)

Before optimizing any generation latency, read
`.trellis/tasks/09-20-gen-timing-soft-reasoning-effort/research/2026-09-20-fix-verification.md`.
Four measured results, all on the same 北京 3-day form:

- **Nominatim fast-fail works**: 2.5s timeout + 3-failure breaker took `geo_geocode_all` from
  165.7s to **3.2s** (the dead fallback was 22.3s per unresolved place). Probes:
  `cd apps/server && npx tsx test-geo-latency.mts`.
- **A soft-violation loop is real and cheap to kill**: the `check_feasibility` reply now appends
a convergence hint when `hard === 0`. plan round 1 went 597.8s → **314.8s**, 14 turns → 6.
- **`reasoning_effort` is not a lever on this gateway**: passing `reasoning: 'medium'` does
  reach the request body (verify with `npx tsx test-reasoning-effort.mts`), but plan round-1
  output *rose* 47228 → 51646 tokens. Measure before assuming a lower effort saves time; the
  model's hidden thinking volume is what it is.
- **The revision round is the dominant cost once round 1 is fast**: plan round 2 emitted
  61243 tokens over 4 turns (~370s) and pushed the job past `GENERATION_TIMEOUT_MINUTES = 15`,
  so the terminal state was `cancelled` — worse than slow. Any plan-phase optimization must
  budget round 2, not just round 1. Also: the reviewer's soft-severity `revisionRequests` are
  what triggers that round at all.

### Upstream flakiness must not kill the whole job

**Symptom**: web generation fails with `模型调用异常：400 Error from provider (Console): Upstream
request failed: Model is unavailable.` even though the same model answers simple requests.

**Cause**: relay/upstream pool flakiness (one channel lost the model) — the error is produced
upstream of this repo, and every LLM error was fatal: `assertAlive` turns any `errorMessage` into
`GenerationFailure`.

**Fix / Prevention**: `agents/runner.ts` wraps `streamSimple` in `streamWithRetry`: each attempt's
events are buffered and only a successful attempt is replayed to the agent, so a retry never pushes
a half message into the context. Only "retry might help" errors retry (`isRetryableUpstreamError`:
model unavailable / rate limit / 5xx / network); request-shape 400s, auth errors, and failures that
already emitted content/tool deltas do not. Retry delays are `[1000, 3000]` ms. Unit tests:
`apps/server/src/__tests__/llmRetry.test.ts`.
