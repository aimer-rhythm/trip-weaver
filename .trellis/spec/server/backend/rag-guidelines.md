# RAG Retrieval Guidelines

Scope: the verified-place knowledge path — `canonical_places` / `research_evidence`
retrieval, its prompt injection points, the embedding client, and the offline scripts that fill
those tables. The storage-selection rationale (pgvector over a dedicated vector database) lives
in `docs/TECHNICAL_ARCHITECTURE.md` §4.3; the runtime chain in §4.4.

## Retrieval Is Optional Enrichment, Never a Gate

Retrieval must never block, fail, or stretch generation toward its 10-minute job timeout. Every
layer degrades silently:

| Failure | Behavior |
| --- | --- |
| pgvector extension missing | startup migration skips the `embedding` columns; startup warns only |
| `EMBEDDING_*` unset | `hasEmbedding()` is false; vector layer skipped |
| embedding HTTP failure | that batch becomes `null`; other batches continue |
| missing `embedding` column during backfill | script logs and skips that table, exit 0 |
| any `retrieveContext` exception | `console.warn` + return `[]` |

Consequences to preserve: `retrieveContext` never throws to the orchestrator, and an empty
result must leave the planner prompt byte-identical to a run without RAG (this is what keeps the
golden set reproducible). Do not surface retrieval failure in `JobStatus`, SSE events, or
`generations`.

## Scenario: Hybrid Recall and Prompt Injection

### 1. Scope / Trigger

Apply when changing `generation/retrieveContext.ts`, the planner prompt builders in
`generation/prompts.ts`, the `search_verified_places` research tool, the `canonical_places` /
`research_evidence` schemas, or the embedding client.

### 2. Signatures

- `retrieveContext(names: string[], options?: RetrieveOptions): Promise<RetrievedPlace[]>`
- `RetrievedPlace { name: string; category: string; verified: boolean; evidence: EvidenceItem[] }`
- `EvidenceItem { kind: string; content: string; strength: string }` — `strength` is the evidence tier:
  `direct` (may be stated as fact) / `weak` (soft phrasing only) / `risk_only` (conditional
  warnings only); empty falls back to `weak`. The migration backfills it from `kind`; the
  external pipeline may write finer labels.
- `RetrieveOptions { city?: string }`
- `embedTexts(texts: string[]): Promise<(number[] | null)[]>` in `integrations/embedding.ts`
- `hasEmbedding(): boolean` in `apps/server/src/env.ts`
- ~~`renderRagContext(ragContext?: RetrievedPlace[]): string`~~ and
  ~~`plannerUserPrompt(form, research, revisionRequests?, longHaulIntel?, currentDraft?, ragContext?)`~~
  — both deleted in 09-25. `retrieveContext` is now consumed ONLY by the research agent's
  `search_verified_places` tool; the "inject RAG into the planner prompt" path is gone because the
  planner is code, not a model.

### 3. Contracts

- Two layers merge into at most 8 places. Keyword recall is mandatory and dependency-free:
  exact `name = ANY($1)` matches first, then prefix `LIKE ANY($2)`, always filtered by
  `verified = TRUE`. Vector recall is optional: `ORDER BY embedding <=> $1`.
- The merge is id-deduplicated concatenation followed by `slice(0, 8)`. There is no RRF, no
  weighted fusion, and no reranker. Keep it that way until a measured quality gap justifies the
  extra machinery — keyword-only behavior is the reference.
- `options.city` adds `AND city = $x` to BOTH layers, which is what prevents cross-city
  contamination. Omitting it must reproduce the pre-city-filter behavior exactly; it is a scope
  filter, not a ranking change.
- Evidence attaches per place, at most 3 rows, ordered by kind priority
  (`xhs_warning` > `xhs_reservation` > `xhs_price` > everything else), then strength
  (`direct` > `risk_only` > `weak`), then `fetched_at DESC`.
  Evidence text enters the prompt verbatim (each item truncated to 80 chars) — never route it
  through an extra summarizing model call.
- Injection has two entry points: an automatic pre-planner call in the orchestrator
  (`orchestrator.ts`, between research and the plan loop) and the research-phase
  `search_verified_places` agent tool. The planner prompt builder is shared by round 1 and
  revision rounds, so retrieved intel stays visible in every round.
