# Chat and Conversational Intake Guidelines

`/trips/new` is a conversation, not a form. This layer collects parameters and updates a Planning
Brief; it never produces an itinerary. Understanding that boundary is the whole design.

## Boundary: chat collects, generation executes

- Chat understands one user message and returns `{ reply, briefPatch, missingFields }`. It may answer
  travel questions. It does not generate trips.
- Only a ready Brief plus an explicit user action create a generation (`POST /api/generations`).
  Conversations never auto-start a run, not even on `intent: confirm`.
- A Brief is a snapshot: a generation task runs on the Brief as it was when the user confirmed it,
  so chatting while a run is in flight cannot retroactively change that run.

Representative paths: `apps/server/src/routes/conversations.ts`,
`apps/server/src/chat/understanding.ts`, `apps/server/src/chat/brief.ts`,
`apps/web/src/pages/ChatPage.tsx`.

## Scenario: Dialogue intent, Brief readiness, and revision

### 1. Scope / Trigger

Apply when changing the dialogue intent set, the Brief readiness rule, the追问 (intake) controls,
the chat quota, or the conversation-to-generation link.

### 2. Signatures

- `CHAT_INTENTS` — the single source of truth for the intent whitelist
  (`packages/shared/src/constants.ts`). `apps/server/src/chat/models.ts` re-exports it as
  `DIALOGUE_INTENTS`; never write a second local list.
- `requiredBriefFields(data): BriefMissingField[]` and `briefIntake(missing)` — pure, in
  `packages/shared/src/chat.ts`; used by the server (gate), the web (card state) and the prompt.
- `applyDialogueDecision(current, raw: unknown, evidenceSequence)` in `apps/server/src/chat/brief.ts`
  — pure, defensive, accepts the model's raw output.
- `briefToGenerateForm(data, { appendNotes })` — pure, in shared; the single Brief → form mapping.
- `chatTurnsToday(userId)` / `chatHasQuota(userId)` in `services/chatQuotaService.ts`.
- `createTrip(userId, source, revisionOf?)` in `services/tripService.ts`.

### 3. Contracts

- **Required fields are exactly four**: destination, start date, end date *or* day count, trip focus.
  Everything else may be missing and still generate. `days` is a legal equivalent of `endDate`;
  when both a date range and `days` exist, the explicit dates win (`applyDialogueDecision` deletes the
  stale `days`).
- **`CHAT_INTENTS` must be derived, not duplicated.** A local second copy is a silent failure: tool
  argument validation rejects the unknown intent, the agent retries the same call until the turn limit,
  and the client only sees a generic 502. This actually happened with `modify_itinerary`.
- **The model's output is untrusted.** `applyDialogueDecision` reads `unknown` and drops or clamps
  anything invalid (unknown polarity/category, out-of-range days, over-long text) instead of throwing.
  A single bad field must not cost the user the whole conversation.
- **One turn writes both messages, or writes nothing.** `appendMessages` inserts the user message and
  the assistant reply in one transaction. An understanding failure leaves no trace, and the chat quota
  (counted from `chat_messages` where `role='user'`) therefore never charges a failed turn. This mirrors
  the generation rule that failed and cancelled runs do not consume quota.
- **Chat quota is independent of generation quota.** `CHAT_DAILY_LIMIT` counts user turns; the
  generation quota counts `generations.status='done'`. Card edits (`PATCH /brief`) also record a user
  message and so do consume a chat turn.
- **Intake controls are click-first, one field at a time.** Never summarise several missing fields into
  one sentence and drop the user into a text box — that degenerates into "write your own requirements".
  `briefIntake` asks for the *first* missing field only: enumerable fields get buttons, dates get a date
  control, and only otherwise-unenumerable fields (destination with no model options) fall back to text.
  When the model supplies `clarification.options`, those win: `briefIntakeWithOptions` renders them as
  buttons with `enumKind: 'natural'`, so a click is sent back as a message for the model to interpret.
  `enumKind: 'canonical'` options (server-provided field values) are `PATCH`ed directly instead, which is
  exact and costs no chat turn. `inputSchema.enum` carries values, `enumLabels` display copy — the backend
  or model owns the wording and the client only renders it.
- **Revision is a targeted edit, not a re-run (09-24 R1).** The model emits `editOps`
  (replace / delete / add activity — the only three supported operations) against the current trip
  rendered into the prompt with activity ids (`renderCurrentTrip`). The route normalises them
  (`normalizeEditOps`), geocodes new activities through the same chain as generation, applies them
  deterministically (`applyItineraryEdits` in `apps/server/src/chat/editOps.ts`), and persists the
  result as the next version via `createTrip(userId, trip, revisionOf)`. No generation row is
  written and no generation quota is consumed. Cross-day moves / lodging / budget stay out of the
  chat channel (editor-only). The legacy `kind='revision'` generation path still exists for API
  compatibility but the chat UI no longer uses it.
