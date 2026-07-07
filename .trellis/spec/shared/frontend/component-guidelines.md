# Component Guidelines

> How components are built in this project.

## Component Patterns

- **Functional Components** with hooks (no class components)
- Props typed with TypeScript interfaces (inline in file)
- No prop-drilling beyond 2 levels -- use Zustand store

## Component Structure

`	sx
// Standard structure: import, helper, component, export

import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';

interface Props {
  trip: Trip;
  onSave: () => void;
}

export function MyComponent({ trip, onSave }: Props) {
  // State hooks at top
  const [open, setOpen] = useState(false);
  // Store selectors
  const revision = useEditorStore((s) => s.revision);
  // Effects
  useEffect(() => { ... }, [deps]);
  // Handlers
  const handleClick = () => { ... };
  // Render
  return <div>...</div>;
}
`

## Props Conventions

- Interface named Props defined above the component
- Optional props with ? for non-required
- No defaultProps -- use default parameter values

## Styling Patterns

- **Plain CSS** in styles/global.css and styles/print.css
- No CSS-in-JS, no Tailwind, no CSS modules
- Component class names map to semantic CSS classes
- Print styles in separate print.css

## Common Components

- Modal -- wraps <dialog> element
- AppLayout -- shell with topbar, outlet, settings
- ExportMenu -- dropdown with PNG/JSON/Print
- GenerationTimeline -- multi-phase progress display
- Editor components under components/editor/