- The research phase is knowledge-base-first: `search_verified_places` is the primary source and
  `search_pois` only supplies place facts (coordinates/address/cover image). `search_web` is a
  degraded fallback — `researchSystemPrompt({ searchWebMax })` allows it only after repeated
  knowledge-base misses, and the cap is coverage-dependent (09-25): `cityCoverage()` counts verified
  `canonical_places` rows for the destination city; ≥ `CITY_COVERAGE_THRESHOLD` (100) keeps the cap
  at 2, below it the cap relaxes to 6 (constants + `searchWebMaxFor` in
  `services/cityCoverageService.ts`; the threshold cleanly separates 北京 1349 / 成都 411 from the
  ≤21 tail). The process-level cache assumes city coverage changes only via offline imports.
  `SEARCH_DAILY_BUDGET` still gates everything. Do not restore
  the old "always search the web for opening hours/tickets" workflow.
- The vector layer queries `canonical_places` ONLY. `research_evidence.embedding` is written by
  the backfill script but read by nothing; do not assume evidence vectors change results.
- Embedding dimension is 1024 and must match BOTH `EMBEDDING_DIMS` and the `vector(1024)`
  column. A model or dimension change requires `DROP COLUMN` + re-add + re-backfill, because
  pgvector cannot alter a column's dimension in place.
- Embeddings use site-level credentials only (`EMBEDDING_*`, falling back to `SITE_LLM_*`).
  A user's BYOK key must never reach the embedding endpoint.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| `names` empty | return `[]` without touching the database |
| `embedding` column absent (upgraded DB without the extension) | keyword layer only |
| `EMBEDDING_DIMS` ≠ 1024 | skip the vector layer, `console.warn`, keyword layer only |
| embedding batch returns an unexpected dimension | that item becomes `null`, batch continues |
| the vector-layer query throws | caught locally; keyword results survive |
| retrieval returns nothing for the research keyword | `search_verified_places` returns the "换关键词、再用 search_web 兜底" hint; job unaffected |
| knowledge base returns nothing for the user's city | research still produces a pool: `search_pois` + model knowledge, with `search_web` allowed as fallback (cap 2 when covered / 6 when uncovered) |

### 5. Good / Base / Bad Cases

- Good: research produced 12 candidates; keyword recall hits 5 verified places, the vector layer
  adds 3 more, each carries up to 3 evidence items, and the research agent sees that evidence
  inline in the `search_verified_places` output it just called.
- Base: no `EMBEDDING_*` configured — output is identical to a keyword-only deployment, with no
  startup failure and no user-visible degradation banner.
- Bad: letting `retrieveContext` throw and failing the job; sending a user's BYOK key to the
  embedding endpoint; reordering keyword recall and calling it a RAG improvement.

### 6. Tests Required

- Offline data check: `npx tsx apps/server/test-rag-data-check.mts` (row counts, embedding
  coverage, covered cities).
- Real job: `npx tsx apps/server/test-beijing-rag.mts` reports `search_verified_places` call
  counts and candidate quality.
- `npm run typecheck` after touching `RetrievedPlace` or the prompt signature — `ragContext`
  must stay the LAST and OPTIONAL parameter so every existing call site still compiles.

### 7. Wrong vs Correct

```typescript
// Wrong: retrieval becomes a hard dependency of the job.
const places = await retrieveContext(names, { city });
if (!places.length) throw new GenerationFailure('无已验证地点情报');

// Correct: retrieval is enrichment; an empty result changes nothing.
const places = await retrieveContext([keyword], { city: destination });
if (!places.length) return { content: text(FALLBACK_HINT), details: { count: 0 } };
```

Representative paths: `apps/server/src/generation/retrieveContext.ts`,
`apps/server/src/generation/prompts.ts`, `apps/server/src/generation/orchestrator.ts`,
`apps/server/src/generation/tools/researchTools.ts`,
`apps/server/src/integrations/embedding.ts`, `apps/server/src/env.ts`.

## Scenario: Offline Knowledge Ingestion

### 1. Scope / Trigger

Apply when adding or rerunning a script that fills `canonical_places` / `research_evidence`, or
when changing the meaning of `source` / `verified` for those tables.

### 2. Signatures

- `apps/server/scripts/seed-canonical-places.ts` — golden-set snapshots → `source='goldset'`,
  `verified=true`; ids derived from city+name, so reruns skip existing rows
- `apps/server/scripts/seed-xhs-places.ts` — community library export → `source='xhs'`;
  `--purge` deletes only rows this source owns
