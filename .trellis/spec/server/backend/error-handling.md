# Error Handling

## Global HTTP Boundary

`apps/server/src/index.ts` installs the Fastify error handler. It maps `SsrfError` and
validation failures to 400, honors an error's `statusCode`, logs 5xx failures, and hides
internal details behind a generic response. Do not expose stack traces, SQL details,
provider responses, tokens, or secrets.

## Route Boundary

Routes handle expected HTTP outcomes directly: 401 authentication failures, 403 policy
denials, 404 missing/non-owned resources, 409 conflicts, 429 quotas, redirects, and cookie
changes. Use the same 404 response for missing and non-owned resources.

Representative paths: `apps/server/src/routes/auth.ts`,
`apps/server/src/routes/trips.ts`, `apps/server/src/routes/generations.ts`.

## Service and Workflow Boundary

Services return `null`/`false` for expected absence and may throw an `Error` with a
`statusCode` for reusable domain rejection. The generation orchestrator owns job failure
conversion and records/emits `done`, `error`, or `cancelled`.

Representative paths: `apps/server/src/services/tripService.ts`,
`apps/server/src/services/settingsService.ts`, `apps/server/src/generation/orchestrator.ts`.

## External Integration Failures

Optional research sources are degradation boundaries. Normal network, provider, and parse
failures return an empty result rather than aborting generation. Missing keys and exhausted
site budgets select Null adapters. `selfCheck()` reports a structured unhealthy status.

Do not extend this tolerance to database corruption, programming errors, or invariant
failures. Current call statistics count accepted non-Null wrapper attempts, including cache
hits and attempts that later degrade; they are not confirmed successful network requests.

Representative paths: `apps/server/src/integrations/amap/poiSource.ts`,
`apps/server/src/integrations/websearch/searchSource.ts`,
`apps/server/src/integrations/sourceStatus.ts`.

## Error Classes

Use a named error class when callers need reliable classification or a stable code, such as
`SsrfError` and `GithubOauthError`. Use a local workflow error such as `GenerationFailure`
when the type should not escape its module. Avoid large generic error hierarchies.

Representative paths: `apps/server/src/integrations/ssrfGuard.ts`,
`apps/server/src/auth/github.ts`, `apps/server/src/generation/orchestrator.ts`.

## Common Mistakes

- Letting an optional provider exception become `job_error` instead of degrading.
- Catching all errors around persistence or invariants and returning success.
- Returning another user's resource as 403 and confirming its existence.
- Sending raw provider or validation internals to clients.
- Calling metered `selfCheck()` on every request; `apps/server/src/routes/settings.ts`
  uses a 60-second promise memo.
