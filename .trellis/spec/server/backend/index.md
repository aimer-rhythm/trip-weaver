# Server Backend Guidelines

These guidelines describe the code that actually exists in `apps/server`. They are the
entry point for server work and override generic inherited placeholders where the server
has a more specific convention.

## Guides

- [Directory structure](./directory-structure.md): module roles, naming, route/service boundaries, and shared contracts.
- [Database guidelines](./database-guidelines.md): Drizzle/SQLite schema, startup migrations, ownership queries, and storage representations.
- [Error handling](./error-handling.md): global, route, service, and integration failure behavior.
- [Logging guidelines](./logging-guidelines.md): Fastify/Pino usage, levels, context, and secret redaction.
- [Security guidelines](./security-guidelines.md): authentication, sessions, OAuth, encryption, SSRF, and environment bootstrap.
- [Integration guidelines](./integration-guidelines.md): external source adapters, Null implementations, caches, queues, limits, and accounting.
- [Generation guidelines](./generation-guidelines.md): background jobs, SSE, cancellation, persistence, and single-instance limitations.
- [Quality guidelines](./quality-guidelines.md): validation rules and the real command matrix.

## Pre-Development Checklist

- Identify the owning module under `apps/server/src` and reuse its existing route, service, integration, or generation boundary.
- Read the relevant contracts in `packages/shared/src/schemas.ts` and `packages/shared/src/types.ts` before changing an API payload.
- For protected data, plan both `requireAuth` and a `userId` ownership predicate; authentication alone is not authorization.
- For every request input, plan a TypeBox schema for `body`, `params`, and/or `querystring` rather than relying on casts.
- For database shape changes, plan matching edits to both `apps/server/src/db/schema.ts` and `apps/server/src/db/migrate.ts`.
- For outbound calls, identify timeout, SSRF, Null fallback, cache, serialization, task limit, and quota/accounting behavior.
- Check whether a verification script needs a built `apps/web/dist` or starts its own isolated server.

## Quality Check Checklist

- Run `npm run typecheck` from the repository root for shared, server, and web TypeScript checking.
- Run the smallest relevant verification script from [Quality guidelines](./quality-guidelines.md).
- Confirm protected reads and writes are filtered by the authenticated `userId` and return non-enumerating failures such as 404 where appropriate.
- Confirm request schemas cover every changed input surface and response bodies do not expose secrets.
- Confirm schema and migration definitions remain synchronized.
- Confirm expected integration failures degrade without aborting generation, while programming and persistence failures remain visible.
- Run `git diff --check -- .trellis/spec/server/backend .trellis/spec/server/frontend` for documentation changes.