- `apps/server/scripts/seed-xhs-relations.ts` — community POI association pairs
  (`import/xhs-place-relations-{city}.json`) → `place_relation`; imports `strength='direct'` only,
  upserts on `(city, from_name, to_name)`
- `apps/server/scripts/lib/exportFiles.ts` — shared export scanner: `scanExports(dir)` /
  `latestExports(files)` / `readExport(path)`; version identity is `sha256(file bytes)[:32]`
- `apps/server/scripts/check-data-freshness.ts` — read-only diff of the newest on-disk exports
  against `data_import`; exits 1 when anything is pending
- `data_import(source, city, content_hash, file_path, row_count, imported_at)` — PK `(source, city)`,
  `source` is `xhs_places` | `xhs_relations`
- `apps/server/scripts/embed-backfill.ts` — idempotent embedding backfill (`WHERE embedding IS
  NULL`); `--tables places` limits it to `canonical_places`
- `apps/server/scripts/restore-goldset.ts` — repairs rows whose `source`/`payload` were clobbered

### 3. Contracts

- There is no online write path. The generation pipeline READS these tables (the `add_candidate`
  enrichment reads community rows for reservation policy and source links); all writes come from
  operator-run offline scripts.
- Scripts must be idempotent and rerunnable, and a rerun of one source must never touch rows
  owned by another. The community importer updates only `WHERE canonical_places.source = 'xhs'`,
  because the same real place can exist as a `goldset` row with the same id.
- **The `goldset` merge must not silently out-rank incoming values.** That branch merges with
  `EXCLUDED.payload || canonical_places.payload`, and jsonb `||` lets the RIGHT operand win — so
  every key present in both sides is frozen at its first-imported value. `recommendScore` /
  `mentionCount` are what this bites. The trailing `CASE` must therefore write the incoming values
  in its `ELSE` branch; returning `'{}'` there assumes the new value already won, and it does not.
  Symptom when broken: 故宫博物院 sat at `17.33 / 6` while upstream had `137.64 / 55`, so scheduling
  dropped it at rank 11 of a 3-day Beijing itinerary. Only `goldset` rows are affected — community
  rows take the other branch, which has no such re-merge.
- **The seeder's default input must not be a hard-coded single file.** `import/` accumulates several
  exports per city under inconsistent names (`xhs-places.json` / `xhs-places-beijing.json` /
  `xhs-places-北京.json`), so a hard-coded default silently imports a stale version. The contract is
  newest `generatedAt` per `(source, city)` via `latestExports`; passing an explicit path imports
  exactly that file.
- **Version identity is the content hash, not `generatedAt`.** The relations export carries no
  `generatedAt`, so `sha256(file bytes)[:32]` is the only identifier that works for both kinds; a
  missing `generatedAt` falls back to the file's mtime date for display only.
- **Every import writes one `data_import` row inside the SAME transaction as the data.** A record
  written separately could claim a version the rows do not match, which is worse than no record.
  `check-data-freshness.ts` compares `content_hash` and is read-only — it must stay out of the
  generation hot path.
- A city present on disk but absent from `data_import` is "never imported", not "no data". This is
  how 重庆's 604-row export stayed invisible while the DB held only its 19 golden-set rows.
- Re-importing rewrites `embedding` (typically to `NULL`) for the rows it touches, so
  `embed-backfill.ts` must be rerun after every import.
- `verified` means "adopted into the project's curated pool", not "crawled". Retrieval filters on
  `verified = TRUE`, so an unverified import is invisible to generation by design.
- Backfill treats a missing `EMBEDDING_*` config or a missing `embedding` column as a normal
  skip with exit code 0.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Importer rerun without `--purge` | upsert; existing ids updated, no duplicates |
| Imported row collides with a golden-set id | golden-set row keeps its identity fields, but `recommendScore` / `mentionCount` take the **higher** of the two |
| `import/` holds several exports for one city | newest `generatedAt` wins; older files stay on disk as history |
| Community score for a seeded place rises upstream but the row keeps the old value | the `goldset` merge order is inverted — see the Contracts entry above |
| `import/` holds several exports for one city | `latestExports` keeps the newest `generatedAt`; older files stay on disk as history |
| relations export has no `generatedAt` | falls back to file mtime for display; the content hash is still the version identity |
| `data_import` disagrees with the rows actually present | rerun the seeders — the record is written in the same transaction as the data, so a mismatch means a write happened outside the seeder |
| a city exists on disk but not in `data_import` | reported as “从未导入”; it is not a “no data” case |
| `EMBEDDING_*` unset during backfill | notice printed, exit 0, no partial state |
| Some embedding batches fail | those rows keep `NULL`; a rerun retries exactly them |

