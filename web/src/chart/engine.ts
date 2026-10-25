/**
 * ChartEngine — canvas renderer + interaction for candles, footprint and liquidity heatmap,
 * order-flow overlays, custom indicator plots, paper-trading markers and drawing tools.
 *
 * Navigation (TradingView-style):
 *   wheel            zoom time around the mouse        shift+wheel / trackpad swipe  scroll time
 *   wheel on price   zoom price (turns auto-scale off) drag price axis               stretch price
 *   drag time axis   stretch time                      drag chart                    pan (vertical only when auto-scale is off)
 *   dbl-click chart  scroll to real-time               dbl-click price axis          auto-scale on
 *   + / -  zoom      ← / →  scroll                     Home  reset view              End  go to real-time
 * Order-flow layers: signals, iceberg / pulled / filled liquidity, liquidations, session profiles with naked POCs,
 * key levels, open interest, economic calendar.
 */
import type { Bar, BarSpec, BigTradeConfig, CalEvent, ChartStyle, Drawing, FlowOpts, FpMode, KBar, Overlays, Plot, Pt, SymbolInfo } from '../lib/types';
import { BarBuilder, buildSeries, type Series } from '../data/bars';
import { data, type MarketData } from '../data/client';
import type { BookWatcher } from '../data/bookwatch';
import { FONT, MONO, fmtQ, niceStep, uid } from '../lib/format';
import { TA } from '../lib/ta';
import { Painter, TOOL_MAP, handlesOf, hitDrawing, renderDrawing, type DView } from './drawings';
import { barSignals, SIG_STYLE, type Sig } from './signals';
import { keyLevels, sessionProfiles, type KeyLevels, type SessProf } from './levels';
import type { PaperBroker } from '../lib/paper';
import { settings } from '../lib/settings';

export interface EngineOpts {
  style: ChartStyle; ov: Overlays; spec: BarSpec; rowMult: number; bigUsd: number; bigConfig?: BigTradeConfig;
  acct: { size: number; risk: number }; magnet: boolean; fpMode?: FpMode; flow?: FlowOpts;
}
export interface ViewState { live: boolean; auto: boolean }
export interface EngineCallbacks {
  drawings?(list: Drawing[]): void;
  select?(d: Drawing | null): void;
  tool?(t: string): void;
  context?(e: MouseEvent, price: number): void;
  legend?(html: string): void;
  gauges?(imb: number, cvd: number): void;
  view?(s: ViewState): void;
  /** time of the bar under the mouse (null when the mouse leaves) — used to link crosshairs */
  cross?(t: number | null): void;
}

/* colour ramps — violet asks, green bids */
const ramp = (stops: [number, number[]][]) => { const o: string[] = []; for (let i = 0; i < 64; i++) { const r = i / 63; let j = 0; while (j < stops.length - 2 && r > stops[j + 1][0]) j++; const [a, ca] = stops[j], [b, cb] = stops[j + 1], f = (r - a) / (b - a); o.push(`rgb(${ca.map((v, k) => Math.round(v + (cb[k] - v) * f)).join(',')})`); } return o; };
const HEAT_ASK = ramp([[0, [12, 14, 18]], [0.15, [31, 27, 41]], [0.35, [44, 28, 81]], [0.55, [77, 33, 129]], [0.75, [138, 69, 180]], [0.9, [193, 120, 244]], [1, [240, 210, 255]]]);
const HEAT_BID = ramp([[0, [12, 14, 18]], [0.2, [22, 36, 26]], [0.45, [20, 64, 36]], [0.7, [30, 120, 50]], [0.88, [70, 200, 80]], [1, [200, 255, 190]]]);
let BULL = '#22c58b', BEAR = '#8b5cf6', BEAR_HI = '#a47cf2';
const LIQ_LONG = '#ff8c1a', LIQ_SHORT = '#18e0f0';
const MIN_CW = 1, MAX_CW = 280;
const STATS_ROW = 15;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const DEFAULT_CW: Record<ChartStyle, number> = { candles: 8, footprint: 110, heatmap: 4 };
const DEFAULT_FLOW: FlowOpts = { fpRatio: 3, fpMinVol: 0, aggMs: 0, sess: { asia: true, london: true, ny: true }, orMin: 30, heatContrast: 0.55, heatCutoff: 4, vpMode: 'split', vpVaPct: 70, vpWidth: 22, keepTool: false };
const IMPACT_COL: Record<string, string> = { High: '#ff4d5e', Medium: '#ffb020', Low: '#e6c84a', Holiday: '#9a9aa2' };

export class ChartEngine {
  cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  W = 0; H = 0; dpr = 1;
  sym: SymbolInfo | null = null;
  md: MarketData | null = null;
  opt: EngineOpts;
  cb: EngineCallbacks = {};
  B: BarBuilder | null = null;
  klines: KBar[] = []; private kKey = '';
  view = { cw: 8, off: 0, auto: true, y: null as null | { mid: number; span: number } };
  drawings: Drawing[] = [];
  sel: string | null = null;
  tool = 'cursor';
  plots: Plot[] = [];
  paper: PaperBroker | null = null;
  book: BookWatcher | null = null;
  calendar: CalEvent[] = [];
  extCross: number | null = null;
  replayIdx: number | null = null;
  hidden = false; locked = false;
  mouse: { x: number; y: number } | null = null;
  hoverId: string | null = null;

  private unsub: (() => void) | null = null;
  private dirty = true; private raf = 0; private lastDraw = 0; private smoothPriceY: number | null = null;
  private creating: Drawing | null = null; private createDown: { x: number; y: number } | null = null;
  private drag: null | { kind: 'pan' | 'yaxis' | 'xaxis' | 'move' | 'handle'; x: number; y: number; off: number; cw: number; y0: { mid: number; span: number }; orig?: Pt[]; hi?: number; t0?: number; p0?: number } = null;
  private undo: string[] = []; private redo: string[] = [];
  private G: any = {};
  private ro: ResizeObserver;
  private lastN = 0; private lastB: BarBuilder | null = null; private lastVS = '';
  private lvCache: { key: string; sess: SessProf[]; lv: KeyLevels | null } = { key: '', sess: [], lv: null };
  private lastCross: number | null = null;

  constructor(cv: HTMLCanvasElement, opt: EngineOpts) {
    this.cv = cv; this.ctx = cv.getContext('2d')!; this.opt = opt;
    this.view.cw = DEFAULT_CW[opt.style];
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(cv);
    this.bindEvents();
    const loop = (t: number) => { this.raf = requestAnimationFrame(loop); if (this.dirty || t - this.lastDraw > 500) { this.dirty = false; this.lastDraw = t; try { this.draw(); } catch (e) { console.error(e); } } };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.unsub?.(); this.unbind(); }
  invalidate() { this.dirty = true; }
  private resize() {
    const r = this.cv.getBoundingClientRect(); this.dpr = window.devicePixelRatio || 1;
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.max(1, Math.round(r.width * this.dpr)); this.cv.height = Math.max(1, Math.round(r.height * this.dpr));
    this.dirty = true;
  }
  private get flow(): FlowOpts { return this.opt.flow || DEFAULT_FLOW; }

  /* ================================================================ data */
  setMarket(md: MarketData, sym: SymbolInfo) {
    this.unsub?.();
    this.md = md; this.sym = sym; this.kKey = ''; this.klines = []; this.smoothPriceY = null;
    this.view = { cw: DEFAULT_CW[this.opt.style], off: 0, auto: true, y: null };
    this.unsub = md.on((e, d) => {
      if (e === 'snap') this.rebuild();
      else if (e === 'tk' && this.B) { for (const t of d) this.B.add(t); }
      this.dirty = true;
    });
    this.rebuild();
  }
  setOptions(o: Partial<EngineOpts>) {
    const prev = this.opt; this.opt = { ...this.opt, ...o };
    const bigChanged = (o.bigUsd != null && o.bigUsd !== prev.bigUsd) ||
      (o.bigConfig && (
        o.bigConfig.mode !== prev.bigConfig?.mode ||
        o.bigConfig.bigUsd !== prev.bigConfig?.bigUsd ||
        o.bigConfig.bigQty !== prev.bigConfig?.bigQty ||
        o.bigConfig.autoPct !== prev.bigConfig?.autoPct
      ));
    if ((o.spec && JSON.stringify(o.spec) !== JSON.stringify(prev.spec)) || (o.rowMult && o.rowMult !== prev.rowMult) || bigChanged || (o.flow && o.flow.aggMs !== prev.flow?.aggMs)) this.rebuild();
    if (o.style && o.style !== prev.style) this.reset();
    this.lvCache.key = '';
    this.dirty = true;
  }
  rowSize() { return (this.sym?.row || 1) * this.opt.rowMult; }
  barMs() { const s = this.opt.spec; return s.kind === 'time' ? s.sec * 1000 : 0; }

  rebuild() {
    if (!this.md || !this.sym) return;
    const bigFilter = this.opt.bigConfig || this.opt.bigUsd;
    this.B = new BarBuilder(this.opt.spec, this.rowSize(), bigFilter, this.flow.aggMs);
    this.B.addAll(this.md.ticks);
    const s = this.opt.spec;
    if (s.kind === 'time' && s.sec >= 60) {
      const key = `${this.sym.id}:${s.sec}`;
      if (this.kKey === key && this.klines.length) this.B.seedKlines(this.klines, this.estSplit());
      else if (this.kKey !== key) {
        this.kKey = key;
        data.klines(this.sym.id, s.sec, 1500).then(k => { if (this.kKey === key) { this.klines = k; this.rebuildKeepKlines(); } });
      }
    }
    this.lvCache.key = '';
    this.dirty = true;
  }
  private rebuildKeepKlines() {
    if (!this.md || !this.sym) return;
    const bigFilter = this.opt.bigConfig || this.opt.bigUsd;
    this.B = new BarBuilder(this.opt.spec, this.rowSize(), bigFilter, this.flow.aggMs);
    this.B.addAll(this.md.ticks);
    this.B.seedKlines(this.klines, this.estSplit());
    this.lvCache.key = '';
    this.dirty = true;
  }
  private estSplit() { return !!this.sym && /hyperliquid|bybit/i.test(this.sym.venues) && !/binance/i.test(this.sym.venues); }

  get bars(): Bar[] { const b = this.B?.bars || []; return this.replayIdx != null ? b.slice(0, Math.min(this.replayIdx, b.length)) : b; }
  series(): Series { return buildSeries(this.bars); }
  replayTime(): number | null { if (this.replayIdx == null) return null; const b = this.bars; return b.length ? b[b.length - 1].t + (this.barMs() || 1000) : null; }

  /* ================================================================ navigation API */
  private rpad(cw: number) {
    if (this.opt.style === 'heatmap') return 120;
    if (this.opt.style === 'footprint') return cw * 0.9 + 50;
    return Math.max(cw * 5, 70);
  }
  zoomAt(f: number, x?: number) {
    const G = this.G, n = G.n || 0, plotW = G.plotW || this.W, v = this.view;
    const cw = clamp(v.cw * f, MIN_CW, MAX_CW);
    if (!n || (x === undefined && Math.abs(v.off) <= 0.5)) { v.cw = cw; if (x === undefined) v.off = 0; this.dirty = true; return; }
    const rp0 = this.rpad(v.cw), ax = x ?? plotW / 2;
    const i = n - 1 - (plotW - rp0 + v.off * v.cw - ax) / v.cw;
    const rp1 = this.rpad(cw);
    v.cw = cw;
    v.off = (ax - plotW + rp1 + (n - 1 - i) * cw) / cw;
    this.dirty = true;
  }
  zoomIn() { this.zoomAt(1.25); }
  zoomOut() { this.zoomAt(1 / 1.25); }
  scrollBars(k: number) { this.view.off += k; this.dirty = true; }
  goLive() { this.view.off = 0; this.view.auto = true; this.view.y = null; this.dirty = true; }
  reset() { this.view = { cw: DEFAULT_CW[this.opt.style], off: 0, auto: true, y: null }; this.smoothPriceY = null; this.dirty = true; }
  fit() {
    const n = this.bars.length, G = this.G; if (!n || !G.plotW) return;
    this.view.cw = clamp((G.plotW - 60) / n, MIN_CW, MAX_CW); this.view.off = 0; this.view.auto = true; this.view.y = null; this.dirty = true;
  }
  setAutoScale(on: boolean) {
    this.view.auto = on;
    this.view.y = on ? null : (this.G.hi != null ? { mid: (this.G.hi + this.G.lo) / 2, span: this.G.hi - this.G.lo } : null);
    this.dirty = true;
  }
  resetY() { this.setAutoScale(true); }
  scrollToTime(t: number) {
    const b = this.bars, n = b.length, plotW = this.G.plotW || this.W; if (!n) return;
    let i = n - 1; while (i > 0 && b[i].t > t) i--;
    this.view.off = (plotW / 2 - plotW + this.rpad(this.view.cw) + (n - 1 - i) * this.view.cw) / this.view.cw;
    this.view.auto = true; this.view.y = null; this.dirty = true;
  }

