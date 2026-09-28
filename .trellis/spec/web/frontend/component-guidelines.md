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

The project carries two style systems on purpose. Which one applies depends on the file you are editing.

**Tailwind for new surfaces.** New pages and components write Tailwind utilities in JSX. Colours must come from the semantic tokens declared in `apps/web/src/styles/tailwind.css`, grouped by purpose: `brand*` (primary blue, gradient ends, disabled), `accent-*` (icon accents), `ink*` (text hierarchy), `canvas`, `hairline*` (glass-panel dividers), `map-*` (province borders, national outline, background dots) — used as `bg-brand`, `text-ink-muted`, `stroke-map-line`, `from-brand-light`. Do not write `bg-[#2f6bf3]`: declaring a token is the cheaper edit, and a hard-coded hex turns the next colour change into a multi-file search. Neutral white/black translucency is exempt — `bg-white/72`, `border-white/70`, and SVG fills like `rgba(255,255,255,0.5)` stay inline — and so is the deeper blue inside glass shadows (`shadow-[0_18px_50px_rgba(31,64,124,0.14)]`): it is darker than the brand blue, it appears in four places, and threading a variable through an arbitrary shadow value costs more than it saves. The token set covers brand and text colours rather than neutrals and shadows. Tailwind is imported as `theme` + `utilities` only — **do not turn preflight back on**, because the legacy pages depend on browser defaults.

**Plain CSS for everything that already exists.** `global.css` and `print.css` keep serving the existing pages (login, trip list, editor). Do not migrate them opportunistically, and do not restate a Tailwind utility as a new `global.css` rule for the same element — one element, one source of truth for its styling. The two token sets coexist on purpose: Tailwind's `--color-*` is not `global.css`'s `--color-primary` family, and nothing is shared between them.

**The escape hatch.** What Tailwind cannot express goes into `global.css` as a commented, feature-prefixed block: `@keyframes`, SVG-internal styling, `:has()` parent selectors, `paint-order`. A third stylesheet, CSS Modules, CSS-in-JS, or a UI component library still needs an explicit project decision before it appears.

**Skipping preflight has a cost.** With only the theme and utilities layers imported, native controls keep their UA look, so a Tailwind page full of `<button>`s renders as a row of 1px-bordered grey boxes. `tailwind.css` therefore carries a small patch in the `theme` layer (lower priority than `utilities`, higher than the UA defaults): `font`/`color: inherit`, `border: 0`, `background: transparent`, and `cursor: pointer` for enabled buttons / `not-allowed` for disabled. Utilities still win over it, and `global.css`'s unlayered `.btn` rules are untouched. Add new UA normalisations there, not per component.

Inline styles stay deliberate for data-dependent or library-facing values, such as day and category colours, progress widths, background-image URLs, and Leaflet marker HTML. Stable layout and appearance belong in a class.

**Traps found while building the 09-26 home page** (each one failed silently, so keep them in mind before "cleaning up" any of it):

- `text-[calc(...)]` is ambiguous (size vs colour) and Tailwind resolves it to `color:`, so it silently does nothing. Force the font-size reading with the type hint: `text-[length:calc(16*var(--ui))]`.
- Unlayered `global.css` element rules beat Tailwind utilities, because everything Tailwind emits lives in a cascade layer and specificity does not enter into it. `h1 { font-size: 1.35rem }` wins over `text-[length:...]` on the same element, so a Tailwind page's heading sizes belong in `global.css` (or the heading must not be an `h1`/`h2`).
- If the page suddenly renders nothing or loses its stylesheet in dev, suspect a stale dev transform before touching any rule: `fetch('/src/styles/global.css')` showing `__vite__css = ""`, or a router-level `SyntaxError: The requested module ... does not provide an export named ...` from an untouched file, both mean the dev server is serving an old/empty transform of a file you just wrote. Re-saving the file clears it; neither `?direct` nor a production build shows anything wrong.
- Sizing a fixed-aspect design (the 1668x943 UI mock) with the viewport: the home page defines one `--ui` ("1 design pixel") as `max(0.75px, min(0.0599vw, 0.106vh))` and writes every size as `calc(<design px> * var(--ui))`. Width-only units overflow vertically on wide screens; the `min()` keeps the scale inside both axes. Horizontal anchors stay percentages so they keep their relation to the capsule's edges.
- Absolute card fans need a separate narrow-screen layout: `GenerationRunPanel` switches to normal-flow grid cards at 900px, resets desktop title offsets and card poses, and keeps the footer after the cards. Check transformed card bounds against both the viewport and footer; `scrollWidth` alone misses clipping hidden by `overflow-hidden`. The generation panel uses the background on `AppLayout`, avoiding a second independently scaled copy with visible seams.
- Generation photos use `selectGenerationCards`: prefer the latest five candidates with a cover URL not in the panel's failed-URL set, then fill remaining slots with recent candidates. `PoiCover.onCoverError(url)` lets the panel replace a broken image with an earlier usable one; key the cover by URL so a replacement URL does not inherit failure state. Never remove candidates from the SSE model just to curate the visual fan. Captions use real `poi.intro` text, with `poi.name` as the fallback. Per the 09-28 product decision, the generation page has no photo credit row or cloud/airplane/building decorations.
- `useStagedGenerationCards` separates presentation timing from SSE state: a 1200ms clock moves at most one slot toward the latest selected target, without restarting on incoming events. Stop its interval on terminal status/unmount; reduced motion bypasses pacing. Typewriter spans reserve text space, expose one accessible status string and animate only the visual characters. Generation headings use `SimSun`, `Songti SC`, then bundled `Noto Serif SC Variable`; avoid treating raster-reference font guesses as confirmed font provenance.