### 5. Good / Base / Bad Cases

- Good: import the community library, rerun `embed-backfill.ts`, then confirm counts with
  `test-rag-data-check.mts` before deploying.
- Base: rerun the golden-set seeder on an unchanged snapshot — zero inserts, no duplicate rows.
- Bad: an importer that overwrites another source's `source`/`payload` on id collision (this
  happened once; `restore-goldset.ts` exists because of it).

### 6. Tests Required

- `npx tsx apps/server/test-rag-data-check.mts` after every import: the `goldset` count must be
  unchanged, `verified` rows must cover the golden-set cities, and embedding coverage must match
  the last backfill.
- `npx tsx apps/server/scripts/check-data-freshness.ts` after every import: must print
  “全部与磁盘最新导出一致” and exit 0. Before importing, it must report the pending cities.
- `apps/server/src/__tests__/exportFiles.test.ts` — recognises only the two export kinds, keeps
  exactly one entry per `(source, city)` at the newest `generatedAt`, empty input → empty output.
- `npx tsx apps/server/scripts/verify-xhs-service.ts` exercises the read helpers
  (`findXhsPlace` / `findXhsEvidence` / `findXhsPlacesByCategory` / `xhsPlaceStats`) against the
  imported data.

### 7. Wrong vs Correct

```sql
-- Wrong: clobbers golden-set rows that share an id with the imported library.
INSERT INTO canonical_places ... ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source;

-- Correct: only update rows this source already owns.
INSERT INTO canonical_places ... ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source
WHERE canonical_places.source = EXCLUDED.source;
```

```sql
-- Wrong: the ELSE assumes the incoming score already won, but jsonb `||` gives the RIGHT side
-- priority — so `EXCLUDED.payload || canonical.payload` leaves the OLD score in place and the
-- incoming file's score is discarded forever.
payload = EXCLUDED.payload || canonical_places.payload
       || CASE WHEN canon_score >= excl_score THEN jsonb_build_object('recommendScore', canon) ELSE '{}'::jsonb END

-- Correct: write the incoming score explicitly when it is the higher one.
payload = EXCLUDED.payload || canonical_places.payload
       || CASE WHEN canon_score >= excl_score THEN jsonb_build_object('recommendScore', canon)
               ELSE jsonb_build_object('recommendScore', EXCLUDED.payload->'recommendScore') END
```

Representative paths: `apps/server/scripts/`, `apps/server/test-rag-data-check.mts`.

## Scenario: Upstream Community Enrichment (openHours / aliases / place_relation)

### 1. Scope / Trigger

Apply when changing how the community pipeline's derived data is consumed: `payload.openHours`,
`payload.aliases` on `canonical_places`, or the `place_relation` table; also when changing
`generation/scheduling/placeFacts.ts`, `generation/scheduling/placeRelations.ts`,
`generation/scheduling/buildDraft.ts` (scheduling inputs), `scripts/seed-xhs-relations.ts`, or the
`place_relation` DDL in `db/schema.ts` / `db/migrate.ts`.

### 2. Signatures

- `place_relation(id TEXT PK, city TEXT, from_name TEXT, to_name TEXT, strength TEXT,
  note_count INTEGER, created_at TIMESTAMPTZ)` — UNIQUE `(city, from_name, to_name)`; the pair is
  UNDIRECTED, stored once with `from_name < to_name`
- `seed-xhs-relations.ts [path.json ...]` — default scans `import/xhs-place-relations-{city}.json`
  for 北京/成都/广州/杭州/厦门
- `loadPlaceRelations(city: string): Promise<PlaceRelations>` where
  `PlaceRelations = ReadonlyMap<normalizedKey, readonly normalizedKey[]>`
- `resolveRelatedPairs(relations, candidateNames): Set<string>` — candidate-pool names, not keys
- `relatedPairKey(a: string, b: string): string` in `scheduling/schedule.ts`
- `ScheduleOptions.relatedPairs?: ReadonlySet<string>`
- `renderOpenHours(raw: unknown): string | undefined` in `scheduling/placeFacts.ts`
- `PlaceFacts.openTime?: string`, `PlaceFacts.aliases: string[]`

### 3. Contracts

