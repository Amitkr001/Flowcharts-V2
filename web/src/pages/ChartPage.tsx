import { useEffect, useRef, useState } from 'react';
import { MenuBar } from '../components/MenuBar';
import { LeftToolbar } from '../components/LeftToolbar';
import { DrawingBar } from '../components/DrawingBar';
import { ChartToolbar, StatusLine } from '../components/ChartChrome';
import { OrderTicket } from '../components/workspace/OrderTicket';
import { RightPanel, BottomTray, WidgetBar } from '../components/workspace/Panels';
import { DomDock, TapeDock, WatchDock } from '../components/Docks';
import { BigTradesDock, VenuesDock } from '../components/FlowDocks';
import { AlertsPanel } from '../components/AlertsPanel';
import { FlowSettings, type FlowTab } from '../components/FlowSettings';
import { ChartControls } from '../components/ChartControls';
import { ChartEngine } from '../chart/engine';
import type { ViewState } from '../chart/engine';
import { data, net, type MarketData } from '../data/client';
import { watcherFor, releaseWatcher } from '../data/bookwatch';
import { parseSpec } from '../data/bars';
import { settings, saveDrawings, drawingsStore, bigFor, bigModeFor, bigQtyFor, toggleOverlay, setUI, openSymbol, setFlow, togglePanel } from '../lib/settings';
import { scripts, saveScripts, runScript } from '../indicators/runtime';
import { PaperBroker } from '../lib/paper';
import { alerts, addAlert } from '../lib/alerts';
import { recordFill } from '../lib/journal';
import { makeShareLink, readShare } from '../lib/share';
import { Icon } from '../lib/icons';
import { I } from '../components/ui/Icons';
import { onCmd } from '../lib/commands';
import { toast } from '../lib/api';
import { uid } from '../lib/format';
import type { BigTradeConfig, CalEvent, Drawing } from '../lib/types';

const ROW_MULTS = [1, 2, 4, 5, 10, 20, 50];

