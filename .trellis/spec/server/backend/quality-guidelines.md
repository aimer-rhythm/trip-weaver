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
- Seeding env for isolated scripts with `||=` after loading `.env` (dotenv wins and the
  fallback silently never applies — assign unconditionally).

## Command Matrix

There is no standalone server `typecheck`, `test`, or `lint` script in
`apps/server/package.json`. Use repository-root commands and targeted scripts.

| Change area | Command | Notes |
| --- | --- | --- |
| Any TypeScript contract/server change | `npm run typecheck` | Checks shared, server, and web. |
| Generation logic, prompts, geocoding, and feasibility | `node --import tsx --test apps/server/src/__tests__/*.test.ts` | Includes isolated mock-provider and draft-revision regressions. Requires `MASTER_KEY` (see below). |
| Web production bundle/static serving | `npm run build` | Builds `apps/web/dist`. |
| Authentication modes/OAuth bootstrap | `node scripts/verify-auth-modes.mjs` | Isolated server scenarios. |
| Ownership, cookies, SSRF, secrets | `node scripts/verify-security.mjs` | Dev and production instances. |
| Generation API, migration, SSE, quota, BYOK | `node scripts/verify-c2.mjs` | Mock LLM and temporary SQLite. |
| Production generation browser flow | `node scripts/verify-c3.mjs` | Requires `npm run build` first. |
| Core browser trip flow | `node scripts/verify-m1.mjs` | Expects a suitable app at `BASE`. |
| Export/import production flow | `node scripts/verify-d1.mjs` | Requires `npm run build` first. |
| Golden-set eval (offline snapshot replay) | `npm run eval` | Deterministic checks; gate = zero hard violations. |
| Golden-set eval (live generation) | `npm run eval:live` | Real LLM via `SITE_LLM_*`; writes `eval/snapshots/`. |
| Docker release artifact | `cp .env.example .env && docker compose config && docker compose build app` | CI/build host only; validates configuration and image build without starting services or using real credentials. |

Run the smallest relevant script. Do not run credential-bearing real-provider checks without
explicit approval. Verification scripts should inject environment values rather than depend
on `apps/server/.env`.

**Unit-test prerequisite**: `apps/server/src/env.ts` validates `MASTER_KEY` at import time, so
any suite that transitively imports it (e.g. `placeLookup.test.ts`) aborts the whole run with
`[env] MASTER_KEY 缺失或格式错误` when the variable is absent. Set it to any 32-byte hex value
before running the suite — the value is never used by these tests, it only has to parse:

```bash
MASTER_KEY=$(printf 'a%.0s' {1..64}) node --import tsx --test apps/server/src/__tests__/*.test.ts
```

Without it the suite reports one "failing test" that is an environment problem, not a code
regression — check for this before investigating a failure in that file.

## Review Checklist

- Shared contract and route schema agree.
- Status codes and error shapes preserve client behavior.
- Authentication and ownership are both present.
- Database upgrade behavior works for existing files, not only fresh databases.
- Secrets do not appear in responses, logs, fixtures, or database plaintext.
- Background work reaches one terminal status and cancellation remains authoritative.
- Relevant validation completed, or blockers are recorded.

## Scenario: Docker Compose Release Validation

### 1. Scope / Trigger

- Trigger when `Dockerfile`, `docker-compose.yml`, build scripts, workspace manifests, or production environment wiring changes.

### 2. Signatures

- Configuration check: `docker compose config`
- Image build: `docker compose build app`

### 3. Contracts

- Copy `.env.example` to a temporary `.env` on the CI runner before Compose validation.
- The validation must build the `app` service from the repository `Dockerfile`.
- Validation must not require production secrets, start services, publish images, or mutate persistent data.

### 4. Validation & Error Matrix

- Invalid Compose interpolation or service configuration -> `docker compose config` exits non-zero.
- Dockerfile, lockfile, workspace, type-check, or bundle failure -> `docker compose build app` exits non-zero.
- Missing optional provider credentials -> configuration and image build still succeed; runtime provider calls are out of scope.

### 5. Good/Base/Bad Cases

- Good: CI runs type-check/build, validates Compose, and builds `app` from a clean checkout.
- Base: `.env.example` contains empty optional credentials and the image still builds.
- Bad: CI starts Caddy/app, uses a developer `.env`, or treats a locally cached image as proof of reproducibility.

### 6. Tests Required

- Assert the workflow retains `npm ci`, `npm run typecheck`, and `npm run build`.
- Assert `docker compose config` passes from a clean checkout with `.env.example` copied to `.env`.
- Assert `docker compose build app` completes on the GitHub Actions runner.

### 7. Wrong vs Correct

#### Wrong

```yaml
- run: docker compose up -d
```

This introduces runtime ports, certificates, state, and secret requirements into a build gate.

#### Correct

```yaml
- run: cp .env.example .env && docker compose config
- run: docker compose build app
```
