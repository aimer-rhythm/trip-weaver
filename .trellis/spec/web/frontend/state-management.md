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
