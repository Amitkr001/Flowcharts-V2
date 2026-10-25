/**
 * Alert service — runs in the background for every symbol that has an active alert, independent of the
 * chart on screen. Evaluates on live ticks, 1-minute bar closes, liquidations and order-book events.
 * Fires a toast, a sound and (optionally) a browser notification. Rules sync to the cloud when signed in.
 */
import { createStore } from './store';
import { localDoc, saveDoc, pullDoc, toast } from './api';
import { data, net, type MarketData } from '../data/client';
import { BarBuilder } from '../data/bars';
import { barSignals } from '../chart/signals';
import { watcherFor, releaseWatcher, type BookWatcher } from '../data/bookwatch';
import { drawingsStore, settings, bigFor } from './settings';
import { fmtQ, uid } from './format';
import type { Liq, Tick } from './types';

export type AlertType = 'price' | 'big' | 'delta' | 'absorption' | 'exhaustion' | 'level' | 'liq' | 'iceberg' | 'pull' | 'tape';

export const ALERT_TYPES: Record<AlertType, { label: string; unit: string; def: number; hint: string; noValue?: boolean }> = {
  price: { label: 'Price', unit: 'price', def: 0, hint: 'Fires when price crosses the value (choose above / below / cross).' },
  big: { label: 'Big trade', unit: 'USD', def: 500_000, hint: 'One aggressive print at or above this notional.' },
  delta: { label: 'Delta spike', unit: '× avg', def: 3, hint: 'A closed 1-minute bar with |delta| at least this multiple of the 20-bar average.' },
  absorption: { label: 'Absorption', unit: '', def: 0, hint: 'A closed 1-minute bar shows absorption.', noValue: true },
  exhaustion: { label: 'Exhaustion', unit: '', def: 0, hint: 'A closed 1-minute bar shows buying or selling exhaustion.', noValue: true },
  level: { label: 'Level touch', unit: '', def: 0, hint: 'Price touches any horizontal line / ray you drew on this symbol.', noValue: true },
  liq: { label: 'Liquidation', unit: 'USD', def: 250_000, hint: 'A liquidation at or above this notional.' },
  iceberg: { label: 'Iceberg', unit: 'USD', def: 100_000, hint: 'An iceberg / refilling level absorbed at least this notional.' },
  pull: { label: 'Pulled liquidity', unit: 'USD', def: 250_000, hint: 'A large resting order near price was pulled (not traded).' },
  tape: { label: 'Tape speed', unit: 'prints/s', def: 20, hint: 'Average prints per second over the last 10 seconds.' },
};

export interface AlertRule { id: string; sym: string; type: AlertType; value: number; dir: 'above' | 'below' | 'cross'; on: boolean; once: boolean; note?: string; fired?: number }
export interface AlertHit { id: string; rid: string; t: number; sym: string; type: AlertType; msg: string }

export const alerts = createStore<{ rules: AlertRule[]; log: AlertHit[]; unread: number }>({ rules: localDoc<AlertRule[]>('alerts', []), log: [], unread: 0 });
const persist = () => saveDoc('alerts', alerts.get().rules);

export function addAlert(r: Omit<AlertRule, 'id' | 'on'> & { on?: boolean }) { alerts.set(s => ({ rules: [...s.rules, { ...r, id: uid(), on: r.on ?? true }] })); persist(); sync(); }
export function updateAlert(id: string, patch: Partial<AlertRule>) { alerts.set(s => ({ rules: s.rules.map(r => r.id === id ? { ...r, ...patch } : r) })); persist(); sync(); }
export function removeAlert(id: string) { alerts.set(s => ({ rules: s.rules.filter(r => r.id !== id) })); persist(); sync(); }
export function clearAlertLog() { alerts.set({ log: [], unread: 0 }); }
export function markAlertsRead() { alerts.set({ unread: 0 }); }
export async function syncAlertsFromCloud() { const r = await pullDoc<AlertRule[]>('alerts'); if (r) { alerts.set({ rules: r }); sync(); } }