  /* ================================================================ drawings */
  setDrawings(list: Drawing[]) { this.drawings = list; this.sel = null; this.undo = []; this.redo = []; this.dirty = true; }
  private snapshot() { this.undo.push(JSON.stringify(this.drawings)); if (this.undo.length > 100) this.undo.shift(); this.redo = []; }
  private changed() { this.cb.drawings?.(this.drawings); this.dirty = true; }
  undoDraw() { const s = this.undo.pop(); if (s == null) return; this.redo.push(JSON.stringify(this.drawings)); this.drawings = JSON.parse(s); this.select(null); this.changed(); }
  redoDraw() { const s = this.redo.pop(); if (s == null) return; this.undo.push(JSON.stringify(this.drawings)); this.drawings = JSON.parse(s); this.select(null); this.changed(); }
  select(id: string | null) { this.sel = id; this.cb.select?.(this.drawings.find(d => d.id === id) || null); this.dirty = true; }
  selected() { return this.drawings.find(d => d.id === this.sel) || null; }
  updateSelected(patch: Partial<Drawing>) { const d = this.selected(); if (!d) return; this.snapshot(); Object.assign(d, patch); this.changed(); this.cb.select?.(d); }
  deleteSelected() { if (!this.sel) return; this.snapshot(); this.drawings = this.drawings.filter(d => d.id !== this.sel); this.select(null); this.changed(); }
  cloneSelected() { const d = this.selected(); if (!d) return; this.snapshot(); const c: Drawing = JSON.parse(JSON.stringify(d)); c.id = uid(); const dt = this.barMs() * 3 || 60000; c.pts.forEach(p => { p.t += dt; }); this.drawings.push(c); this.changed(); this.select(c.id); }
  clearDrawings() { if (!this.drawings.length) return; this.snapshot(); this.drawings = []; this.select(null); this.changed(); }
  setTool(t: string) { this.tool = t; this.creating = null; this.cv.style.cursor = t === 'cursor' ? 'default' : 'crosshair'; this.cb.tool?.(t); this.dirty = true; }

