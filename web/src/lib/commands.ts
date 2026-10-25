/**
 * Global command bus + overlay state.
 * The command palette, keyboard shortcuts and toolbar buttons all go through `run()`, so every action
 * has exactly one implementation and is reachable from the keyboard.
 */
import { createStore } from './store';

export type Cmd = 'screenshot' | 'share' | 'reset' | 'live' | 'autoscale' | 'settings' | 'replay' | 'flatten' | 'cancelAll' | 'zoomIn' | 'zoomOut' | 'fit';

export const overlays = createStore<{ palette: false | 'all' | 'symbols'; shortcuts: boolean }>({ palette: false, shortcuts: false });
export const openPalette = (mode: 'all' | 'symbols' = 'all') => overlays.set({ palette: mode });
export const closePalette = () => overlays.set({ palette: false });

/** Run a chart command. If the chart page is not open it is opened first. */
export function run(c: Cmd) {
  const fire = () => window.dispatchEvent(new CustomEvent('fs:cmd', { detail: c }));
  if (!/^#\/?(chart)?(\?|$)/.test(location.hash) && location.hash !== '') { location.hash = '#/chart'; setTimeout(fire, 120); }
  else fire();
}
export function onCmd(f: (c: Cmd) => void) {
  const h = (e: Event) => f((e as CustomEvent).detail as Cmd);
  window.addEventListener('fs:cmd', h);
  return () => window.removeEventListener('fs:cmd', h);
}
/** True when keyboard focus is in a text field (shortcuts must not fire). */
export const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
