# Database Guidelines

## Stack and Startup

The server uses `better-sqlite3` with Drizzle ORM. `apps/server/src/db/client.ts`
resolves `env.databasePath`, creates its parent directory, opens SQLite, runs migrations,
and exports the Drizzle client. Importing the client during bootstrap performs this setup.

SQLite is configured with WAL mode and foreign key enforcement in
`apps/server/src/db/migrate.ts`. Keep database work synchronous unless the surrounding
operation is asynchronous for another reason; the selected driver is synchronous.

## Schema and Migration Dual-Update Contract

Every database shape change must update both files in the same change:

1. `apps/server/src/db/schema.ts` defines the typed Drizzle model used by application code.
2. `apps/server/src/db/migrate.ts` defines idempotent startup SQL for fresh databases and
   `ensureColumn`/index operations for existing databases.

This project intentionally does not use a drizzle-kit migration history. A change only in
`schema.ts` typechecks but fails on upgraded databases; a change only in `migrate.ts` leaves
Drizzle types inaccurate. `scripts/verify-c2.mjs` creates a legacy `generations` table and
checks that startup migration adds current audit columns.

## Naming and Storage Representation

- Drizzle properties use camelCase; SQLite columns use snake_case.
- Identifiers are text IDs produced by the shared `uid()` helper.
- Timestamps are integer epoch milliseconds from `Date.now()`.
- SQLite booleans are integer `0`/`1`; convert on service boundaries.
- `trips.data` is the full JSON `Trip` source of truth; list columns are derived indexes and
  must be recomputed from the document on writes.

Representative paths: `apps/server/src/db/schema.ts`,
`apps/server/src/services/tripService.ts`, `packages/shared/src/schemas.ts`.

## Query and Ownership Patterns

- Include `userId` in protected read, update, and delete predicates.
- Return `null`/`false` for missing or non-owned resources so routes use the same 404.
- Use Drizzle query helpers rather than SQL string concatenation.
- Use SQLite transactions for migration batches and atomic multi-step operations.

Representative paths: `apps/server/src/services/tripService.ts`,
`apps/server/src/services/quotaService.ts`, `apps/server/src/generation/jobManager.ts`.

## Common Mistakes

- Updating only one half of the schema/migration contract.
- Treating derived trip list columns as authoritative instead of `trips.data`.
- Accepting client-controlled `id`, `createdAt`, or ownership fields.
- Omitting `userId` from a mutation predicate.
