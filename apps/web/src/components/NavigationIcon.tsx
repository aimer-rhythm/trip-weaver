export function NavigationIcon({ name, className = '' }: { name: 'bell' | 'logout' | 'arrow' | 'close'; className?: string }) {
  return <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'bell' && <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>}
    {name === 'logout' && <><path d="M14 5V4a1 1 0 0 0-1-1H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a1 1 0 0 0 1-1v-1" /><path d="M10 12h12m-4-4 4 4-4 4" /></>}
    {name === 'arrow' && <path d="M4 12h16m-5-5 5 5-5 5" />}
    {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
  </svg>;
}
