# Directory Structure

## Runtime and Build Shape

`apps/web` is a Vite React single-page application. Vite serves `/api` through the local server proxy, and `strictPort` keeps the development callback port stable. The package has `dev`, `build`, and `preview` scripts; repository-level TypeScript checking is defined at the workspace root.

Evidence: `apps/web/package.json`, `apps/web/vite.config.ts`, `package.json`.

The application composition is intentionally shallow:

1. `apps/web/index.html` provides `#root`.
2. `apps/web/src/main.tsx` mounts React Strict Mode and imports Leaflet, global, and print CSS.
3. `apps/web/src/App.tsx` creates the single `QueryClient`, provides it, and renders `RouterProvider`.
4. `apps/web/src/router.tsx` owns route declarations and the authentication gate.

Do not scatter providers or route declarations across feature files unless a concrete scaling problem requires it.

## Source Responsibilities

| Path | Responsibility |
| --- | --- |
| `src/pages/` | Route-level screens and orchestration |
| `src/components/` | Reusable application components and browser UI adapters |
| `src/components/editor/` | Trip editor panels, cards, dialogs, and map behavior |
| `src/api/client.ts` | Shared HTTP request and `ApiError` transport behavior |
| `src/api/hooks.ts` | React Query keys, queries, mutations, and cache updates |
| `src/store/editorStore.ts` | Zustand editing draft, revision counter, and editor-only filter state |
| `src/lib/` | Focused browser/domain display helpers such as export, colors, and POI labels |
| `src/styles/` | Plain global CSS and print CSS |

Keep route orchestration in pages, server-state behavior in API hooks, and reusable browser mechanics in components or `lib`. Examples include `apps/web/src/pages/TripEditorPage.tsx`, `apps/web/src/api/hooks.ts`, and `apps/web/src/lib/export.ts`.

## Router Structure and Authentication

Public routes are `/login` and `/register`. Authenticated routes are nested under `RequireAuth`, then under `AppLayout`:

- `/` redirects to `/trips` with `replace`.
- `/trips` renders the trip list.
- `/trips/new` renders the planner and generation flow.
- `/trips/:id` renders the editor.
- Unknown paths redirect to `/trips`.

`RequireAuth` waits for `useMe`. A 401 redirects to `/login` and preserves `location.pathname` in route state so login can return the user to the original page. A non-401 failure is not treated as logged out; it renders a service-unavailable message. Preserve that distinction.

Evidence: `apps/web/src/router.tsx`, `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/components/AppLayout.tsx`.

When adding a route, decide explicitly whether it is public or authenticated, place it in the correct router branch, and provide route-level loading/error behavior if it fetches data. Do not add a second ad hoc auth redirect inside ordinary pages unless the page handles an operation-specific expired-session message.

## Shared Contracts

The web package resolves `@tripweaver/shared` directly to `packages/shared/src/index.ts`. Domain types, constants, schemas, and shared calculations should come from that package rather than being duplicated in the web tree.

Evidence: `apps/web/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/types.ts`.
