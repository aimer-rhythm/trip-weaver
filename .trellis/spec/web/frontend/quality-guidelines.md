# Quality Guidelines

> Web-specific quality standards for apps/web.

## Overview

See shared spec for general quality rules. Web-specific additions:

## Web-Only Forbidden Patterns

| Pattern | Why |
|---------|-----|
| Direct fetch() calls | Use api.client wrapper |
| window.fetch for API calls | Use React Query hooks |
| document.title manipulation | Use React Helmet if needed later |
| Uncontrolled inputs without refs | Prefer controlled components |
| Global CSS scoping conflicts | Use unique class names with component prefix |

## Bundle Size Considerations

- Leaflet is the largest dependency (used in MapView)
- html-to-image used for PNG export (loaded only on demand)
- No code splitting currently; revisit if bundle exceeds 500KB

## Accessibility

- Modal uses native <dialog> element (built-in focus trap + ESC)
- Form inputs have labels and proper types
- Loading/error states shown for all async operations
- Buttons have descriptive text (not just icons)

