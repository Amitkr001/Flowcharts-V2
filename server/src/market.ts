/**
 * MarketHub — one Market per symbol.
 *  • merges trades from every venue into one tape (each tick tagged with its venue index)
 *  • keeps a compressed tick history (per second / price / side / venue; big prints kept individually)
 *  • maintains the order book and samples a heatmap column every second
 *  • collects liquidations, open interest and funding
 *  • pushes batched updates to subscribed WebSocket clients
 */
import type { Deriv, FeedEvents, HeatCol, Liq, Side, SymbolDef, Tick, Trade } from './types.ts';
import { SYMBOLS, SYMBOL_MAP } from './symbols.ts';
import { startSource, sourceLabel, type Running } from './feeds/exchanges.ts';
import { startDerivs } from './feeds/derivs.ts';
import { simGen } from './feeds/sim.ts';
import { persist } from './store/ticks.ts';
import { log } from './log.ts';

export interface Client { id: number; send(msg: string): void; subs: Set<string> }

const HISTORY_MS = (Number(process.env.HISTORY_HOURS) || 8) * 3_600_000;
const HEAT_MS = (Number(process.env.HEAT_MINUTES) || 120) * 60_000;
const SNAP_HEAT_MS = 30 * 60_000;
const SNAP_TICK_MS = (Number(process.env.SNAPSHOT_HOURS) || 2) * 3_600_000;
const LIQ_MS = 24 * 3_600_000;
const DERIV_MS = 48 * 3_600_000;
const HEAT_ROWS = 110;

const r6 = (x: number) => +x.toPrecision(7);

class Market {
  readonly def: SymbolDef;
  readonly venues: string[];
  ticks: Tick[] = [];
  heat: HeatCol[] = [];
  liqs: Liq[] = [];
  deriv: Deriv[] = [];
  bids = new Map<number, number>();
  asks = new Map<number, number>();
  last = 0;
  started = false;
  runners: Running[] = [];
  subs = new Set<Client>();
  status = new Map<string, { ok: boolean; note?: string }>();
  private pending: Tick[] = [];
  private pendingLiq: Liq[] = [];
  private sec = 0;
  private secAgg = new Map<string, Tick>();
  private bigQ = 0;

  constructor(def: SymbolDef) { this.def = def; this.venues = def.sources.map(sourceLabel); }

  start(ev: FeedEvents): void {
    if (this.started) return;
    this.started = true;
    if (this.def.sources[0].ex === 'sim') {
      const g = simGen(this.def);
      const hist = g.history(48 * 60);
      for (const t of hist) this.addTrade(t, false);
      this.flushSecond();
      let j = 0;
      for (let t = Date.now() - 60 * 60_000; t < Date.now(); t += 2000) {
        while (j < hist.length - 1 && hist[j + 1].t <= t) j++;
        const bk = g.book(hist[j].p, t);
        this.applyBook(bk.bids, bk.asks, true);
        this.sampleHeat(t, hist[j].p);
      }
      for (let i = 0; i < hist.length; i += 400) { const h = hist[i], s: Side = Math.random() < 0.5 ? 1 : -1; this.liqs.push({ t: h.t, p: h.p, q: Math.exp(Math.random() * 3) * 0.2, s, v: 0 }); }
    }
    this.def.sources.forEach((s, i) => {
      this.status.set(sourceLabel(s), { ok: false, note: 'connecting' });
      try { this.runners.push(startSource(this.def, i, ev)); }
      catch (e) { log.error(`start ${this.def.id}/${s.ex}: ${(e as Error).message}`); }
    });
    if (this.def.volume === 'real') {
      try { this.runners.push(startDerivs(this.def, ev)); } catch (e) { log.error(`derivs ${this.def.id}: ${(e as Error).message}`); }
    }
    log.info(`market ${this.def.id} started (${this.def.venues})`);
  }

  addTrade(t: Trade, live = true): void {
    if (!(t.p > 0) || !isFinite(t.q)) return;
    this.last = t.p;
    const vi = Math.max(0, this.venues.indexOf(t.ex));
    const tick: Tick = [t.t, t.p, t.q, t.s, vi];
    if (live) this.pending.push(tick);
    const sec = Math.floor(t.t / 1000);
    if (sec !== this.sec) { this.flushSecond(); this.sec = sec; }
    if (!this.bigQ) this.bigQ = Math.max(0.00001, this.def.bigQty ? Math.min(this.def.bigQty * 0.25, (this.def.bigUsd * 0.1) / t.p) : (this.def.bigUsd * 0.1) / t.p);
    if (t.q >= this.bigQ) { this.ticks.push(tick); if (live) persist.tick(this.def.id, tick); return; }
    const k = t.p + '|' + t.s + '|' + vi;
    const a = this.secAgg.get(k);
    if (a) a[2] = r6(a[2] + t.q); else this.secAgg.set(k, [t.t, t.p, t.q, t.s, vi]);
  }

