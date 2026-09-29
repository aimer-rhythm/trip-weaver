import { useRef, type ReactNode } from 'react';

/** Native disclosure keeps keyboard access; Escape / focus leaving dismisses it. */
export function EditorMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details className={"editor-menu relative flex-none [&_>_summary]:grid [&_>_summary]:[place-items:center] [&_>_summary]:[width:44px] [&_>_summary]:[height:44px] [&_>_summary]:[border-radius:50%] [&_>_summary]:[font-size:24px] [&_>_summary]:font-semibold [&_>_summary]:[list-style:none] [&_>_summary]:cursor-pointer [&_>_summary]:[color:var(--color-editor-menu-color-83)] [&_>_summary::-webkit-details-marker]:hidden [&_>_summary:hover]:[background:var(--color-editor-menu-background-84)] [&[open]_>_summary]:[background:var(--color-editor-menu-background-84)]"} ref={ref}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }}
      onKeyDown={(e) => { if (e.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }}>
      <summary aria-label={label} title={label}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg></summary>
      <div className={"editor-menu-list absolute [right:0] [bottom:100%] [z-index:12] flex flex-col [width:180px] [padding:6px] [border-radius:14px] [background:var(--color-btn-primary-color-3)] [border:1px_solid_var(--color-editor-menu-list-border-85)] [box-shadow:0_10px_30px_var(--color-editor-menu-list-box-shadow-86)] [&_button]:[font:inherit] [&_button]:[font-size:14px] [&_button]:[padding:10px] [&_button]:border-0 [&_button]:[background:none] [&_button]:text-left [&_button]:[border-radius:8px] [&_button]:[color:inherit] [&_button]:[min-height:40px] [&_label]:[font:inherit] [&_label]:[font-size:14px] [&_label]:[padding:10px] [&_label]:border-0 [&_label]:[background:none] [&_label]:text-left [&_label]:[border-radius:8px] [&_label]:[color:inherit] [&_label]:[min-height:40px] [&_button:not(:disabled):hover]:[background:var(--color-editor-menu-list-background-87)] [&_button:not(:disabled):hover]:cursor-pointer [&_button:disabled]:[opacity:.4] [&_button:disabled]:[cursor:not-allowed] [&_label]:grid [&_label]:[gap:6px] [&_select]:[font:inherit] [&_select]:[padding:7px] [&_select]:[border:1px_solid_var(--color-editor-menu-list-border-85)] [&_select]:[border-radius:6px] [&_select]:w-full [&_.text-danger]:[color:var(--color-editor-menu-list-color-88)] [&_.text-danger]:[border-top:1px_solid_var(--color-editor-menu-list-border-top-89)]"} onClick={(e) => { if ((e.target as HTMLElement).closest('button') && ref.current) ref.current.open = false; }}>
        {children}
      </div>
    </details>
  );
}