- The association pair is UNDIRECTED by upstream contract («顺序由消费端决定»). Consume it as a
  same-day clustering signal only. Never emit `orderConstraints` from it — ordering seeds stay in
  `data/routeOrderSeeds.json`.
- `strength` is upstream's evidence tier: `direct` (≥2 notes) / `weak` (single note). Only `direct`
  is imported; `weak` may just be an arrow in a post's layout.
- The discount is applied ONLY in `buildChain`'s nearest-neighbour comparison (`distanceKm × 0.5`).
  It never changes coordinates, coordinates-derived legs, `orderSegment`, day assignment, or the
  feasibility simulation.
- Name alignment: both sides of `resolveRelatedPairs` go through `normalizePlaceKey`. The returned
  pair key uses the candidate pool's ORIGINAL name (untrimmed) because `buildChain` compares against
  `poi.name` verbatim — trimming here silently disables every discount.
- `openTime` precedence in `buildDraft`: `facts.openTime` (structured, carries `closedWeekdays`) >
  `poi.openTime` (Amap raw text) > `facts.closureText` (regex-mined evidence fallback).
- `payload.aliases` extends the `loadPlaceFacts` grouping keys: group key = primary
  `normalizePlaceKey(name)` plus `normalizePlaceKey(alias)` for every alias. Any key hitting a row
  serves that row's facts; `mergeFacts` then unions `aliases` across members.
- `renderOpenHours` renders `closedWeekdays` (ints, 0=Sunday, matching `Date.getDay()`) into the
  same free-text shape `isClosedOnDate` already parses, so `packages/shared/src/openHours.ts` needs
  no signature change and the feasibility engine picks it up for free.
- All three are optional enrichment. Missing → scheduling output byte-identical to before.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| `place_relation` empty for the city | `loadPlaceRelations` returns an empty Map; scheduling unchanged |
| `place_relation` query throws | `console.warn('[placeRelations] ...')` + empty Map; job continues |
| relation JSON file missing | `seed-xhs-relations.ts` warns and skips that city |
| all relation files missing | seed exits 1 with the upstream command hint |
| seed rerun | `ON CONFLICT (city, from_name, to_name) DO UPDATE`; row count stable |
| `payload.openHours` absent | `renderOpenHours` → `undefined`; falls back to `poi.openTime` / `closureText` |
| `closedWeekdays` out-of-range or non-numeric | filtered out; no remaining content → `undefined` |
| `payload.aliases` absent for a city | grouping keys degrade to the pre-09-27 single key |
| a relation pair has only one side in the candidate pool | pair dropped; no discount |

### 5. Good / Base / Bad Cases

- Good: 北京 imports 79 `direct` pairs; a pool containing 故宫 + 景山 keeps them on the same day,
  and 香山双清别墅's `closedWeekdays:[1]` keeps it off a Monday.
- Base: a city with no enrichment data schedules exactly as before the change — no discount, no
  structured hours, a single grouping key.
- Bad: turning an undirected pair into a `before`/`after` constraint (fabricates a direction the
  upstream data never asserted); letting a failed `place_relation` query abort generation.

### 6. Tests Required

- `apps/server/src/__tests__/placeRelations.test.ts` — bidirectional key registration, candidate
  cross-match against alias forms, single-sided pairs dropped, empty pool, empty city.
- `apps/server/src/__tests__/placeFacts.test.ts` — `renderOpenHours` output and all `undefined`
  cases; `payload.aliases` reaching a row the primary key cannot match (双清别墅 → 香山双清别墅);
  `openHours` landing in `facts.openTime`.
- `apps/server/src/__tests__/scheduling.test.ts` — a `relatedPairs` hit pulls two points into the
  same day; absent/empty `relatedPairs` reproduces the baseline chain exactly.
- Assertion points: `buildSchedule(...).days[i].stops` names and day assignment — not internals.
- Local DB integration tests skip (not fail) when the enrichment data was never imported.

### 7. Wrong vs Correct

```typescript
// Wrong: undirected data turned into a directional constraint.
const relations = await loadPlaceRelations(city);
orderConstraints: [...relations.keys()].map(...)   // fabricates a 先后 the upstream never claimed

// Correct: same-day clustering only — a distance discount inside the chain builder.
relatedPairs: resolveRelatedPairs(relations, input.pool.map((p) => p.name)),
// … buildChain compares distanceKm × RELATED_DISCOUNT for pairs in that set.
```