  addLiq(l: { t: number; p: number; q: number; s: Side; ex: string }): void {
    if (!(l.p > 0) || !(l.q > 0)) return;
    const x: Liq = { t: l.t || Date.now(), p: l.p, q: r6(l.q), s: l.s, v: Math.max(0, this.venues.indexOf(l.ex)) };
    this.liqs.push(x); this.pendingLiq.push(x);
  }

  addDeriv(d: Deriv): void { this.deriv.push(d); }

  private flushSecond(): void {
    if (!this.secAgg.size) return;
    for (const tk of this.secAgg.values()) { this.ticks.push(tk); persist.tick(this.def.id, tk); }
    this.secAgg.clear();
  }

  applyBook(bids: [number, number][], asks: [number, number][], snapshot: boolean): void {
    if (snapshot) { this.bids.clear(); this.asks.clear(); }
    for (const [p, q] of bids) q > 0 ? this.bids.set(p, q) : this.bids.delete(p);
    for (const [p, q] of asks) q > 0 ? this.asks.set(p, q) : this.asks.delete(p);
  }

  bestBid(): number { let b = -Infinity; for (const p of this.bids.keys()) if (p > b) b = p; return b; }
  bestAsk(): number { let a = Infinity; for (const p of this.asks.keys()) if (p < a) a = p; return a; }

  bookTop(n: number, row: number): { b: [number, number][]; a: [number, number][] } {
    const bin = (m: Map<number, number>, side: 1 | -1) => {
      const agg = new Map<number, number>();
      for (const [p, q] of m) { const k = row ? r6((side > 0 ? Math.floor(p / row) : Math.ceil(p / row)) * row) : p; agg.set(k, (agg.get(k) || 0) + q); }
      return [...agg.entries()].sort((x, y) => side > 0 ? y[0] - x[0] : x[0] - y[0]).slice(0, n).map(([p, q]) => [p, r6(q)] as [number, number]);
    };
    return { b: bin(this.bids, 1), a: bin(this.asks, -1) };
  }

  sampleHeat(now: number, midHint?: number): HeatCol | null {
    if (!this.bids.size && !this.asks.size) return null;
    const bb = this.bestBid(), ba = this.bestAsk();
    const mid = midHint ?? (isFinite(bb) && isFinite(ba) ? (bb + ba) / 2 : this.last);
    if (!mid) return null;
    const row = this.def.row, lo = mid - row * HEAT_ROWS, hi = mid + row * HEAT_ROWS;
    const agg = new Map<number, [number, Side]>();
    const add = (m: Map<number, number>, s: Side) => {
      for (const [p, q] of m) { if (p < lo || p > hi) continue; const k = r6(Math.floor(p / row) * row); const e = agg.get(k); if (e) e[0] += q; else agg.set(k, [q, s]); }
    };
    add(this.bids, 1); add(this.asks, -1);
    const col: HeatCol = { t: now, l: [...agg.entries()].map(([p, [q, s]]) => [p, +q.toPrecision(3), s]) };
    this.heat.push(col);
    return col;
  }

  trim(now: number): void {
    if (this.last > 0) this.bigQ = Math.max(0.00001, this.def.bigQty ? Math.min(this.def.bigQty * 0.25, (this.def.bigUsd * 0.1) / this.last) : (this.def.bigUsd * 0.1) / this.last);
    const cut = now - (this.def.cls === 'demo' ? 48 * 3_600_000 : HISTORY_MS);
    const drop = <T>(a: T[], t: (x: T) => number, c: number) => { let i = 0; while (i < a.length && t(a[i]) < c) i++; if (i) a.splice(0, i); };
    drop(this.ticks, x => x[0], cut);
    drop(this.heat, x => x.t, now - HEAT_MS);
    drop(this.liqs, x => x.t, now - LIQ_MS);
    drop(this.deriv, x => x.t, now - DERIV_MS);
  }

  takePending(): Tick[] { const p = this.pending; this.pending = []; return p; }
  takeLiqs(): Liq[] { const p = this.pendingLiq; this.pendingLiq = []; return p; }

  snapshot(): string {
    this.flushSecond();
    const since = Date.now() - SNAP_HEAT_MS, tickSince = Date.now() - SNAP_TICK_MS;
    let i0 = this.ticks.length; while (i0 > 0 && this.ticks[i0 - 1][0] >= tickSince) i0--;
    const heat: HeatCol[] = [];
    let lastT = 0;
    for (const c of this.heat) if (c.t >= since && c.t - lastT >= 2900) { heat.push(c); lastT = c.t; }
    return JSON.stringify({
      t: 'snap', sym: this.def.id, ticks: this.ticks.slice(i0), heat,
      book: this.bookTop(60, 0), status: Object.fromEntries(this.status),
      venues: this.venues, liqs: this.liqs, deriv: this.deriv,
    });
  }
}