- **Edit anchoring follows messages, not just generations.** An edit writes no `generations` row,
  so `latestConversationTrip` reads both `generations` and `chat_messages.relatedTripId` and picks
  the higher version — otherwise the next "再改一下" would anchor back to the stale pre-edit version.
- **Revision targets are ownership-checked.** Both the conversation and the target trip must belong to
  the authenticated user; `kind='revision'` without `targetTripId` is a 400, a non-owned target is a 404.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Model returns no tool call and no text | 502 `dialogue_understanding_failed`; nothing persisted, no quota used |
| Model returns text but no tool call | Treated as a plain reply with `intent: 'unclear'`; Brief unchanged |
| Chat quota exhausted | 429 `chat_quota_exhausted` with `resetAt`; nothing persisted |
| No usable LLM config | 400 `no_llm` with `hasSiteKey`, same分流 as generation |
| Brief not ready | No confirm card; missing fields drive intake controls |
| Chat page first mounted, no conversation yet | The confirmation card still renders from an empty Brief so the user can see what will be collected |
| Brief ready + `intent: 'confirm'` | Server auto-starts the generation and returns `autoStartedJobId`; quota exhausted / job running silently falls back to the manual card |
| `kind='revision'` without `targetTripId` | 400 `revision_target_missing` |
| `targetTripId` not owned | 404, identical to a missing trip |
| Understanding fails mid-turn | user + assistant messages both dropped; the turn is not counted |

### 5. Good / Base / Bad Cases

- Good: "11月去成都玩3天，带2岁小孩" fills destination/days/focus, records the companion fact as
  `polarity: 'fact'`, and asks only for the start date with a date control.
- Base: a user asks a weather question mid-collection; the reply answers it and the Brief is untouched.
- Bad: a second local intent list that silently drops `modify_itinerary`, or a per-message insert that
  leaves an orphan user message when understanding fails.

### 6. Tests Required

- `apps/server/src/__tests__/chatBrief.test.ts` — readiness rules, intake construction, constraint
  normalisation, `emit date > days` precedence.
- `apps/server/src/__tests__/chatBriefApply.test.ts` — defensive `applyDialogueDecision` and
  `briefToGenerateForm` (including notice-able truncation).
- `apps/server/src/__tests__/chatEditOps.test.ts` — edit-op normalisation and application:
  in-place replace, leg pruning, append/position clamp, per-op rejection isolation, idempotence.
- `apps/server/src/__tests__/chatDerive.test.ts` — web-side pure derivations (intake liveness, polarity
  copy, conversation summary).
- `node scripts/verify-c2.mjs` — chat CRUD, quota separation, ownership 404s, confirm auto-start,
  targeted-edit revision chain (`rootId`/`version`/`parentId`), edit anchoring across turns,
  trip-list version dedupe.
- `node scripts/verify-c3.mjs` — the same flow through the production browser bundle, including the
  editor-embedded chat panel and chat-driven edits.

### 7. Wrong vs Correct

```typescript
// Wrong: a second local intent list — the new intent silently fails tool validation.
export const DIALOGUE_INTENTS = ['update_brief', 'travel_qa', 'confirm', 'unclear'] as const;

// Correct: derive from the shared wire contract so the two cannot drift.
export const DIALOGUE_INTENTS = CHAT_INTENTS;
```

## Common Mistakes

### Two TypeBox packages coexist and are not runtime-compatible

`apps/server/src/generation/tools/*` and `apps/server/src/chat/*` must use `typebox` (v1, the
pi-agent-core ecosystem). `packages/shared` and Fastify route schemas use `@sinclair/typebox` (v0.34).
v1 emits JSON Schema (`anyOf` / `const`); `@sinclair/typebox/value`'s `Value.Check` throws
`Unknown type` on it. `typebox` v1 also has no `Static`, which is why
`apps/server/src/chat/models.ts` does not mirror the decision schema with a hand-written interface —
model output is read as `unknown` and normalised field by field instead. Verify with
`node -e "const {Type}=require('typebox'); ..."` before assuming the two interoperate.

### A map-built union collapses to one literal in TypeScript

`Type.Union(values.map((v) => Type.Literal(v)))` infers a non-tuple array, so the TypeScript type
collapses to a single literal and comparisons like `kind === 'revision'` fail to typecheck. Use an
explicit tuple literal for intersections consumed by route handlers, or the mapped-tuple `StringEnum`
helper in `packages/shared/src/typebox.ts`.

### Fastify logs to stdout, not stderr

Pino's default target is stdout. A verification script that pipes `stdout` into a no-op and only
surfaces `stderr` hides every application log, including the `warn` that explains a chat
understanding failure. `scripts/verify-c2.mjs` routes both streams through `VERBOSE`.
