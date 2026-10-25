/**
 * Bar-based backtester for order-flow strategies.
 * Signals are evaluated on a closed bar; entries and signal exits fill at the NEXT bar's open (no look-ahead).
 * Stop-loss / take-profit are checked intrabar; if both could hit in the same bar the stop is assumed first
 * (conservative). Fees are a % of notional per side; slippage is in ticks against you on every fill.
 */
import type { Series } from '../data/bars';
import { TA } from '../lib/ta';

export interface Param { k: string; label: string; v: number }
export interface Strategy { id: string; name: string; desc: string; params: Param[]; code: string }
export interface Signals { long: boolean[]; short: boolean[]; exitLong?: boolean[]; exitShort?: boolean[] }
export interface BtConfig { qty: number; slTicks: number; tpTicks: number; feePct: number; slipTicks: number; tick: number; maxBars: number; dir: 'both' | 'long' | 'short' }
export interface BtTrade { side: 1 | -1; i0: number; i1: number; t0: number; t1: number; entry: number; exit: number; qty: number; pnl: number; fee: number; why: 'tp' | 'sl' | 'signal' | 'time' | 'end' | 'reverse'; mfe: number; mae: number }
export interface BtResult {
  trades: BtTrade[]; equity: number[]; dd: number[];
  stats: { net: number; gross: number; fees: number; n: number; wins: number; losses: number; winRate: number; pf: number; avgWin: number; avgLoss: number; expectancy: number; maxDD: number; sharpe: number; avgBars: number; longPnl: number; shortPnl: number };
  err: string | null; ms: number;
}

export const PRESETS: Strategy[] = [
  { id: 'absorption', name: 'Absorption reversal', desc: 'Heavy volume, small body and delta that price did not follow → fade it on the next bar.',
    params: [{ k: 'vol', label: 'Volume × 20-bar average', v: 1.8 }, { k: 'body', label: 'Max body % of range', v: 35 }, { k: 'dpct', label: 'Min |delta| % of volume', v: 12 }],
    code: `const avg = ta.sma(d.volume, 20), n = d.length;
const long = new Array(n).fill(false), short = new Array(n).fill(false);
for (let i = 20; i < n; i++) {
  const rng = d.high[i] - d.low[i] || 1e-9, body = Math.abs(d.close[i] - d.open[i]), mid = (d.high[i] + d.low[i]) / 2;
  if (!(d.volume[i] > avg[i] * p.vol && body <= rng * p.body / 100 && Math.abs(d.delta[i]) >= d.volume[i] * p.dpct / 100)) continue;
  if (d.delta[i] < 0 && d.close[i] >= mid) long[i] = true;   // sellers absorbed
  if (d.delta[i] > 0 && d.close[i] <= mid) short[i] = true;  // buyers absorbed
}
return { long, short };` },
  { id: 'ema', name: 'EMA crossover', desc: 'Fast EMA crosses the slow EMA. Exits on the opposite cross or SL/TP.',
    params: [{ k: 'fast', label: 'Fast EMA', v: 8 }, { k: 'slow', label: 'Slow EMA', v: 33 }],
    code: `const f = ta.ema(d.close, p.fast), s = ta.ema(d.close, p.slow);
const long = d.close.map((_, i) => ta.cross(f, s, i)), short = d.close.map((_, i) => ta.crossunder(f, s, i));
return { long, short, exitLong: short, exitShort: long };` },
  { id: 'delta-break', name: 'Delta breakout', desc: 'Close beyond the N-bar range with delta in the same direction.',
    params: [{ k: 'len', label: 'Range bars', v: 20 }, { k: 'dpct', label: 'Min delta % of volume', v: 20 }],
    code: `const hh = ta.highest(d.high, p.len), ll = ta.lowest(d.low, p.len);
const long = d.close.map((c, i) => i > 0 && hh[i - 1] != null && c > hh[i - 1] && d.delta[i] > d.volume[i] * p.dpct / 100);
const short = d.close.map((c, i) => i > 0 && ll[i - 1] != null && c < ll[i - 1] && -d.delta[i] > d.volume[i] * p.dpct / 100);
return { long, short };` },
  { id: 'vwap', name: 'VWAP reclaim', desc: 'Price crosses back over session VWAP with positive / negative delta.',
    params: [{ k: 'dpct', label: 'Min delta % of volume', v: 10 }],
    code: `const long = d.close.map((c, i) => i > 0 && d.close[i - 1] < d.vwap[i - 1] && c > d.vwap[i] && d.delta[i] > d.volume[i] * p.dpct / 100);
const short = d.close.map((c, i) => i > 0 && d.close[i - 1] > d.vwap[i - 1] && c < d.vwap[i] && -d.delta[i] > d.volume[i] * p.dpct / 100);
return { long, short };` },
  { id: 'big', name: 'Big-trade follow', desc: 'Follow bars where big aggressive trades are strongly one-sided.',
    params: [{ k: 'ratio', label: 'Big buy / sell ratio', v: 3 }],
    code: `const long = d.bigBuy.map((b, i) => b > 0 && b >= d.bigSell[i] * p.ratio);
const short = d.bigSell.map((s, i) => s > 0 && s >= d.bigBuy[i] * p.ratio);
return { long, short };` },
];

const bool = (a: unknown, n: number) => Array.isArray(a) ? a.map(Boolean).concat(new Array(Math.max(0, n - a.length)).fill(false)).slice(0, n) : new Array(n).fill(false);

