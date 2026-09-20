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
- `EvidenceItem { kind: string; content: string }`
- `RetrieveOptions { city?: string }`
- `embedTexts(texts: string[]): Promise<(number[] | null)[]>` in `integrations/embedding.ts`
- `hasEmbedding(): boolean` in `apps/server/src/env.ts`
- `renderRagContext(ragContext?: RetrievedPlace[]): string` in `generation/prompts.ts`
- `plannerUserPrompt(form, research, revisionRequests?, longHaulIntel?, currentDraft?, ragContext?)`

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
  (`xhs_warning` > `xhs_reservation` > `xhs_price` > everything else) then `fetched_at DESC`.
  Evidence text enters the prompt verbatim (each item truncated to 80 chars) — never route it
  through an extra summarizing model call.
- Injection has two entry points: an automatic pre-planner call in the orchestrator
  (`orchestrator.ts`, between research and the plan loop) and the research-phase
  `search_verified_places` agent tool. The planner prompt builder is shared by round 1 and
  revision rounds, so retrieved intel stays visible in every round.
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
| `ragContext` empty in `plannerUserPrompt` | no RAG block appears in the prompt |

### 5. Good / Base / Bad Cases

- Good: research produced 12 candidates; keyword recall hits 5 verified places, the vector layer
  adds 3 more, each carries up to 3 evidence items, and the planner prompt gains one
  verified-place intel block.
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
const places = await retrieveContext(names, { city });
const prompt = plannerUserPrompt(form, research, requests, intel, undefined, places);
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
| Imported row collides with a golden-set id | golden-set row untouched (source/payload preserved) |
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

Representative paths: `apps/server/scripts/`, `apps/server/test-rag-data-check.mts`.
