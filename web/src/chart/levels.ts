/**
 * Session profiles and key reference levels (all in UTC).
 *   Asia 00:00–07:00 · London 07:00–13:30 · New York 13:30–21:00
 * A POC is "naked" until a later bar trades through it.
 */
import type { Bar, FlowOpts } from '../lib/types';

export const SESSIONS = [
  { id: 'asia' as const, name: 'Asia', a: 0, b: 7, color: '#4da3ff' },
  { id: 'london' as const, name: 'London', a: 7, b: 13.5, color: '#e6c84a' },
  { id: 'ny' as const, name: 'New York', a: 13.5, b: 21, color: '#ff7ad9' },
];
export type SessId = typeof SESSIONS[number]['id'];

export interface SessProf {
  id: SessId; name: string; color: string; day: number;
  t0: number; t1: number; hi: number; lo: number;
  poc: number; vah: number; val: number; vol: number;
  pocHit: number | null;
}
export interface KeyLevels {
  pdh: number; pdl: number; pdc: number; dayOpen: number; weekOpen: number | null;
  orh: number | null; orl: number | null; orT0: number; orT1: number;
}

const DAY = 86_400_000;

function profileOf(m: Map<number, number>, row: number) {
  const keys = [...m.keys()].sort((a, b) => a - b);
  if (!keys.length) return { poc: 0, vah: 0, val: 0, vol: 0 };
  let tot = 0, mx = -1, poc = keys[0];
  for (const [k, v] of m) { tot += v; if (v > mx) { mx = v; poc = k; } }
  let lo = Math.max(0, keys.indexOf(poc)), hi = lo, acc = Math.max(0, mx);
  if (tot > 0) {
    while (acc < tot * 0.7 && (lo > 0 || hi < keys.length - 1)) {
      const up = hi < keys.length - 1 ? m.get(keys[hi + 1])! : -1, dn = lo > 0 ? m.get(keys[lo - 1])! : -1;
      if (up >= dn) { hi++; acc += up; } else { lo--; acc += dn; }
    }
  }
  return { poc: poc * row, vah: (keys[hi] ?? poc) * row, val: (keys[lo] ?? poc) * row, vol: tot };
}

export function sessionProfiles(bars: Bar[], row: number, opt: FlowOpts['sess']): SessProf[] {
  const acc = new Map<string, { s: typeof SESSIONS[number]; day: number; t0: number; t1: number; hi: number; lo: number; m: Map<number, number>; last: number }>();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], day = Math.floor(b.t / DAY), hr = (b.t - day * DAY) / 3_600_000;
    const s = SESSIONS.find(x => hr >= x.a && hr < x.b && opt[x.id]); if (!s) continue;
    const key = `${day}:${s.id}`;
    let a = acc.get(key);
    if (!a) { a = { s, day, t0: day * DAY + s.a * 3_600_000, t1: day * DAY + s.b * 3_600_000, hi: -Infinity, lo: Infinity, m: new Map(), last: i }; acc.set(key, a); }
    a.hi = Math.max(a.hi, b.h); a.lo = Math.min(a.lo, b.l); a.last = i;
    if (b.fp.size) for (const [k, [x, y]] of b.fp) a.m.set(k, (a.m.get(k) || 0) + x + y);
    else { const k = Math.round(((b.h + b.l + b.c) / 3) / row); a.m.set(k, (a.m.get(k) || 0) + b.v); }
  }
  const out: SessProf[] = [];
  for (const a of acc.values()) {
    if (!a.m.size) continue;
    const p = profileOf(a.m, row);
    let pocHit: number | null = null;
    for (let j = a.last + 1; j < bars.length; j++) if (bars[j].t >= a.t1 && bars[j].l <= p.poc && bars[j].h >= p.poc) { pocHit = bars[j].t; break; }
    out.push({ id: a.s.id, name: a.s.name, color: a.s.color, day: a.day, t0: a.t0, t1: a.t1, hi: a.hi, lo: a.lo, ...p, pocHit });
  }
  return out.sort((x, y) => x.t0 - y.t0);
}

export function keyLevels(bars: Bar[], orMin: number): KeyLevels | null {
  if (!bars.length) return null;
  const lastT = bars[bars.length - 1].t, today = Math.floor(lastT / DAY), y = today - 1;
  let pdh = -Infinity, pdl = Infinity, pdc = NaN, dayOpen = NaN, weekOpen: number | null = null, orh = -Infinity, orl = Infinity;
  const dow = new Date(today * DAY).getUTCDay(), monday = today - ((dow + 6) % 7);
  const orT0 = today * DAY + 13.5 * 3_600_000, orT1 = orT0 + orMin * 60_000;
  for (const b of bars) {
    const d = Math.floor(b.t / DAY);
    if (d === y) { pdh = Math.max(pdh, b.h); pdl = Math.min(pdl, b.l); pdc = b.c; }
    if (d === today && isNaN(dayOpen)) dayOpen = b.o;
    if (d === monday && weekOpen == null) weekOpen = b.o;
    if (b.t >= orT0 && b.t < orT1) { orh = Math.max(orh, b.h); orl = Math.min(orl, b.l); }
  }
  if (!isFinite(pdh)) return null;
  return { pdh, pdl, pdc, dayOpen: isNaN(dayOpen) ? bars[bars.length - 1].o : dayOpen, weekOpen, orh: isFinite(orh) ? orh : null, orl: isFinite(orl) ? orl : null, orT0, orT1 };
}
