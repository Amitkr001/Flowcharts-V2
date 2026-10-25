/**
 * Indicators & scripts.
 *   left   built-in order-flow overlays (switches) + your scripts
 *   right  script editor: name, inputs, code — with a live preview on real market data and instant error feedback
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MenuBar } from '../components/MenuBar';
import { I } from '../components/ui/Icons';
import { OV_GROUPS } from '../components/workspace/meta';
import { scripts, saveScripts, runScript, newScript, SAMPLE_SCRIPTS, type Script } from '../indicators/runtime';
import { settings, toggleOverlay } from '../lib/settings';
import { net } from '../data/client';
import { BAR_SPECS, specKey, specLabel } from '../data/bars';
import { hidpi, FONT, MONO, uid } from '../lib/format';
import { toast } from '../lib/api';
import { useSeries } from './useSeries';
import type { Plot } from '../lib/types';
import type { Series } from '../data/bars';

const HELP = `d.open · d.high · d.low · d.close · d.volume · d.buy · d.sell · d.delta · d.cvd · d.vwap · d.bigBuy · d.bigSell · d.time
ta.sma · ta.ema · ta.wma · ta.stdev · ta.rsi · ta.atr · ta.macd · ta.highest · ta.lowest · ta.cross(a, b, i) · ta.crossunder(a, b, i)
plot(name, values, { color, pane: 'main' | 'sub', type: 'line' | 'hist' | 'dots' })   ·   input.<key>`;

function Preview({ d, plots, dec }: { d: Series | null; plots: Plot[]; dec: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const { ctx, w, h } = hidpi(c);
    ctx.fillStyle = '#0c0e12'; ctx.fillRect(0, 0, w, h);
    if (!d || d.length < 2) { ctx.fillStyle = '#6b7684'; ctx.font = `13px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('Loading market data…', w / 2, h / 2); return; }
    const N = Math.min(d.length, Math.max(60, Math.floor((w - 70) / 5))), i0 = d.length - N, cw = (w - 70) / N;
    const subs = plots.filter(p => p.pane === 'sub'), subH = subs.length ? Math.min(110, h * 0.28) : 0, mainH = h - subH * subs.length - 18;
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i < d.length; i++) { lo = Math.min(lo, d.low[i]); hi = Math.max(hi, d.high[i]); }
    for (const p of plots) if (p.pane !== 'sub') for (let i = i0; i < d.length; i++) { const v = p.values[i]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
    const X = (i: number) => (i - i0 + 0.5) * cw, Y = (p: number) => ((hi - p) / (hi - lo)) * mainH;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; for (let k = 1; k < 6; k++) { const y = Math.round((mainH * k) / 6) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w - 70, y); ctx.stroke(); }
    for (let i = i0; i < d.length; i++) {
      const up = d.close[i] >= d.open[i], x = X(i); ctx.fillStyle = up ? '#22c58b' : '#8b5cf6';
      ctx.fillRect(Math.round(x), Y(d.high[i]), 1, Math.max(1, Y(d.low[i]) - Y(d.high[i])));
      const y1 = Y(Math.max(d.open[i], d.close[i])); ctx.fillRect(x - Math.max(1, cw * 0.32), y1, Math.max(1, cw * 0.64), Math.max(1, Y(Math.min(d.open[i], d.close[i])) - y1));
    }
    for (const p of plots) if (p.pane !== 'sub') {
      if (p.type === 'dots') { ctx.fillStyle = p.color; for (let i = i0; i < d.length; i++) { const v = p.values[i]; if (v == null) continue; ctx.beginPath(); ctx.arc(X(i), Y(v), 3.5, 0, 7); ctx.fill(); } continue; }
      ctx.strokeStyle = p.color; ctx.lineWidth = 1.6; ctx.beginPath(); let s = false;
      for (let i = i0; i < d.length; i++) { const v = p.values[i]; if (v == null) { s = false; continue; } s ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); s = true; }
      ctx.stroke(); ctx.lineWidth = 1;
    }
    ctx.fillStyle = '#8b96a3'; ctx.font = `11px ${MONO}`; ctx.textAlign = 'left';
    for (let k = 0; k <= 5; k++) { const p = hi - ((hi - lo) * k) / 5; ctx.fillText(p.toFixed(dec), w - 64, Math.min(mainH - 4, Math.max(10, Y(p) + 4))); }
    subs.forEach((p, si) => {
      const st = mainH + si * subH; ctx.fillStyle = '#191e25'; ctx.fillRect(0, st, w, 1);
      let a = Infinity, b = -Infinity; for (let i = i0; i < d.length; i++) { const v = p.values[i]; if (v != null) { a = Math.min(a, v); b = Math.max(b, v); } }
      if (!isFinite(a)) return; if (a === b) { a -= 1; b += 1; }
      const Ys = (v: number) => st + 6 + ((b - v) / (b - a)) * (subH - 12);
      if (p.type === 'hist') { const z = Ys(Math.max(a, Math.min(b, 0))); for (let i = i0; i < d.length; i++) { const v = p.values[i]; if (v == null) continue; ctx.fillStyle = v >= 0 ? p.color : '#8b5cf6'; ctx.fillRect(X(i) - cw * 0.35, Math.min(z, Ys(v)), Math.max(1, cw * 0.7), Math.abs(Ys(v) - z)); } }
      else { ctx.strokeStyle = p.color; ctx.lineWidth = 1.5; ctx.beginPath(); let s = false; for (let i = i0; i < d.length; i++) { const v = p.values[i]; if (v == null) { s = false; continue; } s ? ctx.lineTo(X(i), Ys(v)) : ctx.moveTo(X(i), Ys(v)); s = true; } ctx.stroke(); ctx.lineWidth = 1; }
      ctx.fillStyle = '#a0a9b6'; ctx.font = `600 11px ${FONT}`; ctx.fillText(p.name, 8, st + 15);
    });
    let lx = 8; ctx.font = `600 11px ${FONT}`;
    for (const p of plots.filter(p => p.pane !== 'sub')) { ctx.fillStyle = p.color; ctx.fillText(p.name, lx, 16); lx += ctx.measureText(p.name).width + 14; }
  }, [d, plots, dec]);
  return <canvas ref={cv} className="sc-preview" aria-label="Indicator preview" />;
}

export function IndicatorsPage() {
  const list = scripts.use(s => s.list), ov = settings.use(s => s.ov), syms = net.use(s => s.symbols), curSym = settings.use(s => s.sym);
  const [selId, setSelId] = useState<string | null>(list[0]?.id ?? null), [q, setQ] = useState('');
  const [draft, setDraft] = useState<Script | null>(null), [sym, setSym] = useState(curSym), [spec, setSpec] = useState('t:300');
  const sel = list.find(s => s.id === selId) || null;
  useEffect(() => { setDraft(sel ? JSON.parse(JSON.stringify(sel)) : null); }, [selId, sel?.code, sel?.name]);
  const { series } = useSeries(sym, spec, false);
  const dec = syms.find(s => s.id === sym)?.dec ?? 2;
  const res = useMemo(() => draft && series ? runScript(draft, series) : null, [draft, series]);
  const dirty = !!sel && !!draft && JSON.stringify(sel) !== JSON.stringify(draft);
  const save = () => { if (!draft) return; saveScripts(list.map(s => s.id === draft.id ? draft : s)); toast(`Saved “${draft.name}”`); };
  const add = () => { const s = newScript(); saveScripts([...list, s]); setSelId(s.id); };
  const dup = () => { if (!draft) return; const s = { ...draft, id: uid(), name: draft.name + ' copy' }; saveScripts([...list, s]); setSelId(s.id); };
  const del = () => { if (!sel || !confirm(`Delete “${sel.name}”?`)) return; const rest = list.filter(s => s.id !== sel.id); saveScripts(rest); setSelId(rest[0]?.id ?? null); };
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const setIn = (i: number, patch: Partial<Script['inputs'][number]>) => draft && setDraft({ ...draft, inputs: draft.inputs.map((x, j) => j === i ? { ...x, ...patch } : x) });

  return (
    <div className="page">
      <MenuBar active="indicators" />
      <div className="sc-layout">
        <aside className="sc-side">
          <div className="sc-search"><I n="search" s={14} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search indicators" aria-label="Search indicators" /></div>
          <div className="sc-list">
            {OV_GROUPS.map(([g, items]) => {
              const vis = items.filter(([, n, d]) => match(n + d)); if (!vis.length) return null;
              return <section key={g}><h6>{g}</h6>{vis.map(([k, n, d]) => (
                <button key={k} className="sc-row" onClick={() => toggleOverlay(k)} role="switch" aria-checked={ov[k]}>
                  <span className="sc-txt"><b>{n}</b><small>{d}</small></span><span className={`toggle ${ov[k] ? 'on' : ''}`} />
                </button>))}</section>;
            })}
            <section>
              <h6>Your scripts <button className="sc-add" onClick={add} aria-label="New script"><I n="plus" s={13} />New</button></h6>
              {list.filter(s => match(s.name)).map(s => (
                <div key={s.id} className={`sc-row script ${s.id === selId ? 'sel' : ''}`} onClick={() => setSelId(s.id)}>
                  <span className="sc-ic"><I n="code" s={14} /></span>
                  <span className="sc-txt"><b>{s.name}</b><small>{s.inputs.length} input{s.inputs.length === 1 ? '' : 's'}</small></span>
                  <span className={`toggle ${s.on ? 'on' : ''}`} role="switch" aria-checked={s.on} aria-label={`Show ${s.name} on chart`}
                    onClick={e => { e.stopPropagation(); saveScripts(list.map(x => x.id === s.id ? { ...x, on: !x.on } : x)); }} />
                </div>))}
              {!list.length && <p className="muted sc-empty">No scripts. <button className="link" onClick={() => saveScripts(SAMPLE_SCRIPTS)}>Load examples</button></p>}
            </section>
          </div>
        </aside>

        <main className="sc-main">
          {draft ? <>
            <div className="sc-head">
              <input className="sc-name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} aria-label="Script name" />
              {dirty && <span className="sc-dirty">Unsaved</span>}
              <span className="grow" />
              <button className="btn" onClick={dup}><I n="copy" s={14} />Duplicate</button>
              <button className="btn" onClick={del}><I n="trash" s={14} />Delete</button>
              <button className="btn pri" onClick={save} disabled={!dirty}><I n="check" s={14} />Save</button>
            </div>
            <div className="sc-body">
              <div className="sc-editor">
                <div className="sc-inputs">
                  <div className="sc-sub">Inputs</div>
                  {draft.inputs.map((x, i) => (
                    <div key={i} className="sc-in">
                      <input value={x.label} onChange={e => setIn(i, { label: e.target.value })} aria-label="Input label" />
                      <input className="mono" value={x.k} onChange={e => setIn(i, { k: e.target.value.replace(/[^\w]/g, '') })} aria-label="Input key" />
                      <input className="mono" type="number" step="any" value={x.v} onChange={e => setIn(i, { v: +e.target.value })} aria-label="Value" />
                      <button className="icon-btn" aria-label="Remove input" onClick={() => setDraft({ ...draft, inputs: draft.inputs.filter((_, j) => j !== i) })}><I n="x" s={13} /></button>
                    </div>))}
                  <button className="sc-addin" onClick={() => setDraft({ ...draft, inputs: [...draft.inputs, { k: `in${draft.inputs.length + 1}`, label: 'Input', v: 10 }] })}><I n="plus" s={13} />Add input</button>
                </div>
                <div className="sc-sub">Code <span className="muted">— body of <span className="mono">(d, ta, input, plot) =&gt; {'{ … }'}</span></span></div>
                <textarea className="sc-code mono" spellCheck={false} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })}
                  onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } if (e.key === 'Tab') { e.preventDefault(); const t = e.currentTarget, a = t.selectionStart; t.setRangeText('  ', a, t.selectionEnd, 'end'); setDraft({ ...draft, code: t.value }); } }} aria-label="Script code" />
                <pre className="sc-help">{HELP}</pre>
              </div>
              <div className="sc-right">
                <div className="sc-ptools">
                  <select value={sym} onChange={e => setSym(e.target.value)} aria-label="Preview market">{syms.map(s => <option key={s.id}>{s.id}</option>)}</select>
                  <select value={spec} onChange={e => setSpec(e.target.value)} aria-label="Preview bar type">{BAR_SPECS.filter(s => s.kind === 'time' && s.sec >= 60).map(s => <option key={specKey(s)} value={specKey(s)}>{specLabel(s)}</option>)}</select>
                  <span className="grow" />
                  {res && <span className={`sc-status ${res.err ? 'err' : 'ok'}`}>{res.err ? 'Error' : `${res.plots.length} plot${res.plots.length === 1 ? '' : 's'} · ${res.ms.toFixed(1)} ms`}</span>}
                </div>
                <Preview d={series} plots={res?.plots || []} dec={dec} />
                {res?.err && <div className="sc-err"><I n="alert" s={14} /><span className="mono">{res.err}</span></div>}
                <p className="muted sc-note">Turn the switch next to a script on to draw it on the Trade chart. Scripts run only in your browser and sync to your account when signed in.</p>
              </div>
            </div>
          </> : <div className="empty" style={{ height: '100%' }}><span className="e-ic"><I n="code" s={18} /></span><b>No script selected</b><small>Create a new script or pick one on the left.</small><button className="btn pri" onClick={add} style={{ marginTop: 10 }}><I n="plus" s={14} />New script</button></div>}
        </main>
      </div>
    </div>
  );
}
