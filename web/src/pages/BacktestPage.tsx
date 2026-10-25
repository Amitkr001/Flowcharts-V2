/**
 * Strategy backtest.
 *   left    market · data · strategy (presets or your code) · parameters · risk & costs
 *   right   KPIs, equity + drawdown curve, trade list (CSV)
 * Data: "Recorded ticks" uses the server's tick history (full order flow: delta, footprint, big trades);
 *       "Exchange candles" goes further back but has no aggressor split on some venues.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MenuBar } from '../components/MenuBar';
import { I } from '../components/ui/Icons';
import { net, data } from '../data/client';
import { BAR_SPECS, BarBuilder, buildSeries, parseSpec, specKey, specLabel, type Series } from '../data/bars';
import { settings, bigFor } from '../lib/settings';
import { PRESETS, backtest, signalsOf, tradesCsv, type BtConfig, type BtResult, type Param } from '../backtest/engine';
import { hidpi, fmtUsd, FONT, MONO } from '../lib/format';
import { toast } from '../lib/api';
import type { KBar, Tick } from '../lib/types';

function Equity({ r }: { r: BtResult }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const { ctx, w, h } = hidpi(c), eq = r.equity, dd = r.dd, n = eq.length;
    ctx.fillStyle = '#0c0e12'; ctx.fillRect(0, 0, w, h);
    if (n < 2) return;
    const eqH = h * 0.72, ddH = h - eqH - 6;
    let a = Math.min(0, ...eq), b = Math.max(0, ...eq); if (a === b) { a -= 1; b += 1; }
    const X = (i: number) => 8 + (i / (n - 1)) * (w - 76), Y = (v: number) => 10 + ((b - v) / (b - a)) * (eqH - 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(8, Y(0)); ctx.lineTo(w - 68, Y(0)); ctx.stroke(); ctx.setLineDash([]);
    const last = eq[n - 1], col = last >= 0 ? '#22c58b' : '#a47cf2';
    const g = ctx.createLinearGradient(0, 0, 0, eqH); g.addColorStop(0, col + '40'); g.addColorStop(1, col + '00');
    ctx.beginPath(); eq.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.stroke(); ctx.lineWidth = 1;
    ctx.lineTo(X(n - 1), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    for (const t of r.trades) { ctx.fillStyle = t.pnl > 0 ? '#22c58b' : '#a47cf2'; ctx.beginPath(); ctx.arc(X(t.i1), Y(eq[t.i1]), 2.2, 0, 7); ctx.fill(); }
    const mdd = Math.min(-1e-9, ...dd), Yd = (v: number) => eqH + 6 + (v / mdd) * ddH;
    ctx.fillStyle = '#191e25'; ctx.fillRect(0, eqH + 2, w, 1);
    ctx.beginPath(); ctx.moveTo(X(0), Yd(0)); dd.forEach((v, i) => ctx.lineTo(X(i), Yd(v))); ctx.lineTo(X(n - 1), Yd(0)); ctx.closePath(); ctx.fillStyle = 'rgba(240,80,110,0.28)'; ctx.fill();
    ctx.font = `11px ${MONO}`; ctx.fillStyle = '#8b96a3'; ctx.textAlign = 'left';
    ctx.fillText(fmtUsd(b), w - 64, 14); ctx.fillText(fmtUsd(a), w - 64, eqH - 6); ctx.fillText(fmtUsd(mdd), w - 64, h - 4);
    ctx.font = `600 11px ${FONT}`; ctx.fillStyle = '#a0a9b6'; ctx.fillText('Equity', 10, 16); ctx.fillText('Drawdown', 10, eqH + 18);
  }, [r]);
  return <canvas ref={cv} className="bt-eq" aria-label="Equity curve" />;
}

export function BacktestPage() {
  const syms = net.use(s => s.symbols), st = settings.use(s => s);
  const [sym, setSym] = useState(st.sym), [spec, setSpec] = useState('t:300'), [src, setSrc] = useState<'ticks' | 'klines'>('klines'), [hours, setHours] = useState(24);
  const [pid, setPid] = useState(PRESETS[0].id), [code, setCode] = useState(PRESETS[0].code), [params, setParams] = useState<Param[]>(PRESETS[0].params), [showCode, setShowCode] = useState(false);
  const [cfg, setCfg] = useState({ qty: 1, slTicks: 40, tpTicks: 80, feePct: 0.04, slipTicks: 1, maxBars: 0, dir: 'both' as BtConfig['dir'] });
  const [busy, setBusy] = useState(false), [res, setRes] = useState<BtResult | null>(null), [err, setErr] = useState(''), [meta, setMeta] = useState('');
  const si = syms.find(s => s.id === sym);
  const preset = PRESETS.find(p => p.id === pid);
  useEffect(() => { const p = PRESETS.find(x => x.id === pid); if (p) { setCode(p.code); setParams(p.params.map(x => ({ ...x }))); } }, [pid]);
  const C = (k: keyof typeof cfg, v: number | string) => setCfg(c => ({ ...c, [k]: v }));

  const run = async () => {
    if (!si) return;
    setBusy(true); setErr(''); setRes(null);
    try {
      const s = parseSpec(spec), B = new BarBuilder(s, si.row, bigFor(si.id, si.bigUsd));
      if (src === 'ticks') {
        const to = Date.now(), ticks: Tick[] = await data.ticksRange(si.id, to - hours * 3_600_000, to);
        if (!ticks?.length) throw new Error('No recorded ticks for this period. The server records markets listed in RECORD; try exchange candles or a shorter period.');
        B.addAll(ticks);
      } else {
        if (s.kind !== 'time' || s.sec < 60) throw new Error('Exchange candles need a time bar type of 1 minute or more.');
        const k: KBar[] = await data.klines(si.id, s.sec, 1500);
        if (!k?.length) throw new Error('No candle history available for this market.');
        B.seedKlines(k, false);
      }
      const d: Series = buildSeries(B.bars);
      if (d.length < 30) throw new Error(`Only ${d.length} bars — need at least 30. Use a longer period or smaller bar type.`);
      const sig = signalsOf(code, d, params);
      const r = backtest(d, sig, { ...cfg, tick: si.tick });
      setRes(r); setMeta(`${d.length} bars · ${new Date(d.time[0]).toLocaleString('en-GB')} → ${new Date(d.time[d.length - 1]).toLocaleString('en-GB')}`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const csv = () => { if (!res || !si) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([tradesCsv(res.trades, si.dec)], { type: 'text/csv' })); a.download = `flowscope-backtest-${si.id}.csv`; a.click(); toast('Trades exported'); };
  const S = res?.stats;
  const kpis = useMemo(() => S ? [
    ['Net P&L', fmtUsd(S.net), S.net >= 0 ? 'up' : 'dn'], ['Trades', String(S.n), ''], ['Win rate', `${S.winRate.toFixed(1)}%`, ''],
    ['Profit factor', isFinite(S.pf) ? S.pf.toFixed(2) : '∞', S.pf >= 1 ? 'up' : 'dn'], ['Max drawdown', fmtUsd(S.maxDD), 'dn'], ['Expectancy', fmtUsd(S.expectancy), S.expectancy >= 0 ? 'up' : 'dn'],
    ['Avg win / loss', `${fmtUsd(S.avgWin)} / ${fmtUsd(-S.avgLoss)}`, ''], ['Long / short', `${fmtUsd(S.longPnl)} / ${fmtUsd(S.shortPnl)}`, ''], ['Fees', fmtUsd(-S.fees), ''], ['Avg bars held', S.avgBars.toFixed(1), ''],
  ] : [], [S]);

  return (
    <div className="page">
      <MenuBar active="backtest" />
      <div className="bt-layout">
        <aside className="bt-side">
          <section><h6>Market & data</h6>
            <label className="f2">Market<select value={sym} onChange={e => setSym(e.target.value)}>{syms.map(s => <option key={s.id} value={s.id}>{s.id} — {s.desc}</option>)}</select></label>
            <label className="f2">Bar type<select value={spec} onChange={e => setSpec(e.target.value)}>{BAR_SPECS.map(s => <option key={specKey(s)} value={specKey(s)}>{specLabel(s)}</option>)}</select></label>
            <div className="seg3" role="radiogroup" aria-label="Data source">
              <button className={src === 'klines' ? 'on' : ''} onClick={() => setSrc('klines')}>Exchange candles</button>
              <button className={src === 'ticks' ? 'on' : ''} onClick={() => setSrc('ticks')}>Recorded ticks</button>
            </div>
            {src === 'ticks' ? <label className="f2">Period (hours)<input type="number" min={1} max={168} value={hours} onChange={e => setHours(Math.max(1, Math.min(168, +e.target.value)))} /></label>
              : <p className="hint">Up to 1,500 candles. Some venues don't split buy/sell volume in candles, so delta-based strategies work best on recorded ticks.</p>}
          </section>
          <section><h6>Strategy</h6>
            <label className="f2"><select value={pid} onChange={e => setPid(e.target.value)}>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="custom">Custom code</option></select></label>
            {preset && <p className="hint">{preset.desc}</p>}
            {params.map((p, i) => <label key={p.k} className="f2 row">{p.label}<input type="number" step="any" value={p.v} onChange={e => setParams(ps => ps.map((x, j) => j === i ? { ...x, v: +e.target.value } : x))} /></label>)}
            <button className="link sm" onClick={() => setShowCode(s => !s)}>{showCode ? 'Hide code' : 'Edit code'}</button>
            {showCode && <textarea className="bt-code mono" spellCheck={false} value={code} onChange={e => { setCode(e.target.value); setPid('custom'); }} aria-label="Strategy code" />}
          </section>
          <section><h6>Risk & costs</h6>
            <div className="seg3" role="radiogroup" aria-label="Direction">{(['both', 'long', 'short'] as const).map(d => <button key={d} className={cfg.dir === d ? 'on' : ''} onClick={() => C('dir', d)}>{d === 'both' ? 'Long & short' : d === 'long' ? 'Long only' : 'Short only'}</button>)}</div>
            <div className="g2">
              <label className="f2">Quantity<input type="number" step="any" min={0} value={cfg.qty} onChange={e => C('qty', +e.target.value)} /></label>
              <label className="f2">Max bars (0 = off)<input type="number" min={0} value={cfg.maxBars} onChange={e => C('maxBars', +e.target.value)} /></label>
              <label className="f2">Stop loss · ticks<input type="number" min={0} value={cfg.slTicks} onChange={e => C('slTicks', +e.target.value)} /></label>
              <label className="f2">Take profit · ticks<input type="number" min={0} value={cfg.tpTicks} onChange={e => C('tpTicks', +e.target.value)} /></label>
              <label className="f2">Fee % per side<input type="number" step="0.01" min={0} value={cfg.feePct} onChange={e => C('feePct', +e.target.value)} /></label>
              <label className="f2">Slippage · ticks<input type="number" min={0} value={cfg.slipTicks} onChange={e => C('slipTicks', +e.target.value)} /></label>
            </div>
            {si && <p className="hint">1 tick = {si.tick} · SL {(cfg.slTicks * si.tick).toFixed(si.dec)} · TP {(cfg.tpTicks * si.tick).toFixed(si.dec)}</p>}
            {si && si.last > 0 && cfg.tpTicks > 0 && (() => {
              const fees = 2 * (cfg.feePct / 100) * si.last * cfg.qty + 2 * cfg.slipTicks * si.tick * cfg.qty, tp = cfg.tpTicks * si.tick * cfg.qty;
              return fees >= tp * 0.5 ? <p className="hint warn">Round-trip costs ≈ {fmtUsd(fees)} vs take-profit {fmtUsd(tp)} — costs eat {fees >= tp ? 'all' : 'over half'} of each winning trade. Widen the target or lower the fee.</p> : null;
            })()}
          </section>
          <button className="btn pri bt-run" onClick={run} disabled={busy || !si}><I n="play" s={14} />{busy ? 'Running…' : 'Run backtest'}</button>
        </aside>

        <main className="bt-main">
          {err && <div className="sc-err"><I n="alert" s={14} /><span>{err}</span></div>}
          {!res && !err && <div className="empty" style={{ height: '100%' }}><span className="e-ic"><I n="flask" s={18} /></span><b>Run a backtest</b><small>Choose a market, a strategy and your costs, then press Run. Fills happen at the next bar's open; if stop and target are both touched in one bar, the stop is assumed first.</small></div>}
          {res && S && <>
            <div className="bt-meta"><b>{preset?.name || 'Custom strategy'}</b><span className="muted">{sym} · {specLabel(parseSpec(spec))} · {meta} · {res.ms.toFixed(0)} ms</span><span className="grow" /><button className="btn" onClick={csv} disabled={!res.trades.length}>Export CSV</button></div>
            <div className="bt-kpis">{kpis.map(([k, v, c]) => <div key={k} className="kpi"><small>{k}</small><b className={`mono ${c}`}>{v}</b></div>)}</div>
            <Equity r={res} />
            <div className="bt-table">
              <table className="dt"><thead><tr><th>#</th><th>Side</th><th>Entry time</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">Bars</th><th>Exit reason</th><th className="r">MFE / MAE</th><th className="r">P&amp;L</th></tr></thead>
                <tbody>{res.trades.slice().reverse().map((t, k) => (
                  <tr key={k}><td className="muted mono">{res.trades.length - k}</td><td><span className={`side-badge ${t.side > 0 ? 'long' : 'short'}`}>{t.side > 0 ? 'LONG' : 'SHORT'}</span></td>
                    <td className="mono">{new Date(t.t0).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="r mono">{t.entry.toFixed(si?.dec ?? 2)}</td><td className="r mono">{t.exit.toFixed(si?.dec ?? 2)}</td><td className="r mono">{t.i1 - t.i0}</td>
                    <td>{({ tp: 'Take profit', sl: 'Stop loss', signal: 'Exit signal', reverse: 'Reversed', time: 'Time stop', end: 'End of data' } as const)[t.why]}</td>
                    <td className="r mono muted">{t.mfe.toFixed(si?.dec ?? 2)} / {t.mae.toFixed(si?.dec ?? 2)}</td>
                    <td className={`r mono ${t.pnl >= 0 ? 'up' : 'dn'}`}>{fmtUsd(t.pnl)}</td></tr>))}
                </tbody></table>
              {!res.trades.length && <div className="empty"><b>No trades</b><small>The strategy produced no signals on this data. Loosen the parameters or use more history.</small></div>}
            </div>
            <p className="muted bt-disc">Backtests are simulations on historical data and do not guarantee future results.</p>
          </>}
        </main>
      </div>
    </div>
  );
}