Representative paths: `apps/server/src/generation/scheduling/placeRelations.ts`,
`apps/server/src/generation/scheduling/placeFacts.ts`,
`apps/server/src/generation/scheduling/buildDraft.ts`, `apps/server/src/db/migrate.ts`,
`apps/server/scripts/seed-xhs-relations.ts`.

## Scenario: Attraction Cover Images (payload.coverImage → /media)

### 1. Scope / Trigger

Apply when changing where an attraction's `coverUrl` comes from: the stored-cover lookup, the
`/media` static route, `MEDIA_BASE_URL`, `scripts/seed-xhs-place-images.ts`, the upstream
`export_place_images.py` manifest, or `researchTools.resolveCover`'s URL acceptance rule.

Background: the Wikimedia fallback cannot serve mainland users — `upload.wikimedia.org` and the
rest of the Wikimedia media servers are blocked in China. The order is therefore: stored library
(real photos, but only Beijing/Guangzhou/Hangzhou) → Pexels (any city, ~45–50% textual gate) → Amap
POI photos (China-reachable and tied to the exact POI, but burns the scarce search quota) → live
wiki lookup (overseas/proxied environments only).

### 2. Signatures

- Manifest `import/xhs-place-images-{city}.json`:
  `{ city, generatedAt, count, images: [{ placeId, placeName, key, width, height, bytes, score, sourceUrl }] }`
- `placeId` = `sha256(city + name)[:32]` — the SAME algorithm as `canonical_places.id`. Upstream's
own auto-increment id must never be exported: it matches no row here and the import silently
writes nothing.
- `key` = `xhs/{city}/{placeId}/{index}.webp` — a RELATIVE key. No `/media` prefix, no host.
- Upstream producer: `xhs-travel-pipeline/scripts/export_place_images.py [--city] [--out] [--media-root]
  [--max-per-place] [--dry-run]`; `export_and_embed.ps1 -WithImages` chains it after the places import.
- Importer: `tsx apps/server/scripts/seed-xhs-place-images.ts [path.json ...]` — run AFTER
  `seed-xhs-places.ts`, because a key can only be written onto an existing row.
- `createStoredPlaceLookups(city, loadFacts = loadCityPlaceFacts)` returns `coverFor(name)`,
  `amapPhotoFor(name)`, `pointFor(name)`; the orchestrator shares this instance per generation.
- `loadCityPlaceFacts(city)` returns the complete normalized-name/alias index;
  `loadPlaceFacts(names, city)` returns only the requested names (trimmed, otherwise unchanged).
- `createStoredCoverLookup(city)` / `createStoredAmapPhotoLookup(city)` remain convenience wrappers.
- `mediaUrl(key: string, base = env.mediaBaseUrl): string | null` — same file
- `PlaceFacts.coverImage?: string` in `generation/scheduling/placeFacts.ts`
- `env.mediaBaseUrl` ← `MEDIA_BASE_URL` (default `/media`; trailing slashes stripped)
- Fastify route `/media/` → `path.resolve(__dirname, '../../../data/media')`, registered in dev AND
  prod, with `decorateReply: false`

### 3. Contracts

- **Store the relative key, never a URL.** The display prefix comes from `MEDIA_BASE_URL` at read
  time, so switching from the local disk to object storage is an env-var change, not a re-import.
- Resolution order in `add_candidate` (attraction only): stored library → Pexels → Amap POI photos →
  Chinese Wikipedia → empty. Each hit short-circuits the remaining sources and their request budgets.
  The four-source contract lives in the integration guidelines under *Attraction Cover Sources*.
- URL acceptance is deliberately wider than the wiki path: `isUsableCoverUrl` accepts `http(s)://`
  OR a leading `/` (same-origin `/media/...`). The wiki result still requires `https://`.
- `mergeFacts` takes `coverImage` from any member of a normalized group — split rows (「故宫」 vs
  「故宫博物院」) share one exported image.
- Images never enter the database or the Docker image: `data/media/` is gitignored and mounted
  read-only into the container (`./data/media:/app/data/media:ro`). The DB stores keys; the host
  stores bytes; they are synced separately.
- The route is skipped when `data/media` does not exist, so a fresh clone still boots.
- Vite must proxy `/media` to the same Fastify backend as `/api`. A 200 HTML SPA fallback is
  NOT a valid media response; verify `image/webp` and browser decoding.
- Cache the full `loadCityPlaceFacts` index, never the candidate subset returned by
  `loadPlaceFacts([firstName], city)`. The latter silently loses every later name, including
  coordinates required for the Wikimedia fallback. Empty city/name does not load the index.
