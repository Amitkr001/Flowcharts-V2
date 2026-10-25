/**
 * Command palette (⌘K / Ctrl+K or "/").
 * One search box for markets, timeframes, chart types, indicators, panels, pages and actions.
 * Ranked fuzzy matching, grouped results, full keyboard control (cmdk pattern, dependency-free).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { I, Kbd } from './ui/Icons';
import { net } from '../data/client';
import { BAR_SPECS, specKey, specLabel } from '../data/bars';
import { settings, openSymbol, togglePanel, setUI, toggleOverlay } from '../lib/settings';
import { scripts, saveScripts } from '../indicators/runtime';
import { overlays, closePalette, openPalette, run, typing } from '../lib/commands';
import { OV_GROUPS, PANELS, STYLES } from './workspace/meta';
import { fmtPx } from '../lib/format';

interface Item { id: string; group: string; label: string; hint?: string; icon: string; right?: string; kbd?: string; on?: boolean; keep?: boolean; danger?: boolean; run(): void }

const toChart = () => { if (location.hash && !/^#\/?chart/.test(location.hash)) location.hash = '#/chart'; };

/** Each query token must match the label (substring, word-start bonus, or tight subsequence) or appear in the description. */
function tokenScore(tok: string, label: string, hint: string): number {
  const i = label.indexOf(tok);
  if (i >= 0) return 200 - Math.min(i, 60) + (i === 0 || label[i - 1] === ' ' ? 40 : 0);
  let j = 0, gaps = 0, last = -1;
  for (const ch of tok) { const k = label.indexOf(ch, j); if (k < 0) { last = -2; break; } if (last >= 0) gaps += k - last - 1; last = k; j = k + 1; }
  if (last !== -2 && gaps <= tok.length * 2) return 120 - gaps * 4;
  const h = hint.indexOf(tok);
  return h >= 0 ? 60 - Math.min(h, 40) : -1;
}
function score(q: string, label: string, hint: string): number {
  if (!q) return 1;
  const L = label.toLowerCase(), H = hint.toLowerCase(); let total = 0;
  for (const tok of q.toLowerCase().split(/\s+/).filter(Boolean)) { const s = tokenScore(tok, L, H); if (s < 0) return -1; total += s; }
  return total;
}

