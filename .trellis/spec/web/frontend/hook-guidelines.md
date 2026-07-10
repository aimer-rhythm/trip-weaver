# Hook Guidelines

## API Client and React Query Boundary

Use `api/client.ts` for normal JSON HTTP transport. It applies same-origin credentials, JSON request headers, content-type-aware response parsing, and `ApiError` with status plus a loosely typed error body. Put reusable server-state operations in `api/hooks.ts` as React Query queries or mutations.

Evidence: `apps/web/src/api/client.ts`, `apps/web/src/api/hooks.ts`, `apps/web/src/App.tsx`.

Direct `fetch` calls should not duplicate the client behavior. However, "every command must be a hook" is too absolute. A narrow one-shot command may call `api` directly when it is not persistent server state and does not need shared mutation status or cache behavior. The list-level full-trip export is the current example. OAuth navigation uses a normal anchor because it is a browser navigation, not an AJAX request.

Evidence: `apps/web/src/pages/TripListPage.tsx`, `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/pages/RegisterPage.tsx`.

## Query Keys and Cache Updates

Define reusable query keys in the `keys` object with `as const`. Parameterized entities use key factories such as `keys.trip(id)`. Keep a query's key and fetcher together in its hook.

Choose cache behavior based on what the mutation returns:

- Use `setQueryData` when the response is the authoritative updated entity, as settings and saved trips do.
- Invalidate affected collections when list summaries may have changed.
- Invalidate both collection and detail queries when a partial command, such as rename, does not return the complete updated entity.
- Clear the cache on logout.
- Broad invalidation after login/register is an intentional auth-boundary refresh; prefer targeted invalidation for ordinary domain mutations.

Evidence: `apps/web/src/api/hooks.ts`, `apps/web/src/pages/PlannerPage.tsx`, `apps/web/src/pages/TripEditorPage.tsx`.

Respect query-specific freshness and retry policy. `useMe` does not retry 401, auth config is long-lived, and optional source status is disabled until requested and does not retry. Do not copy global defaults blindly when the endpoint has different semantics.

## Effects, Timers, and External Subscriptions

Effects are for synchronization with external systems, not for routine derived values. Use `useMemo` for expensive or identity-sensitive derivation and event handlers for user actions.

Every effect that creates a resource must return cleanup:

- Clear debounce and layout timers.
- Remove DOM and media-query listeners.
- Close `EventSource` subscriptions.
- Guard promise continuations when an async operation cannot be cancelled.
- Clear store state on page unmount when the state belongs only to that mounted editor.

Evidence: `apps/web/src/pages/TripEditorPage.tsx`, `apps/web/src/pages/PlannerPage.tsx`, `apps/web/src/components/editor/MapView.tsx`.

The native dialog adapter also removes its `cancel` listener in cleanup. Export helpers revoke object URLs after triggering downloads. Preserve these resource lifetimes when changing browser-facing code.

Evidence: `apps/web/src/components/Modal.tsx`, `apps/web/src/lib/export.ts`.

## SSE and Recovery

Generation progress is an external event stream, not React Query cache state. `PlannerPage` stores the active job id in `sessionStorage`, checks a snapshot on refresh, then connects `EventSource` with `lastEventId=0` so the timeline can be rebuilt from replayed events. On reconnect, the event list is cleared before replay to avoid duplicates. Terminal events close the stream, clear session state, update relevant caches, and navigate or display recovery UI.

Evidence: `apps/web/src/pages/PlannerPage.tsx`, `apps/web/src/components/GenerationTimeline.tsx`, `packages/shared/src/types.ts`.

Treat SSE data as untrusted input even when the server and client share a union type. Parse inside `try/catch`, validate or narrowly guard the event shape before appending it, and convert malformed payloads into a controlled stream error. A type assertion after `JSON.parse` is not runtime validation; the current direct cast in `PlannerPage` is boundary debt to avoid extending.

## Dependency Discipline

Include all values used by an effect unless there is a deliberate lifecycle reason not to. Existing lint-suppression comments around editor loading/autosave and map point keys encode intentional behavior, but they are not a general license to omit dependencies. Prefer stable callbacks, key primitives, or a small ref when that communicates the synchronization contract more clearly.
