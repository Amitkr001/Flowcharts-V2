import { useEffect, useRef, useState } from 'react';
import { MenuBar } from '../components/MenuBar';
import { ChartEngine } from '../chart/engine';
import { data, net } from '../data/client';
import { watcherFor, releaseWatcher } from '../data/bookwatch';
import { BAR_SPECS, specKey, specLabel } from '../data/bars';
import { settings, specOf, bigFor, bigModeFor, bigQtyFor, drawingsStore, saveDrawings, type Pane } from '../lib/settings';
import { createStore } from '../lib/store';
import type { ChartStyle } from '../lib/types';

/** Linked crosshair shared by all panes. */
const cross = createStore<{ t: number | null; from: number }>({ t: null, from: -1 });

function ChartPane({ idx, pane }: { idx: number; pane: Pane }) {
  const st = settings.use(s => s), syms = net.use(s => s.symbols);
  const cv = useRef<HTMLCanvasElement>(null), leg = useRef<HTMLDivElement>(null), eng = useRef<ChartEngine | null>(null);
  const [, force] = useState(0);
  const sym = syms.find(s => s.id === pane.sym) || syms[0];
  const set = (patch: Partial<Pane>) => settings.set(s => {
    const panes = s.multi.panes.map((p, i) => i === idx ? { ...p, ...patch } : (s.multi.link && patch.sym ? { ...p, sym: patch.sym } : p));
    return { multi: { ...s.multi, panes } };
  });
  const curMode = sym ? bigModeFor(sym.id) : 'usd';
  const curUsd = sym ? bigFor(sym.id, sym.bigUsd) : 100_000;
  const curQty = sym ? bigQtyFor(sym.id, sym.bigQty || 1) : 1;
  const bigConfig = { mode: curMode, bigUsd: curUsd, bigQty: curQty, autoPct: st.bigAutoPct ?? 0.99 };
  const opts = () => ({ style: pane.style, ov: { ...st.ov, stats: false }, spec: specOf(pane.spec), rowMult: 1, bigUsd: curUsd, bigConfig, acct: st.acct, magnet: st.magnet, fpMode: st.fpMode, flow: st.flow });

  useEffect(() => {
    const e = new ChartEngine(cv.current!, opts());
    e.cb = {
      legend: html => { if (leg.current && leg.current.innerHTML !== html) leg.current.innerHTML = html; },
      cross: t => { if (settings.get().multi.cross) cross.set({ t, from: idx }); },
    };
    eng.current = e; force(x => x + 1);
    const off = cross.subscribe(() => { const c = cross.get(); e.extCross = c.from === idx ? null : c.t; e.invalidate(); });
    return () => { off(); e.destroy(); eng.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const e = eng.current; if (!e || !sym) return;
    const m = data.get(sym.id);
    e.book = sym.hasBook ? watcherFor(m, sym.row, st.wallMult) : null;
    e.setOptions({ bigUsd: curUsd, bigConfig });
    e.setMarket(m, sym);
    e.cb.drawings = list => saveDrawings(sym.id, list);
    e.setDrawings(JSON.parse(JSON.stringify(drawingsStore.get().bySym[sym.id] || [])));
    data.calendar().then(c => { e.calendar = c.filter(x => x.impact === 'High' && x.country === 'USD'); e.invalidate(); });
    return () => { if (sym.hasBook) releaseWatcher(sym.id); e.book = null; data.release(sym.id); };
  }, [sym?.id]);

  useEffect(() => { eng.current?.setOptions(opts()); }, [pane.style, pane.spec, st.ov, st.flow, st.fpMode, st.acct, st.magnet, curUsd, curQty, curMode, st.bigAutoPct]);

  return (
    <div className="mpane">
      <div className="mpane-h">
        <select value={pane.sym} onChange={e => set({ sym: e.target.value })} aria-label="Symbol">{syms.map(s => <option key={s.id}>{s.id}</option>)}</select>
        <select value={pane.spec} onChange={e => set({ spec: e.target.value })} aria-label="Bar type">{BAR_SPECS.map(s => <option key={specKey(s)} value={specKey(s)}>{specLabel(s)}</option>)}</select>
        <select value={pane.style} onChange={e => set({ style: e.target.value as ChartStyle })} aria-label="Style"><option value="candles">Candles</option><option value="footprint">Footprint</option><option value="heatmap">Heatmap</option></select>
        <span style={{ flex: 1 }} />
        <button className="mini-btn" onClick={() => eng.current?.goLive()} title="Scroll to real-time">»</button>
        <button className="mini-btn" onClick={() => eng.current?.reset()} title="Reset chart">⟲</button>
        <button className="mini-btn" onClick={() => { settings.set({ sym: pane.sym, spec: pane.spec, style: pane.style }); location.hash = '#/chart'; }} title="Open in full chart">⤢</button>
      </div>
      <div className="chart-box"><canvas ref={cv} /></div>
    </div>
  );
}

export function MultiChartPage() {
  const m = settings.use(s => s.multi);
  const setM = (patch: Partial<typeof m>) => settings.set(s => ({ multi: { ...s.multi, ...patch } }));
  return (
    <div className="page">
      <MenuBar active="multi" center={<>
        <span className="seg-mini big">{([1, 2, 4] as const).map(n => <span key={n} className={m.n === n ? 'on' : ''} onClick={() => setM({ n })}>{n === 1 ? '1 chart' : n === 2 ? '2 charts' : '4 charts'}</span>)}</span>
        <label className="mini" title="Changing the symbol in one pane changes all panes" onClick={() => setM({ link: !m.link })} style={{ cursor: 'pointer' }}><span className={`chk ${m.link ? 'on' : ''}`} />Link symbol</label>
        <label className="mini" title="Show the crosshair time in every pane" onClick={() => setM({ cross: !m.cross })} style={{ cursor: 'pointer' }}><span className={`chk ${m.cross ? 'on' : ''}`} />Link crosshair</label>
      </>} />
      <div className={`mgrid n${m.n}`}>
        {m.panes.slice(0, m.n).map((p, i) => <ChartPane key={i} idx={i} pane={p} />)}
      </div>
    </div>
  );
}
