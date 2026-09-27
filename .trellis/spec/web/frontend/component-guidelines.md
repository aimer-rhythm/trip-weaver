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

## Map Rendering: Two Implementations Behind One Panel

`MapView` owns renderer selection; the two canvases only draw the data they are given. The data layer
(`lib/mapData.ts`) is SDK-free — it produces `MapPoint[]` / `DayLines[]` in **GCJ-02** as `{lat, lng}`
objects, deliberately **not** `[lat, lng]` tuples: Amap takes `[lng, lat]` and Leaflet takes
`[lat, lng]`, and that reversed order is a classic bug source.

- **Primary** — `AmapCanvas` (Amap JS API). Its entire reason for existing is `features`: passing
  `['bg','road','building']` and omitting **`point`** removes the POI text layer. Raster tiles bake
  that text into the PNG and offer no switch to disable it (`style=` has none; a CSS-filter attempt
  was made in `b7e85c9` and reverted in `1d5a59b`).
- **Fallback** — `LeafletCanvas` (Amap raster tiles). Used when no JS key is configured, or when the
  SDK fails or times out (8 s, `lib/amapLoader.ts`).

Rules that keep this from becoming two divergent maps:

- Selection lives ONLY in `MapView`. Canvases never fetch config or decide anything.
- Degradation is **silent** apart from one `console.warn`. The fallback is also the initial state —
  the map renders `LeafletCanvas` while probing, so the editor is never left map-less.
- `window._AMapSecurityConfig` must be set BEFORE the SDK script loads. Setting it afterwards
  silently breaks every request, because JS API 2.0 keys require the security code.
- The JS key and security code are served by `GET /api/settings/config` and are **meant to reach the
  browser** — a JS API key cannot be hidden. Security comes from Amap's domain allowlist, not
  secrecy. Never log them; never treat them as secrets.
- **Moving a route means re-checking the caller's URL string.** This endpoint started as a planned
  standalone `/api/config` and ended up mounted under the settings group as `/api/settings/config`;
  the frontend kept requesting the old path. Typecheck cannot see a wrong URL literal, and the 404
  degrades **silently into the Leaflet fallback** — indistinguishable from "the key isn't
  configured". Treat a new endpoint as unverified until one real request has returned its expected
  body.
- InfoWindow content is an HTML string, so model-authored text (activity names, descriptions) must
  pass through `escapeHtml` before interpolation. React components cannot be used there; the edit
  button uses data attributes plus one delegated click handler on the host element.
- Route stroke geometry lives in `lib/routeStyle.ts`, not in either canvas. Every route segment is
  drawn twice — a wider dimmed underlay (`dimColor`, 7 px, z 60) then the day colour on top
  (5 px, z 61) — and the numbers only stay identical across both renderers if there is one source.
  Selecting a day no longer removes the other days from the data; `DayLines` / `MapPoint` carry a
  `dimmed` flag and the faded band (opacity 0.2, z 10/11) is what the user sees instead. The map
  still fits **all** days, dimmed ones included: fitting only the selected day would push them off
  screen, which defeats the point of drawing them (a trip's days can be 0.5° apart).
  Leaflet's `Path` has neither `zIndex` (JSX order decides layering) nor `showDir`
  (Amap's direction arrows): the fallback is dual-layer but arrowless **by design**. Treat that as
  a known asymmetry, not a missed edit, when reviewing the two canvases side by side.
  Reference measurements and the source-project version drift are recorded in
  `.trellis/tasks/09-26-route-polyline-style/research/pitravel-route-style.md`.
- The marker DOM is a three-class contract owned by `lib/markerHtml.ts` and shared by both canvases:
  `.map-marker` (28×28 positioning box, also the query root for collision) wrapping `.marker-pin`
  and an absolutely positioned `.map-label`. `lib/labelCollision.ts` finds elements **only** by those
  class names, so dropping one silently disables name avoidance — and the failure mode looks like
  "we never implemented it" rather than like a breakage. Avoidance runs on `zoomend` / `moveend` plus
  once after overlays are rebuilt; it is deliberately **not** a rAF loop, which is also why it needs
  none of the reference implementation's hysteresis thresholds.

## Derived Data Matching

### Common Mistake: unguarded containment matching between domain lists

**Symptom**: a short candidate name (e.g. "西湖") substring-matches an unrelated longer
activity name (e.g. "西湖醋鱼餐厅") and the UI attaches wrong metadata to the card.

**Cause**: name-based association (`a.includes(b) || b.includes(a)`) without length or
ratio guards, used when two lists share no id linkage (Activity ↔ `Trip.overview`).

**Fix / Prevention**: guard containment — contained side must be ≥2 chars and at least
half the length of the longer side (see `matchOverview` in `apps/web/src/lib/tripDerive.ts`).
Prefer precision over recall: unmatched items degrade into their fallback surface (备选
drawer) instead of showing wrong data. When the association matters long-term, add a real
id link at the producing side (generation) rather than strengthening string heuristics.

**Related**: keep name-match derivations in pure functions under `src/lib/` so they are
unit-testable and shared between panels and the map.
