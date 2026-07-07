# State Management

> Web-specific state management for apps/web.

## Overview

See shared spec for general patterns. Web-specific details:

### Editor Store Pattern

The Zustand editor store uses a mutate helper that clones the draft before mutation:

`	s
const mutate = (fn: (draft: Trip) => void) => {
  const cur = get().trip;
  if (!cur) return;
  const draft = structuredClone(cur);
  fn(draft);
  set({ trip: draft, revision: get().revision + 1 });
};
`

### Auto-Save Flow

`
User edits -> revision++ -> debounce 800ms -> useSaveTrip mutation -> server update
                                                                         |
                                                                   invalidateQueries
`

### Form State (PlannerPage)

Generation form uses local useState (no global state needed):

`	s
const [destination, setDestination] = useState('');
const [days, setDays] = useState(3);
`

### Job State (PlannerPage)

Active generation job stored in sessionStorage for refresh recovery:

`	s
const JOB_KEY = 'tw.activeJobId';
sessionStorage.setItem(JOB_KEY, jobId);
// On refresh: check snapshot, reconnect SSE if running, navigate if done
`

