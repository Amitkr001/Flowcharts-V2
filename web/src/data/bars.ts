import type { Bar, BarSpec, BigTradeConfig, BigTradeMode, KBar, Side, Tick } from '../lib/types';

/**
 * Builds candles + footprint incrementally from ticks; can be seeded with exchange klines for older history.
 * Big trades: with aggMs > 0, consecutive same-side prints within aggMs of each other are merged into one
 * trade (VWAP price) before the size threshold is applied — how a large order sweeping several levels looks.
 * Supports Dual-Mode (USD notional or contract quantity) and Auto Top 1% (rolling percentile whale detection).
 */
export class BarBuilder {
  bars: Bar[] = [];
  readonly spec: BarSpec;
  readonly row: number;
  readonly bigConfig: BigTradeConfig;
  readonly aggMs: number;
  private n = 0;
  private cl: { s: Side; t0: number; tl: number; q: number; pq: number; bar: Bar } | null = null;
  /** Rolling window of trade sizes (in USD notional) for auto whale / percentile detection */
  private recentTradeNotionals: number[] = [];
  private cachedAutoThreshold: number = 0;
  private tradesSinceRecalc: number = 0;

  constructor(spec: BarSpec, row: number, bigFilter: number | BigTradeConfig, aggMs = 0) {
    this.spec = spec;
    this.row = row;
    this.bigConfig = typeof bigFilter === 'number'
      ? { mode: 'usd', bigUsd: bigFilter, bigQty: 1, autoPct: 0.99 }
      : { mode: bigFilter.mode || 'usd', bigUsd: bigFilter.bigUsd, bigQty: bigFilter.bigQty ?? 1, autoPct: bigFilter.autoPct || 0.99 };
    this.aggMs = aggMs;
    this.cachedAutoThreshold = this.bigConfig.bigUsd;
  }

  get bigUsd() { return this.bigConfig.bigUsd; }
  get bigQty() { return this.bigConfig.bigQty; }
  get bigMode(): BigTradeMode { return this.bigConfig.mode; }
  getAutoThreshold(): number { return this.cachedAutoThreshold; }

  static ms(spec: BarSpec) { return spec.kind === 'time' ? spec.sec * 1000 : 0; }

  /** Evaluate whether a trade (or sweep cluster) qualifies as a big trade */
  isBig(q: number, p: number): boolean {
    const usd = q * p;
    // Always feed rolling window for auto mode (capped at 1000 samples)
    if (usd > 0) {
      if (this.recentTradeNotionals.length >= 1000) {
        this.recentTradeNotionals.shift();
      }
      this.recentTradeNotionals.push(usd);
      this.tradesSinceRecalc++;
      if (this.tradesSinceRecalc >= 25 || !this.cachedAutoThreshold) {
        this.recalcAutoThreshold();
      }
    }

    if (this.bigConfig.mode === 'qty') {
      return q >= this.bigConfig.bigQty;
    }
    if (this.bigConfig.mode === 'auto') {
      const thresh = this.cachedAutoThreshold || this.bigConfig.bigUsd;
      return usd >= thresh;
    }
    // Default 'usd' mode
    return usd >= this.bigConfig.bigUsd;
  }

  private recalcAutoThreshold() {
    this.tradesSinceRecalc = 0;
    const len = this.recentTradeNotionals.length;
    if (len < 15) {
      this.cachedAutoThreshold = this.bigConfig.bigUsd;
      return;
    }
    const sorted = [...this.recentTradeNotionals].sort((a, b) => a - b);
    const pct = Math.min(0.999, Math.max(0.5, this.bigConfig.autoPct || 0.99));
    const idx = Math.min(len - 1, Math.floor(len * pct));
    this.cachedAutoThreshold = Math.max(100, Math.round(sorted[idx]));
  }

  add(tk: Tick): void {
    const [t, p, q, s, vi] = tk;
    let c = this.bars[this.bars.length - 1];
    let fresh = !c || c.k;
    if (!fresh) {
      const sp = this.spec;
      if (sp.kind === 'time') fresh = Math.floor(t / (sp.sec * 1000)) * sp.sec * 1000 > c.t;
      else if (sp.kind === 'vol') fresh = c.v >= sp.size;
      else fresh = this.n >= sp.count;
    }
    if (c && c.k && this.spec.kind === 'time') {
      const bt = Math.floor(t / (this.spec.sec * 1000)) * this.spec.sec * 1000;
      if (bt === c.t) { c.k = false; fresh = false; }
      else if (bt < c.t) return;
    }
    if (fresh) {
      const bt = this.spec.kind === 'time' ? Math.floor(t / (this.spec.sec * 1000)) * this.spec.sec * 1000 : t;
      c = { t: bt, o: p, h: p, l: p, c: p, v: 0, b: 0, s: 0, fp: new Map(), big: [] };
      this.bars.push(c); this.n = 0;
    }
    if (p > c.h) c.h = p; if (p < c.l) c.l = p; c.c = p;
    c.v += q; s > 0 ? (c.b += q) : (c.s += q); this.n++;
    const k = Math.round(p / this.row);
    let cell = c.fp.get(k); if (!cell) { cell = [0, 0]; c.fp.set(k, cell); }
    cell[s > 0 ? 1 : 0] += q;
    if (vi != null) {
      const vd = (c.vd ||= []), vv = (c.vv ||= []);
      vd[vi] = (vd[vi] || 0) + (s > 0 ? q : -q); vv[vi] = (vv[vi] || 0) + q;
    }
    if (!this.aggMs) { if (this.isBig(q, p)) c.big.push(tk); return; }
    const cl = this.cl;
    if (cl && cl.s === s && t - cl.tl <= this.aggMs) { cl.q += q; cl.pq += p * q; cl.tl = t; }
    else { this.flushCluster(); this.cl = { s, t0: t, tl: t, q, pq: p * q, bar: c }; }
  }

