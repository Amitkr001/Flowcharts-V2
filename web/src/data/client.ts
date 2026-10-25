/**
 * DataClient — one WebSocket to the FlowScope gateway, multiplexing symbols.
 * MarketData keeps the tape, heatmap columns, book, venues, liquidations, open interest and venue status for one symbol.
 */
import type { Book, CalEvent, Deriv, HeatCol, KBar, Liq, SymbolInfo, Tick } from '../lib/types';
import { API_BASE, api } from '../lib/api';
import { createStore } from '../lib/store';

export type Ev = 'snap' | 'tk' | 'hm' | 'bk' | 'st' | 'lq' | 'dv';
const MAX_TICKS = 1_500_000;
const MAX_HEAT = 4 * 3600;
const MAX_LIQ = 20_000;

export class MarketData {
  sym: string;
  ticks: Tick[] = [];
  heat: HeatCol[] = [];
  book: Book = { b: [], a: [] };
  venues: string[] = [];
  liqs: Liq[] = [];
  deriv: Deriv[] = [];
  status: Record<string, { ok: boolean; note?: string }> = {};
  ready = false;
  lastPrice = 0;
  refs = 0;
  private ls = new Set<(e: Ev, d?: any) => void>();
  constructor(sym: string) { this.sym = sym; }
  on(f: (e: Ev, d?: any) => void) { this.ls.add(f); return () => { this.ls.delete(f); }; }
  emit(e: Ev, d?: any) { this.ls.forEach(f => f(e, d)); }

  onSnap(m: any) {
    this.ticks = m.ticks || [];
    this.heat = m.heat || [];
    this.book = m.book || { b: [], a: [] };
    this.status = m.status || {};
    this.venues = m.venues || [];
    this.liqs = m.liqs || [];
    this.deriv = m.deriv || [];
    this.ready = true;
    if (this.ticks.length) this.lastPrice = this.ticks[this.ticks.length - 1][1];
    this.emit('snap');
  }
  onTicks(d: Tick[]) {
    if (!this.ready) return;
    for (const t of d) this.ticks.push(t);
    if (this.ticks.length > MAX_TICKS) this.ticks.splice(0, this.ticks.length - MAX_TICKS);
    if (d.length) this.lastPrice = d[d.length - 1][1];
    this.emit('tk', d);
  }
  onHeat(c: HeatCol) { this.heat.push(c); if (this.heat.length > MAX_HEAT) this.heat.shift(); this.emit('hm', c); }
  onBook(m: Book) { this.book = { b: m.b, a: m.a }; this.emit('bk'); }
  onStatus(s: any) { this.status = s; this.emit('st'); }
  onLiqs(d: Liq[]) { if (!this.ready) return; this.liqs.push(...d); if (this.liqs.length > MAX_LIQ) this.liqs.splice(0, this.liqs.length - MAX_LIQ); this.emit('lq', d); }
  onDeriv(d: Deriv) { this.deriv.push(d); this.emit('dv', d); }
  lastDeriv(): Deriv | null { return this.deriv.length ? this.deriv[this.deriv.length - 1] : null; }
}

export const net = createStore<{ connected: boolean; symbols: SymbolInfo[]; error: string }>({ connected: false, symbols: [], error: '' });

class DataClient {
  private ws: WebSocket | null = null;
  private md = new Map<string, MarketData>();
  private retry = 0;
  private klineCache = new Map<string, { at: number; p: Promise<KBar[]> }>();
  private cal: { at: number; p: Promise<CalEvent[]> } | null = null;

  constructor() {
    this.connect();
    api<SymbolInfo[]>('/api/symbols').then(s => { if (Array.isArray(s)) net.set({ symbols: s }); }).catch(e => net.set({ error: String(e.message || e) }));
  }

  private url() {
    if (API_BASE) return API_BASE.replace(/^http/, 'ws') + '/ws';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }

  private connect() {
    let ws: WebSocket;
    try { ws = new WebSocket(this.url()); } catch { return this.later(); }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      net.set({ connected: true, error: '' });
      for (const m of this.md.values()) { m.ready = false; ws.send(JSON.stringify({ op: 'sub', sym: m.sym })); }
    };
    ws.onmessage = (e) => {
      let m: any; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'hello') { net.set({ symbols: m.symbols }); return; }
      const d = this.md.get(m.sym); if (!d) return;
      if (m.t === 'snap') d.onSnap(m);
      else if (m.t === 'tk') d.onTicks(m.d);
      else if (m.t === 'hm') d.onHeat(m.c);
      else if (m.t === 'bk') d.onBook(m);
      else if (m.t === 'st') d.onStatus(m.status);
      else if (m.t === 'lq') d.onLiqs(m.d);
      else if (m.t === 'dv') d.onDeriv(m.d);
    };
    ws.onclose = () => { net.set({ connected: false }); this.later(); };
    ws.onerror = () => { /* close follows */ };
  }
  private later() { setTimeout(() => this.connect(), Math.min(15000, 800 * 2 ** this.retry++)); }

  reconnect() {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.retry = 0;
    this.connect();
  }

  get(sym: string): MarketData {
    let m = this.md.get(sym);
    if (!m) {
      m = new MarketData(sym); this.md.set(sym, m);
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: 'sub', sym }));
    }
    m.refs++;
    return m;
  }
  release(sym: string) {
    const m = this.md.get(sym); if (!m) return;
    if (--m.refs <= 0) { this.md.delete(sym); if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: 'unsub', sym })); }
  }

  klines(sym: string, tfSec: number, limit = 1500): Promise<KBar[]> {
    const k = `${sym}:${tfSec}:${limit}`, hit = this.klineCache.get(k);
    if (hit && Date.now() - hit.at < 30_000) return hit.p;
    const p = api<KBar[]>(`/api/klines?sym=${encodeURIComponent(sym)}&tf=${tfSec}&limit=${limit}`).then(k => Array.isArray(k) ? k : []).catch(() => [] as KBar[]);
    this.klineCache.set(k, { at: Date.now(), p });
    return p;
  }
  ticksRange(sym: string, from: number, to: number) { return api<Tick[]>(`/api/ticks?sym=${encodeURIComponent(sym)}&from=${from}&to=${to}`); }
  calendar(): Promise<CalEvent[]> {
    if (this.cal && Date.now() - this.cal.at < 1_800_000) return this.cal.p;
    const p = api<CalEvent[]>('/api/calendar').then(c => Array.isArray(c) ? c : []).catch(() => [] as CalEvent[]);
    this.cal = { at: Date.now(), p };
    return p;
  }
}

export const data = new DataClient();
export const symInfo = (id: string): SymbolInfo | undefined => net.get().symbols.find(s => s.id === id);
