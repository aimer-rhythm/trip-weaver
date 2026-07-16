# Quality and Verification Guidelines

## Required Patterns

- Use `FastifyPluginAsyncTypebox` and TypeBox schemas for changed request inputs.
- Reuse shared schemas/types for cross-package API contracts.
- Use `requireAuth`, then scope resource lookups and mutations by `request.user!.id`.
- Keep HTTP concerns in routes and reusable application/database work in services, except
  for the documented authentication route exception.
- Keep `db/schema.ts` and `db/migrate.ts` synchronized.
- Give outbound requests appropriate timeout, security, cache, rate, limit, degradation,
  and accounting behavior.

## Forbidden Patterns

- Unvalidated request input casts in new code.
- User-owned resource queries without a `userId` predicate.
- Logging secrets or returning them in API responses.
- Updating only Drizzle schema or only startup migration SQL.
- Outbound `fetch` without an explicit timeout or abort signal.
- Throwing optional research-source failures into generation.
- Calling source call-attempt counters confirmed network-call counters.
- Assuming in-memory jobs, caches, or queues coordinate across replicas.

## Command Matrix

There is no standalone server `typecheck`, `test`, or `lint` script in
`apps/server/package.json`. Use repository-root commands and targeted scripts.

| Change area | Command | Notes |
| --- | --- | --- |
| Any TypeScript contract/server change | `npm run typecheck` | Checks shared, server, and web. |
| Web production bundle/static serving | `npm run build` | Builds `apps/web/dist`. |
| Authentication modes/OAuth bootstrap | `node scripts/verify-auth-modes.mjs` | Isolated server scenarios. |
| Ownership, cookies, SSRF, secrets | `node scripts/verify-security.mjs` | Dev and production instances. |
| Generation API, migration, SSE, quota, BYOK | `node scripts/verify-c2.mjs` | Mock LLM and temporary SQLite. |
| Production generation browser flow | `node scripts/verify-c3.mjs` | Requires `npm run build` first. |
| Core browser trip flow | `node scripts/verify-m1.mjs` | Expects a suitable app at `BASE`. |
| Export/import production flow | `node scripts/verify-d1.mjs` | Requires `npm run build` first. |
| Golden-set eval (offline snapshot replay) | `npm run eval` | Deterministic checks; gate = zero hard violations. |
| Golden-set eval (live generation) | `npm run eval:live` | Real LLM via `SITE_LLM_*`; writes `eval/snapshots/`. |

Run the smallest relevant script. Do not run credential-bearing real-provider checks without
explicit approval. Verification scripts should inject environment values rather than depend
on `apps/server/.env`.

## Review Checklist

- Shared contract and route schema agree.
- Status codes and error shapes preserve client behavior.
- Authentication and ownership are both present.
- Database upgrade behavior works for existing files, not only fresh databases.
- Secrets do not appear in responses, logs, fixtures, or database plaintext.
- Background work reaches one terminal status and cancellation remains authoritative.
- Relevant validation completed, or blockers are recorded.
