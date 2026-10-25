import { useEffect, useMemo, useReducer, useState } from 'react';
import type { MarketData } from '../data/client';
import type { ChartEngine } from '../chart/engine';
import type { SymbolInfo, Tick } from '../lib/types';
import { fmtQ, fmtT } from '../lib/format';

function useTick(ms: number) { const [, f] = useReducer(x => x + 1, 0); useEffect(() => { const h = setInterval(f, ms); return () => clearInterval(h); }, [ms]); }
const download = (name: string, text: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); };

/** Large-trade log: aggregated big prints from the chart (same rules as the bubbles), filterable, exportable. */
export function BigTradesDock({ eng, sym }: { eng: () => ChartEngine | null; sym: SymbolInfo }) {
  useTick(1000);
  const [min, setMin] = useState(0), [side, setSide] = useState<0 | 1 | -1>(0);
  const e = eng(), bars = e?.bars || [], venues = e?.md?.venues || [];
  const unit = sym.contractUnit || 'units';
  const list: Tick[] = [];
  for (let i = bars.length - 1; i >= 0 && list.length < 400; i--) for (let j = bars[i].big.length - 1; j >= 0; j--) {
    const t = bars[i].big[j]; if (t[1] * t[2] < min || (side && t[3] !== side)) continue; list.push(t);
  }
  list.sort((a, b) => b[0] - a[0]);
  const buys = list.filter(t => t[3] > 0).reduce((a, t) => a + t[2], 0), sells = list.filter(t => t[3] < 0).reduce((a, t) => a + t[2], 0);
  const csv = () => download(`${sym.id}-big-trades.csv`, ['time,side,price,size,unit,notional_usd,venue', ...list.map(t => [new Date(t[0]).toISOString(), t[3] > 0 ? 'buy' : 'sell', t[1], t[2], unit, (t[1] * t[2]).toFixed(0), venues[t[4] ?? -1] || ''].join(','))].join('\n'));
  return (
    <section className="dock" style={{ width: 310 }} aria-label="Large trade log">
      <h5>Big trades <span className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>({unit})</span> <button className="mini-btn" onClick={csv} disabled={!list.length}>CSV</button></h5>
      <div className="dock-tools">
        <label>Min $<input type="number" value={min} step={10000} onChange={ev => setMin(+ev.target.value)} /></label>
        <select value={side} onChange={ev => setSide(+ev.target.value as 0 | 1 | -1)}><option value={0}>Both</option><option value={1}>Buys</option><option value={-1}>Sells</option></select>
      </div>
      <div className="split-bar" title="Big buy vs big sell volume in the list"><i style={{ width: `${buys + sells ? (buys / (buys + sells)) * 100 : 50}%` }} /></div>
      <div className="body">
        <table className="ts-t big-t">
          <thead>
            <tr style={{ fontSize: 10, color: '#94a3b8', borderBottom: '1px solid #1e293b' }}>
              <th style={{ textAlign: 'left', padding: '3px 6px' }}>Time</th>
              <th style={{ textAlign: 'left', padding: '3px 6px' }}>Side</th>
              <th style={{ textAlign: 'left', padding: '3px 6px' }}>Price</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Size ({unit})</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>USD ($)</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t, i) => (
              <tr key={i} className={t[3] > 0 ? 'b' : 's'} onClick={() => e?.scrollToTime(t[0])} title="Show on chart">
                <td>{fmtT(t[0])}</td><td>{t[3] > 0 ? 'BUY' : 'SELL'}</td><td>{t[1].toFixed(sym.dec)}</td><td style={{ textAlign: 'right' }}>{fmtQ(t[2])}</td><td style={{ textAlign: 'right' }}>${fmtQ(t[1] * t[2])}</td>
              </tr>))}
            {!list.length && <tr><td colSpan={5} className="muted" style={{ padding: 12, textAlign: 'center', fontSize: 11 }}>No qualifying big trades in loaded history.<br />Adjust mode or threshold in Settings ⚙️.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Cross-venue comparison: who is buying/selling where, and whether venues agree. */
export function VenuesDock({ md }: { md: MarketData }) {
  useTick(1000);
  const [win, setWin] = useState(5);
  const stats = useMemo(() => {
    const V = md.venues.length, out = Array.from({ length: V }, () => ({ v: 0, d: 0, n: 0 }));
    const from = Date.now() - win * 60_000;
    for (let i = md.ticks.length - 1; i >= 0 && md.ticks[i][0] >= from; i--) { const [, , q, s, vi] = md.ticks[i]; const o = out[vi ?? 0]; if (!o) continue; o.v += q; o.d += s > 0 ? q : -q; o.n++; }
    return out;
  }, [md, win, md.ticks.length]);
  const tot = stats.reduce((a, s) => a + s.v, 0);
  if (md.venues.length < 2) return <section className="dock" style={{ width: 260 }}><h5>Venue flow</h5><p className="muted" style={{ padding: 14 }}>This market comes from a single venue ({md.venues[0] || '—'}). Cross-venue comparison is available for the aggregated crypto symbols (BTCUSD, ETHUSD, SOLUSD, XRPUSD, DOGEUSD).</p></section>;
  const signs = stats.filter(s => s.v > 0).map(s => Math.sign(s.d)), agree = signs.length > 1 && signs.every(x => x === signs[0]);
  const lead = stats.reduce((b, s, i) => Math.abs(s.d) > Math.abs(stats[b].d) ? i : b, 0);
  return (
    <section className="dock" style={{ width: 260 }} aria-label="Cross-venue order flow">
      <h5>Venue flow <span className="seg-mini">{[1, 5, 15].map(w => <span key={w} className={w === win ? 'on' : ''} onClick={() => setWin(w)}>{w}m</span>)}</span></h5>
      <div className="body" style={{ padding: 12 }}>
        <div className={`venue-verdict ${agree ? (signs[0] > 0 ? 'up' : 'dn') : ''}`}>
          {agree ? `All venues ${signs[0] > 0 ? 'net buying' : 'net selling'}` : 'Venues disagree'} · leader <b>{md.venues[lead]}</b>
        </div>
        {stats.map((s, i) => (
          <div key={i} className="venue-row">
            <div className="venue-h"><b>{md.venues[i]}</b><span className="muted">{tot ? ((s.v / tot) * 100).toFixed(0) : 0}% of volume</span></div>
            <div className="split-bar"><i style={{ width: `${s.v ? ((s.v + s.d) / 2 / s.v) * 100 : 50}%` }} /></div>
            <div className="venue-h"><span className="muted mono">vol {fmtQ(s.v)} · {s.n} prints</span><span className={`mono ${s.d >= 0 ? 'up' : 'dn'}`}>Δ {s.d >= 0 ? '+' : ''}{fmtQ(s.d)}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}