  /* ================================================================ geometry */
  private geom() {
    const panes = this.subPanes();
    const axisW = 88, ladW = this.opt.style === 'heatmap' && this.sym?.hasBook ? 36 : 0, timeH = 24;
    const statsH = this.opt.ov.stats && this.opt.style !== 'heatmap' ? STATS_ROW * 4 + 2 : 0;
    const avail = this.H - timeH - statsH;
    const subH = panes.length ? Math.max(56, Math.round(avail * (panes.length > 2 ? 0.11 : 0.15))) : 0;
    const mainH = Math.max(60, avail - subH * panes.length), plotW = Math.max(60, this.W - axisW - ladW);
    return { axisW, ladW, timeH, subH, statsH, mainH, plotW, panes };
  }
  private subPanes(): string[] {
    const p: string[] = [];
    if (this.opt.ov.volume) p.push('volume');
    if (this.opt.ov.cvd) p.push('cvd');
    if (this.opt.ov.delta) p.push('delta');
    if (this.opt.ov.oi && (this.md?.deriv.length || 0) > 1) p.push('oi');
    this.plots.forEach((pl, i) => { if (pl.pane === 'sub') p.push('plot:' + i); });
    return p.slice(0, 5);
  }
  timeToX(t: number): number {
    const b = this.G.bars as Bar[]; const n = b?.length; if (!n) return 0;
    const ms = this.barMs() || (n > 1 && b[n - 1].t > b[0].t ? (b[n - 1].t - b[0].t) / (n - 1) : 60000);
    if (t >= b[n - 1].t) return this.G.xOf(n - 1 + (t - b[n - 1].t) / (ms || 60000));
    if (t <= b[0].t) return this.G.xOf((t - b[0].t) / (ms || 60000));
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].t <= t) lo = m; else hi = m; }
    const span = b[hi].t - b[lo].t || ms || 60000; return this.G.xOf(lo + Math.min(1, (t - b[lo].t) / span));
  }
  xToTime(x: number): number {
    const b = this.G.bars as Bar[]; const n = b?.length; if (!n) return Date.now();
    const i = this.G.iOf(x), ms = this.barMs() || (n > 1 && b[n - 1].t > b[0].t ? (b[n - 1].t - b[0].t) / (n - 1) : 60000);
    if (i >= n - 1) return b[n - 1].t + (i - (n - 1)) * ms;
    if (i <= 0) return b[0].t + i * ms;
    const lo = Math.floor(i), f = i - lo; return b[lo].t + f * ((b[lo + 1]?.t ?? b[lo].t + ms) - b[lo].t);
  }
  private dview(): DView {
    const G = this.G, sym = this.sym!;
    return { x: (t) => this.timeToX(t), y: G.yOf, t: (x) => this.xToTime(x), p: G.pOf, plotW: G.plotW, mainH: G.mainH, dec: sym.dec, tick: sym.tick, bars: G.bars, row: this.rowSize(), fmt: (p) => p.toFixed(sym.dec), acct: this.opt.acct };
  }
  private tapeSpeed() {
    const tk = this.md?.ticks; if (!tk?.length) return { now: 0, avg: 0 };
    const end = this.replayTime() ?? Date.now();
    let i = tk.length - 1; while (i >= 0 && tk[i][0] > end) i--;
    let n10 = 0, n300 = 0;
    for (let j = i; j >= 0 && tk[j][0] >= end - 300_000; j--) { n300++; if (tk[j][0] >= end - 10_000) n10++; }
    return { now: n10 / 10, avg: n300 / 300 };
  }

  /* ================================================================ render */
  private draw() {
    const ctx = this.ctx, W = this.W, H = this.H; if (!W || !H) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sym = this.sym, bars = this.bars, n = bars.length;
    const style = this.opt.style, fp = style === 'footprint', heat = style === 'heatmap', ov = this.opt.ov;
    const bg = fp ? '#0d0f15' : '#0c0e12';
    const bgG = ctx.createLinearGradient(0, 0, 0, H); bgG.addColorStop(0, fp ? '#10131b' : '#0e1116'); bgG.addColorStop(1, bg);
    ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);
    if (!sym || !n) {
      ctx.fillStyle = '#6b7684'; ctx.font = `14px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(!sym ? 'Loading symbols…' : this.md?.ready ? (sym.volume === 'none' ? 'Waiting for the first price…' : 'Waiting for trades…') : 'Connecting to data feed…', W / 2, H / 2);
      ctx.textAlign = 'left'; this.emitView(true); return;
    }
    const { axisW, ladW, timeH, subH, statsH, mainH, plotW, panes } = this.geom();

    if (this.lastB === this.B && n > this.lastN && n - this.lastN < 10 && this.view.off > 0.5) this.view.off += n - this.lastN;
    this.lastB = this.B; this.lastN = n;
    const cw = (this.view.cw = clamp(this.view.cw, MIN_CW, MAX_CW));
    const rpad = this.rpad(cw);
    const offMin = Math.min(0, (rpad - plotW / 2) / cw);
    const offMax = (rpad - plotW / 2) / cw + (n - 1);
    this.view.off = offMin > offMax ? 0 : clamp(this.view.off, offMin, offMax);
    if (!isFinite(this.view.off)) this.view.off = 0;
    const off = this.view.off;
    const xOf = (i: number) => plotW - rpad - (n - 1 - i) * cw + off * cw;
    const iOf = (x: number) => n - 1 - (plotW - rpad + off * cw - x) / cw;
    const first = Math.max(0, Math.floor(iOf(0)) - 1), last = Math.min(n - 1, Math.ceil(iOf(plotW)) + 1);

    let vlo = Infinity, vhi = -Infinity, iHi = last, iLo = last;
    for (let i = first; i <= last; i++) { if (bars[i].l < vlo) { vlo = bars[i].l; iLo = i; } if (bars[i].h > vhi) { vhi = bars[i].h; iHi = i; } }
    if (!isFinite(vlo)) { vlo = bars[n - 1].l; vhi = bars[n - 1].h; }
    let lo: number, hi: number;
    const y = this.view.y;
    if (!this.view.auto && y && isFinite(y.mid) && y.span > 0 && isFinite(y.span) && !(vhi < y.mid - y.span / 2 || vlo > y.mid + y.span / 2)) {
      lo = y.mid - y.span / 2; hi = y.mid + y.span / 2;
    } else {
      if (!this.view.auto) { this.view.auto = true; this.view.y = null; }
      const pad = Math.max((vhi - vlo) * 0.1, sym.tick * 8); lo = vlo - pad; hi = vhi + pad;
    }
    const yOf = (p: number) => ((hi - p) / (hi - lo)) * mainH, pOf = (yy: number) => hi - (yy / mainH) * (hi - lo);
    const row = this.rowSize(), pxRow = (mainH * row) / (hi - lo);
    this.G = { xOf, iOf, yOf, pOf, plotW, mainH, bars, n, lo, hi, first, last, cw };
    const fmtP = (p: number) => p.toFixed(sym.dec);
    const ms = this.barMs();
    const tLo = this.xToTime(0), tHi = this.xToTime(plotW), tEnd = this.replayTime() ?? Infinity;
    const th = settings.get().theme;
    BULL = th.candles.bullBody;
    BEAR = th.candles.bearBody;
    BEAR_HI = th.candles.bearBody;
    const BULL_WICK = th.candles.bullWick;
    const BEAR_WICK = th.candles.bearWick;
    const HOLLOW = !!th.candles.hollowBull;
    const visuals = th.visuals;

    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, plotW, mainH); ctx.clip();

    /* ---------- grid, session separators, watermark ---------- */
    const priceStep = Math.max(sym.tick || 1e-8, niceStep((hi - lo) / Math.max(4, Math.floor(mainH / 42))));
    const showGrid = !!(visuals.grid && visuals.gridOpacity > 0);
    ctx.strokeStyle = `rgba(255,255,255,${(visuals.gridOpacity / 100).toFixed(3)})`; ctx.lineWidth = 1;
    if (showGrid) for (let p = Math.ceil(lo / priceStep) * priceStep; p < hi; p += priceStep) { const yy = Math.round(yOf(p)) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); }
    const every = Math.max(1, Math.ceil(110 / cw));
    if (showGrid) for (let i = first; i <= last; i++) if (i % every === 0) { const x = Math.round(xOf(i)) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mainH); ctx.stroke(); }
    if (visuals.sessionLines && (!ms || ms < 86_400_000)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.setLineDash([4, 4]);
      for (let i = Math.max(1, first); i <= last; i++) if (new Date(bars[i].t).getDate() !== new Date(bars[i - 1].t).getDate()) { const x = Math.round(xOf(i) - cw / 2) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (visuals.watermark && visuals.watermarkOpacity > 0) { const wm = visuals.watermarkOpacity / 100; ctx.fillStyle = `rgba(255,255,255,${wm.toFixed(3)})`; ctx.font = `700 ${Math.min(96, plotW / 7)}px ${FONT}`; ctx.fillText(sym.id, plotW / 2, mainH / 2); }
    if (visuals.watermark && visuals.watermarkOpacity > 0) { const wm = visuals.watermarkOpacity / 100; ctx.fillStyle = `rgba(255,255,255,${(wm * 1.6).toFixed(3)})`; ctx.font = `14px ${FONT}`; ctx.fillText(`${sym.venues} · FlowScope`, plotW / 2, mainH / 2 + Math.min(60, plotW / 12)); }
    ctx.textAlign = 'left';

    /* ---------- context behind price: calendar, sessions ---------- */
    if (ov.cal && this.calendar.length) this.drawCalendar(tLo, tHi, mainH);
    const ctxLv = (ov.sessions || ov.levels) && !heat ? this.levelsCache(bars, row) : null;
    if (ov.sessions && ctxLv) this.drawSessions(ctxLv.sess, tLo, tHi, yOf, plotW, mainH, fmtP);

    /* ---------- liquidity heatmap ---------- */
    if (heat && this.md) {
      const cols = this.md.heat;
      let a = 0, b = cols.length - 1; while (a <= b) { const m = (a + b) >> 1; if (cols[m].t < tLo) a = m + 1; else b = m - 1; }
      const i0 = Math.max(0, a - 1);
      let mx = 1; for (let i = i0; i < cols.length && cols[i].t <= tHi && cols[i].t <= tEnd; i++) for (const l of cols[i].l) if (l[1] > mx) mx = l[1];
      const contrast = Math.max(0.2, Math.min(1.0, this.flow.heatContrast || 0.55));
      mx *= (1.1 - contrast * 0.7);
      const rowH = Math.max(1, pxRow);
      for (let i = i0; i < cols.length && cols[i].t <= tHi && cols[i].t <= tEnd; i++) {
        const c = cols[i], x = this.timeToX(c.t), nx = i + 1 < cols.length ? this.timeToX(cols[i + 1].t) : x + Math.max(1, cw / 2);
        const w = Math.max(1, Math.min(nx - x, cw * 4) + 0.6);
        for (const [p, q, s] of c.l) {
          const yy = yOf(p + row); if (yy > mainH || yy + rowH < 0) continue;
          const ix = Math.min(63, Math.floor(Math.pow(Math.min(1, q / mx), contrast) * 63)); if (ix < (this.flow.heatCutoff ?? 4)) continue;
          ctx.fillStyle = s > 0 ? HEAT_BID[ix] : HEAT_ASK[ix]; ctx.fillRect(x, yy, w, rowH + 0.6);
        }
      }
      ctx.lineWidth = 1.4;
      for (let i = Math.max(first, 1); i <= last; i++) { const p0 = bars[i - 1], c = bars[i]; ctx.strokeStyle = c.c >= p0.c ? BULL : '#8a45b4'; ctx.beginPath(); ctx.moveTo(xOf(i - 1), yOf(p0.c)); ctx.lineTo(xOf(i), yOf(c.c)); ctx.stroke(); }
      for (let i = first; i <= last; i++) { if (cw < 3 && i % 2) continue; const c = bars[i]; ctx.fillStyle = c.b >= c.s ? '#7be36f' : '#b27ae6'; ctx.beginPath(); ctx.arc(xOf(i), yOf(c.c), 1.8, 0, 7); ctx.fill(); }
      if (ov.bubbles) for (let i = first; i <= last; i++) for (const t of bars[i].big) this.bubble(xOf(i), yOf(t[1]), t[2], t[1], t[3], true);
    }

    /* ---------- order-flow zones behind price ---------- */
    if (ov.imbl && !heat) this.drawImbalanceZones(bars, first, last, xOf, yOf, row, plotW, cw);
    if (ov.walls && !heat && this.md && sym.hasBook && this.replayIdx == null) this.drawWalls(yOf, plotW, mainH, row, xOf(n - 1));

    /* ---------- candles ---------- */
    if (style === 'candles') {
      for (let i = first; i <= last; i++) {
        const c = bars[i], x = Math.round(xOf(i)), up = c.c >= c.o, bw = Math.max(1, Math.round(cw * 0.7) | 1);
        ctx.fillStyle = up ? BULL_WICK : BEAR_WICK;
        ctx.fillRect(x, Math.round(yOf(c.h)), 1, Math.max(1, Math.round(yOf(c.l) - yOf(c.h))));
        const y1 = Math.round(yOf(Math.max(c.o, c.c))), y2 = Math.round(yOf(Math.min(c.o, c.c)));
        const ch = Math.max(1, y2 - y1);
        if (up && HOLLOW) { ctx.strokeStyle = BULL; ctx.lineWidth = 1; ctx.strokeRect(x - (bw >> 1) + 0.5, y1 + 0.5, Math.max(1, bw - 1), Math.max(1, ch - 1)); }
        else { ctx.fillStyle = up ? BULL : BEAR; ctx.fillRect(x - (bw >> 1), y1, bw, ch); }
        if (!HOLLOW && bw >= 5 && y2 - y1 > 2) { ctx.fillStyle = up ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.07)'; ctx.fillRect(x - (bw >> 1), y1, Math.max(1, bw >> 2), y2 - y1); }
      }
      if (ov.bubbles) for (let i = first; i <= last; i++) {
        let bb: any = null, bs: any = null;
        for (const t of bars[i].big) { if (t[3] > 0) { if (!bb || t[2] > bb[2]) bb = t; } else if (!bs || t[2] > bs[2]) bs = t; }
        for (const t of [bb, bs]) if (t) this.bubble(xOf(i), yOf(t[1]), t[2], t[1], t[3], false);
      }
    }

    /* ---------- footprint ---------- */
    if (fp) this.drawFootprint(bars, first, last, xOf, yOf, row, pxRow, cw);

    /* ---------- overlays ---------- */
    const S = buildSeries(bars);
    const line = (v: (number | null)[], col: string, w = 1.5, dash?: number[]) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); let st = false;
      for (let i = first; i <= last; i++) { const yy = v[i]; if (yy == null || !isFinite(yy)) { st = false; continue; } st ? ctx.lineTo(xOf(i), yOf(yy)) : ctx.moveTo(xOf(i), yOf(yy)); st = true; }
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    };
    if (ov.vwap) {
      line(S.vwap, '#ffffff', 1.6); const sd = TA.stdev(S.close, 50);
      line(S.vwap.map((v, i) => sd[i] != null ? v + sd[i]! : null), '#ffffff55', 1, [4, 4]); line(S.vwap.map((v, i) => sd[i] != null ? v - sd[i]! : null), '#ffffff55', 1, [4, 4]);
      this.edgeTag(plotW, yOf(S.vwap[last]), 'VWAP', '#e6e6e6', '#111');
    }
    if (ov.visp || ov.dlyp) this.drawProfile(bars, first, last, n, yOf, row, pxRow, plotW, mainH, fmtP);
    if (ov.levels && ctxLv?.lv) this.drawKeyLevels(ctxLv.lv, yOf, plotW, mainH, fmtP);
    for (const p of this.plots) if (p.pane !== 'sub') {
      if (p.type === 'dots') { ctx.fillStyle = p.color; for (let i = first; i <= last; i++) { const v = p.values[i]; if (v == null) continue; const x = xOf(i), yy = yOf(v); ctx.beginPath(); ctx.moveTo(x, yy - 6); ctx.lineTo(x + 5, yy); ctx.lineTo(x, yy + 6); ctx.lineTo(x - 5, yy); ctx.closePath(); ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; } }
      else line(p.values, p.color, 1.5);
    }

    /* ---------- order-flow events on top of price ---------- */
    if (ov.liqs && this.md?.liqs.length) this.drawLiqs(tLo, tHi, tEnd, yOf, mainH);
    if (ov.book && this.book) this.drawBookMarks(tLo, tHi, tEnd, yOf, mainH);
    if (ov.signals && !heat) this.drawSignals(bars, first, Math.min(last, n - 2), xOf, yOf, cw, row);

    /* ---------- visible high / low markers ---------- */
    if (!heat && last - first > 3) {
      ctx.font = `11px ${MONO}`; ctx.fillStyle = '#8b96a3'; ctx.textBaseline = 'middle';
      const mark = (i: number, p: number, dy: number) => { const x = xOf(i), yy = yOf(p) + dy; const s = fmtP(p), w = ctx.measureText(s).width; const left = x + w + 22 > plotW; ctx.strokeStyle = '#4a5361'; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(left ? x - 12 : x + 12, yy); ctx.stroke(); ctx.textAlign = left ? 'right' : 'left'; ctx.fillText(s, left ? x - 15 : x + 15, yy); };
      if (yOf(vhi) > 10) mark(iHi, vhi, -6);
      if (yOf(vlo) < mainH - 10) mark(iLo, vlo, 6);
      ctx.textAlign = 'left';
    }

    /* ---------- paper trading ---------- */
    const lastC = bars[n - 1];
    const tag = (x: number, yy: number, s: string, b: string) => { ctx.font = `600 11px ${FONT}`; const w = ctx.measureText(s).width + 12; ctx.fillStyle = b; ctx.fillRect(x, yy - 9, w, 18); ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(s, x + 6, yy); };
    if (this.paper && this.paper.sym === sym.id) {
      const P = this.paper;
      if (P.pos.qty) { const yy = yOf(P.pos.avg), pl = (lastC.c - P.pos.avg) * P.pos.qty; ctx.strokeStyle = pl >= 0 ? BULL : BEAR_HI; ctx.setLineDash([6, 3]); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); ctx.setLineDash([]); tag(plotW - 240, yy, `${P.pos.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(P.pos.qty)} @ ${fmtP(P.pos.avg)}  ${pl >= 0 ? '+' : ''}${pl.toFixed(2)}`, pl >= 0 ? '#14684a' : '#4b2d86'); }
      for (const o of P.orders) { const yy = yOf(o.px); ctx.strokeStyle = o.side > 0 ? BULL : BEAR_HI; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); tag(plotW - 180, yy, `${o.type.toUpperCase()} ${o.side > 0 ? 'BUY' : 'SELL'} ${o.qty} @ ${fmtP(o.px)}`, o.side > 0 ? '#14684a' : '#4b2d86'); }
    }

    /* ---------- drawings ---------- */
    if (!this.hidden) {
      const V = this.dview(), painter = new Painter(ctx);
      for (const d of this.drawings) if (!d.hidden && d.id !== this.sel) renderDrawing(painter, d, V, { sel: false, hover: d.id === this.hoverId });
      const sd0 = this.selected(); if (sd0 && !sd0.hidden) renderDrawing(painter, sd0, V, { sel: true, hover: false });
      if (this.creating) renderDrawing(painter, this.creating, V, { sel: false, hover: true });
      const s = this.selected();
      if (s) {
        const hs = handlesOf(s, V);
        for (let i = 0; i < hs.length; i++) {
          const [hx, hy] = hs[i];
          const isCorner = s.type === 'fixedvp' ? i < 4 : true;
          const r = isCorner ? 5.5 : 3.5;
          ctx.fillStyle = s.type === 'fixedvp' ? '#7d7432' : '#0c0e12';
          ctx.strokeStyle = s.locked ? '#6b7684' : (s.color || '#4c8dff');
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hx, hy, r, 0, Math.PI * 2);
          ctx.fill();
          if (s.type !== 'fixedvp') ctx.stroke();
        }
      }
    }
    ctx.restore();

    /* ---------- DOM ladder strip (heatmap) ---------- */
    if (ladW && this.md) {
      const lx = plotW; ctx.fillStyle = bg; ctx.fillRect(lx, 0, ladW, mainH);
      const lv = new Map<number, [number, number]>(); let mx = 1;
      for (const [p, q] of this.md.book.b) { const k = Math.floor(p / row); const e = lv.get(k) || [0, 1]; e[0] += q; lv.set(k, e); }
      for (const [p, q] of this.md.book.a) { const k = Math.floor(p / row); const e = lv.get(k) || [0, -1]; e[0] += q; e[1] = -1; lv.set(k, e); }
      for (const e of lv.values()) mx = Math.max(mx, e[0]);
      const step = Math.max(1, Math.ceil(13 / pxRow));
      ctx.font = `10.5px ${MONO}`; ctx.textBaseline = 'middle';
      for (const [k, [q, s]] of lv) { if (k % step) continue; const yy = yOf((k + 0.5) * row); if (yy < 6 || yy > mainH - 6) continue; ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, (q / mx) * 2); ctx.fillStyle = s > 0 ? '#1aa51a' : '#6b2fb3'; ctx.fillRect(lx, yy - 6.5, 4 + Math.min(1, q / mx) * 30, 13); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillText(fmtQ(q), lx + 3, yy); }
    }
    const ax = plotW + ladW;

    /* ---------- bar statistics strip ---------- */
    if (statsH) {
      const st = mainH;
      ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, st, W, statsH); ctx.fillStyle = '#191e25'; ctx.fillRect(0, st, W, 1);
      const pct = S.delta.map((d, i) => S.volume[i] ? (d / S.volume[i]) * 100 : 0), big = S.bigBuy.map((b, i) => b - S.bigSell[i]);
      const rows: [string, number[], boolean][] = [['Volume', S.volume, false], ['Delta', S.delta, true], ['Delta %', pct, true], ['Big Δ', big, true]];
      ctx.save(); ctx.beginPath(); ctx.rect(0, st + 1, plotW, statsH - 1); ctx.clip();
      ctx.font = `10.5px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      rows.forEach(([, v, signed], r) => {
        let mx = 1e-12; for (let i = first; i <= last; i++) mx = Math.max(mx, Math.abs(v[i]));
        const yy = st + 1 + r * STATS_ROW;
        for (let i = first; i <= last; i++) {
          const a = Math.min(1, Math.abs(v[i]) / mx), x = xOf(i) - cw / 2 + 0.5, w = Math.max(1, cw - 1);
          ctx.fillStyle = !signed ? `rgba(160,169,182,${0.05 + 0.4 * a})` : v[i] >= 0 ? `rgba(34,197,139,${0.06 + 0.6 * a})` : `rgba(139,92,246,${0.08 + 0.7 * a})`;
          ctx.fillRect(x, yy, w, STATS_ROW - 1);
          if (cw >= 34) { ctx.fillStyle = a > 0.55 ? '#fff' : '#c4ccd6'; ctx.fillText(r === 2 ? `${v[i].toFixed(0)}%` : fmtQ(v[i]), xOf(i), yy + STATS_ROW / 2); }
        }
      });
      ctx.restore();
      ctx.fillStyle = '#0a0c10'; ctx.fillRect(ax, st + 1, axisW, statsH - 1);
      ctx.font = `500 10.5px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = '#6b7684';
      rows.forEach(([name], r) => ctx.fillText(name, ax + 8, st + 1 + r * STATS_ROW + STATS_ROW / 2));
    }

    /* ---------- sub panes ---------- */
    panes.forEach((pane, pi) => {
      const st = mainH + statsH + pi * subH; ctx.fillStyle = bg; ctx.fillRect(0, st, plotW + ladW, subH); ctx.fillStyle = '#191e25'; ctx.fillRect(0, st, W, 1);
      ctx.save(); ctx.beginPath(); ctx.rect(0, st + 1, plotW, subH - 1); ctx.clip();
      let label = '', axisTxt = '';
      const lineSub = (v: (number | null)[], col: string, fill = false) => {
        let a = Infinity, b = -Infinity; for (let i = first; i <= last; i++) { const yy = v[i]; if (yy != null && isFinite(yy)) { a = Math.min(a, yy); b = Math.max(b, yy); } } if (!isFinite(a)) return; if (a === b) { a -= 1; b += 1; }
        const Y = (q: number) => st + 8 + ((b - q) / (b - a)) * (subH - 16);
        ctx.beginPath(); let s0 = false, x0 = 0, xl = 0; for (let i = first; i <= last; i++) { const yy = v[i]; if (yy == null) continue; const x = xOf(i); if (!s0) x0 = x; xl = x; s0 ? ctx.lineTo(x, Y(yy)) : ctx.moveTo(x, Y(yy)); s0 = true; }
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
        if (fill && s0) { ctx.lineTo(xl, st + subH); ctx.lineTo(x0, st + subH); ctx.closePath(); const g = ctx.createLinearGradient(0, st, 0, st + subH); g.addColorStop(0, col + '44'); g.addColorStop(1, col + '00'); ctx.fillStyle = g; ctx.fill(); }
        axisTxt = fmtQ(v[last] ?? 0);
      };
      const histSub = (v: (number | null)[], pos: string, neg: string) => { let m = 0; for (let i = first; i <= last; i++) { const yy = v[i]; if (yy != null) m = Math.max(m, Math.abs(yy)); } const mid = st + subH / 2; ctx.fillStyle = '#222831'; ctx.fillRect(0, mid, plotW, 1); for (let i = first; i <= last; i++) { const yy = v[i]; if (yy == null) continue; const h = (yy / (m || 1)) * (subH / 2 - 6); ctx.fillStyle = yy >= 0 ? pos : neg; ctx.fillRect(xOf(i) - Math.max(0.5, cw * 0.35), Math.min(mid, mid - h), Math.max(1, cw * 0.7), Math.abs(h)); } axisTxt = fmtQ(v[last] ?? 0); };
      if (pane === 'volume') {
        label = 'Volume'; let mx = 1; for (let i = first; i <= last; i++) mx = Math.max(mx, bars[i].v);
        for (let i = first; i <= last; i++) {
          const c = bars[i], h = (c.v / mx) * (subH - 22), x = xOf(i), bw = Math.max(1, cw * 0.7), base = st + subH;
          if (c.est || c.v <= 0) { ctx.fillStyle = c.c >= c.o ? BULL : BEAR; ctx.fillRect(x - bw / 2, base - h, bw, h); continue; }
          const hb = h * (c.b / c.v);
          ctx.fillStyle = 'rgba(34,197,139,0.85)'; ctx.fillRect(x - bw / 2, base - hb, bw, hb);
          ctx.fillStyle = 'rgba(139,92,246,0.9)'; ctx.fillRect(x - bw / 2, base - h, bw, h - hb);
        }
        axisTxt = fmtQ(mx);
      } else if (pane === 'cvd') { label = 'CVD'; lineSub(S.cvd, '#38bdf8', true); }
      else if (pane === 'delta') { label = 'Delta'; histSub(S.delta, BULL, BEAR); }
      else if (pane === 'oi') { const r = this.drawOI(st, subH, tLo, tHi, tEnd); label = r.label; axisTxt = r.axis; }
      else { const p = this.plots[+pane.slice(5)]; label = p.name; p.type === 'hist' ? histSub(p.values, p.color, BEAR) : lineSub(p.values, p.color); }
      ctx.restore();
      ctx.fillStyle = '#a0a9b6'; ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, 8, st + 15);
      ctx.fillStyle = bg; ctx.fillRect(plotW + ladW, st + 1, axisW, subH - 1); ctx.fillStyle = '#6b7684'; ctx.font = `11px ${MONO}`; ctx.fillText(axisTxt, plotW + ladW + 8, st + 16);
    });

    /* ---------- price axis ---------- */
    ctx.fillStyle = bg; ctx.fillRect(ax, 0, axisW, mainH); ctx.fillStyle = '#191e25'; ctx.fillRect(ax, 0, 1, mainH);


    const targetY = yOf(lastC.c);
    if (this.drag || this.smoothPriceY === null || !Number.isFinite(this.smoothPriceY)) {
      this.smoothPriceY = targetY;
    } else {
      const dy = targetY - this.smoothPriceY;
      if (Math.abs(dy) > 0.08) {
        this.smoothPriceY += dy * 0.32;
        this.dirty = true;
      } else {
        this.smoothPriceY = targetY;
      }
    }
    const lyRaw = this.smoothPriceY;
    const ly = clamp(lyRaw, 11, mainH - 11);
    const up = lastC.c >= lastC.o;
    ctx.font = `11px ${MONO}`; ctx.fillStyle = '#8b96a3'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (priceStep > 0 && isFinite(priceStep)) {
      for (let p = Math.ceil(lo / priceStep) * priceStep; p < hi; p += priceStep) {
        const yy = yOf(p);
        if (yy > 8 && yy < mainH - 8) {
          if (Math.abs(yy - ly) < 12) continue;
          ctx.fillText(fmtP(p), ax + 8, yy);
        }
      }
    }
    if (lyRaw >= 0 && lyRaw <= mainH) { ctx.strokeStyle = up ? 'rgba(34,197,139,0.55)' : 'rgba(164,124,242,0.6)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(0, lyRaw); ctx.lineTo(plotW, lyRaw); ctx.stroke(); ctx.setLineDash([]); }
    const tagH = 20, tagL = ax + 2, tagR = ax + axisW - 2, arrowW = 5;
    ctx.beginPath();
    ctx.moveTo(tagL, ly);
    ctx.lineTo(tagL + arrowW, ly - tagH / 2);
    ctx.lineTo(tagR - 2, ly - tagH / 2);
    ctx.quadraticCurveTo(tagR, ly - tagH / 2, tagR, ly - tagH / 2 + 2);
    ctx.lineTo(tagR, ly + tagH / 2 - 2);
    ctx.quadraticCurveTo(tagR, ly + tagH / 2, tagR - 2, ly + tagH / 2);
    ctx.lineTo(tagL + arrowW, ly + tagH / 2);
    ctx.closePath();
    ctx.fillStyle = up ? BULL : BEAR;
    ctx.fill();

    ctx.fillStyle = up ? '#04180f' : '#ffffff';
    ctx.font = `600 11px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const arrowPrefix = lyRaw < 0 ? '▲ ' : lyRaw > mainH ? '▼ ' : '';
    ctx.fillText(arrowPrefix + fmtP(lastC.c), (tagL + arrowW + tagR) / 2, ly);



    if (ms && this.replayIdx == null) {
      const now = Date.now();
      const remainingSec = Math.max(0, Math.ceil((lastC.t + ms - now) / 1000));
      let timeStr = '';
      if (remainingSec >= 3600) {
        const h = Math.floor(remainingSec / 3600), m = Math.floor((remainingSec % 3600) / 60);
        timeStr = `${h}h${String(m).padStart(2, '0')}m`;
      } else {
        const m = Math.floor(remainingSec / 60), s = remainingSec % 60;
        timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
      const pillH = 16, pillW = 56, pillX = ax + Math.round((axisW - pillW) / 2);
      const placeAbove = ly > mainH - 32;
      const pillY = placeAbove ? ly - tagH / 2 - pillH - 3 : ly + tagH / 2 + 3;

      ctx.fillStyle = 'rgba(15, 19, 25, 0.94)';
      ctx.beginPath();
      if (typeof (ctx as any).roundRect === 'function') {
        (ctx as any).roundRect(pillX, pillY, pillW, pillH, 3);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fill();
      ctx.strokeStyle = up ? 'rgba(34,197,139,0.35)' : 'rgba(164,124,242,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = up ? '#34d399' : '#c084fc';
      ctx.font = `600 10px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(timeStr, pillX + pillW / 2, pillY + pillH / 2);
    }
    const sd = this.selected();
    if (sd && !this.hidden) for (const pt of sd.pts.slice(0, 3)) { const yy = yOf(pt.p); if (yy < 0 || yy > mainH) continue; ctx.fillStyle = '#4c8dff'; ctx.fillRect(ax + 2, yy - 9, axisW - 4, 18); ctx.fillStyle = '#fff'; ctx.font = `11px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText(fmtP(pt.p), ax + axisW / 2, yy); }
    if (!this.view.auto) { ctx.fillStyle = '#f5b544'; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('manual scale', ax + axisW / 2, mainH - 9); }

    /* ---------- time axis ---------- */
    ctx.fillStyle = bg; ctx.fillRect(0, H - timeH, W, timeH); ctx.fillStyle = '#191e25'; ctx.fillRect(0, H - timeH, W, 1);
    ctx.fillStyle = '#8b96a3'; ctx.font = `11px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const withSec = ms > 0 && ms < 60000;
    const tl = (t: number, prev?: number) => { const d = new Date(t); if (prev != null && new Date(prev).getDate() !== d.getDate()) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); return withSec ? d.toTimeString().slice(0, 8) : ms >= 86_400_000 ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : d.toTimeString().slice(0, 5); };
    let prevT: number | undefined;
    for (let i = first; i <= last; i++) if (i % every === 0) { const x = xOf(i); if (x > 30 && x < plotW - 30) { const isDay = prevT != null && new Date(prevT).getDate() !== new Date(bars[i].t).getDate(); ctx.font = `${isDay ? '600 ' : ''}11px ${MONO}`; ctx.fillText(tl(bars[i].t, prevT), x, H - timeH / 2); } prevT = bars[i].t; }

    /* ---------- linked crosshair from another chart ---------- */
    if (this.extCross != null && !this.mouse) {
      const x = this.timeToX(this.extCross);
      if (x >= 0 && x <= plotW) { ctx.strokeStyle = 'rgba(76,141,255,0.6)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - timeH); ctx.stroke(); ctx.setLineDash([]); }
    }

    /* ---------- crosshair ---------- */
    let hc = lastC, hp: number | null = null, hi_ = n - 1;
    if (this.mouse && this.mouse.x < plotW && this.mouse.y < H - timeH && !this.drag) {
      const { x, y: my } = this.mouse; hi_ = Math.round(iOf(x)); if (hi_ >= 0 && hi_ < n) hc = bars[hi_];
      const sx = hi_ >= 0 && hi_ < n ? xOf(hi_) : x;
      const chDash = visuals.crosshair === 'solid' ? [] : visuals.crosshair === 'dotted' ? [2, 2] : [4, 4];
      ctx.strokeStyle = 'rgba(160,169,182,0.55)'; ctx.setLineDash(chDash); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H - timeH); if (my < mainH) { ctx.moveTo(0, my); ctx.lineTo(plotW, my); } ctx.stroke(); ctx.setLineDash([]);
      if (my < mainH) { hp = pOf(my); ctx.fillStyle = '#2e3640'; ctx.fillRect(ax + 2, my - 10, axisW - 4, 20); ctx.fillStyle = '#e9edf2'; ctx.textAlign = 'center'; ctx.font = `11px ${MONO}`; ctx.fillText(fmtP(hp), ax + axisW / 2, my); }
      const t = hi_ >= 0 && hi_ < n ? bars[hi_].t : this.xToTime(x), lbl = new Date(t).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: withSec ? '2-digit' : undefined });
      ctx.font = `11px ${MONO}`; const tw = ctx.measureText(lbl).width + 16; ctx.fillStyle = '#2e3640'; ctx.fillRect(clamp(sx - tw / 2, 0, plotW - tw), H - timeH + 1, tw, timeH - 1); ctx.fillStyle = '#e9edf2'; ctx.textAlign = 'center'; ctx.fillText(lbl, clamp(sx, tw / 2, plotW - tw / 2), H - timeH / 2);
      if (t !== this.lastCross) { this.lastCross = t; this.cb.cross?.(t); }
    }
    ctx.textAlign = 'left';

    /* ---------- legend & gauges ---------- */
    if (this.cb.legend) {
      const col = hc.c >= hc.o ? BULL : BEAR_HI, dv = hc.b - hc.s;
      const plots = this.plots.map(p => `<span style="color:${p.color}">${p.name}</span>`).join('');
      let cell = '';
      if (hp != null && hc.fp.size) { const k = Math.round(hp / row), c = hc.fp.get(k); if (c) cell = `<span style="color:#ffd23f">@ ${fmtP(k * row)}  <span style="color:${BEAR_HI}">${fmtQ(c[0])}</span> × <span style="color:${BULL}">${fmtQ(c[1])}</span>  Δ ${fmtQ(c[1] - c[0])}</span>`; }
      const tp = this.tapeSpeed(), hot = tp.avg > 0 && tp.now > tp.avg * 2.5;
      const tape = sym.volume === 'real' ? `<span style="color:${hot ? '#ff8c1a' : '#6b7684'}">Tape ${tp.now.toFixed(1)}/s${hot ? ' ⚡' : ''}</span>` : '';
      const dvr = this.md?.lastDeriv();
      const der = dvr ? `${dvr.oi != null ? `<span style="color:#6b7684">OI ${fmtQ(dvr.oi)}</span>` : ''}${dvr.fr != null ? `<span style="color:${dvr.fr >= 0 ? BULL : BEAR_HI}">Fund ${(dvr.fr * 100).toFixed(4)}%</span>` : ''}` : '';
      const sigs = ov.signals && hi_ >= 0 && hi_ < n - 1 ? barSignals(bars, hi_, row).map(g => `<span style="color:${SIG_STYLE[g.kind].color}">${SIG_STYLE[g.kind].label} ${g.txt}</span>`).join('') : '';
      const note = sym.volume === 'none' ? '<span class="note">Price-only feed — no real traded volume is available for this market.</span>' : hc.k ? '<span class="note">Older bars come from exchange candles (no tick-level footprint). Live bars carry full order flow.</span>' : '';
      this.cb.legend(`<span style="color:${col}">O ${fmtP(hc.o)}</span><span style="color:${col}">H ${fmtP(hc.h)}</span><span style="color:${col}">L ${fmtP(hc.l)}</span><span style="color:${col}">C ${fmtP(hc.c)}</span><span style="color:${col}">${(((hc.c / hc.o) - 1) * 100).toFixed(2)}%</span><span style="color:#c4ccd6">V ${fmtQ(hc.v)}</span>${hc.est ? '' : `<span style="color:${dv >= 0 ? BULL : '#ff3df5'}">Δ ${fmtQ(dv)}</span>`}${tape}${der}${cell}${plots}${sigs ? `<br>${sigs}` : ''}${note}`);
    }
    this.cb.gauges?.(lastC.b - lastC.s, S.cvd[n - 1] || 0);
    this.emitView(Math.abs(this.view.off) <= 0.5);
  }

  private emitView(live: boolean) {
    const s = `${live}|${this.view.auto}`;
    if (s !== this.lastVS) { this.lastVS = s; this.cb.view?.({ live, auto: this.view.auto }); }
  }

  /* ---------- render helpers ---------- */
  private bubble(x: number, y: number, q: number, p: number, side: number, solid: boolean) {
    const ctx = this.ctx;
    let ratio = 1;
    const cfg = this.opt.bigConfig;
    if (cfg?.mode === 'qty' && cfg.bigQty > 0) {
      ratio = q / cfg.bigQty;
    } else {
      const denom = (cfg?.mode === 'auto' && this.B?.getAutoThreshold()) ? this.B.getAutoThreshold() : (this.opt.bigUsd || 50_000);
      ratio = (q * p) / Math.max(1, denom);
    }
    const r = Math.min(solid ? 26 : 28, (solid ? 3 : 5) + Math.sqrt(Math.max(0.4, ratio)) * (solid ? 4.2 : 4));
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    if (side > 0) { g.addColorStop(0, solid ? '#b8ff9c' : 'rgba(120,255,170,0.55)'); g.addColorStop(1, solid ? '#2fa82c' : 'rgba(34,197,139,0.18)'); }
    else { g.addColorStop(0, solid ? '#e3c2ff' : 'rgba(210,160,255,0.55)'); g.addColorStop(1, solid ? '#8a45b4' : 'rgba(139,92,246,0.22)'); }
    ctx.globalAlpha = solid ? 0.85 : 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    if (!solid) { ctx.strokeStyle = side > 0 ? BULL : BEAR; ctx.lineWidth = 1.6; ctx.stroke(); ctx.lineWidth = 1; }
    if (r >= 12) { ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.min(12, r * 0.6)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(fmtQ(q), x, y + 0.5); ctx.textAlign = 'left'; }
  }

  private edgeTag(plotW: number, y: number, s: string, bgc: string, fg: string) {
    if (!isFinite(y)) return; const ctx = this.ctx;
    ctx.font = `600 10.5px ${FONT}`; const w = ctx.measureText(s).width + 10;
    ctx.fillStyle = bgc; ctx.fillRect(plotW - w - 2, y - 8, w, 16); ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(s, plotW - w + 3, y);
  }

  private levelsCache(bars: Bar[], row: number) {
    const f = this.flow, n = bars.length;
    const key = `${n}|${bars[n - 1]?.t}|${Math.floor(Date.now() / 5000)}|${row}|${f.sess.asia}${f.sess.london}${f.sess.ny}|${f.orMin}|${this.replayIdx}`;
    if (key !== this.lvCache.key) this.lvCache = { key, sess: sessionProfiles(bars, row, f.sess), lv: keyLevels(bars, f.orMin) };
    return this.lvCache;
  }

  private drawSessions(sess: SessProf[], tLo: number, tHi: number, yOf: (p: number) => number, plotW: number, mainH: number, fmtP: (p: number) => string) {
    const ctx = this.ctx, now = this.replayTime() ?? Date.now();
    const recent = sess.filter(s => s.t1 >= tLo - 3 * 86_400_000);
    for (const s of recent) {
      if (s.t1 < tLo || s.t0 > tHi) continue;
      const x0 = Math.max(0, this.timeToX(s.t0)), x1 = Math.min(plotW, this.timeToX(Math.min(s.t1, now)));
      if (x1 - x0 < 2) continue;
      ctx.fillStyle = s.color + '0d'; ctx.fillRect(x0, yOf(s.vah), x1 - x0, yOf(s.val) - yOf(s.vah));
      ctx.strokeStyle = s.color + '55'; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x0, yOf(s.vah)); ctx.lineTo(x1, yOf(s.vah)); ctx.moveTo(x0, yOf(s.val)); ctx.lineTo(x1, yOf(s.val)); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x0, yOf(s.poc)); ctx.lineTo(x1, yOf(s.poc)); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = s.color; ctx.font = `600 10.5px ${FONT}`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      if (x1 - x0 > 40) ctx.fillText(s.name, x0 + 4, Math.min(mainH - 14, yOf(s.lo) + 4));
    }
    for (const s of recent) {
      if (s.t1 > now || (s.pocHit != null && s.pocHit < tLo)) continue;
      const x0 = Math.max(0, this.timeToX(s.t1)), x1 = s.pocHit != null ? this.timeToX(s.pocHit) : plotW, yy = yOf(s.poc);
      if (yy < 0 || yy > mainH || x1 <= x0) continue;
      ctx.strokeStyle = s.color + (s.pocHit != null ? '66' : 'cc'); ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); ctx.setLineDash([]);
      if (s.pocHit == null) this.edgeTag(plotW - 52, yy, `nPOC ${s.name} ${fmtP(s.poc)}`, s.color, '#111');
    }
    ctx.textBaseline = 'middle';
  }

  private drawKeyLevels(L: KeyLevels, yOf: (p: number) => number, plotW: number, mainH: number, fmtP: (p: number) => string) {
    const ctx = this.ctx;
    const items: [number | null, string, string, number[]][] = [
      [L.pdh, 'PDH', '#ff4d5e', []], [L.pdl, 'PDL', '#42da45', []], [L.pdc, 'PDC', '#9a9aa2', [2, 3]],
      [L.dayOpen, 'D Open', '#e6e6e6', [6, 3]], [L.weekOpen, 'W Open', '#4da3ff', [8, 4]],
      [L.orh, 'OR H', '#e6c84a', [3, 3]], [L.orl, 'OR L', '#e6c84a', [3, 3]],
    ];
    const used: number[] = [];
    for (const [p, lbl, col, dash] of items) {
      if (p == null || !isFinite(p)) continue;
      const yy = yOf(p); if (yy < 2 || yy > mainH - 2) continue;
      ctx.strokeStyle = col + 'aa'; ctx.lineWidth = 1; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); ctx.setLineDash([]);
      let ty = yy; while (used.some(u => Math.abs(u - ty) < 15)) ty += 15; used.push(ty);
      ctx.font = `600 10px ${FONT}`; const s = `${lbl} ${fmtP(p)}`, w = ctx.measureText(s).width + 8;
      ctx.fillStyle = col; ctx.fillRect(6, ty - 7, w, 14); ctx.fillStyle = '#111'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(s, 10, ty);
    }
  }

  private drawCalendar(tLo: number, tHi: number, mainH: number) {
    const ctx = this.ctx; let row = 0;
    for (const e of this.calendar) {
      if (e.t < tLo || e.t > tHi) continue;
      const x = this.timeToX(e.t), col = e.user ? '#4da3ff' : IMPACT_COL[e.impact] || '#9a9aa2';
      ctx.strokeStyle = col + '99'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mainH); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `600 10px ${FONT}`; const s = `${e.country ? e.country + ' ' : ''}${e.title}`.slice(0, 34), w = ctx.measureText(s).width + 8, yy = 22 + (row++ % 3) * 16;
      ctx.fillStyle = col; ctx.fillRect(x + 2, yy - 7, w, 14); ctx.fillStyle = '#111'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(s, x + 6, yy);
    }
  }

  private drawLiqs(tLo: number, tHi: number, tEnd: number, yOf: (p: number) => number, mainH: number) {
    const ctx = this.ctx, L = this.md!.liqs, big = this.opt.bigUsd, minUsd = big * 0.25;
    let a = 0, b = L.length - 1; while (a <= b) { const m = (a + b) >> 1; if (L[m].t < tLo) a = m + 1; else b = m - 1; }
    for (let i = a; i < L.length && L[i].t <= tHi && L[i].t <= tEnd; i++) {
      const l = L[i], usd = l.q * l.p; if (usd < minUsd) continue;
      const x = this.timeToX(l.t), yy = yOf(l.p); if (yy < -20 || yy > mainH + 20) continue;
      const r = Math.min(22, 3 + Math.sqrt(usd / (big * 0.5)) * 5), col = l.s < 0 ? LIQ_LONG : LIQ_SHORT;
      ctx.beginPath(); ctx.moveTo(x, yy - r); ctx.lineTo(x + r, yy); ctx.lineTo(x, yy + r); ctx.lineTo(x - r, yy); ctx.closePath();
      ctx.fillStyle = col + '55'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke(); ctx.lineWidth = 1;
      if (r >= 11) { ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.min(11, r * 0.55)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$' + fmtQ(usd), x, yy); ctx.textAlign = 'left'; }
    }
  }

  private drawBookMarks(tLo: number, tHi: number, tEnd: number, yOf: (p: number) => number, mainH: number) {
    const ctx = this.ctx;
    for (const m of this.book!.marks) {
      if (m.t < tLo || m.t > tHi || m.t > tEnd) continue;
      const x = this.timeToX(m.t), yy = yOf(m.p); if (yy < 0 || yy > mainH) continue;
      const col = m.side > 0 ? BULL : BEAR_HI;
      if (m.kind === 'ice') {
        ctx.fillStyle = '#e6c84a'; ctx.beginPath(); ctx.moveTo(x, yy - 7); ctx.lineTo(x + 7, yy); ctx.lineTo(x, yy + 7); ctx.lineTo(x - 7, yy); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
        ctx.font = `700 9.5px ${FONT}`; ctx.fillStyle = '#e6c84a'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(`ICE ${fmtQ(m.q)}`, x + 9, yy);
      } else if (m.kind === 'pull') {
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, yy - 5); ctx.lineTo(x + 5, yy + 5); ctx.moveTo(x + 5, yy - 5); ctx.lineTo(x - 5, yy + 5); ctx.stroke(); ctx.lineWidth = 1;
        ctx.font = `9.5px ${FONT}`; ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(`pulled ${fmtQ(m.q)}`, x + 7, yy);
      } else {
        ctx.fillStyle = col; ctx.fillRect(x - 3.5, yy - 3.5, 7, 7);
      }
    }
  }

  private drawSignals(bars: Bar[], first: number, last: number, xOf: (i: number) => number, yOf: (p: number) => number, cw: number, row: number) {
    const ctx = this.ctx;
    for (let i = first; i <= last; i++) {
      const sigs: Sig[] = barSignals(bars, i, row); if (!sigs.length) continue;
      let below = 0, above = 0;
      for (const g of sigs) {
        const st = SIG_STYLE[g.kind], x = xOf(i);
        if (g.kind === 'ua') {
          const yy = yOf(g.p); ctx.strokeStyle = st.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - cw * 0.45, yy); ctx.lineTo(x + Math.max(cw * 2.5, 18), yy); ctx.stroke(); ctx.lineWidth = 1;
          continue;
        }
        if (g.kind === 'df' && cw < 6) continue;
        const bull = g.side > 0, k = bull ? below++ : above++;
        const yy = bull ? yOf(bars[i].l) + 12 + k * 15 : yOf(bars[i].h) - 12 - k * 15, r = 6.5;
        ctx.fillStyle = st.color; ctx.beginPath();
        if (bull) { ctx.moveTo(x, yy - r); ctx.lineTo(x + r, yy + r * 0.7); ctx.lineTo(x - r, yy + r * 0.7); }
        else { ctx.moveTo(x, yy + r); ctx.lineTo(x + r, yy - r * 0.7); ctx.lineTo(x - r, yy - r * 0.7); }
        ctx.closePath(); ctx.fill();
        if (cw >= 10) { ctx.fillStyle = '#111'; ctx.font = `700 8.5px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(st.label, x, yy + (bull ? 1.5 : -1.5)); ctx.textAlign = 'left'; }
      }
    }
  }

  private drawOI(st: number, subH: number, tLo: number, tHi: number, tEnd: number): { label: string; axis: string } {
    const ctx = this.ctx, D = this.md!.deriv.filter(d => d.oi != null && d.t <= tEnd);
    const vis = D.filter(d => d.t >= tLo - 60_000 && d.t <= tHi + 60_000);
    const last = D[D.length - 1];
    if (vis.length < 2 || !last) return { label: 'Open interest (collecting…)', axis: '' };
    let a = Infinity, b = -Infinity; for (const d of vis) { a = Math.min(a, d.oi!); b = Math.max(b, d.oi!); } if (a === b) { a -= 1; b += 1; }
    const Y = (v: number) => st + 8 + ((b - v) / (b - a)) * (subH - 16);
    ctx.beginPath(); vis.forEach((d, i) => { const x = this.timeToX(d.t); i ? ctx.lineTo(x, Y(d.oi!)) : ctx.moveTo(x, Y(d.oi!)); });
    ctx.strokeStyle = '#e6c84a'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
    const hAgo = D.find(d => d.t >= last.t - 3_600_000), ch = hAgo && hAgo.oi ? ((last.oi! - hAgo.oi) / hAgo.oi) * 100 : 0;
    return { label: `Open interest ${fmtQ(last.oi!)}  ${ch >= 0 ? '+' : ''}${ch.toFixed(2)}% 1h${last.fr != null ? `  ·  funding ${(last.fr * 100).toFixed(4)}%` : ''}`, axis: fmtQ(last.oi!) };
  }

  private drawFootprint(bars: Bar[], first: number, last: number, xOf: (i: number) => number, yOf: (p: number) => number, row: number, pxRow: number, cw: number) {
    const ctx = this.ctx, mode = this.opt.fpMode || 'ba', ratio = this.flow.fpRatio || 3, minV = this.flow.fpMinVol || 0;
    const mul = Math.max(1, Math.ceil(16 / pxRow)), rowPx = pxRow * mul, colW = cw * 0.88, showTxt = cw >= 56 && rowPx >= 11;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (let i = first; i <= last; i++) {
      const c = bars[i], x0 = xOf(i) - colW / 2, up = c.c >= c.o;
      ctx.fillStyle = up ? BULL : BEAR;
      ctx.fillRect(x0, yOf(c.h), 2, Math.max(1, yOf(c.l) - yOf(c.h)));
      const yb = yOf(Math.max(c.o, c.c)); ctx.fillRect(x0 - 1, yb, 5, Math.max(2, yOf(Math.min(c.o, c.c)) - yb));
      if (!c.fp.size) {
        ctx.fillStyle = '#ffffff0c'; ctx.fillRect(x0 + 8, yOf(c.h), colW - 10, Math.max(1, yOf(c.l) - yOf(c.h)));
        if (showTxt) { ctx.fillStyle = '#4a5361'; ctx.font = `10px ${FONT}`; ctx.fillText('no tick data', x0 + colW / 2, (yOf(c.h) + yOf(c.l)) / 2); }
        continue;
      }
      const rows = new Map<number, [number, number]>();
      for (const [k, [s, b]] of c.fp) { const rk = Math.floor(k / mul); const r = rows.get(rk) || [0, 0]; r[0] += s; r[1] += b; rows.set(rk, r); }
      let mx = 0, poc = 0, mxD = 1e-12; for (const [rk, r] of rows) { const t = r[0] + r[1]; if (t > mx) { mx = t; poc = rk; } mxD = Math.max(mxD, Math.abs(r[1] - r[0])); }
      const cx0 = x0 + 8, cW = colW - 10, half = cW / 2;
      for (const [rk, [s, b]] of rows) {
        const yy = yOf((rk + 1) * mul * row - row / 2), h = Math.max(1, rowPx - 1.5), tot = s + b, d = b - s, fs = Math.min(12, rowPx * 0.72);
        if (mode === 'delta') {
          const a = Math.abs(d) / mxD; ctx.fillStyle = d >= 0 ? `rgba(34,197,139,${0.12 + 0.6 * a})` : `rgba(139,92,246,${0.15 + 0.65 * a})`; ctx.fillRect(cx0, yy + 1, cW, h);
          if (showTxt) { ctx.font = `${a > 0.6 ? '700 ' : ''}${fs}px ${MONO}`; ctx.fillStyle = '#f2f2f2'; ctx.fillText((d > 0 ? '+' : '') + fmtQ(d), cx0 + half, yy + 1 + h / 2); }
        } else if (mode === 'vol') {
          ctx.fillStyle = b >= s ? 'rgba(34,197,139,0.45)' : 'rgba(139,92,246,0.5)'; ctx.fillRect(cx0, yy + 1, Math.max(3, (tot / mx) * cW), h);
          if (showTxt) { ctx.font = `${fs}px ${MONO}`; ctx.fillStyle = '#f2f2f2'; ctx.textAlign = 'left'; ctx.fillText(fmtQ(tot), cx0 + 4, yy + 1 + h / 2); ctx.textAlign = 'center'; }
        } else {
          const strong = Math.abs(d) / (tot || 1) > 0.45 && tot > mx * 0.35;
          ctx.fillStyle = b >= s ? (strong ? 'rgba(34,197,139,0.75)' : 'rgba(34,197,139,0.35)') : (strong ? 'rgba(139,92,246,0.8)' : 'rgba(139,92,246,0.38)');
          ctx.fillRect(cx0, yy + 1, Math.max(4, (tot / mx) * half), h);
          if (showTxt) {
            const below = rows.get(rk - 1), above = rows.get(rk + 1);
            const imbB = !!below && b > below[0] * ratio && b > 0 && b >= minV, imbS = !!above && s > above[1] * ratio && s > 0 && s >= minV;
            ctx.font = `${imbS ? '700 ' : ''}${fs}px ${MONO}`; ctx.fillStyle = imbS ? '#ff3df5' : '#e9edf2'; ctx.fillText(fmtQ(s), cx0 + half * 0.5, yy + 1 + h / 2);
            ctx.font = `${imbB ? '700 ' : ''}${fs}px ${MONO}`; ctx.fillStyle = imbB ? '#00e5ff' : '#e9edf2'; ctx.fillText(fmtQ(b), cx0 + half * 1.5, yy + 1 + h / 2);
          }
        }
        if (rk === poc) { ctx.strokeStyle = '#e6c84a'; ctx.lineWidth = 1.5; ctx.strokeRect(cx0 + 0.5, yy + 1.5, cW - 1, h - 1); ctx.lineWidth = 1; }
      }
      if (showTxt) { const dl = c.b - c.s; ctx.font = `600 11px ${MONO}`; ctx.fillStyle = dl >= 0 ? BULL : BEAR_HI; ctx.fillText(`Δ ${dl > 0 ? '+' : ''}${fmtQ(dl)}`, x0 + colW / 2, yOf(c.l) + rowPx / 2 + 12); ctx.fillStyle = '#6b7684'; ctx.font = `10.5px ${MONO}`; ctx.fillText(`V ${fmtQ(c.v)}`, x0 + colW / 2, yOf(c.l) + rowPx / 2 + 26); }
    }
    ctx.textAlign = 'left';
  }

  private drawProfile(
    bars: Bar[],
    first: number,
    last: number,
    n: number,
    yOf: (p: number) => number,
    row: number,
    pxRow: number,
    plotW: number,
    mainH: number,
    fmtP: (p: number) => string
  ) {
    const ov = this.opt.ov;
    if (!bars.length || last < 0 || first > last) return;

    if (ov.visp && ov.dlyp) {
      // Both active: Render Visible Range on right edge, Daily (UTC) on left edge
      this.renderSingleProfile(bars, first, last, false, 'right', yOf, row, pxRow, plotW, mainH, fmtP);
      this.renderSingleProfile(bars, first, last, true, 'left', yOf, row, pxRow, plotW, mainH, fmtP);
    } else if (ov.dlyp) {
      // Only Daily active
      this.renderSingleProfile(bars, first, last, true, 'right', yOf, row, pxRow, plotW, mainH, fmtP);
    } else if (ov.visp) {
      // Only Visible Range active
      this.renderSingleProfile(bars, first, last, false, 'right', yOf, row, pxRow, plotW, mainH, fmtP);
    }
  }

  private renderSingleProfile(
    bars: Bar[],
    first: number,
    last: number,
    isDaily: boolean,
    side: 'right' | 'left',
    yOf: (p: number) => number,
    row: number,
    pxRow: number,
    plotW: number,
    mainH: number,
    fmtP: (p: number) => string
  ) {
    const ctx = this.ctx, f = this.flow;

    // 1. Resolve start bar index (strict UTC 00:00:00 boundary for Daily VP)
    let f0 = first;
    if (isDaily) {
      const d0 = new Date(bars[last].t);
      d0.setUTCHours(0, 0, 0, 0);
      const dayStartMs = d0.getTime();
      f0 = last;
      while (f0 > 0 && bars[f0 - 1].t >= dayStartMs) f0--;
    }
    if (f0 > last) return;

    // 2. High-precision volume aggregation with smooth body-weighted distribution on historical klines
    const rawProf = new Map<number, { s: number; b: number; tot: number }>();
    let totVol = 0, totBuy = 0, totSell = 0;
    const addRaw = (k: number, s: number, b: number) => {
      let r = rawProf.get(k);
      if (!r) { r = { s: 0, b: 0, tot: 0 }; rawProf.set(k, r); }
      r.s += s; r.b += b; r.tot += s + b;
      totVol += s + b; totBuy += b; totSell += s;
    };

    for (let i = f0; i <= last; i++) {
      const c = bars[i];
      if (c.fp && c.fp.size > 0) {
        for (const [k, [s, b]] of c.fp) addRaw(k, s, b);
      } else {
        const kLo = Math.floor(c.l / row), kHi = Math.ceil(c.h / row);
        const bLo = Math.floor(Math.min(c.o, c.c) / row), bHi = Math.ceil(Math.max(c.o, c.c) / row);
        let wSum = 0;
        for (let k = kLo; k <= kHi; k++) wSum += (k >= bLo && k <= bHi) ? 2 : 1;
        if (wSum > 0) {
          const sUnit = c.s / wSum, bUnit = c.b / wSum;
          for (let k = kLo; k <= kHi; k++) {
            const w = (k >= bLo && k <= bHi) ? 2 : 1;
            addRaw(k, sUnit * w, bUnit * w);
          }
        }
      }
    }
    if (!rawProf.size || totVol <= 0) return;

    // 3. Screen-Adaptive Binning (Target ~4.5px per visual bin to prevent muddy sub-pixel overdraw)
    const targetBinPx = 4.5;
    const kGroup = Math.max(1, Math.round(targetBinPx / Math.max(0.001, pxRow)));
    const binH = Math.max(2, Math.min(pxRow * kGroup - 0.8, 30));

    const binnedProf = new Map<number, { s: number; b: number; tot: number; price: number }>();
    for (const [k, v] of rawProf) {
      const binKey = Math.floor(k / kGroup) * kGroup;
      let bin = binnedProf.get(binKey);
      if (!bin) {
        bin = { s: 0, b: 0, tot: 0, price: (binKey + (kGroup - 1) / 2) * row };
        binnedProf.set(binKey, bin);
      }
      bin.s += v.s; bin.b += v.b; bin.tot += v.tot;
    }

    // 4. Find POC, Delta POC, and Max Volume
    let maxBinVol = 0, pocKey = 0, maxDelta = 0, deltaPocKey = 0;
    for (const [bk, bin] of binnedProf) {
      if (bin.tot > maxBinVol) { maxBinVol = bin.tot; pocKey = bk; }
      const d = Math.abs(bin.b - bin.s);
      if (d > maxDelta) { maxDelta = d; deltaPocKey = bk; }
    }
    if (maxBinVol <= 0) return;

    // 5. Contiguous Auction Theory Value Area Expansion (default 70%)
    const binKeys = [...binnedProf.keys()].sort((a, b) => a - b);
    const pocIdx = binKeys.indexOf(pocKey);
    const vaPct = Math.max(0.5, Math.min(0.95, (f?.vpVaPct || 70) / 100));
    const targetVa = totVol * vaPct;

    const inVaSet = new Set<number>();
    inVaSet.add(pocKey);
    let curVaVol = binnedProf.get(pocKey)!.tot;
    let up = pocIdx + 1, dn = pocIdx - 1;
    while (curVaVol < targetVa && (up < binKeys.length || dn >= 0)) {
      const upVol = up < binKeys.length ? binnedProf.get(binKeys[up])!.tot : -1;
      const dnVol = dn >= 0 ? binnedProf.get(binKeys[dn])!.tot : -1;
      if (upVol > dnVol || dn < 0) {
        inVaSet.add(binKeys[up]);
        curVaVol += upVol;
        up++;
      } else {
        inVaSet.add(binKeys[dn]);
        curVaVol += dnVol;
        dn--;
      }
    }

    const pocPrice = binnedProf.get(pocKey)!.price;
    const deltaPocPrice = binnedProf.get(deltaPocKey)!.price;
    const valPrice = binnedProf.get(binKeys[Math.max(0, dn + 1)])!.price;
    const vahPrice = binnedProf.get(binKeys[Math.min(binKeys.length - 1, up - 1)])!.price;

    // 6. Layout geometry & Deepcharts split mode support
    const maxW = Math.min(plotW * 0.42, Math.max(130, plotW * ((f?.vpWidth || 22) / 100)));
    const vpMode = f?.vpMode || 'split';
    const isSplit = vpMode === 'split';

    // 7. Render Volume & Delta Profile Bars
    for (const [bk, bin] of binnedProf) {
      const yy = Math.round(yOf(bin.price));
      if (yy < -20 || yy > mainH + 20) continue;
      const yTop = Math.round(yy - binH / 2);
      const inVa = inVaSet.has(bk);
      const isPoc = (bk === pocKey);
      const isHvn = bin.tot >= maxBinVol * 0.85;

      // Normal Volume Profile
      if (vpMode === 'split' || vpMode === 'normal') {
        const allocW = isSplit ? maxW * 0.65 : maxW;
        const wNorm = Math.max(2, (bin.tot / maxBinVol) * allocW);
        const buyRatio = bin.b / (bin.tot || 1);
        const wBuy = wNorm * buyRatio;
        const wSell = wNorm - wBuy;

        let buyCol: string, sellCol: string;
        if (isPoc) {
          buyCol = 'rgba(230, 200, 74, 0.95)';
          sellCol = 'rgba(215, 175, 45, 0.95)';
        } else if (inVa) {
          buyCol = 'rgba(46, 189, 133, 0.82)'; // Vibrant emerald green inside VA
          sellCol = 'rgba(168, 85, 247, 0.82)'; // Vibrant purple inside VA
        } else {
          buyCol = 'rgba(46, 189, 133, 0.28)'; // Muted outside VA
          sellCol = 'rgba(168, 85, 247, 0.28)';
        }

        if (side === 'right') {
          const barLeft = plotW - wNorm;
          ctx.fillStyle = sellCol;
          ctx.fillRect(barLeft, yTop, wSell, binH);
          ctx.fillStyle = buyCol;
          ctx.fillRect(barLeft + wSell, yTop, wBuy, binH);

          // Deepcharts red HVN spike accent
          if (isHvn && !isPoc) {
            ctx.fillStyle = '#eb2f2f';
            ctx.fillRect(barLeft - 3, yTop, 3, binH);
          }
        } else {
          // Left side
          ctx.fillStyle = buyCol;
          ctx.fillRect(0, yTop, wBuy, binH);
          ctx.fillStyle = sellCol;
          ctx.fillRect(wBuy, yTop, wSell, binH);
          if (isHvn && !isPoc) {
            ctx.fillStyle = '#eb2f2f';
            ctx.fillRect(wNorm, yTop, 3, binH);
          }
        }
      }

      // Delta Profile (Left portion in split mode, or full width in delta mode)
      if (vpMode === 'split' || vpMode === 'delta') {
        const allocW = isSplit ? maxW * 0.32 : maxW;
        const delta = bin.b - bin.s;
        const absDelta = Math.abs(delta);
        const wDelta = Math.max(1, (absDelta / (maxDelta || 1)) * allocW);
        const isPos = delta >= 0;

        let dCol: string;
        if (isPos) {
          dCol = inVa ? 'rgba(34, 197, 139, 0.90)' : 'rgba(34, 197, 139, 0.35)';
        } else {
          dCol = inVa ? 'rgba(168, 85, 247, 0.90)' : 'rgba(168, 85, 247, 0.35)';
        }

        if (side === 'right') {
          const deltaBase = plotW - maxW;
          ctx.fillStyle = dCol;
          ctx.fillRect(deltaBase, yTop, wDelta, binH);
        } else {
          const deltaBase = maxW;
          ctx.fillStyle = dCol;
          ctx.fillRect(deltaBase - wDelta, yTop, wDelta, binH);
        }
      }
    }

    // 8. Outer Contour Line (Deepcharts / dxFeed style)
    ctx.strokeStyle = 'rgba(229, 207, 122, 0.40)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (const bk of binKeys) {
      const bin = binnedProf.get(bk)!;
      const yy = Math.round(yOf(bin.price));
      if (yy < 0 || yy > mainH) continue;
      const allocW = isSplit ? maxW * 0.65 : maxW;
      const wNorm = Math.max(2, (bin.tot / maxBinVol) * allocW);
      const tipX = side === 'right' ? plotW - wNorm : wNorm;
      if (!started) { ctx.moveTo(tipX, yy); started = true; }
      else { ctx.lineTo(tipX, yy); }
    }
    if (started) ctx.stroke();

    // 9. Key Levels Lines (POC, VAH, VAL)
    const yyPoc = Math.round(yOf(pocPrice));
    if (yyPoc >= 0 && yyPoc <= mainH) {
      // Dotted projection line across entire chart
      ctx.strokeStyle = 'rgba(230, 200, 74, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yyPoc);
      ctx.lineTo(plotW, yyPoc);
      ctx.stroke();
      ctx.setLineDash([]);

      // Solid bright POC line across profile
      ctx.strokeStyle = '#e6c84a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (side === 'right') {
        ctx.moveTo(plotW - maxW, yyPoc);
        ctx.lineTo(plotW, yyPoc);
      } else {
        ctx.moveTo(0, yyPoc);
        ctx.lineTo(maxW, yyPoc);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    const yyVah = Math.round(yOf(vahPrice));
    if (yyVah >= 0 && yyVah <= mainH) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(side === 'right' ? plotW - maxW : 0, yyVah);
      ctx.lineTo(side === 'right' ? plotW : maxW, yyVah);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const yyVal = Math.round(yOf(valPrice));
    if (yyVal >= 0 && yyVal <= mainH) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(side === 'right' ? plotW - maxW : 0, yyVal);
      ctx.lineTo(side === 'right' ? plotW : maxW, yyVal);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 10. Tags for POC, VAH, VAL
    const drawVpTag = (x: number, y: number, s: string, bgc: string, fg: string, align: 'left' | 'right') => {
      if (!isFinite(y) || y < 0 || y > mainH) return;
      ctx.font = `600 10px ${FONT}`;
      const tw = ctx.measureText(s).width + 8;
      const tagX = align === 'right' ? x - tw : x;
      ctx.fillStyle = bgc;
      ctx.fillRect(tagX, y - 7.5, tw, 15);
      ctx.fillStyle = fg;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(s, tagX + 4, y);
    };

    const prefix = isDaily ? 'D-' : '';
    if (side === 'right') {
      drawVpTag(plotW, yyPoc, `${prefix}POC ${fmtP(pocPrice)} (${fmtQ(binnedProf.get(pocKey)!.tot)})`, '#e6c84a', '#111315', 'right');
      drawVpTag(plotW, yyVah, `${prefix}VAH ${fmtP(vahPrice)}`, '#0369a1', '#f0f9ff', 'right');
      drawVpTag(plotW, yyVal, `${prefix}VAL ${fmtP(valPrice)}`, '#0369a1', '#f0f9ff', 'right');
      if (isSplit && deltaPocPrice !== pocPrice) {
        const yyDeltaPoc = Math.round(yOf(deltaPocPrice));
        if (yyDeltaPoc >= 0 && yyDeltaPoc <= mainH) {
          drawVpTag(plotW - maxW * 0.65, yyDeltaPoc, `ΔPOC ${fmtP(deltaPocPrice)}`, '#7c3aed', '#ffffff', 'right');
        }
      }
    } else {
      drawVpTag(0, yyPoc, `${prefix}POC ${fmtP(pocPrice)} (${fmtQ(binnedProf.get(pocKey)!.tot)})`, '#e6c84a', '#111315', 'left');
      drawVpTag(0, yyVah, `${prefix}VAH ${fmtP(vahPrice)}`, '#0369a1', '#f0f9ff', 'left');
      drawVpTag(0, yyVal, `${prefix}VAL ${fmtP(valPrice)}`, '#0369a1', '#f0f9ff', 'left');
    }

    // 11. Sleek Glass Header Info Badge
    const netDelta = totBuy - totSell;
    const buyPct = Math.round((totBuy / (totVol || 1)) * 100);
    const sellPct = 100 - buyPct;
    const title = isDaily ? 'DAILY VP (UTC)' : 'VISIBLE VP';
    const badgeText = `${title}  ·  Vol: ${fmtQ(totVol)}  ·  Buy: ${buyPct}%  ·  Sell: ${sellPct}%  ·  Δ: ${netDelta >= 0 ? '+' : ''}${fmtQ(netDelta)}`;

    ctx.font = `600 10.5px ${FONT}`;
    const bW = ctx.measureText(badgeText).width + 24;
    const bX = side === 'right' ? plotW - bW - 8 : 8;
    const bY = 8;

    ctx.fillStyle = 'rgba(18, 20, 24, 0.88)';
    if (typeof (ctx as any).roundRect === 'function') {
      ctx.beginPath();
      (ctx as any).roundRect(bX, bY, bW, 20, 4);
      ctx.fill();
    } else {
      ctx.fillRect(bX, bY, bW, 20);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Dot indicator
    ctx.fillStyle = isDaily ? '#38bdf8' : '#2ebd85';
    ctx.beginPath();
    ctx.arc(bX + 10, bY + 10, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(badgeText, bX + 18, bY + 10);
  }

  private drawImbalanceZones(bars: Bar[], first: number, last: number, xOf: (i: number) => number, yOf: (p: number) => number, row: number, plotW: number, cw: number) {
    const ctx = this.ctx, n = bars.length, ratio = this.flow.fpRatio || 3, minV = this.flow.fpMinVol || 0, zones: { i: number; lo: number; hi: number; side: 1 | -1 }[] = [];
    for (let i = Math.max(0, first - 200); i <= last; i++) {
      const c = bars[i]; if (c.fp.size < 4) continue; const ks = [...c.fp.keys()].sort((a, b) => a - b);
      let rb = 0, bS = 0, bE = 0, rs = 0, sS = 0, sE = 0;
      for (let j = 1; j <= ks.length; j++) {
        const cur = j < ks.length ? c.fp.get(ks[j])! : null, prev = c.fp.get(ks[j - 1])!, adj = !!cur && ks[j] === ks[j - 1] + 1;
        if (adj && cur![1] > prev[0] * ratio && cur![1] > 0 && cur![1] >= minV) { if (!rb) bS = ks[j]; bE = ks[j]; rb++; } else { if (rb >= 3) zones.push({ i, lo: (bS - 0.5) * row, hi: (bE + 0.5) * row, side: 1 }); rb = 0; }
        if (adj && prev[0] > cur![1] * ratio && prev[0] > 0 && prev[0] >= minV) { if (!rs) sS = ks[j - 1]; sE = ks[j - 1]; rs++; } else { if (rs >= 3) zones.push({ i, lo: (sS - 0.5) * row, hi: (sE + 0.5) * row, side: -1 }); rs = 0; }
      }
    }
    for (const z of zones) {
      let end = n;
      for (let j = z.i + 1; j < n; j++) if (z.side > 0 ? bars[j].l < z.lo : bars[j].h > z.hi) { end = j; break; }
      if (end < first) continue;
      const x1 = xOf(z.i) - cw / 2, x2 = end >= n ? plotW : xOf(end), y1 = yOf(z.hi), y2 = yOf(z.lo), open = end >= n;
      const col = z.side > 0 ? '0,229,255' : '255,61,245';
      ctx.fillStyle = `rgba(${col},${open ? 0.16 : 0.07})`; ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillStyle = `rgba(${col},${open ? 0.9 : 0.4})`; ctx.fillRect(x1, y1, 2, y2 - y1);
      if (open) { ctx.strokeStyle = `rgba(${col},0.55)`; ctx.beginPath(); ctx.moveTo(x1, y1 + 0.5); ctx.lineTo(x2, y1 + 0.5); ctx.moveTo(x1, y2 - 0.5); ctx.lineTo(x2, y2 - 0.5); ctx.stroke(); }
    }
  }

  private drawWalls(yOf: (p: number) => number, plotW: number, mainH: number, row: number, xLast: number) {
    const ctx = this.ctx, md = this.md!, lv = new Map<number, [number, 1 | -1]>();
    for (const [p, q] of md.book.b) { const k = Math.floor(p / row); const e = lv.get(k) || [0, 1]; e[0] += q; lv.set(k, e); }
    for (const [p, q] of md.book.a) { const k = Math.floor(p / row); const e = lv.get(k) || [0, -1]; e[0] += q; e[1] = -1; lv.set(k, e); }
    if (lv.size < 6) return;
    const sizes = [...lv.values()].map(e => e[0]).sort((a, b) => a - b), med = sizes[sizes.length >> 1] || 1, mx = sizes[sizes.length - 1];
    const pick = (side: 1 | -1) => [...lv.entries()].filter(([, e]) => e[1] === side && e[0] >= med * 3).sort((a, b) => b[1][0] - a[1][0]).slice(0, 3);
    ctx.font = `600 10.5px ${MONO}`; ctx.textBaseline = 'middle';
    for (const [k, [q, side]] of [...pick(1), ...pick(-1)]) {
      const yy = yOf((k + 0.5) * row); if (yy < 4 || yy > mainH - 4) continue;
      const col = side > 0 ? '34,197,139' : '164,124,242', w = 1 + 3 * (q / mx), x0 = Math.max(0, xLast + 6);
      ctx.strokeStyle = `rgba(${col},0.18)`; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(x0, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(${col},0.75)`; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); ctx.lineWidth = 1;
      const s = `${side > 0 ? 'BID' : 'ASK'} ${fmtQ(q)}`, tw = ctx.measureText(s).width + 10;
      ctx.fillStyle = side > 0 ? '#14684a' : '#4b2d86'; ctx.fillRect(plotW - tw - 4, yy - 8, tw, 16); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(s, plotW - tw + 1, yy);
    }
  }

  /* ================================================================ interaction */
  private handlers: [string, any, any?][] = [];
  private on(t: EventTarget, ev: string, f: any, opt?: any) { t.addEventListener(ev, f, opt); this.handlers.push([ev, f, t]); }
  private unbind() { for (const [ev, f, t] of this.handlers) (t as EventTarget).removeEventListener(ev, f); this.handlers = []; }

  private pos(e: MouseEvent) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private curY() { const G = this.G; return this.view.y || { mid: (G.hi + G.lo) / 2, span: G.hi - G.lo }; }
  private ptAt(x: number, y: number, e?: MouseEvent): Pt {
    let t = this.xToTime(x), p = this.G.pOf(y);
    if (this.opt.magnet && !(e && (e.ctrlKey || e.metaKey))) {
      const i = Math.round(this.G.iOf(x)), c = this.G.bars[i];
      if (c) { let best = p, bd = 14; for (const v of [c.o, c.h, c.l, c.c]) { const d = Math.abs(this.G.yOf(v) - y); if (d < bd) { bd = d; best = v; } } if (best !== p) { p = best; t = c.t; } }
    }
    return { t, p };
  }
  private hitTop(x: number, y: number): Drawing | null {
    if (this.hidden) return null;
    const V = this.dview();
    const s = this.selected(); if (s && !s.hidden && hitDrawing(s, V, x, y, true) < 6) return s;
    for (let i = this.drawings.length - 1; i >= 0; i--) { const d = this.drawings[i]; if (!d.hidden && hitDrawing(d, V, x, y) < 6) return d; }
    return null;
  }
  private handleAt(x: number, y: number): number {
    const s = this.selected(); if (!s || s.locked) return -1;
    const hs = handlesOf(s, this.dview());
    for (let i = 0; i < hs.length; i++) if (Math.hypot(hs[i][0] - x, hs[i][1] - y) < 8) return i;
    return -1;
  }
  private commit(d: Drawing) {
    const def = TOOL_MAP.get(d.type)!;
    if (def.init) def.init(d, this.dview());
    this.snapshot(); this.drawings.push(d); this.creating = null; this.createDown = null;
    this.changed(); this.select(d.id); if (!this.flow.keepTool) this.setTool('cursor');
  }
  private newDrawing(type: string, pt: Pt): Drawing {
    const def = TOOL_MAP.get(type)!;
    return { id: uid(), type, pts: [pt], color: def.color || '#e6e6e6', width: def.width || 1.5, dash: 0, fill: def.fill, text: def.text };
  }

  private bindEvents() {
    const cv = this.cv;
    cv.tabIndex = 0;
    this.on(cv, 'mousedown', (e: MouseEvent) => {
      if (e.button !== 0 || !this.G.bars?.length) return;
      cv.focus();
      const { x, y } = this.pos(e), G = this.G, base = { x, y, off: this.view.off, cw: this.view.cw, y0: this.curY() };
      if (x > G.plotW && y < G.mainH) { this.drag = { kind: 'yaxis', ...base }; return; }
      if (y > this.H - 24) { this.drag = { kind: 'xaxis', ...base }; return; }
      if (y > G.mainH) { this.drag = { kind: 'pan', ...base }; return; }
      const pt = this.ptAt(x, y, e);
      if (this.tool !== 'cursor') {
        const def = TOOL_MAP.get(this.tool); if (!def) return;
        if (def.n === 1) return this.commit(this.newDrawing(this.tool, pt));
        if (def.n === 0) { this.creating = this.newDrawing(this.tool, pt); this.createDown = { x, y }; return; }
        if (!this.creating) { this.creating = this.newDrawing(this.tool, pt); this.creating.pts.push({ ...pt }); this.createDown = { x, y }; return; }
        const c = this.creating; c.pts[c.pts.length - 1] = pt;
        if (def.n > 0 && c.pts.length >= def.n) return this.commit(c);
        c.pts.push({ ...pt }); this.dirty = true; return;
      }
      const hi = this.handleAt(x, y), s = this.selected();
      if (hi >= 0 && s) {
        this.snapshot();
        if (s.type === 'brush' || s.type === 'highlighter') this.drag = { kind: 'move', ...base, orig: s.pts.map(p => ({ ...p })), t0: pt.t, p0: G.pOf(y) };
        else this.drag = { kind: 'handle', ...base, hi };
        return;
      }
      const hit = this.hitTop(x, y);
      if (hit) {
        this.select(hit.id);
        if (!hit.locked) { this.snapshot(); this.drag = { kind: 'move', ...base, orig: hit.pts.map(p => ({ ...p })), t0: this.xToTime(x), p0: G.pOf(y) }; }
        return;
      }
      if (this.sel) this.select(null);
      this.drag = { kind: 'pan', ...base };
      cv.style.cursor = 'grabbing';
    });
    this.on(window, 'mousemove', (e: MouseEvent) => {
      const m = this.pos(e), inside = m.x >= 0 && m.y >= 0 && m.x <= this.W && m.y <= this.H;
      const prevMouse = this.mouse; this.mouse = inside ? m : null;
      if (inside || prevMouse) this.dirty = true;
      if (!inside && prevMouse && this.lastCross != null) { this.lastCross = null; this.cb.cross?.(null); }
      const d = this.drag, G = this.G;
      if (d) {
        if (d.kind === 'yaxis') { this.view.auto = false; this.view.y = { mid: d.y0.mid, span: d.y0.span * Math.exp((m.y - d.y) / 160) }; }
        else if (d.kind === 'xaxis') { this.view.cw = clamp(d.cw * Math.exp((m.x - d.x) / 140), MIN_CW, MAX_CW); }
        else if (d.kind === 'pan') {
          this.view.off = d.off + (m.x - d.x) / this.view.cw;
          if (!this.view.auto) this.view.y = { mid: d.y0.mid + ((m.y - d.y) / G.mainH) * d.y0.span, span: d.y0.span };
        } else if (d.kind === 'move') {
          const s = this.selected(); if (s && d.orig) { const dt = this.xToTime(m.x) - d.t0!, dp = G.pOf(m.y) - d.p0!; s.pts = d.orig.map(p => ({ t: p.t + dt, p: p.p + dp })); }
        } else if (d.kind === 'handle') {
          const s = this.selected(); if (s) { const pt = this.ptAt(m.x, m.y, e), def = TOOL_MAP.get(s.type); if (def?.moveHandle) def.moveHandle(s, d.hi!, pt); else s.pts[d.hi!] = pt; }
        }
        this.dirty = true;
        return;
      }
      if (this.creating && inside) {
        const def = TOOL_MAP.get(this.creating.type)!, pt = this.ptAt(m.x, m.y, e);
        if (def.n === 0) { const lp = this.creating.pts[this.creating.pts.length - 1]; if (Math.hypot(this.timeToX(lp.t) - m.x, G.yOf(lp.p) - m.y) > 3) this.creating.pts.push(pt); }
        else this.creating.pts[this.creating.pts.length - 1] = pt;
        return;
      }
      if (!inside || !G.plotW) return;
      if (m.x >= G.plotW && m.y < G.mainH) cv.style.cursor = 'ns-resize';
      else if (m.y > this.H - 24) cv.style.cursor = 'ew-resize';
      else if (this.tool === 'cursor' && m.y < G.mainH) {
        const h = this.hitTop(m.x, m.y), hid = h ? h.id : null;
        if (hid !== this.hoverId) { this.hoverId = hid; this.dirty = true; }
        const hi = this.handleAt(m.x, m.y);
        if (hi >= 0) {
          const s = this.selected();
          if (s?.type === 'fixedvp') {
            if (hi === 0 || hi === 3) cv.style.cursor = 'nwse-resize';
            else if (hi === 1 || hi === 2) cv.style.cursor = 'nesw-resize';
            else if (hi >= 4 && hi <= 7) cv.style.cursor = 'ns-resize';
            else if (hi === 8 || hi === 9) cv.style.cursor = 'ew-resize';
            else cv.style.cursor = 'move';
          } else {
            if (hi === 0 || hi === 7) cv.style.cursor = 'nwse-resize';
            else if (hi === 2 || hi === 5) cv.style.cursor = 'nesw-resize';
            else if (hi === 1 || hi === 6) cv.style.cursor = 'ns-resize';
            else if (hi === 3 || hi === 4) cv.style.cursor = 'ew-resize';
            else cv.style.cursor = 'move';
          }
        } else {
          cv.style.cursor = h ? 'pointer' : 'crosshair';
        }
      }
      else if (this.tool === 'cursor') cv.style.cursor = 'default';
    });
    this.on(window, 'mouseup', (e: MouseEvent) => {
      const d = this.drag; this.drag = null;
      if (d && (d.kind === 'move' || d.kind === 'handle')) this.changed();
      if (d) this.dirty = true;
      if (this.creating && this.createDown) {
        const m = this.pos(e), def = TOOL_MAP.get(this.creating.type)!, moved = Math.hypot(m.x - this.createDown.x, m.y - this.createDown.y) > 6;
        if (def.n === 0) { if (this.creating.pts.length > 1) this.commit(this.creating); else this.creating = null; return; }
        if (moved && def.n === 2) return this.commit(this.creating);
        if (moved && def.n === 3 && this.creating.pts.length === 2) { this.creating.pts.push({ ...this.creating.pts[1] }); }
        this.createDown = null;
      }
    });
    this.on(cv, 'dblclick', (e: MouseEvent) => {
      if (this.creating) { const def = TOOL_MAP.get(this.creating.type)!; if (def.n === -1 && this.creating.pts.length > 2) { this.creating.pts.pop(); this.commit(this.creating); } return; }
      const { x, y } = this.pos(e);
      if (x > this.G.plotW && y < this.G.mainH) return this.setAutoScale(true);
      if (y > this.H - 24) return this.reset();
      if (!this.hitTop(x, y)) this.goLive();
    });
    this.on(cv, 'wheel', (e: WheelEvent) => {
      e.preventDefault(); const G = this.G; if (!G.bars?.length) return;
      const { x, y } = this.pos(e), unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if ((x > G.plotW && y < G.mainH) || e.altKey) {
        const f = clamp(Math.exp(dy * 0.0015), 0.7, 1.4), c = this.curY();
        this.view.auto = false; this.view.y = { mid: c.mid, span: c.span * f };
      } else if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
        this.view.off -= (e.shiftKey ? dy : dx) / this.view.cw;
      } else {
        this.zoomAt(clamp(Math.exp(-dy * 0.0015), 0.7, 1.4), Math.min(x, G.plotW));
      }
      this.dirty = true;
    }, { passive: false });
    this.on(cv, 'mouseleave', () => { this.mouse = null; this.hoverId = null; this.dirty = true; if (this.lastCross != null) { this.lastCross = null; this.cb.cross?.(null); } });
    this.on(cv, 'contextmenu', (e: MouseEvent) => { e.preventDefault(); const { x, y } = this.pos(e); const hit = this.hitTop(x, y); if (hit) this.select(hit.id); this.cb.context?.(e, this.G.pOf ? this.G.pOf(y) : 0); });
    this.on(cv, 'keydown', (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'Escape') { this.creating = null; this.setTool('cursor'); this.select(null); }
      else if ((k === 'Delete' || k === 'Backspace') && this.sel) { e.preventDefault(); this.deleteSelected(); }
      else if (k === 'Enter' && this.creating) { const def = TOOL_MAP.get(this.creating.type)!; if (def.n === -1 && this.creating.pts.length > 2) { this.creating.pts.pop(); this.commit(this.creating); } }
      else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redoDraw() : this.undoDraw(); }
      else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); this.redoDraw(); }
      else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd' && this.sel) { e.preventDefault(); this.cloneSelected(); }
      else if (k === 'ArrowLeft') { e.preventDefault(); this.scrollBars(e.shiftKey ? 20 : 3); }
      else if (k === 'ArrowRight') { e.preventDefault(); this.scrollBars(e.shiftKey ? -20 : -3); }
      else if (k === 'ArrowUp' || k === '+' || k === '=') { e.preventDefault(); this.zoomIn(); }
      else if (k === 'ArrowDown' || k === '-') { e.preventDefault(); this.zoomOut(); }
      else if (k === 'Home') { e.preventDefault(); this.reset(); }
      else if (k === 'End') { e.preventDefault(); this.goLive(); }
    });
  }

  screenshot(): string { return this.cv.toDataURL('image/png'); }
}
