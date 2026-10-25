/**
 * BookWatcher — watches order-book updates against the tape to find:
 *   ice   Iceberg / refill: a large level keeps absorbing more volume than was ever displayed, and refills
 *   pull  Pulled liquidity: a large level near price disappears without being traded (spoof-like)
 *   fill  Filled liquidity: a large level near price disappears because it was traded through
 */
import type { MarketData } from './client';
import type { Side } from '../lib/types';

export interface BookMark { t: number; p: number; kind: 'ice' | 'pull' | 'fill'; side: Side; q: number; refills?: number }

interface Lvl { side: Side; first: number; max: number; size: number; traded: number; tradedAtLast: number; refills: number; iceAt: number }

export class BookWatcher {
  marks: BookMark[] = [];
  md: MarketData;
  row: number;
  mult: number;
  private lv = new Map<string, Lvl>();
  private ls = new Set<(m: BookMark) => void>();
  private off: () => void;
  private last = 0;

  constructor(md: MarketData, row: number, mult = 4) {
    this.md = md; this.row = row; this.mult = mult;
    this.off = md.on((e, d) => {
      if (e === 'tk') this.onTicks(d);
      else if (e === 'bk') this.onBook();
      else if (e === 'snap') { this.lv.clear(); this.last = md.lastPrice; }
    });
  }
  destroy() { this.off(); this.ls.clear(); }
  on(f: (m: BookMark) => void) { this.ls.add(f); return () => { this.ls.delete(f); }; }

  private key(side: Side, k: number) { return (side > 0 ? 'b' : 'a') + k; }

  private onTicks(ts: [number, number, number, Side, number?][]) {
    for (const [, p, q, s] of ts) {
      this.last = p;
      const L = this.lv.get(this.key(s > 0 ? -1 : 1, Math.floor(p / this.row)));
      if (L) L.traded += q;
    }
  }

  private emit(m: BookMark) { this.marks.push(m); if (this.marks.length > 3000) this.marks.splice(0, 500); this.ls.forEach(f => f(m)); }

  private onBook() {
    const now = Date.now(), row = this.row, bins = new Map<string, { side: Side; k: number; q: number }>();
    const add = (arr: [number, number][], side: Side) => { for (const [p, q] of arr) { const k = Math.floor(p / row), key = this.key(side, k); const e = bins.get(key); if (e) e.q += q; else bins.set(key, { side, k, q }); } };
    add(this.md.book.b, 1); add(this.md.book.a, -1);
    if (bins.size < 6) return;
    const sizes = [...bins.values()].map(x => x.q).sort((a, b) => a - b), thr = (sizes[sizes.length >> 1] || 0) * this.mult;
    const px = this.last || this.md.lastPrice, near = Math.max(row * 8, px * 0.002);

    for (const [key, b] of bins) {
      const L = this.lv.get(key);
      if (L) {
        if (b.q > L.size * 1.15 && L.traded > L.tradedAtLast) L.refills++;
        L.tradedAtLast = L.traded; L.size = b.q; L.max = Math.max(L.max, b.q);
        if (L.traded >= L.max * 1.5 && L.refills >= 1 && now - L.iceAt > 60_000) {
          L.iceAt = now;
          this.emit({ t: now, p: (b.k + 0.5) * row, kind: 'ice', side: b.side, q: L.traded, refills: L.refills });
        }
      } else if (b.q >= thr && thr > 0) {
        this.lv.set(key, { side: b.side, first: now, max: b.q, size: b.q, traded: 0, tradedAtLast: 0, refills: 0, iceAt: 0 });
      }
    }
    for (const [key, L] of this.lv) {
      const b = bins.get(key), k = +key.slice(1), p = (k + 0.5) * row;
      if (b && b.q >= L.max * 0.2) continue;
      if (Math.abs(p - px) <= near && now - L.first > 1500) {
        if (L.traded >= L.max * 0.6) this.emit({ t: now, p, kind: 'fill', side: L.side, q: L.max });
        else if (L.traded < L.max * 0.25) this.emit({ t: now, p, kind: 'pull', side: L.side, q: L.max });
      }
      this.lv.delete(key);
    }
  }
}

const reg = new Map<string, { w: BookWatcher; refs: number }>();
/** Shared watcher per symbol (the chart and the alert service use the same one). */
export function watcherFor(md: MarketData, row: number, mult = 4): BookWatcher {
  let e = reg.get(md.sym);
  if (!e || e.w.md !== md) { e?.w.destroy(); e = { w: new BookWatcher(md, row, mult), refs: 0 }; reg.set(md.sym, e); }
  e.w.mult = mult; e.refs++;
  return e.w;
}
export function releaseWatcher(sym: string) {
  const e = reg.get(sym); if (!e) return;
  if (--e.refs <= 0) { e.w.destroy(); reg.delete(sym); }
}
