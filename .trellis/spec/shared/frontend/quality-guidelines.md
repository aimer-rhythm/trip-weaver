# Quality Guidelines

> Code quality standards for frontend development.

## Forbidden Patterns

| Pattern | Why |
|---------|-----|
| Class components | Use functional + hooks |
| CSS-in-JS | Project uses plain CSS |
| any type | Prefer unknown + type guard |
| Direct DOM manipulation | Use React refs |
| Inline styles | Use CSS classes |
| prop-drilling > 2 levels | Extract to store or context |

## Required Patterns

| Pattern | Where |
|---------|-------|
| TypeScript strict mode | All files |
| React hooks at top of component | All components |
| React Query for API data | Data fetching |
| Zustand for editor state | Trip editing |
| Semantic CSS class names | Styles |
| ApiError class for error handling | API calls |

## Code Review Checklist

- [ ] No class components
- [ ] Props typed with interface
- [ ] Hooks follow rules (top-level, no conditionals)
- [ ] Query keys consistent with keys pattern
- [ ] No direct API calls in components
- [ ] CSS changes use existing naming conventions