/* ---------------- sound & notification ---------------- */
let actx: AudioContext | null = null;
function beep(up: boolean) {
  try {
    actx ||= new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = 'sine'; o.frequency.setValueAtTime(up ? 660 : 520, t); o.frequency.linearRampToValueAtTime(up ? 990 : 390, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.4);
  } catch { /* audio blocked until first user gesture */ }
}
export async function enableNotifications(): Promise<boolean> {
  if (!('Notification' in window)) { toast('This browser does not support notifications'); return false; }
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  settings.set({ notify: p === 'granted' });
  if (p !== 'granted') toast('Notifications were blocked in the browser');
  return p === 'granted';
}

const COOLDOWN = 30_000;
function fire(r: AlertRule, msg: string, up = true) {
  const now = Date.now();
  if (r.fired && now - r.fired < COOLDOWN) return;
  r.fired = now;
  const hit: AlertHit = { id: uid(), rid: r.id, t: now, sym: r.sym, type: r.type, msg };
  alerts.set(s => ({ log: [hit, ...s.log].slice(0, 300), unread: s.unread + 1, rules: r.once ? s.rules.map(x => x.id === r.id ? { ...x, on: false, fired: now } : x) : s.rules }));
  if (r.once) { persist(); sync(); }
  const text = `${r.sym} · ${msg}${r.note ? ` — ${r.note}` : ''}`;
  toast('🔔 ' + text);
  const st = settings.get();
  if (st.sound) beep(up);
  if (st.notify && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(`FlowScope · ${ALERT_TYPES[r.type].label}`, { body: text, tag: r.id, silent: true }); } catch { /* ignore */ }
  }
}

