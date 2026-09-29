import type { ComponentProps } from 'react';

const fieldClass = 'ui-field box-border min-h-11 min-w-0 rounded-xl border border-solid border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-base text-[var(--color-text)] transition-colors focus:outline-2 focus:outline-offset-0 focus:outline-brand disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--color-danger)]';

export function Input({ className = '', type = 'text', ...props }: ComponentProps<'input'>) {
  const compact = ['checkbox', 'radio', 'hidden', 'file', 'range'].includes(type);
  return <input {...props} type={type} className={`${compact ? 'accent-brand focus-visible:outline-brand disabled:opacity-50' : fieldClass} ${className}`} />;
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select {...props} className={`${fieldClass} ui-select cursor-pointer pr-10 ${className}`} />;
}

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`${fieldClass} resize-y ${className}`} />;
}
