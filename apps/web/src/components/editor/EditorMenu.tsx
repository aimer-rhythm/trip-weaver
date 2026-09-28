import { useRef, type ReactNode } from 'react';

/** Native disclosure keeps keyboard access; Escape / focus leaving dismisses it. */
export function EditorMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details className="editor-menu" ref={ref}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }}
      onKeyDown={(e) => { if (e.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }}>
      <summary aria-label={label} title={label}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg></summary>
      <div className="editor-menu-list" onClick={(e) => { if ((e.target as HTMLElement).closest('button') && ref.current) ref.current.open = false; }}>
        {children}
      </div>
    </details>
  );
}