/* ---------------- per-symbol monitor ---------------- */
class Monitor {
  sym: string; md: MarketData; B!: BarBuilder; w: BookWatcher | null = null; last = 0; nBars = 0; offs: (() => void)[] = [];
  constructor(sym: string) {
    this.sym = sym; this.md = data.get(sym);
    this.offs.push(this.md.on((e, d) => {
      if (e === 'snap') this.seed();
      else if (e === 'tk') this.onTicks(d);
      else if (e === 'lq') this.onLiqs(d);
    }));
    if (this.md.ready) this.seed(); else this.ensureWatcher();
  }
  private info() { return net.get().symbols.find(s => s.id === this.sym); }
  private rules(): AlertRule[] { return alerts.get().rules.filter(r => r.on && r.sym === this.sym); }
  private seed() {
    const si = this.info(), row = si?.row || 1;
    this.B = new BarBuilder({ kind: 'time', sec: 60 }, row, bigFor(this.sym, si?.bigUsd || 1e12), 0);
    const ticks = this.md.ticks, from = Math.max(0, ticks.length - 200_000);
    this.B.addAll(ticks, from);
    this.nBars = this.B.bars.length; this.last = this.md.lastPrice;
    this.ensureWatcher();
  }
  ensureWatcher() {
    const si = this.info();
    if (this.w || !si?.hasBook || !this.rules().some(r => r.type === 'iceberg' || r.type === 'pull')) return;
    this.w = watcherFor(this.md, si.row, settings.get().wallMult);
    this.offs.push(this.w.on(m => this.onBook(m.kind, m.p, m.q, m.refills)));
  }
  private onTicks(ts: Tick[]) {
    if (!this.B) return;
    const rules = this.rules(); if (!rules.length) return;
    const dec = this.info()?.dec ?? 2, lines = rules.some(r => r.type === 'level') ? (drawingsStore.get().bySym[this.sym] || []).filter(d => (d.type === 'hline' || d.type === 'hray') && !d.hidden).map(d => d.pts[0].p) : [];
    for (const tk of ts) {
      const [, p, q, s] = tk, prev = this.last || p;
      for (const r of rules) {
        if (r.type === 'price') {
          const up = prev < r.value && p >= r.value, dn = prev > r.value && p <= r.value;
          if ((r.dir === 'above' && up) || (r.dir === 'below' && dn) || (r.dir === 'cross' && (up || dn))) fire(r, `Price ${up ? 'crossed above' : 'crossed below'} ${r.value.toFixed(dec)} (now ${p.toFixed(dec)})`, up);
        } else if (r.type === 'big' && q * p >= r.value) fire(r, `Big ${s > 0 ? 'BUY' : 'SELL'} ${fmtQ(q)} @ ${p.toFixed(dec)} ($${fmtQ(q * p)})`, s > 0);
        else if (r.type === 'level') for (const L of lines) if ((prev - L) * (p - L) <= 0 && prev !== p) { fire(r, `Touched your level ${L.toFixed(dec)}`, p >= L); break; }
      }
      this.B.add(tk); this.last = p;
    }
    const tape = rules.find(r => r.type === 'tape');
    if (tape) { const now = Date.now(), tk = this.md.ticks; let n = 0; for (let i = tk.length - 1; i >= 0 && tk[i][0] >= now - 10_000; i--) n++; if (n / 10 >= tape.value) fire(tape, `Tape speed ${(n / 10).toFixed(1)} prints/s`); }
    const n = this.B.bars.length;
    if (n > this.nBars) { const ci = n - 2; this.nBars = n; if (ci >= 0) this.onBarClose(ci, rules); }
  }
  private onBarClose(i: number, rules: AlertRule[]) {
    const bars = this.B.bars, c = bars[i], dec = this.info()?.dec ?? 2;
    for (const r of rules) {
      if (r.type === 'delta') {
        let s = 0, k = 0; for (let j = Math.max(0, i - 20); j < i; j++) { s += Math.abs(bars[j].b - bars[j].s); k++; }
        const d = c.b - c.s, avg = k ? s / k : 0;
        if (avg > 0 && Math.abs(d) >= avg * r.value) fire(r, `Delta spike ${d > 0 ? '+' : ''}${fmtQ(d)} (${(Math.abs(d) / avg).toFixed(1)}× avg) on 1m bar`, d > 0);
      } else if (r.type === 'absorption' || r.type === 'exhaustion') {
        const want = r.type === 'absorption' ? 'abs' : 'exh';
        for (const g of barSignals(bars, i, this.B.row)) if (g.kind === want) fire(r, `${g.txt} @ ${g.p.toFixed(dec)} (1m)`, g.side > 0);
      }
    }
  }
  private onLiqs(ls: Liq[]) {
    const dec = this.info()?.dec ?? 2;
    for (const r of this.rules()) if (r.type === 'liq') for (const l of ls) if (l.q * l.p >= r.value) fire(r, `${l.s < 0 ? 'LONGS' : 'SHORTS'} liquidated $${fmtQ(l.q * l.p)} @ ${l.p.toFixed(dec)}${this.md.venues[l.v] ? ` (${this.md.venues[l.v]})` : ''}`, l.s > 0);
  }
  private onBook(kind: string, p: number, q: number, refills?: number) {
    const dec = this.info()?.dec ?? 2;
    for (const r of this.rules()) {
      if (r.type === 'iceberg' && kind === 'ice' && q * p >= r.value) fire(r, `Iceberg at ${p.toFixed(dec)} — absorbed ${fmtQ(q)} ($${fmtQ(q * p)}), refilled ${refills ?? 0}×`);
      if (r.type === 'pull' && kind === 'pull' && q * p >= r.value) fire(r, `Liquidity pulled at ${p.toFixed(dec)} (${fmtQ(q)}, $${fmtQ(q * p)})`);
    }
  }
  destroy() { this.offs.forEach(f => f()); if (this.w) releaseWatcher(this.sym); data.release(this.sym); }
}

const monitors = new Map<string, Monitor>();
/** Start/stop monitors so exactly the symbols with active alerts are watched. */
export function sync() {
  const want = new Set(alerts.get().rules.filter(r => r.on).map(r => r.sym));
  for (const [s, m] of monitors) if (!want.has(s)) { m.destroy(); monitors.delete(s); }
  for (const s of want) if (!monitors.has(s)) monitors.set(s, new Monitor(s));
  for (const m of monitors.values()) m.ensureWatcher();
}
let started = false;
export function startAlerts() {
  sync();
  if (started) return; started = true;
  net.subscribe(() => { for (const m of monitors.values()) m.ensureWatcher(); });
}
