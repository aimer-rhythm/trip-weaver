/** 行程手册中的统一细线图标。 */
export function EditorIcon({ name }: { name: 'pin' | 'calendar' | 'back' | 'send' | 'walk' | 'route' | 'place' | 'reset' | 'export' }) {
  const paths = {
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    calendar: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 2v4M17 2v4M3 9h18M7 13h3M14 13h3M7 17h3',
    back: 'M20 12H4m7-7-7 7 7 7',
    send: 'm21 3-7 18-4-8-8-4 19-6ZM10 13 21 3',
    walk: 'M14 3h.01M13 7l-2 6 4 4 1 5M11 13l-3 8M13 7l4 5 3 1M12 8l-5 3-2 4',
    route: 'M5 5h14v14H5ZM5 11h14M8 19v3M16 19v3M8 15h.01M16 15h.01',
    place: 'm12 3 8 4v10l-8 4-8-4V7l8-4ZM8 10h8v5H8Z',
    reset: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M12 8v8M8 12h8',
    export: 'M12 15V2m-4 4 4-4 4 4M5 10H3v11h18V10h-2',
  };
  return <svg className="editor-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
