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

Representative paths: `apps/server/src/routes/generations.ts`,
`apps/server/src/generation/jobManager.ts`, `packages/shared/src/types.ts`.

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
- `closed_on_arrival`: RESERVED. Activity has no open-hours field yet; the engine signature
  carries an optional `openHours?` slot but never emits this code. Do not fabricate open hours.

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
   Tiered intel + day-discipline rules are injected into `plannerUserPrompt` (revision rounds
   reuse the same builder). Cases with no long-haul POIs get a byte-identical prompt
   (regression-locked by test).
2. **Deterministic fixer (repair)** — `longHaulFixer.ts` runs INSIDE each plan⇆review round,
   after geoPipeline+feasibility and before the reviewer. Trigger: hard
   `transit_infeasible`/`overpacked` on a day that has an exclusive-tier long-haul activity
   (re-identified from REAL resolved coordinates, not the name-keyed research intel) plus
   mixed-in urban activities (>45min from the long-haul point AND closer to the trip median
   center). Action: move urban activities out (`draft.moveActivityToDay`, a code-level
   primitive — NOT an agent tool) to the lightest-load day with a derivable time slot.
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

// Correct: rebuild final routes, then accept a bounded swap only after strict real-route checks.
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
- `mealCoverageProblems(days): string[]`
- `ensureMealCoverage(days, destination): MealRepair[]`
- `DraftTrip.validate(): string[]` includes `mealCoverageProblems`.
- `GenerateForm.budgetLevel`, `GenerateForm.totalBudget`, `Trip.budgetLevel`,
  `Trip.totalBudget`, and `Activity.cost?` remain compatibility fields.

### 3. Contracts

- Every newly generated day must contain both lunch and dinner. Explicit meal names count;
  otherwise only `category === '美食'` starting in 11:00-14:30 or 17:00-21:30 counts.
- `submit_plan` rejects a draft with a day-specific missing-meal problem before review.
- After the final review, `ensureMealCoverage` runs again. It inserts a non-overlapping meal
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
