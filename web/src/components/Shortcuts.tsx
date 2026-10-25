/** Keyboard shortcuts sheet ("?"). Also registers the global workspace shortcuts. */
import { useEffect } from 'react';
import { I, Kbd, MOD } from './ui/Icons';
import { overlays, typing } from '../lib/commands';
import { settings, setUI, togglePanel } from '../lib/settings';
import { PANELS, FAV_TF } from './workspace/meta';

const ROWS: [string, [string, string[]][]][] = [
  ['General', [['Command palette', [MOD, 'K']], ['Search markets', ['/']], ['This sheet', ['?']], ['Close dialog / cancel tool', ['Esc']]]],
  ['Workspace', [['Focus mode (chart only)', ['F']], ['Toggle bottom tray', ['B']], ...PANELS.map(([, l, , k]) => [l, k.split('+')] as [string, string[]]), ['Close right panel', ['Alt', '0']]]],
  ['Chart', [['Timeframes 1m · 5m · 15m · 1h · 4h · 1D', ['1', '–', '6']], ['Zoom in / out', ['+', '−']], ['Scroll', ['←', '→']], ['Reset view', ['Home']], ['Go to real-time', ['End']], ['Zoom price', ['Ctrl', 'wheel']]]],
  ['Drawing', [['Trend line', ['Alt', 'T']], ['Horizontal line', ['Alt', 'H']], ['Fib retracement', ['Alt', 'F']], ['Rectangle', ['Alt', 'R']], ['Long / short position', ['Alt', 'L / S']], ['Undo / redo', [MOD, 'Z / Y']], ['Delete selected', ['Del']]]],
];

export function Shortcuts() {
  const open = overlays.use(s => s.shortcuts);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (typing(e) || overlays.get().palette) return;
      if (e.key === '?') { e.preventDefault(); overlays.set({ shortcuts: !overlays.get().shortcuts }); return; }
      if (e.key === 'Escape' && overlays.get().shortcuts) { overlays.set({ shortcuts: false }); return; }
      const onChart = !location.hash || /^#\/?chart/.test(location.hash);
      if (!onChart || e.metaKey || e.ctrlKey) return;
      if (e.altKey && /^Digit[0-6]$/.test(e.code)) { e.preventDefault(); const n = +e.code.slice(5); if (n === 0) setUI({ panel: null }); else togglePanel(PANELS[n - 1][0]); return; }
      if (e.altKey) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setUI({ focus: !settings.get().ui.focus }); }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setUI({ tray: !settings.get().ui.tray, focus: false }); }
      else if (/^[1-6]$/.test(e.key)) { e.preventDefault(); settings.set({ spec: FAV_TF[+e.key - 1] }); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  if (!open) return null;
  return (
    <div className="cp-bg" onMouseDown={e => { if (e.target === e.currentTarget) overlays.set({ shortcuts: false }); }}>
      <div className="sheet" role="dialog" aria-label="Keyboard shortcuts">
        <div className="sheet-h"><I n="keyboard" s={18} /><b>Keyboard shortcuts</b><span className="grow" /><button className="icon-btn" onClick={() => overlays.set({ shortcuts: false })} aria-label="Close"><I n="x" /></button></div>
        <div className="sheet-b">
          {ROWS.map(([g, rows]) => (
            <section key={g}><h6>{g}</h6>{rows.map(([l, ks]) => <div key={l} className="sk-row"><span>{l}</span><span className="kbds">{ks.map((k, i) => k === '–' ? <span key={i} className="muted">–</span> : <Kbd key={i} k={k} />)}</span></div>)}</section>
          ))}
        </div>
      </div>
    </div>
  );
}
