# Component Guidelines

## Function Components and Composition

Use named function components and React hooks. Route pages orchestrate data and navigation; focused child components render reusable UI or editor behavior. Avoid class components and avoid moving a feature into a generic abstraction before at least one real reuse or complexity need exists.

Evidence: `apps/web/src/pages/TripEditorPage.tsx`, `apps/web/src/components/GenerationTimeline.tsx`, `apps/web/src/components/editor/ActivityCard.tsx`.

Prefer composition over large configurable components. Existing examples include `TripEditorPage` composing editor panels and dialogs, `GenerationTimeline` composing `PoiCard`, and dialogs composing the shared `Modal`.

## Practical Props Typing

Use the least ceremonial readable form:

- Use a named `interface Props` when a component has several fields, domain comments, or the shape benefits from a reusable name.
- Use an inline object type for a small, local prop surface.
- Use shared domain types from `@tripweaver/shared`; do not recreate `Trip`, `TripDay`, `Activity`, or protocol unions locally.
- Model optional props with `?` and state variants with literal unions or discriminated unions.

Both styles are established and valid. `ActivityEditDialog` and `DaySection` use named interfaces, while `Modal`, `ExportMenu`, and `MapView` use compact inline prop types. Do not impose an inaccurate rule that every component must use `interface Props`.

Evidence: `apps/web/src/components/editor/ActivityEditDialog.tsx`, `apps/web/src/components/Modal.tsx`, `apps/web/src/components/editor/MapView.tsx`.

## Forms and User Actions

Forms are controlled with local `useState`, native labels, and `FormEvent` submit handlers. Keep transient drafts local unless multiple distant components must edit the same domain draft. Parse and clamp numeric input at the submit or commit boundary rather than storing partially parsed domain numbers while the user types.

Evidence: `apps/web/src/pages/RegisterPage.tsx`, `apps/web/src/components/SettingsDialog.tsx`, `apps/web/src/components/editor/TripMetaDialog.tsx`.

Mutation buttons should disable or change labels while pending when duplicate submission would be harmful. Display actionable errors near the operation. Native `window.prompt`, `window.confirm`, and `alert` are currently used for small one-shot list/editor commands; they are acceptable as narrow legacy-style adapters, not as the default for complex workflows.

Evidence: `apps/web/src/pages/TripListPage.tsx`, `apps/web/src/components/editor/DaySection.tsx`, `apps/web/src/components/editor/ActivityCard.tsx`.

## Styling

Use the existing plain CSS system in `apps/web/src/styles/global.css` and `print.css`. Reuse established classes, CSS variables, responsive rules, and component prefixes. Do not add CSS modules, CSS-in-JS, utility frameworks, or a second design-token system without an explicit project decision.

Inline styles are a deliberate exception for values that are genuinely data-dependent or library-facing, such as day colors, category colors, progress widths, and Leaflet marker HTML. Stable layout and appearance belong in CSS.

Evidence: `apps/web/src/components/editor/BudgetPanel.tsx`, `apps/web/src/components/editor/DaySection.tsx`, `apps/web/src/components/editor/MapView.tsx`.

## Dialogs and Browser UI

Use the shared native `Modal` adapter for application dialogs. It calls `showModal`, handles the native `cancel` event, supports backdrop click closing, and removes its listener during effect cleanup. Render dialogs conditionally so their local form state is recreated when appropriate.

Evidence: `apps/web/src/components/Modal.tsx`, `apps/web/src/components/SettingsDialog.tsx`, `apps/web/src/components/editor/ActivityEditDialog.tsx`.

Keep direct DOM and browser APIs behind small components or `lib` helpers when they have reusable mechanics. `lib/export.ts` owns object URLs, downloads, user-agent detection, and printing; `MapView` owns `matchMedia` and Leaflet lifecycle behavior. A one-off command may stay at the page handler when extracting it would hide rather than clarify the flow.

## Async Rendering and Degradation

Async pages and dialogs must intentionally handle loading and errors. Also handle empty data, disabled actions, and recovery when those states exist. Optional data may degrade without blocking the primary flow: GitHub login appears only when enabled, usage chips render only with data, source-status checks are disabled until expanded, missing POI images fall back to a category icon, and old trips omit the optional overview UI.

Evidence: `apps/web/src/router.tsx`, `apps/web/src/components/SettingsDialog.tsx`, `apps/web/src/components/PoiCard.tsx`.

Do not convert optional secondary-query failure into a full-page failure unless the feature cannot function safely without it. Conversely, do not silently swallow failure for primary data such as the trip being edited.

## Accessibility

- Associate form controls with visible labels; use semantic `button`, `a`, `details`, `summary`, `dialog`, headings, and lists.
- Every icon-only button needs an accessible name. Add `aria-label`; a `title` may supplement it but is not a sufficient keyboard/screen-reader contract by itself.
- Preserve keyboard behavior for native dialogs, forms, links, and controls.
- Mark decorative icons `aria-hidden="true"`; provide meaningful `alt` text for content images and a fallback for failed images.
- Keep disabled and loading states perceivable in text, not only color.

`Modal` already gives its close icon an `aria-label`, while several editor arrow/edit/delete icon buttons currently rely only on `title`. Treat those as existing accessibility debt, not a pattern to copy.

Evidence: `apps/web/src/components/Modal.tsx`, `apps/web/src/components/editor/ActivityCard.tsx`, `apps/web/src/components/PoiCard.tsx`.
