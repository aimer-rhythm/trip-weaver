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

All application pages and components use **Tailwind CSS 4 utilities in JSX**, including existing authentication, collection, editor, generation, home and shared UI. The 2026-09-29 product decision removes the legacy-page exception. Do not recreate `global.css`, `print.css`, map-specific CSS, a runtime class-name translator, or CSS selector rules as an alternative styling system.

`apps/web/src/styles/tailwind.css` is the single application stylesheet. It contains Tailwind imports, `@theme` colour tokens, `@layer base` browser defaults/print visibility, font-face declarations and animation keyframes. Keep preflight disabled; base defaults sit below utilities, so headings and controls can be styled directly in JSX. Leaflet's vendor stylesheet and packaged font CSS remain vendor dependencies.

Use standard utilities where available, semantic colour tokens (`bg-brand`, `text-ink-muted`) and arbitrary values/properties for exact design measurements. Existing migration tokens preserve the original palette; reuse or consolidate them rather than adding hard-coded colours. Native state, responsive, descendant and print behavior belongs in Tailwind variants. Use complete literal class names, never construct utility names from runtime fragments. An attribute selector should use single quotes inside a JavaScript string, e.g. `[&[data-tone='1']]:bg-canvas`; escaped double quotes can prevent Tailwind source detection.

Retain semantic hook names only when selectors, map collision code or browser tests require them; they are not backed by a second stylesheet. Before combining utility groups, remove conflicting properties rather than relying on their order in `className` (Tailwind generates stylesheet order independently). Conditional modifiers need explicit state variants or mutually exclusive utility groups.

Inline styles stay deliberate for data-dependent or library-facing values, such as day and category colours, progress widths, background-image URLs, and Leaflet marker HTML. Stable layout and appearance belong in a class.

**Traps found while building the 09-26 home page** (each one failed silently, so keep them in mind before "cleaning up" any of it):

- `text-[calc(...)]` is ambiguous (size vs colour) and Tailwind resolves it to `color:`, so it silently does nothing. Force the font-size reading with the type hint: `text-[length:calc(16*var(--ui))]`.
- Keep all browser defaults in `@layer base`; unlayered element rules would override utilities regardless of selector specificity. Page heading sizes now belong in JSX.
- If the page suddenly renders nothing or loses its stylesheet in dev, suspect a stale dev transform before touching any rule: `fetch('/src/styles/tailwind.css')` showing `__vite__css = ""`, or a router-level `SyntaxError: The requested module ... does not provide an export named ...` from an untouched file, both mean the dev server is serving an old/empty transform of a file you just wrote. Re-saving the file clears it; neither `?direct` nor a production build shows anything wrong.
- Sizing a fixed-aspect design (the 1668x943 UI mock) with the viewport: the home page defines one `--ui` ("1 design pixel") as `max(0.75px, min(0.0599vw, 0.106vh))` and writes every size as `calc(<design px> * var(--ui))`. Width-only units overflow vertically on wide screens; the `min()` keeps the scale inside both axes. Horizontal anchors stay percentages so they keep their relation to the capsule's edges.
- Absolute card fans need a separate narrow-screen layout: `GenerationRunPanel` switches to normal-flow grid cards at 900px, resets desktop title offsets and card poses, and keeps the footer after the cards. Check transformed card bounds against both the viewport and footer; `scrollWidth` alone misses clipping hidden by `overflow-hidden`. The generation panel uses the background on `AppLayout`, avoiding a second independently scaled copy with visible seams.
- Generation photos use `selectGenerationCards`: prefer the latest five candidates with a cover URL not in the panel's failed-URL set, then fill remaining slots with recent candidates. `PoiCover.onCoverError(url)` lets the panel replace a broken image with an earlier usable one; key the cover by URL so a replacement URL does not inherit failure state. Never remove candidates from the SSE model just to curate the visual fan. Captions use real `poi.intro` text, with `poi.name` as the fallback. Per the 09-28 product decision, the generation page has no photo credit row or cloud/airplane/building decorations. Curated licensed photos carry their own compact author/work/license notice via `PhotoCredit`; keep it with the associated photo, including inside the editor activity card, before transport details. Legacy photos without attribution metadata do not gain a fabricated notice.
- `useStagedGenerationCards` separates presentation timing from SSE state: a 1200ms clock moves at most one slot toward the latest selected target, without restarting on incoming events. Stop its interval on terminal status/unmount; reduced motion bypasses pacing. Typewriter spans reserve text space, expose one accessible status string and animate only the visual characters. Generation headings use `SimSun`, `Songti SC`, then bundled `Noto Serif SC Variable`; avoid treating raster-reference font guesses as confirmed font provenance.

