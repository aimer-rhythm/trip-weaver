# Type Safety

## Strict TypeScript Baseline

The web package extends the repository base configuration. The effective baseline includes `strict`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `isolatedModules`, and `noEmit`, with bundler module resolution and the React JSX transform.

Evidence: `tsconfig.base.json`, `apps/web/tsconfig.json`, `apps/web/package.json`.

Write code that passes this configuration without weakening it. Handle possibly missing array entries and optional fields explicitly. Prefer exhaustive handling of discriminated unions; a switch over `GenerationEvent['type']` is clearer and safer than chains of unrelated property checks.

## Shared Types and Schemas

Domain contracts come from `@tripweaver/shared`. The TypeBox schemas are the runtime source of truth, and TypeScript domain types are derived from them with `Static`. Shared constants define literal unions and limits used by both server and web.

Evidence: `packages/shared/src/schemas.ts`, `packages/shared/src/types.ts`, `packages/shared/src/constants.ts`.

Import shared `Trip`, `TripExport`, `GenerateForm`, `GenerationEvent`, constants, and calculations instead of duplicating them. Frontend-only transport views such as `MeView`, `AuthConfigView`, and `SettingsView` may remain near their hooks until they become shared cross-package contracts.

Evidence: `apps/web/src/api/hooks.ts`, `apps/web/src/components/GenerationTimeline.tsx`, `apps/web/src/components/editor/BudgetPanel.tsx`.

## Assertions Must Be Controlled

Use assertions only after code has established the invariant or when a browser/library API cannot express it precisely. Keep them narrow and local.

Established examples include the known `#root` element at startup, tuple construction for Leaflet coordinates, literal-compatible form values, and a guarded `firstElementChild` cast before PNG export.

Evidence: `apps/web/src/main.tsx`, `apps/web/src/components/editor/MapView.tsx`, `apps/web/src/components/ExportMenu.tsx`.

Do not use `as` to turn unknown external data into a trusted domain object. Prefer `unknown`, runtime validation, property guards, and discriminated checks. When reading `ApiError.data`, check each field with `typeof` before using it; `PlannerPage` demonstrates this for `resetAt` and `jobId`.

## Untrusted Boundaries

The following values are untrusted at runtime even if TypeScript knows the expected target type:

- JSON returned by HTTP endpoints.
- `ApiError.data`.
- SSE `MessageEvent.data` parsed with `JSON.parse`.
- Imported JSON files.
- Route params, search params, location state, and browser storage.

Validate shared domain payloads against the exported shared schemas, or add a focused runtime guard at the adapter boundary. Only pass validated data into React Query cache, Zustand, navigation decisions, or mutations.

The generic API client currently casts successful JSON to `T`, and the current import and SSE paths also rely on unchecked values. These are known trust-boundary limitations, not conventions to repeat. New or touched boundary code should improve validation where practical rather than adding another broad assertion.

Evidence: `apps/web/src/api/client.ts`, `apps/web/src/pages/TripListPage.tsx`, `apps/web/src/pages/PlannerPage.tsx`.

## Error and Variant Modeling

Use literal unions for finite UI states, such as save and tab states. Use `instanceof ApiError` for transport branching, then narrow status-specific fields. Keep optional fields optional for backward compatibility; the editor intentionally hides overview UI for older trips without `overview`, and data-source labels tolerate missing metadata.

Evidence: `apps/web/src/pages/TripEditorPage.tsx`, `apps/web/src/pages/PlannerPage.tsx`, `apps/web/src/components/editor/OverviewPanel.tsx`.