- Re-importing xhs places preserves independently maintained `coverImage` and `amapPhoto` fields,
  while other upstream-owned payload fields refresh normally. Image imports choose the FIRST
  valid manifest entry per place; upstream order is preference order, not last-write-wins.
- Saved trips contain a cover snapshot in `overview`; library imports do not update old trips.
  A targeted backfill must preserve other trip content, save a backup, and protect against
  concurrent edits with an owner-scoped compare-and-swap write.
- Upstream keeps `sourceUrl` (the Xiaohongshu CDN link, ~24 h signed) for provenance and takedown
  only. The file has already been copied locally; the link is never used for display.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| `payload.coverImage` absent | stored lookup → `null`; continue with Pexels, Amap, then wiki |
| `PEXELS_API_KEY` unset | Pexels source skipped silently; covers behave exactly as before that change |
| Amap POI `photos` empty or name mismatch | `pickPhoto` → `null` (negative-cached 24 h) → wiki |
| Amap search quota exhausted (`status≠1`) | `null`, not cached, one `[amap-photo]` warn; later candidates fall through |
| `payload.amapPhoto` already set | read from the DB — no request, never overwritten |
| `saveAmapPhoto` write fails | warn only; this generation keeps the working URL and continues |
| Pexels results carry no textual match | `pickCover` → `null` (negative-cached 24 h) → Amap → wiki |
| Pexels budget exhausted (8 per generation / 180 per hour) | `null` without a request; later candidates fall through |
| `canonical_places` query throws | `loadPlaceFacts` warns and returns an empty Map → `null`; generation continues |
| City argument empty | `createStoredCoverLookup` returns `null` without touching the DB |
| `MEDIA_BASE_URL` empty string | `str()` falls back to `/media`; URLs stay same-origin |
| `data/media` missing at boot | `/media` route not registered; nothing else changes |
| key in DB but file missing | `/media/...` → 404 → `PoiCard` `onerror` → category placeholder |
| place id not in `canonical_places` (wrong run order) | importer skips it and warns; exits 0 |
| importer rerun | `payload \|\| jsonb_build_object('coverImage', key)`; other payload keys untouched |
| first candidate has no cover / no matching row | later candidates still query the full city index |
| duplicate place entries in image manifest | first entry wins; repeated import is idempotent |
| upstream source image missing/unreadable | count as `skipped`, keep going; manifest lists only written files |

### 5. Good / Base / Bad Cases

- Good: 杭州 exports 34 covers (4.6 MB after webp q80, ~137 KB each); 33 land on existing rows; a
  generated 杭州 trip renders `/media/xhs/杭州/{placeId}/00.webp` with no wiki request.
- Base: a city with no exported images behaves exactly as before — wiki fallback, then the category
  icon.
- Bad: exporting upstream's `canonical_place.id` (auto-increment) as `placeId` — every row misses and
  the importer reports「不在库里」for the whole city.

### 6. Tests Required

- `apps/server/src/__tests__/storedCover.test.ts` — key→URL joining for `/media`, absolute CDN base,
  trailing slash, leading slash on the key, empty key → `null`, empty city → `null` without a query.
  Also cover multiple sequential/concurrent names after a first miss, shared loading across the
  three readers, aliases, city isolation, and real database full-index/subset boundaries.
- `apps/server/src/__tests__/imageImport.test.ts` — real seed scripts in a disposable database:
  retain both image fields through place re-import, refresh other payload fields, first-image
  selection and idempotence. Never run against application data.
- `apps/server/src/__tests__/exportFiles.test.ts` — `xhs-place-images-*.json` is recognized as its own
  source with `rowCount` from `images`, and is NOT swallowed by the `xhs-places*` pattern.
- `apps/server/src/__tests__/placeLookup.test.ts` — a stored `/media/...` value is accepted and no
  wiki request is made.
- `apps/server/src/__tests__/placeFacts.test.ts` — `mergeFacts` picks up `coverImage` from any member;
  the value stays a relative key. DB-backed assertions skip when no covers were imported.
- Assertion points: the resolved `poi.coverUrl` string and the recorded wiki-query list.

### 7. Wrong vs Correct

```typescript
// Wrong: absolute URL in the payload. Switching storage (or just running locally vs in prod)
// then requires a full re-import, and localhost leaks into production data.
payload.coverImage = 'http://localhost:3001/media/xhs/杭州/8f3a/00.webp';

// Correct: relative key; the prefix is applied at read time.
payload.coverImage = 'xhs/杭州/8f3a1b2c/00.webp';   // mediaUrl() → `${MEDIA_BASE_URL}/xhs/…`
```