Evidence: `apps/web/src/pages/HomePage.tsx`, `apps/web/src/components/home/HomeCapsule.tsx`, `apps/web/src/components/home/ChinaMap.tsx`, `apps/web/src/styles/tailwind.css`.

## Dialogs and Browser UI

- `PhotoCredit` handles Pexels, Commons, Unsplash and Pixabay explicitly. When a validated photographer profile URL is present, link the name to that profile and the source label to the work. Preserve Unsplash referral parameters and each selected gallery photo's own attribution; do not label all non-Pexels photos as Commons. API secrets and private adoption endpoints never belong in frontend state. New-source browser fixtures are mock protocol/layout verification, not evidence of live photo coverage.

- Detail activity and non-compact candidate photos use `PoiCover variant="photo"`, with the chosen C layout: medium cover beside wider text, intrinsic aspect ratio and `object-contain`. Landscape/square bounds are180×120px desktop and128×88px mobile; portrait bounds108×150px and74×110px. Limit the trigger to44% of the row and retain a44px minimum button target. Read actual natural dimensions, not assumed source orientation. Full-width photos beneath text and the previous smaller image layout were rejected; do not reintroduce fixed-aspect cropping.
- Only the saved cover appears in the card. The shared `Button` opens `Modal size="photo"`, with cover-first deduplicated photos capped at three total, previous/next controls, thumbnails and selected-photo attribution. Browsing never changes the saved cover; reopening starts at the cover. Remove failed alternatives; a failed cover hides the photo instead of displaying an alternative under the wrong credit. Preserve old single-cover snapshots. Viewing must not autosave or send chat messages. Compact generation thumbnails retain their presentation and the shared modal's default size remains unchanged. Verify text/photo balance, gallery switching, Escape, focus restoration, image failure, mobile bounds and five image ratios with `apps/web/tests/photo-layout-browser.mjs`.

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
  pass through `escapeHtml` before interpolation. It shows only activity summaries; no edit button
  or delegated edit handler remains.
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
- Cards show activity order, not a timeline. Persisted legacy time fields remain in data; the full-detail dialog has been removed and new activities use empty time strings.
- The action disclosure lives in the activity card header at the top right and remains available even without an outgoing transit leg. Derive transit from `legForPair` so reorder/delete cannot leave stale travel information.
- Desktop uses three panels; at 1100px and below, use section switching. `MapView.useIsDesktop` must share that breakpoint so hidden maps do not fit a zero-size canvas.
- Both map renderers use `MapControls`. Reset fits the selected range without changing the filter. Amap overlay invalidation includes activity labels/details, not just coordinates, so editing a name also refreshes its map label.
- Regression commands: `node --import tsx --test apps/web/tests/editorStore.test.ts`, `node apps/web/tests/editor-browser.mjs`, and `node apps/web/tests/editor-browser.mjs --amap`. Browser checks intercept API calls with local fixtures; `--amap` tests the SDK contract using a stub, not a live Amap service.

### Editor export and viewport regression guard

- A `backdrop-filter` ancestor establishes a containing block for fixed children. Keep the offscreen `.print-host` and fullscreen export preview portalled to `document.body`; otherwise a long print view can inflate editor scrolling or a preview can become confined to the toolbar.
- The editor toolbar must have an explicit stacking level above the body panels. Raising only the export menu's z-index cannot escape the toolbar's stacking context.
- Scope viewport height/overflow to the editor AppLayout, keeping panel scrolling and print media intact. Test both document scrollHeight and panel scrolling, including a print view taller than the viewport.
- Editor primary buttons/selected states intentionally reference the homepage `--color-brand-light` / `--color-brand` tokens per user request; disabled sends use its disabled pair.
- Image export now uses `TripShareImageDialog` with shared Modal/Button, explicit generate → loading → preview/download or manual retry. Opening alone must not call the paid API. JSON/print remain independent; `.print-host` stays portalled to body. Tests use a mocked image provider, never paid calls.
- Keep pending/result state while the modal is closed; clear stale image state after relevant draft changes and isolate component state by trip ID. Returning an old request after draft edits must not show an image for the current draft.
- `trip-share-image-browser.mjs` checks loading, close/reopen, failure retry, preview/download and portrait mobile bounds; editor regression retains JSON and print checks.

## Shared UI Components (2026-09-29)

- `Button variant="plain"` is deliberately interaction-only: no display, spacing, border, radius, background, typography or opacity utilities. Those conflict with domain classes through Tailwind generation order (appending className does not guarantee overrides). Verify selected chips and calendar cells by computed colours and screenshots, not only aria-pressed.
- The shared Select retains native semantics, with a uniform arrow and `appearance: base-select` picker styling where supported; other browsers use their native popup. Keep arrow clearance in the utility layer (`pr-10`), since `px-3` would override component-layer padding. Picker rules live in the single tailwind.css entry.
- Home date picker uses two months on desktop and one at <=640px. Calendar grids include six weeks, hide adjacent-month cells and retain next/previous month navigation. `picker-browser.mjs` covers a six-week month, selected-chip contrast, open pickers and mobile overflow.

