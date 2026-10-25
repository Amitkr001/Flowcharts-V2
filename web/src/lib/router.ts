import { useSyncExternalStore } from 'react';

const sub = (f: () => void) => { window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); };
/** Current page from the URL hash: '#/chart' → 'chart'. Query strings (e.g. ?share=…) are ignored. */
export function useRoute(): string {
  const h = useSyncExternalStore(sub, () => location.hash, () => '');
  return h.replace(/^#\/?/, '').split('?')[0] || 'chart';
}
export const go = (r: string) => { location.hash = '#/' + r; };
