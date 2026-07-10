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

Representative paths: `apps/server/src/services/quotaService.ts`,
`apps/server/src/generation/orchestrator.ts`, `apps/server/src/db/schema.ts`.

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