export class MarketHub implements FeedEvents {
  markets = new Map<string, Market>();

  constructor() {
    for (const d of SYMBOLS) this.markets.set(d.id, new Market(d));
    setInterval(() => this.flushTrades(), 100);
    setInterval(() => this.flushBooks(), 250);
    setInterval(() => this.flushHeat(), 1000);
    setInterval(() => { const n = Date.now(); for (const m of this.markets.values()) m.trim(n); }, 60_000);
    const boot = (process.env.RECORD || 'BTCUSD,ETHUSD,XAUUSDT,XAGUSDT,GOLD,SILVER,SP500,NDX,DEMO').split(',').map(s => s.trim()).filter(Boolean);
    for (const id of boot) this.ensure(id);
  }

  ensure(id: string): Market | undefined {
    const m = this.markets.get(id);
    if (m && !m.started) m.start(this);
    return m;
  }

  trade(id: string, t: Trade) { this.markets.get(id)?.addTrade(t); }
  book(id: string, b: [number, number][], a: [number, number][], snap: boolean) { this.markets.get(id)?.applyBook(b, a, snap); }
  liq(id: string, l: { t: number; p: number; q: number; s: Side; ex: string }) { this.markets.get(id)?.addLiq(l); }
  deriv(id: string, d: Deriv) {
    const m = this.markets.get(id); if (!m) return;
    m.addDeriv(d);
    if (m.subs.size) this.broadcast(m, JSON.stringify({ t: 'dv', sym: id, d }));
  }
  status(id: string, ex: string, ok: boolean, note?: string) {
    const m = this.markets.get(id); if (!m) return;
    m.status.set(ex, { ok, note });
    this.broadcast(m, JSON.stringify({ t: 'st', sym: id, status: Object.fromEntries(m.status) }));
  }

  subscribe(c: Client, id: string) {
    const m = this.ensure(id);
    if (!m) return c.send(JSON.stringify({ t: 'err', msg: `unknown symbol ${id}` }));
    m.subs.add(c); c.subs.add(id);
    c.send(m.snapshot());
  }
  unsubscribe(c: Client, id: string) { this.markets.get(id)?.subs.delete(c); c.subs.delete(id); }
  drop(c: Client) { for (const id of c.subs) this.markets.get(id)?.subs.delete(c); c.subs.clear(); }

  private broadcast(m: Market, msg: string) { for (const c of m.subs) c.send(msg); }

  private flushTrades() {
    for (const m of this.markets.values()) {
      const p = m.takePending();
      if (p.length && m.subs.size) this.broadcast(m, JSON.stringify({ t: 'tk', sym: m.def.id, d: p }));
      const l = m.takeLiqs();
      if (l.length && m.subs.size) this.broadcast(m, JSON.stringify({ t: 'lq', sym: m.def.id, d: l }));
    }
  }
  private flushBooks() {
    for (const m of this.markets.values()) {
      if (!m.subs.size || (!m.bids.size && !m.asks.size)) continue;
      this.broadcast(m, JSON.stringify({ t: 'bk', sym: m.def.id, ...m.bookTop(60, 0) }));
    }
  }
  private flushHeat() {
    const now = Date.now();
    for (const m of this.markets.values()) {
      if (!m.started) continue;
      const col = m.sampleHeat(now);
      if (col) { persist.heat(m.def.id, col); if (m.subs.size) this.broadcast(m, JSON.stringify({ t: 'hm', sym: m.def.id, c: col })); }
    }
  }

  async ticksRange(id: string, from: number, to: number): Promise<Tick[]> {
    const m = this.markets.get(id); if (!m) return [];
    const mem = m.ticks;
    const memStart = mem.length ? mem[0][0] : Infinity;
    let out: Tick[] = [];
    if (from < memStart) out = await persist.ticksRange(id, from, Math.min(to, memStart - 1));
    if (to >= memStart) { for (const t of mem) if (t[0] >= from && t[0] <= to) out.push(t); }
    return out;
  }

  info() {
    return SYMBOLS.map(d => {
      const m = this.markets.get(d.id)!;
      return { id: d.id, name: d.name, desc: d.desc, cls: d.cls, tick: d.tick, row: d.row, dec: d.dec, bigUsd: d.bigUsd, bigQty: d.bigQty, contractUnit: d.contractUnit, volume: d.volume, venues: d.venues,
        hasBook: d.bookFrom >= 0, last: m.last, live: m.started && [...m.status.values()].some(s => s.ok), recordedFrom: m.ticks[0]?.[0] ?? null };
    });
  }

  def(id: string) { return SYMBOL_MAP.get(id); }
}
