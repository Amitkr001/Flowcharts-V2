import { useEffect, useReducer, type ReactElement } from 'react';
import type { MarketData } from '../data/client';
import { net } from '../data/client';
import type { Bar, SymbolInfo } from '../lib/types';
import { fmtQ, fmtT } from '../lib/format';
import { settings, bigFor, bigModeFor, bigQtyFor } from '../lib/settings';

function useTick(ms: number) { const [, f] = useReducer(x => x + 1, 0); useEffect(() => { const h = setInterval(f, ms); return () => clearInterval(h); }, [ms]); }

/** DOM ladder. With atTime (bar replay) the book is rebuilt from the recorded heatmap column at that time. */
export function DomDock({ md, sym, lastBar, row, atTime }: { md: MarketData; sym: SymbolInfo; lastBar: () => Bar | undefined; row: number; atTime?: number | null }) {
  useTick(250);
  let px = md.lastPrice, bids = md.book.b, asks = md.book.a;
  if (atTime != null) {
    const H = md.heat; let a = 0, b = H.length - 1, idx = -1;
    while (a <= b) { const m = (a + b) >> 1; if (H[m].t <= atTime) { idx = m; a = m + 1; } else b = m - 1; }
    const col = idx >= 0 ? H[idx] : null;
    bids = col ? col.l.filter(l => l[2] > 0).map(l => [l[0], l[1]] as [number, number]) : [];
    asks = col ? col.l.filter(l => l[2] < 0).map(l => [l[0], l[1]] as [number, number]) : [];
    const lb = lastBar(); if (lb) px = lb.c;
  }
  if (!px) return <section className="dock" style={{ width: 236 }}><h5>Order book</h5><p className="muted" style={{ padding: 14 }}>Waiting for data…</p></section>;
  const bk = new Map<number, [number, number]>(); let mx = 1;
  for (const [p, q] of bids) { const k = Math.floor(p / row); const e = bk.get(k) || [0, 0]; e[0] += q; bk.set(k, e); }
  for (const [p, q] of asks) { const k = Math.floor(p / row); const e = bk.get(k) || [0, 0]; e[1] += q; bk.set(k, e); }
  for (const e of bk.values()) mx = Math.max(mx, e[0], e[1]);
  const lb = lastBar(), base = Math.floor(px / row), vol = new Map<number, number>();
  if (lb) for (const [k, [s, b]] of lb.fp) { const kk = Math.floor((k * row + row * 1e-6) / row); vol.set(kk, (vol.get(kk) || 0) + s + b); }
  const rows: ReactElement[] = [];
  for (let k = 22; k >= -22; k--) {
    const lv = base + k, e = bk.get(lv) || [0, 0], v = vol.get(lv) || 0;
    rows.push(<tr key={lv} className={k === 0 ? 'last' : ''}>
      <td className="bd">{e[0] > 0 && <><div className="f" style={{ width: `${Math.min(100, (e[0] / mx) * 140)}%` }} /><span>{fmtQ(e[0])}</span></>}</td>
      <td className="px">{(lv * row).toFixed(sym.dec)}</td>
      <td className="ak">{e[1] > 0 && <><div className="f" style={{ width: `${Math.min(100, (e[1] / mx) * 140)}%` }} /><span>{fmtQ(e[1])}</span></>}</td>
      <td className="vl">{v ? fmtQ(v) : ''}</td></tr>);
  }
  return (
    <section className="dock" style={{ width: 250 }} aria-label="Depth of market">
      <h5>Order book {atTime != null ? <span className="replay-tag">REPLAY</span> : null}<span className="muted">{sym.hasBook ? `row ${row}` : 'no book for this market'}</span></h5>
      <div className="body"><table className="dom-t"><tbody>{rows}</tbody></table></div>
    </section>
  );
}

export function TapeDock({ md, sym, bigQ, atTime }: { md: MarketData; sym: SymbolInfo; bigQ?: number; atTime?: number | null }) {
  useTick(300);
  const out: ReactElement[] = [];
  const mode = bigModeFor(sym.id);
  const qtyThresh = bigQtyFor(sym.id, sym.bigQty || 1);
  const usdThresh = bigQ ?? bigFor(sym.id, sym.bigUsd);
  const isBig = (q: number, p: number) => mode === 'qty' ? q >= qtyThresh : (q * p >= usdThresh);
  let i = md.ticks.length - 1;
  if (atTime != null) while (i >= 0 && md.ticks[i][0] > atTime) i--;
  for (; i >= 0 && out.length < 120; i--) {
    const [t, p, q, s, v] = md.ticks[i];
    out.push(<tr key={i} className={`${s > 0 ? 'b' : 's'} ${isBig(q, p) ? 'big' : ''}`}><td>{fmtT(t)}</td><td>{p.toFixed(sym.dec)}</td><td style={{ textAlign: 'right' }}>{fmtQ(q)}</td>{md.venues.length > 1 && <td className="vtag">{(md.venues[v ?? 0] || '').slice(0, 3)}</td>}</tr>);
  }
  return (
    <section className="dock" style={{ width: md.venues.length > 1 ? 250 : 220 }} aria-label="Time and sales">
      <h5>Time &amp; sales {atTime != null ? <span className="replay-tag">REPLAY</span> : <span className="muted">bold = big</span>}</h5>
      <div className="body"><table className="ts-t"><tbody>{out}</tbody></table></div>
    </section>
  );
}

export function WatchDock({ cur, onPick }: { cur: string; onPick(id: string): void }) {
  const syms = net.use(s => s.symbols), watch = settings.use(s => s.watch);
  return (
    <section className="dock" style={{ width: 230 }} aria-label="Watchlist">
      <h5>Watchlist <span className="muted">{watch.length}</span></h5>
      <div className="body">
        {watch.map(id => { const s = syms.find(x => x.id === id); if (!s) return null; return (
          <div key={id} className={`wl-row ${id === cur ? 'on' : ''}`} onClick={() => onPick(id)}>
            <b>{id}</b><span className="mono">{s.last ? s.last.toFixed(s.dec) : '—'}</span>
            <small>{s.venues}</small><span className={`tag ${s.volume}`}>{s.volume === 'real' ? (s.live ? 'live' : 'idle') : 'price'}</span>
          </div>); })}
      </div>
    </section>
  );
}