```typescript
// Wrong: reusing the wiki-path check for a stored cover — isHttpUrl() drops the same-origin path,
// so every stored cover silently falls through to the (blocked-in-China) wiki lookup.
if (stored && isHttpUrl(stored)) return stored;

// Correct: accept same-origin absolute paths too.
if (stored && isUsableCoverUrl(stored)) return stored.slice(0, 300);
```

Representative paths: `apps/server/src/generation/storedCover.ts`,
`apps/server/src/generation/tools/researchTools.ts`, `apps/server/scripts/seed-xhs-place-images.ts`,
`apps/server/scripts/lib/exportFiles.ts`, `apps/server/src/index.ts`, `docker-compose.yml`,
`apps/server/src/integrations/pexels/cover.ts`, `apps/server/src/lib/placeKey.ts`,
`xhs-travel-pipeline/scripts/export_place_images.py`.

Read-only audit: `node --import tsx apps/server/scripts/audit-xhs-images.ts --city 杭州
--trip-id <id> --out <report.json>`. Optional `--pipeline-root` defaults to the sibling pipeline
repository. It reads each project's `.env` without importing the migrating database bootstrap,
uses read-only transactions, and reports link/classification/assignment/export/import/trip
coverage without contacting external providers. Counts of images in notes mentioning a place
are only attribution candidates, not confirmed images of that place; do not sum overlapping
per-place counts as unique images.

## Ranked photography gallery contract (2026-10-01)

### 1. Scope / trigger

The upstream photography manifest now supplies an ordered gallery. This contract spans export, import, place facts, generation and saved trip snapshots.

### 2. Signatures

- `imageGroups(value: unknown): Map<string, StoredImage[]>` validates the exported `images` array.
- `readImageGallery(value: unknown): StoredImage[]` reads persisted optional data.
- `seed-xhs-place-images.ts` stores `payload.coverImage` and `payload.imageGallery` for the manifest city.
- `createStoredPlaceLookups(city).photosFor(name)` supplies stored photos to research; curated manual photos retain priority.

### 3. Contracts

`imageGallery` holds at most three `{ key, attribution?, provenance? }` entries in selected order. The first key is `coverImage`; exported `placeId` still uses the shared city/name hash. `provenance` retains original source, author, note/image index, model review and rights. Keys are safe relative WebP paths, including immutable `xhs/photography/<placeId>/<contentHash>.webp` keys. Existing `MEDIA_BASE_URL` maps these keys to local or remote media.

Photography entries require `reviewMethod=model`, `review.status=eligible`, `review.identity=match` and an HTTPS `www.xiaohongshu.com/explore/<id>` source. Attribution uses `source=xhs`, `license=未确认授权`; model review never implies a copyright license or human approval. Place reimport must retain both cover and gallery. New generation snapshots copy ordered photos; historical trips never change merely because the library was refreshed.

### 4. Validation and errors

| Condition | Result |
| --- | --- |
| Malformed manifest, unsafe path or photography missing review/source | Reject import before database writes |
| Duplicate key / more than three entries | Deduplicate and keep first three in source order |
| Missing or invalid legacy gallery | Read as empty; use existing single cover/fallback |
| Place outside manifest city | Do not update |
| Valid source excluded by frontend URL allowlist | Bug: synchronize `PhotoCredit.safeCreditUrl` when adding providers |

### 5. Good / Base / Bad cases

- Good: two selected photos import in order with independent attribution and complete provenance.
- Base: old payload contains only `coverImage`; existing rendering remains supported.
- Bad: photography manifest says only “note mentions this place” without an eligible identity review; reject it.

### 6. Required tests

`imageGallery.test.ts`, `imageImport.test.ts` and `storedCover.test.ts` assert malformed inputs, city isolation, reimport retention, cover-first order and attribution. Actual export-to-disposable-database verification and browser gallery switching must also cover per-photo credits and zero writes while browsing.

### 7. Wrong vs correct

```typescript
// Wrong: drops alternatives and erases gallery provenance on place reimport.
payload = { ...incoming, coverImage: old.coverImage };
// Correct: retain both optional stored-image fields in the reimport merge.
payload = { ...incoming, coverImage: old.coverImage, imageGallery: old.imageGallery };
```