Evidence: `apps/web/src/pages/HomePage.tsx`, `apps/web/src/components/home/HomeCapsule.tsx`, `apps/web/src/components/home/ChinaMap.tsx`, `apps/web/src/styles/tailwind.css`.

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
  fits the selected day (or all days in overview); other days stay as dimmed context outside or
  inside that viewport. Reset uses the same selected range.
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

## Itinerary Detail Reading and Navigation (2026-09-28)

- `dayFilter` is the single owner for itinerary and map selection: `null` means overview/all days. Loading defaults to the first available day. View changes never increment `revision`.
- `deleteDay` preserves selection by original day ID after renumbering. If the selected day was removed, select the first remaining day; an empty trip uses `null`. Overview stays overview after mutations.
- Cards show activity order, not a timeline. Keep persisted legacy time fields during edits, with raw time visible only in details; new activities use empty time strings.
- The action disclosure lives in the activity card header at the top right and remains available even without an outgoing transit leg. Derive transit from `legForPair` so reorder/delete cannot leave stale travel information.
- Desktop uses three panels; at 1100px and below, use section switching. `MapView.useIsDesktop` must share that breakpoint so hidden maps do not fit a zero-size canvas.
- Both map renderers use `MapControls`. Reset fits the selected range without changing the filter. Amap overlay invalidation includes activity labels/details, not just coordinates, so editing a name also refreshes its map label.
- Regression commands: `node --import tsx --test apps/web/tests/editorStore.test.ts`, `node apps/web/tests/editor-browser.mjs`, and `node apps/web/tests/editor-browser.mjs --amap`. Browser checks intercept API calls with local fixtures; `--amap` tests the SDK contract using a stub, not a live Amap service.

### Editor export and viewport regression guard

- A `backdrop-filter` ancestor establishes a containing block for fixed children. Keep the offscreen `.print-host` and fullscreen export preview portalled to `document.body`; otherwise a long print view can inflate editor scrolling or a preview can become confined to the toolbar.
- The editor toolbar must have an explicit stacking level above the body panels. Raising only the export menu's z-index cannot escape the toolbar's stacking context.
- Scope viewport height/overflow to the editor AppLayout, keeping panel scrolling and print media intact. Test both document scrollHeight and panel scrolling, including a print view taller than the viewport.
- Editor primary buttons/selected states intentionally reference the homepage `--color-brand-light` / `--color-brand` tokens per user request; disabled sends use its disabled pair.
- Export checks must click through PNG, JSON and print, verify the downloaded PNG/JSON, and exercise long itineraries. Testing only whether the menu exists misses stacking-context click interception.

## My Trips Collection

- `TripListPage` owns search, destination and sorting in URL parameters (`q`, `city`, `sort`), preserving conditions when returning from detail.
- Render only list summaries; do not fetch each trip detail to fill covers or fabricate travel dates/photos. Dates are explicitly update dates.
- Cards are accessible whole-card links. Covers use decorative SVGs and handwriting; body text remains readable sans serif. Keep natural page scrolling and responsive columns, scoped separately from the fixed editor viewport.
- Collection has no create/import/rename/delete commands; export belongs in detail. Keep loading, empty, no-results and retry states.
- Regression: `node apps/web/tests/trip-collection-browser.mjs` checks filters, navigation, recovery and responsive layouts with isolated API fixtures.