  /** Finalise the current aggregation cluster (called automatically when the next cluster starts). */
  flushCluster() {
    const cl = this.cl; if (!cl) return; this.cl = null;
    const p = cl.pq / cl.q;
    if (this.isBig(cl.q, p)) cl.bar.big.push([cl.t0, +p.toPrecision(10), +cl.q.toPrecision(8), cl.s]);
  }

  addAll(ticks: Tick[], from = 0) { for (let i = from; i < ticks.length; i++) this.add(ticks[i]); if (this.aggMs) this.flushCluster(); }

  /** Prepend kline bars that are older than the first tick-built bar. */
  seedKlines(k: KBar[], estimated: boolean) {
    if (this.spec.kind !== 'time' || !k.length) return;
    const first = this.bars[0]?.t ?? Infinity;
    const older: Bar[] = [];
    for (const x of k) if (x.t < first) older.push({ ...x, fp: new Map(), big: [], k: true, est: estimated });
    this.bars = older.concat(this.bars);
  }
}

/** Plain series used by indicators, backtests and overlays. */
export interface Series {
  length: number;
  time: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[];
  buy: number[]; sell: number[]; delta: number[]; cvd: number[]; vwap: number[]; bigBuy: number[]; bigSell: number[];
}

export function buildSeries(bars: Bar[]): Series {
  const n = bars.length;
  const d: Series = { length: n, time: new Array(n), open: new Array(n), high: new Array(n), low: new Array(n), close: new Array(n), volume: new Array(n), buy: new Array(n), sell: new Array(n), delta: new Array(n), cvd: new Array(n), vwap: new Array(n), bigBuy: new Array(n), bigSell: new Array(n) };
  let cv = 0, pv = 0, vv = 0, day = -1;
  for (let i = 0; i < n; i++) {
    const c = bars[i];
    const dd = Math.floor(c.t / 86_400_000);
    if (dd !== day) { day = dd; pv = 0; vv = 0; }
    d.time[i] = c.t; d.open[i] = c.o; d.high[i] = c.h; d.low[i] = c.l; d.close[i] = c.c; d.volume[i] = c.v;
    d.buy[i] = c.b; d.sell[i] = c.s; d.delta[i] = c.est ? 0 : c.b - c.s; cv += d.delta[i]; d.cvd[i] = cv;
    pv += ((c.h + c.l + c.c) / 3) * c.v; vv += c.v; d.vwap[i] = vv ? pv / vv : c.c;
    let bb = 0, bs = 0; for (const t of c.big) t[3] > 0 ? (bb += t[2]) : (bs += t[2]);
    d.bigBuy[i] = bb; d.bigSell[i] = bs;
  }
  return d;
}

export const specLabel = (s: BarSpec) => s.kind === 'time' ? (s.sec < 60 ? `${s.sec}s` : s.sec < 3600 ? `${s.sec / 60}m` : s.sec < 86400 ? `${s.sec / 3600}h` : `${s.sec / 86400}D`) : s.kind === 'vol' ? `${s.size} Vol` : `${s.count} Tick`;
export const BAR_SPECS: BarSpec[] = [
  { kind: 'time', sec: 5 }, { kind: 'time', sec: 15 }, { kind: 'time', sec: 30 },
  { kind: 'time', sec: 60 }, { kind: 'time', sec: 180 }, { kind: 'time', sec: 300 }, { kind: 'time', sec: 900 }, { kind: 'time', sec: 1800 },
  { kind: 'time', sec: 3600 }, { kind: 'time', sec: 14400 }, { kind: 'time', sec: 86400 },
  { kind: 'tick', count: 100 }, { kind: 'tick', count: 500 }, { kind: 'tick', count: 1000 },
  { kind: 'vol', size: 50 }, { kind: 'vol', size: 250 }, { kind: 'vol', size: 1000 },
];
export const specKey = (s: BarSpec) => s.kind === 'time' ? `t:${s.sec}` : s.kind === 'vol' ? `v:${s.size}` : `k:${s.count}`;
export const parseSpec = (k: string): BarSpec => { const [a, b] = k.split(':'); return a === 't' ? { kind: 'time', sec: +b } : a === 'v' ? { kind: 'vol', size: +b } : { kind: 'tick', count: +b }; };
