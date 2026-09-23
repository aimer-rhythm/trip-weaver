# Database Guidelines

## Stack and Startup

The server uses PostgreSQL (Neon) with Drizzle ORM (`drizzle-orm/pg-core`; migrated 09-18,
superseding the old better-sqlite3 stack). `apps/server/src/db/client.ts` resolves
`env.databaseUrl`, creates the pg Pool, runs migrations, and exports the Drizzle client.
Importing the client during bootstrap performs this setup.

Migrations are idempotent startup SQL in `apps/server/src/db/migrate.ts`
(`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`), executed in one transaction.
The pgvector extension is optional: when unavailable, embedding columns are skipped and
vector search degrades to null. Keep database work async; the pg driver is asynchronous.

## Schema and Migration Dual-Update Contract

Every database shape change must update both files in the same change:

1. `apps/server/src/db/schema.ts` defines the typed Drizzle model used by application code.
2. `apps/server/src/db/migrate.ts` defines idempotent startup SQL for fresh databases and
   `ensureColumn`/index operations for existing databases.

This project intentionally does not use a drizzle-kit migration history. A change only in
`schema.ts` typechecks but fails on upgraded databases; a change only in `migrate.ts` leaves
Drizzle types inaccurate. `scripts/verify-c2.mjs` creates a legacy `generations` table and
checks that startup migration adds current audit columns.

**Ordering rule for columns added later**: an index on a column that did not exist originally must be
created *after* the `ADD COLUMN IF NOT EXISTS` statements, never inside the `STATEMENTS` array. The
array runs first, so on an existing database `CREATE INDEX ... ON trips(root_id)` fails with
`column "root_id" does not exist` before the column is ever added. The same applies to backfills:
add the column, `UPDATE ... WHERE col IS NULL`, then `ALTER COLUMN col SET NOT NULL`, in that order.
`verify-c2.mjs` seeds a legacy row rather than an empty table, because `SET NOT NULL` cannot fail on
an empty table and would therefore hide a broken backfill.

## Naming and Storage Representation

- Drizzle properties use camelCase; SQLite columns use snake_case.
- Identifiers are text IDs produced by the shared `uid()` helper.
- Timestamps are `TIMESTAMPTZ` columns written with `new Date()`.
- `trips.data` is the full JSON `Trip` source of truth; list columns are derived indexes and
  must be recomputed from the document on writes.

Representative paths: `apps/server/src/db/schema.ts`,
`apps/server/src/services/tripService.ts`, `packages/shared/src/schemas.ts`.

## Query and Ownership Patterns

- Include `userId` in protected read, update, and delete predicates.
- Return `null`/`false` for missing or non-owned resources so routes use the same 404.
- Use Drizzle query helpers rather than SQL string concatenation.
- Migration batches run inside a single PG transaction (BEGIN/COMMIT in `runMigrations`).

Representative paths: `apps/server/src/services/tripService.ts`,
`apps/server/src/services/quotaService.ts`, `apps/server/src/generation/jobManager.ts`.

## Common Mistakes

- Updating only one half of the schema/migration contract.
- Treating derived trip list columns as authoritative instead of `trips.data`.
- Accepting client-controlled `id`, `createdAt`, or ownership fields.
- Omitting `userId` from a mutation predicate.
