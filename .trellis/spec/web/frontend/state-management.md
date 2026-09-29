# State Management

## Choose the Smallest State Owner

Use state according to its lifetime and authority:

| State kind | Owner |
| --- | --- |
| Input drafts, open/closed flags, active visual tabs, transient errors | Component `useState` |
| Route identity, login callback errors, redirect destination | React Router URL params, search params, location state |
| Server resources and mutation status | React Query |
| Shared editor draft plus editor-only filter | Zustand editor store |
| Refresh recovery for an in-progress generation job | `sessionStorage` |
| Live generation timeline | Local state derived from replayable SSE events |

Evidence: `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/pages/PlannerPage.tsx`, `apps/web/src/pages/TripEditorPage.tsx`.

There is currently no `localStorage` usage in `apps/web`. Add it only for intentionally durable, non-sensitive browser preferences that should survive browser restarts. Do not use it for auth, authoritative trips, API keys, or server cache. Version and guard any persisted value because storage contents are untrusted and may outlive code changes.

## React Query Is Server State

React Query owns authenticated user data, settings, usage, trip collections, and trip details. Components should consume hooks rather than copying fetched server data into another global store by default. Mutation cache effects belong beside the mutation in `api/hooks.ts`. Generation restoration is a narrow exception: its snapshot is fetched as a one-shot command and used immediately to decide whether to reconnect, navigate, or clear recovery state.

Evidence: `apps/web/src/api/hooks.ts`, `apps/web/src/components/AppLayout.tsx`, `apps/web/src/pages/TripListPage.tsx`.

The editor is a deliberate exception because it needs a mutable cross-component working draft. The server remains the durable source of truth; the Zustand store is an editing copy, not a second persistence layer.

## Editor Draft, Revision, and Autosave

Route selection uses `routePairKey(trip, dayId, fromId)` (trip/destination/day plus both endpoint IDs, names, coordinates and coordinate systems). `selectRoute(dayId, key, leg)` rejects changed or non-adjacent pairs before incrementing revision, replaces only that pair and preserves other legs. A coordinate edit drops incident legs. `RouteOptionsForPair` remounts on key changes and guards unmounted promise continuations; options use shared runtime validation. Query responses write the draft only for explicit manual selection or a pending move-triggered recommendation.

Moves create transient `routeReplans` only for newly adjacent pairs; unchanged pairs retain choices. `AutoRoutePlanner` lives above day filtering so hidden source/target days are also handled. It shares the menu cache/serial queue, waits for all modes to settle, and selects a real walk <=1000m, otherwise shortest duration, then distance, then walk/cycle/transit/drive order. Partial failures allow remaining real routes; no real result or missing coordinates yields a visible retry state. Retry creates a fresh job ID and refreshes results. Loading does not schedule recommendations.

Every replan has a unique request ID in addition to its endpoint fingerprint: checking only endpoints would accept an old response after an A→B→A reorder. All edits prune invalid fingerprints; load/clear reset jobs. Manual selection cancels the job before awaiting its query. `finishRouteReplan(id, leg?, error?)` accepts only a still-pending ID and delegates to `selectRoute`; success updates revision/autosave and map geometry. Replan status itself never increments revision. Tests: `editorStore.test.ts`, `recommendedRoute.test.ts`, and `route-options-browser.mjs` (sorting, retry, hidden destination, save/reload).

`api/routeOptions.ts` observes four separate React Query entries per pair/user. Mounted current-day cards prefetch after a 350ms settling delay; successful results are fresh for five minutes, unavailable results for 30 seconds, retained for 30 minutes in memory and cleared by logout. Saving settings invalidates them. Opening a menu does not start an all-mode blocking request.

`RouteQueryQueue` sends only one request at a time across cards. Choosing a mode promotes its queued request and automatically applies the successful recommendation; a selection sequence counter rejects superseded choices. Abort signals skip queued work after unmount/day changes. Already-sent work is allowed to finish before the next request, matching the server concurrency gate. HTTP 429 starts a 30s frontend cooldown; cached valid options remain usable. Manual refresh retries options without changing the saved route by itself.

Route disclosures share editor colours, rounded panels and gradient selection. Escape restores focus to the summary; pointer-outside dismisses. A null `relatedTarget` from a button becoming disabled must not dismiss the panel mid-refresh.

`useSaveTrip` uses the `editor-trip-save` React Query mutation scope to serialize writes: debouncing alone cannot prevent an older in-flight PUT from overwriting the latest transport selection. Browser regression: `node apps/web/tests/route-options-browser.mjs` includes a deliberately slow first save, rapid second selection, reload, stale response after move, partial failure and mobile overflow.

`useEditorStore` clones a fetched `Trip` on load. Every domain edit runs through the store's `mutate` helper, clones the current draft with `structuredClone`, applies a focused change, and increments `revision`. UI-only `dayFilter` changes do not increment revision.

`TripEditorPage` loads only when the fetched trip id changes so a React Query cache write after save does not overwrite newer local edits. It clears the store on unmount. A revision change sets the save state to saving, waits 800 ms, reads the latest draft from `useEditorStore.getState()`, and calls `useSaveTrip`. The mutation writes the saved trip to the detail cache and invalidates the list summary.

Evidence: `apps/web/src/store/editorStore.ts`, `apps/web/src/pages/TripEditorPage.tsx`, `apps/web/src/api/hooks.ts`.

Preserve these invariants:

- Loading or clearing a trip resets `revision` to zero.
- Every persisted draft mutation increments revision exactly once.
- Pure view state must not trigger autosave.
- Debounce timers are cleared on revision change and unmount.
- Autosave reads the latest store snapshot, not a stale closure.
- A successful save must not reload and replace in-progress local edits.

The current save error label says a later edit will retry; there is no independent retry queue. Do not describe autosave as durable offline persistence or guaranteed retry.

## URL, Session, and SSE State

Use URL state for navigation-relevant values: route ids, OAuth error codes, and the post-login return path. Treat route and search values as untrusted strings and narrow them before use.

Use `sessionStorage` only for the active generation job id because it should survive refresh in the current tab but not become permanent application data. On restoration, query the snapshot before reconnecting or navigating. Clear the key on terminal status, missing/expired jobs, cancellation recovery, and explicit reset.

SSE events rebuild the local timeline. They are append-only inputs until a terminal event, after which the stream closes and React Query collections are invalidated as needed. The derived timeline model is calculated with `useMemo` and should remain replay-safe.

Evidence: `apps/web/src/pages/PlannerPage.tsx`, `apps/web/src/components/GenerationTimeline.tsx`, `packages/shared/src/types.ts`.