export function CommandPalette() {
  const mode = overlays.use(s => s.palette);
  const syms = net.use(s => s.symbols), st = settings.use(s => s), list = scripts.use(s => s.list);
  const [q, setQ] = useState(''), [sel, setSel] = useState(0);
  const inp = useRef<HTMLInputElement>(null), box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); overlays.get().palette ? closePalette() : openPalette('all'); }
      else if (e.key === '/' && !typing(e) && !overlays.get().palette) { e.preventDefault(); openPalette('symbols'); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (mode) { setQ(''); setSel(0); setTimeout(() => inp.current?.focus(), 0); } }, [mode]);

  const items = useMemo<Item[]>(() => {
    if (!mode) return [];
    const out: Item[] = [];
    const symItem = (id: string, group: string): Item | null => {
      const s = syms.find(x => x.id === id); if (!s) return null;
      return { id: `${group}:${id}`, group, label: s.id, hint: s.desc, icon: s.volume === 'real' ? 'activity' : 'wave', right: s.last ? fmtPx(s.last, s.dec) : undefined, on: id === st.sym, run: () => { openSymbol(id); toChart(); } };
    };
    for (const id of st.ui.recent) { const it = symItem(id, 'Recent'); if (it) out.push(it); }
    for (const s of syms) { const it = symItem(s.id, 'Markets'); if (it) { it.hint = `${s.desc} · ${s.venues}`; out.push(it); } }
    if (mode === 'symbols') return out;
    const A = (id: string, label: string, icon: string, f: () => void, o: Partial<Item> = {}) => out.push({ id: 'a:' + id, group: 'Actions', label, icon, run: f, ...o });
    A('replay', 'Start bar replay', 'replay', () => run('replay'));
    A('shot', 'Take screenshot', 'camera', () => run('screenshot'));
    A('share', 'Copy share link', 'share', () => run('share'));
    A('live', 'Scroll to real-time', 'live', () => run('live'), { kbd: 'End' });
    A('reset', 'Reset chart view', 'focus', () => run('reset'), { kbd: 'Home' });
    A('fit', 'Fit all bars', 'focus', () => run('fit'));
    A('auto', 'Auto-scale price', 'focus', () => run('autoscale'));
    A('settings', 'Order-flow settings', 'sliders', () => run('settings'));
    A('focusmode', st.ui.focus ? 'Exit focus mode' : 'Enter focus mode (chart only)', 'focus', () => { setUI({ focus: !st.ui.focus }); toChart(); }, { kbd: 'F' });
    A('tray', st.ui.tray ? 'Hide bottom tray' : 'Show bottom tray', 'panelBottom', () => { setUI({ tray: !st.ui.tray }); toChart(); }, { kbd: 'B' });
    A('cancel', 'Cancel all working orders', 'x', () => run('cancelAll'), { danger: true });
    A('flatten', 'Flatten position (close at market)', 'alert', () => { if (confirm(`Close the ${st.sym} paper position at market?`)) run('flatten'); }, { danger: true });
    A('keys', 'Keyboard shortcuts', 'keyboard', () => overlays.set({ shortcuts: true }), { kbd: '?' });
    BAR_SPECS.forEach(s => out.push({ id: 'tf:' + specKey(s), group: 'Timeframe', label: `Timeframe ${specLabel(s)}`, icon: 'clock', on: st.spec === specKey(s), run: () => { settings.set({ spec: specKey(s) }); toChart(); } }));
    STYLES.forEach(([k, l, ic, d]) => out.push({ id: 'st:' + k, group: 'Chart type', label: l, hint: d, icon: ic, on: st.style === k, run: () => { settings.set({ style: k }); toChart(); } }));
    OV_GROUPS.forEach(([, it]) => it.forEach(([k, l, d]) => out.push({ id: 'ov:' + k, group: 'Indicators', label: l, hint: d, icon: 'fx', on: st.ov[k], keep: true, run: () => toggleOverlay(k) })));
    list.forEach(s => out.push({ id: 'sc:' + s.id, group: 'Indicators', label: s.name, hint: 'Custom script', icon: 'code', on: s.on, keep: true, run: () => saveScripts(list.map(x => x.id === s.id ? { ...x, on: !x.on } : x)) }));
    PANELS.forEach(([k, l, ic, kb]) => out.push({ id: 'p:' + k, group: 'Panels', label: `${st.ui.panel === k ? 'Close' : 'Open'} ${l}`, icon: ic, kbd: kb, on: st.ui.panel === k, run: () => { togglePanel(k); toChart(); } }));
    ([['chart', 'Trade', 'chart'], ['multi', 'Layouts', 'grid'], ['indicators', 'Scripts', 'code'], ['backtest', 'Backtest', 'flask'], ['journal', 'Journal', 'book'], ['account', 'Account & settings', 'user']] as const)
      .forEach(([k, l, ic]) => out.push({ id: 'n:' + k, group: 'Go to', label: l, icon: ic, run: () => { location.hash = '#/' + k; } }));
    return out;
  }, [mode, syms, st, list]);

  const shown = useMemo(() => {
    const r = items.map(it => ({ it, s: score(q, it.label, `${it.hint || ''} ${it.group}`) })).filter(x => x.s >= 0);
    if (q) r.sort((a, b) => b.s - a.s);
    const cap: Record<string, number> = { Recent: 6, Markets: q ? 8 : 12, Timeframe: q ? 6 : 0, 'Chart type': q ? 3 : 0, Indicators: q ? 8 : 0, Panels: q ? 6 : 0, 'Go to': q ? 6 : 0, Actions: q ? 8 : 6 };
    const order = q ? [] as string[] : ['Recent', 'Markets', 'Actions'];
    const groups = new Map<string, Item[]>();
    for (const { it } of r) { if (!q && !order.includes(it.group)) continue; if (q && it.group === 'Recent') continue; const g = groups.get(it.group) || []; if (g.length < (cap[it.group] ?? 6)) { g.push(it); groups.set(it.group, g); } }
    return [...groups.entries()];
  }, [items, q]);
  const flat = shown.flatMap(([, g]) => g);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { box.current?.querySelector('.cp-item.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  if (!mode) return null;

  const exec = (it: Item) => { it.run(); if (!it.keep) closePalette(); };
  const onKey = (e: { key: string; preventDefault(): void }) => {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(flat.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && flat[sel]) { e.preventDefault(); exec(flat[sel]); }
  };
  let idx = -1;
  return (
    <div className="cp-bg" onMouseDown={e => { if (e.target === e.currentTarget) closePalette(); }}>
      <div className="cp" role="dialog" aria-label="Command palette">
        <div className="cp-in">
          <I n="search" s={18} />
          <input ref={inp} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder={mode === 'symbols' ? 'Search markets…' : 'Type a market, indicator, timeframe or action…'} aria-label="Search" />
          {mode === 'symbols' && <button className="cp-scope" onClick={() => openPalette('all')}>All commands</button>}
          <Kbd k="Esc" />
        </div>
        <div className="cp-list" ref={box} role="listbox">
          {shown.map(([g, its]) => (
            <div key={g} className="cp-group">
              <div className="cp-gh">{g}</div>
              {its.map(it => { idx++; const i = idx; return (
                <div key={it.id} className={`cp-item ${i === sel ? 'sel' : ''} ${it.danger ? 'danger' : ''}`} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => exec(it)}>
                  <span className="cp-ic"><I n={it.icon} s={15} /></span>
                  <span className="cp-txt"><b>{it.label}</b>{it.hint && <small>{it.hint}</small>}</span>
                  {it.right && <span className="cp-right mono">{it.right}</span>}
                  {it.on !== undefined && it.group !== 'Markets' && it.group !== 'Recent' && <span className={`cp-state ${it.on ? 'on' : ''}`}>{it.on ? 'On' : 'Off'}</span>}
                  {it.on && (it.group === 'Markets' || it.group === 'Recent') && <span className="cp-state on">Open</span>}
                  {it.kbd && <Kbd k={it.kbd} />}
                </div>); })}
            </div>
          ))}
          {!flat.length && <div className="cp-empty">No results for “{q}”</div>}
        </div>
        <div className="cp-foot"><span><Kbd k="↑" /><Kbd k="↓" /> navigate</span><span><Kbd k="↵" /> select</span><span><Kbd k="Esc" /> close</span><span className="cp-tip">Tip: press <Kbd k="/" /> to jump straight to markets</span></div>
      </div>
    </div>
  );
}