- Use `components/ui/Button.tsx` for all JSX buttons: `primary`, `secondary`, `ghost`, `danger`, and `plain` for domain-specific layouts (calendar cells, map filters, route choices). The default type is `button`; forms must explicitly use `type="submit"`. Native props and React 19 refs pass through. `loading` adds Spinner, disables repeated actions and sets `aria-busy`; provide visible pending text. IconButton requires an accessible label. Button-like links use `buttonClassName` without changing anchor semantics.
- Use `ui/Field.tsx` Input/Select/Textarea. Do not restyle their borders, colours, font or focus through parent selectors. Keep layout at the caller. Select retains native keyboard and OS popup behaviour; checkbox/radio/file/range keep native compact semantics.
- `ui/Dropdown.tsx` owns details/summary menu panels, external-click dismissal, focus leaving and Escape focus restoration. EditorMenu is a domain wrapper. Route options share `useDismissibleDisclosure` while retaining their asynchronous selection behaviour. Never use ARIA menu roles without implementing their keyboard model.
- `Modal` remains the only dialog shell: named by its title, native modal focus trap, viewport-bounded scroll, Escape and actual-backdrop close. Closing returns focus to the trigger (or its collapsed disclosure summary). `ui/ActionDialog` provides ConfirmDialog and PromptDialog; no window.confirm/prompt in product flows. Export image preview uses Modal too.
- Activity cards and both map renderers expose summaries, not manual activity-edit or full-detail actions. Existing activities remain reorderable/movable/deletable; adding activities remains available. Do not tell users to use a removed editor when coordinates are missing.
- Tests: `styles.test.mjs` prevents raw JSX controls outside ui and browser prompt/confirm; `shared-ui-browser.mjs` covers form states, dialog naming/focus, calendar and narrow viewports; editor tests cover both renderers and export.

## My Trips Collection

- Spine shading uses a soft 24px gradient tinted with the cover's `currentColor`. Keep white highlights restrained (18% alpha) and fade the crease into the cover without a second white stripe; a bright crease edge makes the binding look metallic. Compare with `09-28-my-trips-redesign/research/ui-reference.png` at matching scale.

- `TripListPage` owns search, destination and sorting in URL parameters (`q`, `city`, `sort`), preserving conditions when returning from detail.
- Render only list summaries; do not fetch each trip detail to fill covers or fabricate travel dates/photos. Dates are explicitly update dates.
- Cards are accessible whole-card links. `TripCover` renders pastel covers with a narrow curved spine, a crease and two short binding marks. Without an asset, destination handwriting stays centred; body text remains readable sans serif. Keep natural page scrolling and responsive columns, scoped separately from the fixed editor viewport.
- Optional cover line art is discovered at build time with `import.meta.glob('../assets/city-landmarks/*.{svg,png,webp}', { eager: true, query: '?url', import: 'default' })`. Name files after the complete city name, e.g. `北京.png`, using lowercase extensions; trim destination whitespace and a trailing `市` only. Duplicate city files resolve in SVG → PNG → WebP order. Do not substring-match multi-city trips or request guessed/external image URLs. Prefer transparent outline assets; PNG/WebP must have actual alpha transparency, since alpha masks recolour all opaque shapes, including unwanted white backgrounds. A hidden image confirms loading before rendering the decorative mask; failure retains the text cover. Sources/license records belong beside the assets; see `docs/CITY_LANDMARK_ASSETS.md`. Production additions require a rebuild. White-background PNG line art is converted in place with `npm run assets:transparent` (`scripts/to-transparent.mjs`, zero dependencies): it sets `alpha = 255 - max(R,G,B)` with RGB forced to black, skips files that already contain transparent pixels so re-running never double-processes a converted asset, and leaves non-8-bit / interlaced / non-NRGBA PNGs untouched while reporting them as failures.
- Collection has no create/import/rename/delete commands; export belongs in detail. Keep loading, empty, no-results and retry states.
- Regression: `node apps/web/tests/trip-collection-browser.mjs` checks filters, navigation, recovery, responsive layouts, SVG/PNG/WebP loading and priority, transparent PNG alpha, failure and exact-city matching with isolated fixtures. `TRIP_COLLECTION_URL` and `TRIP_COLLECTION_OUTPUT` override the default server/output. Temporary uniquely named image fixtures are created with exclusive writes and removed in `finally`; never overwrite user assets. Format assertions must accept both URL paths and Vite-inlined data URLs. Run production builds after fixture cleanup so test assets do not enter the bundle.
