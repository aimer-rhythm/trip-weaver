# State Management

> How state is managed in this project.

## State Categories

| Category | Tool | Scope |
|----------|------|-------|
| Server state | React Query | API data, caching |
| Editor state | Zustand | Trip editing (draft) |
| URL state | React Router | Routes, params |
| Local state | useState | Modal open, form state, UI flags |

## Server State

- All API data managed by React Query
- Server is the single source of truth for business data
- Editor uses a local draft; auto-save writes back to server

## Local (Editor) State

- **Zustand** store for trip editor (store/editorStore.ts)
- Structured clone for immutable updates: structuredClone(cur)
- Revision counter drives auto-save debounce

`	s
// Store pattern: single create() call per store
export const useEditorStore = create<EditorState>((set, get) => ({
  trip: null,
  revision: 0,
  load: (trip) => set({ trip: structuredClone(trip), revision: 0 }),
  updateMeta: (patch) => mutate((draft) => Object.assign(draft, patch)),
  addDay: () => mutate((draft) => { draft.days.push(...) }),
  // ...
}));
`

## When to Use Global State

- Only trip editor state is global (via Zustand)
- Everything else is local state or React Query
- Avoid adding new Zustand stores without strong justification