export function signalsOf(code: string, d: Series, params: Param[]): Signals {
  const p: Record<string, number> = {}; for (const x of params) p[x.k] = x.v;
  const r = new Function('d', 'ta', 'p', '"use strict";\n' + code)(d, TA, p);
  if (!r || !Array.isArray(r.long) || !Array.isArray(r.short)) throw new Error('the strategy must return { long: boolean[], short: boolean[] }');
  const n = d.length;
  return { long: bool(r.long, n), short: bool(r.short, n), exitLong: r.exitLong ? bool(r.exitLong, n) : undefined, exitShort: r.exitShort ? bool(r.exitShort, n) : undefined };
}

export function backtest(d: Series, sig: Signals, c: BtConfig): BtResult {
  const t0 = performance.now(), n = d.length, trades: BtTrade[] = [], equity: number[] = new Array(n).fill(0);
  const slip = c.slipTicks * c.tick, fee = (px: number) => (Math.abs(px * c.qty) * c.feePct) / 100;
  type Pos = { side: 1 | -1; i0: number; entry: number; sl: number; tp: number; mfe: number; mae: number; fee: number };
  let pos = null as Pos | null, realized = 0;
  const close = (i: number, px: number, why: BtTrade['why']) => {
    const p = pos!, fx = px - p.side * slip, f2 = fee(fx), gross = (fx - p.entry) * p.side * c.qty;
    const t: BtTrade = { side: p.side, i0: p.i0, i1: i, t0: d.time[p.i0], t1: d.time[i], entry: p.entry, exit: fx, qty: c.qty, pnl: gross - p.fee - f2, fee: p.fee + f2, why, mfe: p.mfe, mae: p.mae };
    trades.push(t); realized += t.pnl; pos = null;
  };
  const open = (i: number, side: 1 | -1) => {
    const px = d.open[i] + side * slip;
    pos = { side, i0: i, entry: px, sl: c.slTicks > 0 ? px - side * c.slTicks * c.tick : NaN, tp: c.tpTicks > 0 ? px + side * c.tpTicks * c.tick : NaN, mfe: 0, mae: 0, fee: fee(px) };
  };
  const okL = c.dir !== 'short', okS = c.dir !== 'long';
  for (let i = 1; i < n; i++) {
    const j = i - 1; // decisions from bar j fill at bar i open
    if (pos) {
      const p = pos;
      const wantExit = (p.side > 0 && (sig.exitLong?.[j] || (okS && sig.short[j]))) || (p.side < 0 && (sig.exitShort?.[j] || (okL && sig.long[j])));
      if (wantExit) close(i, d.open[i], (p.side > 0 ? sig.short[j] : sig.long[j]) ? 'reverse' : 'signal');
      else if (c.maxBars > 0 && i - p.i0 >= c.maxBars) close(i, d.open[i], 'time');
    }
    if (!pos) { if (okL && sig.long[j] && !sig.short[j]) open(i, 1); else if (okS && sig.short[j] && !sig.long[j]) open(i, -1); }
    if (pos) {
      const p = pos;
      p.mfe = Math.max(p.mfe, (p.side > 0 ? d.high[i] - p.entry : p.entry - d.low[i]));
      p.mae = Math.max(p.mae, (p.side > 0 ? p.entry - d.low[i] : d.high[i] - p.entry));
      const hitSl = !isNaN(p.sl) && (p.side > 0 ? d.low[i] <= p.sl : d.high[i] >= p.sl);
      const hitTp = !isNaN(p.tp) && (p.side > 0 ? d.high[i] >= p.tp : d.low[i] <= p.tp);
      if (hitSl) close(i, p.side > 0 ? Math.min(p.sl, d.open[i]) : Math.max(p.sl, d.open[i]), 'sl');
      else if (hitTp) close(i, p.tp, 'tp');
    }
    const op = pos as Pos | null;
    equity[i] = realized + (op ? (d.close[i] - op.entry) * op.side * c.qty - op.fee : 0);
  }
  if (pos) close(n - 1, d.close[n - 1], 'end');
  if (n) equity[n - 1] = realized;
  let peak = 0; const dd = equity.map(e => { peak = Math.max(peak, e); return e - peak; });
  const w = trades.filter(t => t.pnl > 0), l = trades.filter(t => t.pnl <= 0);
  const gw = w.reduce((a, t) => a + t.pnl, 0), gl = -l.reduce((a, t) => a + t.pnl, 0);
  const rets = trades.map(t => t.pnl), mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0;
  return {
    trades, equity, dd, err: null, ms: performance.now() - t0,
    stats: {
      net: realized, gross: gw - gl + trades.reduce((a, t) => a + t.fee, 0), fees: trades.reduce((a, t) => a + t.fee, 0),
      n: trades.length, wins: w.length, losses: l.length, winRate: trades.length ? (w.length / trades.length) * 100 : 0,
      pf: gl ? gw / gl : gw ? Infinity : 0, avgWin: w.length ? gw / w.length : 0, avgLoss: l.length ? gl / l.length : 0,
      expectancy: trades.length ? realized / trades.length : 0, maxDD: Math.min(0, ...dd), sharpe: sd ? (mean / sd) * Math.sqrt(trades.length) : 0,
      avgBars: trades.length ? trades.reduce((a, t) => a + (t.i1 - t.i0), 0) / trades.length : 0,
      longPnl: trades.filter(t => t.side > 0).reduce((a, t) => a + t.pnl, 0), shortPnl: trades.filter(t => t.side < 0).reduce((a, t) => a + t.pnl, 0),
    },
  };
}

export function tradesCsv(ts: BtTrade[], dec: number) {
  return ['side,entry_time,exit_time,entry,exit,qty,pnl,fee,reason,bars',
    ...ts.map(t => [t.side > 0 ? 'long' : 'short', new Date(t.t0).toISOString(), new Date(t.t1).toISOString(), t.entry.toFixed(dec), t.exit.toFixed(dec), t.qty, t.pnl.toFixed(2), t.fee.toFixed(2), t.why, t.i1 - t.i0].join(','))].join('\n');
}