export function ChartPage() {
  const st = settings.use(s => s);
  const syms = net.use(s => s.symbols), connected = net.use(s => s.connected);
  const list = scripts.use(s => s.list);
  const unread = alerts.use(s => s.unread);
  const sym = syms.find(s => s.id === st.sym) || syms.find(s => s.id === 'DEMO') || syms[0];
  const cvRef = useRef<HTMLCanvasElement>(null), legRef = useRef<HTMLDivElement>(null);
  const gImb = useRef<HTMLElement>(null), gCvd = useRef<HTMLElement>(null), gImbT = useRef<HTMLSpanElement>(null), gCvdT = useRef<HTMLSpanElement>(null);
  const eng = useRef<ChartEngine | null>(null);
  const [md, setMd] = useState<MarketData | null>(null);
  const [broker, setBroker] = useState<PaperBroker | null>(null);
  const [selD, setSelD] = useState<Drawing | null>(null);
  const [tool, setTool] = useState('cursor');
  const [menu, setMenu] = useState<{ x: number; y: number; p: number } | null>(null);
  const [replay, setReplay] = useState<{ idx: number; on: boolean; speed: number } | null>(null);
  const [lockAll, setLockAll] = useState(false), [hideAll, setHideAll] = useState(false);
  const [, setStatusTick] = useState(0);
  const [vs, setVs] = useState<ViewState>({ live: true, auto: true });
  const [showSet, setShowSet] = useState(false), [setTab, setSetTab] = useState<FlowTab>('big');
  const [cal, setCal] = useState<CalEvent[]>([]);
  const spec = parseSpec(st.spec);
  const curSymId = sym?.id || st.sym;
  const curMode = bigModeFor(curSymId);
  const bigUsd = sym ? bigFor(sym.id, sym.bigUsd) : 100_000;
  const bigQty = sym ? bigQtyFor(sym.id, sym.bigQty || 1) : 1;
  const bigConfig: BigTradeConfig = {
    mode: curMode,
    bigUsd,
    bigQty,
    autoPct: st.bigAutoPct ?? 0.99,
  };
  const engOpts = () => ({ style: st.style, ov: st.ov, spec, rowMult: st.rowMult, bigUsd, bigConfig, acct: st.acct, magnet: st.magnet, fpMode: st.fpMode, flow: st.flow });

  /* engine lifecycle */
  useEffect(() => {
    const e = new ChartEngine(cvRef.current!, engOpts());
    e.cb = {
      view: s => setVs(s),
      select: d => setSelD(d ? { ...d } : null),
      tool: t => setTool(t),
      context: (ev, p) => setMenu({ x: ev.clientX, y: ev.clientY, p }),
      legend: html => { if (legRef.current && legRef.current.innerHTML !== html) legRef.current.innerHTML = html; },
      gauges: (imb, cvd) => {
        if (!gImb.current) return;
        gImb.current.style.left = Math.max(0, Math.min(96, 50 + (imb / (Math.abs(imb) + 20)) * 48)) + '%';
        gCvd.current!.style.left = Math.max(0, Math.min(96, 50 + (cvd / (Math.abs(cvd) + 300)) * 48)) + '%';
        gImbT.current!.textContent = 'Imb: ' + Math.round(imb); gCvdT.current!.textContent = 'Cvd: ' + Math.round(cvd);
      },
    };
    eng.current = e;
    setStatusTick(x => x + 1);
    readShare().then(p => {
      if (!p) return;
      const mine = drawingsStore.get().bySym[p.sym] || [];
      saveDrawings(p.sym, [...mine, ...p.drawings.map(d => ({ ...d, id: uid() }))]);
      settings.set(s => ({ sym: p.sym, spec: p.spec, style: p.style, ov: { ...s.ov, ...(p.ov || {}) }, tabs: s.tabs.includes(p.sym) ? s.tabs : [...s.tabs, p.sym] }));
      toast(`Shared chart loaded — ${p.drawings.length} drawing(s) added to ${p.sym}`);
    });
    data.calendar().then(setCal);
    return () => { e.destroy(); eng.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* market subscription */
  useEffect(() => {
    if (!sym) return;
    const m = data.get(sym.id); setMd(m);
    const b = new PaperBroker(sym.id); b.tickSize = sym.tick; b.onChange = (msg) => { if (msg) toast(msg); eng.current?.invalidate(); };
    b.onFill = (f, before, after, avg) => { recordFill(sym.id, f.px, f.pnl, before, after, avg, () => eng.current?.screenshot() ?? null); };
    setBroker(b);
    const off = m.on((ev, d) => { if (ev === 'tk') b.onTicks(d); if (ev === 'snap' && m.ticks.length) b.last = m.lastPrice; if (ev === 'st' || ev === 'snap') setStatusTick(x => x + 1); });
    if (m.ready) b.last = m.lastPrice;
    const e = eng.current!;
    e.paper = b;
    e.book = sym.hasBook ? watcherFor(m, sym.row, settings.get().wallMult) : null;
    e.setOptions({ bigUsd, bigConfig });
    e.setMarket(m, sym);
    e.cb.drawings = list => saveDrawings(sym.id, list);
    e.setDrawings(JSON.parse(JSON.stringify(drawingsStore.get().bySym[sym.id] || [])));
    setReplay(null); e.replayIdx = null;
    return () => { off(); if (sym.hasBook) releaseWatcher(sym.id); e.book = null; data.release(sym.id); };
  }, [sym?.id]);

  /* options -> engine */
  useEffect(() => { eng.current?.setOptions(engOpts()); }, [st.style, st.ov, st.spec, st.rowMult, bigUsd, bigQty, curMode, st.bigAutoPct, st.acct, st.magnet, st.fpMode, st.flow]);
  useEffect(() => { if (eng.current?.book) eng.current.book.mult = st.wallMult; }, [st.wallMult]);
  useEffect(() => { if (eng.current) { eng.current.hidden = hideAll; eng.current.invalidate(); } }, [hideAll]);
  useEffect(() => { const e = eng.current; if (!e) return; e.drawings.forEach(d => { d.locked = lockAll; }); e.invalidate(); }, [lockAll]);

  /* economic calendar: server feed (filtered) + your own events */
  useEffect(() => {
    const e = eng.current; if (!e) return;
    const rank: Record<string, number> = { High: 3, Medium: 2, Low: 1 }, min = rank[st.calImpact] || 3;
    const cc = st.calCountries.split(',').map(s => s.trim()).filter(Boolean);
    e.calendar = [...cal.filter(x => (rank[x.impact] || 0) >= min && (!cc.length || cc.includes(x.country))), ...st.events].sort((a, b) => a.t - b.t);
    e.invalidate();
  }, [cal, st.calImpact, st.calCountries, st.events]);

  /* custom indicators (recomputed every second) */
  useEffect(() => {
    const run = () => {
      const e = eng.current; if (!e || !e.bars.length) return;
      const on = scripts.get().list.filter(s => s.on); if (!on.length) { if (e.plots.length) { e.plots = []; e.invalidate(); } return; }
      const d = e.series(); const plots = on.flatMap(s => runScript(s, d).plots);
      e.plots = plots; e.invalidate();
    };
    run(); const h = setInterval(run, 1000); return () => clearInterval(h);
  }, [list]);

  /* replay */
  useEffect(() => {
    const e = eng.current; if (!e) return;
    if (!replay) { e.replayIdx = null; e.invalidate(); return; }
    e.replayIdx = replay.idx; e.invalidate();
    if (!replay.on) return;
    const h = setInterval(() => setReplay(r => r && ({ ...r, idx: Math.min(r.idx + 1, (e.B?.bars.length || 0)) })), replay.speed);
    return () => clearInterval(h);
  }, [replay]);
  const replayAt = replay ? eng.current?.replayTime() ?? null : null;

  /* drawing shortcuts */
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.tagName === 'INPUT' || (ev.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (ev.altKey) { const m: Record<string, string> = { t: 'trend', h: 'hline', v: 'vline', f: 'fib', r: 'rect', l: 'long', s: 'short', p: 'fixedvp' }; const t = m[ev.key.toLowerCase()]; if (t) { ev.preventDefault(); eng.current?.setTool(t); } }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { const c = () => setMenu(null); window.addEventListener('mousedown', c); return () => window.removeEventListener('mousedown', c); }, []);

  const setSym = openSymbol;
  const share = async () => {
    if (!sym) return;
    const link = await makeShareLink({ v: 1, sym: sym.id, spec: st.spec, style: st.style, ov: st.ov, drawings: eng.current?.drawings || [] });
    try { await navigator.clipboard.writeText(link); toast('Share link copied — it contains this chart and its drawings'); }
    catch { prompt('Copy this link:', link); }
  };
  const shot = () => { const e = eng.current; if (!e) return; const a = document.createElement('a'); a.download = `flowscope-${sym?.id}-${Date.now()}.png`; a.href = e.screenshot(); a.click(); toast('Screenshot saved'); };
  const onStyle = (s: typeof st.style) => settings.set({ style: s, ...(s === 'heatmap' && (spec.kind !== 'time' || spec.sec >= 60) ? { spec: 't:15' } : {}), ...(s !== 'heatmap' && st.style === 'heatmap' && spec.kind === 'time' && spec.sec < 60 ? { spec: 't:60' } : {}) });
  const toggleReplay = () => { const n = eng.current?.B?.bars.length || 0; setReplay(r => r ? null : { idx: Math.max(20, n - 150), on: true, speed: 300 }); };
  const row = sym ? sym.row * st.rowMult : 1;

  /* commands from the palette, toolbar and shortcuts */
  const cmdRef = useRef<(c: string) => void>(() => {});
  cmdRef.current = (c: string) => {
    const e = eng.current;
    if (c === 'screenshot') shot(); else if (c === 'share') share(); else if (c === 'settings') setShowSet(true); else if (c === 'replay') toggleReplay();
    else if (c === 'reset') e?.reset(); else if (c === 'live') e?.goLive(); else if (c === 'autoscale') e?.setAutoScale(true); else if (c === 'fit') e?.fit();
    else if (c === 'zoomIn') e?.zoomIn(); else if (c === 'zoomOut') e?.zoomOut();
    else if (c === 'flatten') broker?.flatten(); else if (c === 'cancelAll') broker?.cancelAll();
  };
  useEffect(() => onCmd(c => cmdRef.current(c)), []);

  const panels = {
    trade: () => broker && sym ? <OrderTicket broker={broker} sym={sym} /> : null,
    book: () => md && sym ? <DomDock md={md} sym={sym} row={row} atTime={replayAt} lastBar={() => eng.current?.bars[eng.current.bars.length - 1]} /> : null,
    tape: () => md && sym ? <TapeDock md={md} sym={sym} bigQ={bigUsd} atTime={replayAt} /> : null,
    alerts: () => sym ? <AlertsPanel sym={sym} price={md?.lastPrice || 0} /> : null,
    watch: () => <WatchDock cur={sym?.id || ''} onPick={setSym} />,
    flow: () => md ? <VenuesDock md={md} /> : null,
  };

  return (
    <div className="page term">
      <MenuBar active="chart" sym={sym} md={md} bars={() => eng.current?.bars || []} />

      <div className={`ws ${st.ui.focus ? 'focus' : ''}`}>
        <LeftToolbar tool={tool} onTool={t => eng.current?.setTool(t)} magnet={st.magnet} onMagnet={() => settings.set(s => ({ magnet: !s.magnet }))}
          locked={lockAll} onLock={() => setLockAll(v => !v)} hidden={hideAll} onHide={() => setHideAll(v => !v)} keepTool={st.flow.keepTool} onKeepTool={() => setFlow({ keepTool: !st.flow.keepTool })}
          onUndo={() => eng.current?.undoDraw()} onRedo={() => eng.current?.redoDraw()}
          onClear={() => { if (confirm('Remove all drawings on ' + sym?.id + '?')) eng.current?.clearDrawings(); }}
          onShot={shot} />
        <div className="ws-center">
          <ChartToolbar sym={sym} md={md} bars={() => eng.current?.bars || []} spec={st.spec} onSpec={k => settings.set({ spec: k })}
            style={st.style} onStyle={onStyle} fpMode={st.fpMode} onFpMode={m => settings.set({ fpMode: m })}
            rowMult={st.rowMult} rowMults={ROW_MULTS} rowLabel={m => String(+(sym ? sym.row * m : m).toPrecision(6))} onRow={m => settings.set({ rowMult: m })}
            ov={st.ov} onOv={toggleOverlay} scripts={list} onScript={id => saveScripts(list.map(s => s.id === id ? { ...s, on: !s.on } : s))}
            replaying={!!replay} onReplay={toggleReplay}
            onSettings={() => { setSetTab('theme'); setShowSet(true); }} onConfigure={t => { setSetTab(t as FlowTab); setShowSet(true); }} onShare={share} onShot={shot}
            focus={st.ui.focus} onFocus={() => setUI({ focus: !st.ui.focus })} tray={st.ui.tray} onTray={() => setUI({ tray: !st.ui.tray, focus: false })}
            panel={st.ui.panel} onTrade={() => togglePanel('trade')} />
          <div className="ws-chart">
            <div className="chart-box">
              <canvas ref={cvRef} aria-label={`${sym?.id} chart`} />
              
              <div className="gauges" style={{ display: st.style === 'heatmap' ? 'flex' : 'none' }}>
                <div className="g"><div className="bar"><i ref={gImb as any} style={{ background: '#f0506e', left: '50%' }} /></div><span ref={gImbT}>Imb: 0</span></div>
                <div className="g"><div className="bar"><i ref={gCvd as any} style={{ background: '#38bdf8', left: '50%' }} /></div><span ref={gCvdT}>Cvd: 0</span></div>
              </div>
              {selD && <DrawingBar d={selD} onPatch={p => eng.current?.updateSelected(p)} onClone={() => eng.current?.cloneSelected()} onDelete={() => eng.current?.deleteSelected()} />}
              {!connected && <div className="conn-banner"><I n="alert" s={14} />Disconnected from the data server — reconnecting…</div>}
              <ChartControls eng={eng.current} vs={vs} style={st.style}
                fpMode={st.fpMode} onFpMode={m => settings.set({ fpMode: m })}
                replaying={!!replay} onReplay={toggleReplay} />
              {replay && (
                <div className="replay-bar">
                  <span className="rp-tag">REPLAY</span>
                  <button className="tb" aria-label="Back 60 bars" onClick={() => setReplay(r => r && { ...r, idx: Math.max(5, r.idx - 60) })}><Icon n="back" /></button>
                  <button className="tb" aria-label="Play or pause" onClick={() => setReplay(r => r && { ...r, on: !r.on })}><Icon n={replay.on ? 'pause' : 'play'} /></button>
                  <button className="tb" aria-label="Step one bar" onClick={() => setReplay(r => r && { ...r, on: false, idx: r.idx + 1 })}><Icon n="step" /></button>
                  <select value={replay.speed} onChange={e => setReplay(r => r && { ...r, speed: +e.target.value })} aria-label="Replay speed"><option value={900}>1×</option><option value={300}>3×</option><option value={90}>10×</option><option value={20}>50×</option></select>
                  <span className="mono rp-time">{eng.current?.B?.bars[replay.idx - 1] ? new Date(eng.current.B.bars[replay.idx - 1].t).toLocaleString('en-GB') : ''}</span>
                  <button className="tb" aria-label="Exit replay" onClick={() => setReplay(null)}><Icon n="close" /></button>
                </div>
              )}
            </div>
          </div>
          <BottomTray broker={broker} curSym={sym?.id} mark={md?.lastPrice || 0} big={() => sym ? <BigTradesDock eng={() => eng.current} sym={sym} /> : null} />
        </div>
        <RightPanel>{panels}</RightPanel>
        <WidgetBar unread={unread} />

      </div>
      <StatusLine md={md} connected={connected} sym={sym} />

      {showSet && <FlowSettings onClose={() => setShowSet(false)} sym={sym} initialTab={setTab} />}
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={e => e.stopPropagation()}>
          {selD && <><div onClick={() => { eng.current?.cloneSelected(); setMenu(null); }}>Clone drawing</div><div onClick={() => { eng.current?.deleteSelected(); setMenu(null); }}>Delete drawing</div><hr /></>}
          {sym && <div onClick={() => { addAlert({ sym: sym.id, type: 'price', value: +menu.p.toFixed(sym.dec), dir: 'cross', once: true }); setMenu(null); toast(`Alert set at ${menu.p.toFixed(sym.dec)}`); }}><I n="bell" s={14} />Alert at <b className="mono">{menu.p.toFixed(sym?.dec)}</b></div>}
          {broker && sym && <>
            <div onClick={() => { broker.place('lmt', 1, 1, +menu.p.toFixed(sym.dec)); setMenu(null); }}><span className="up">Buy</span>&nbsp;limit 1 @ <b className="mono">{menu.p.toFixed(sym.dec)}</b></div>
            <div onClick={() => { broker.place('lmt', -1, 1, +menu.p.toFixed(sym.dec)); setMenu(null); }}><span className="dn">Sell</span>&nbsp;limit 1 @ <b className="mono">{menu.p.toFixed(sym.dec)}</b></div><hr />
          </>}
          <div onClick={() => { eng.current?.setTool('hline'); setMenu(null); toast('Click the chart to place the level'); }}>Add horizontal line</div>
          <div onClick={() => { eng.current?.goLive(); setMenu(null); }}>Scroll to real-time<kbd className="kbd">End</kbd></div>
          <div onClick={() => { eng.current?.reset(); setMenu(null); }}>Reset chart<kbd className="kbd">Home</kbd></div>
          <div onClick={() => { eng.current?.setAutoScale(true); setMenu(null); }}>Auto-scale price</div>
          <div onClick={() => { setSetTab('theme'); setShowSet(true); setMenu(null); }}>🎨 Chart Appearance &amp; Themes…</div>
          <div onClick={() => { setSetTab('trade'); setShowSet(true); setMenu(null); }}>⚡ Trading &amp; Risk Settings…</div>
          <div onClick={() => { setSetTab('audio'); setShowSet(true); setMenu(null); }}>🔊 Audio FX &amp; Synthesizer…</div>
          <div onClick={() => { share(); setMenu(null); }}>Copy share link</div>
        </div>
      )}
    </div>
  );
}
