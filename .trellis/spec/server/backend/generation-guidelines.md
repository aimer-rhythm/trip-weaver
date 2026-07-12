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
a code-level post-pass in the orchestrator after the review loop and before `createTrip`.

- Progress goes through the existing `thought` sink events (e.g. `正在解析坐标与通勤 (12/18)`);
  do not invent new SSE event types for internal passes.
- Degradation inside the pass must never fail the job; skip items truthfully instead of
  fabricating data.
- Agent tools remain available for judgment calls only (e.g. `geocode_place` for ambiguous
  key places); the post-pass skips items the agent already resolved (`coordSource==='geocoded'`).

Representative paths: `apps/server/src/generation/geoPipeline.ts`,
`apps/server/src/generation/orchestrator.ts`.

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

Validation paths: `scripts/verify-c2.mjs` covers API/SSE replay, cancellation, quota, BYOK,
and migration behavior; `scripts/verify-c3.mjs` covers the production browser flow and
refresh recovery after `npm run build`.
