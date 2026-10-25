/**
 * Per-bar order-flow signals (evaluated on closed bars).
 *   abs  Absorption       heavy volume + small body + strong delta that price did NOT follow
 *   exh  Exhaustion       new swing extreme printed on almost no volume (no one left to push)
 *   ua   Unfinished auction  both buyers and sellers traded at the bar's extreme → price often revisits
 *   df   Delta divergence  candle colour disagrees with its delta
 * side: 1 = bullish read, -1 = bearish read. p = price where the marker belongs.
 */
import type { Bar, Side } from '../lib/types';

export type SigKind = 'abs' | 'exh' | 'ua' | 'df';
export interface Sig { i: number; kind: SigKind; side: Side; p: number; txt: string }

export const SIG_STYLE: Record<SigKind, { label: string; color: string; name: string }> = {
  abs: { label: 'A', color: '#e6c84a', name: 'Absorption' },
  exh: { label: 'E', color: '#ff8c1a', name: 'Exhaustion' },
  ua: { label: 'UA', color: '#9ad7ff', name: 'Unfinished auction' },
  df: { label: 'Δ', color: '#c38bff', name: 'Delta divergence' },
};

const cache = new WeakMap<Bar, { v: number; n: number; sigs: Sig[] }>();

export function barSignals(bars: Bar[], i: number, row: number): Sig[] {
  const c = bars[i]; if (!c || c.est || c.k || c.v <= 0) return [];
  const hit = cache.get(c);
  if (hit && hit.v === c.v && hit.n === i) return hit.sigs;
  const out: Sig[] = [];
  let sv = 0, n = 0; for (let j = Math.max(0, i - 20); j < i; j++) { sv += bars[j].v; n++; }
  const avg = n ? sv / n : c.v, rng = c.h - c.l || 1e-12, body = Math.abs(c.c - c.o), d = c.b - c.s, mid = (c.h + c.l) / 2;

  if (n >= 5 && c.v >= avg * 1.6 && body / rng <= 0.35 && Math.abs(d) >= c.v * 0.12) {
    if (d < 0 && c.c >= mid) out.push({ i, kind: 'abs', side: 1, p: c.l, txt: `Sellers absorbed (Δ ${d.toFixed(1)}, vol ${(c.v / avg).toFixed(1)}× avg)` });
    if (d > 0 && c.c <= mid) out.push({ i, kind: 'abs', side: -1, p: c.h, txt: `Buyers absorbed (Δ +${d.toFixed(1)}, vol ${(c.v / avg).toFixed(1)}× avg)` });
  }
  if (c.fp.size >= 3) {
    let kmin = Infinity, kmax = -Infinity, mx = 0;
    for (const [k, [s, b]] of c.fp) { if (k < kmin) kmin = k; if (k > kmax) kmax = k; if (s + b > mx) mx = s + b; }
    const top = c.fp.get(kmax)!, bot = c.fp.get(kmin)!, minQ = mx * 0.2, active = n >= 5 && c.v >= avg * 0.8;
    if (active && top[0] >= minQ && top[1] >= minQ) out.push({ i, kind: 'ua', side: -1, p: c.h, txt: 'Unfinished auction at high — likely revisit' });
    if (active && bot[0] >= minQ && bot[1] >= minQ) out.push({ i, kind: 'ua', side: 1, p: c.l, txt: 'Unfinished auction at low — likely revisit' });
    let hh = -Infinity, ll = Infinity; for (let j = Math.max(0, i - 20); j < i; j++) { if (bars[j].h > hh) hh = bars[j].h; if (bars[j].l < ll) ll = bars[j].l; }
    const top2 = top[0] + top[1] + (c.fp.get(kmax - 1)?.reduce((a, b) => a + b, 0) || 0), bot2 = bot[0] + bot[1] + (c.fp.get(kmin + 1)?.reduce((a, b) => a + b, 0) || 0);
    if (active && i >= 20 && c.h > hh && top2 <= mx * 0.06 && c.c < mid) out.push({ i, kind: 'exh', side: -1, p: c.h, txt: 'Buying exhausted at new high' });
    if (active && i >= 20 && c.l < ll && bot2 <= mx * 0.06 && c.c > mid) out.push({ i, kind: 'exh', side: 1, p: c.l, txt: 'Selling exhausted at new low' });
  }
  if (n >= 5 && c.v >= avg && c.c > c.o && body > rng * 0.4 && d < -c.v * 0.2) out.push({ i, kind: 'df', side: -1, p: c.h, txt: 'Up bar with negative delta' });
  if (n >= 5 && c.v >= avg && c.c < c.o && body > rng * 0.4 && d > c.v * 0.2) out.push({ i, kind: 'df', side: 1, p: c.l, txt: 'Down bar with positive delta' });
  void row;
  cache.set(c, { v: c.v, n: i, sigs: out });
  return out;
}
