# Hook Guidelines

> Web-specific hook patterns for apps/web.

## Overview

All data-fetching hooks live in pi/hooks.ts. See shared spec for conventions.

## Web-Specific Patterns

### API Client (api/client.ts)

`	s
// Centralized fetch wrapper with error handling
export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> | null = null) {
    super(message);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
`

### SSE Pattern (PlannerPage)

Generation progress uses EventSource with Last-Event-ID replay:

`	s
const es = new EventSource(/api/generations//events?lastEventId=0);
es.onmessage = (msg) => {
  const ev = JSON.parse(msg.data) as GenerationEvent;
  setEvents((prev) => [...prev, ev]);
};
`

### Auto-Save Pattern (TripEditorPage)

`	s
useEffect(() => {
  if (revision === 0) return;
  const timer = setTimeout(() => {
    saveTrip.mutate(current);
  }, 800);
  return () => clearTimeout(timer);
}, [revision]);
`

