/**
 * Chart workspace chrome:
 *   InstrumentBar  market, live price, day stats, derivatives, recent markets
 *   ChartToolbar   timeframe, chart type, indicators, view tools
 *   StatusLine     connection, venues, latency, message rate, clocks
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { I, Kbd } from './ui/Icons';
import { fmtQ, fmtPx } from '../lib/format';
import { BAR_SPECS, specKey, specLabel } from '../data/bars';
import type { MarketData } from '../data/client';
import type { Bar, ChartStyle, FpMode, Overlays, SymbolInfo } from '../lib/types';
import type { Script } from '../indicators/runtime';
import { settings, openSymbol } from '../lib/settings';
import { openPalette, overlays } from '../lib/commands';
import { OV_GROUPS, STYLES, FAV_TF } from './workspace/meta';
import { data, net } from '../data/client';

function useTick(ms: number) { const [, f] = useReducer(x => x + 1, 0); useEffect(() => { const h = setInterval(f, ms); return () => clearInterval(h); }, [ms]); }
const DAY = 86_400_000;

/* ================================================================ instrument bar */
export function InstrumentBar({ sym, md, bars }: { sym?: SymbolInfo; md: MarketData | null; bars: () => Bar[] }) {
  useTick(500);
  const watch = settings.use(s => s.watch), recent = settings.use(s => s.ui.recent), syms = net.use(s => s.symbols);
  const prev = useRef(0), dir = useRef<0 | 1 | -1>(0);
  const b = bars(), dec = sym?.dec ?? 2;
  const last = md?.lastPrice || b[b.length - 1]?.c || 0;
  if (last && last !== prev.current) { dir.current = last > prev.current ? 1 : -1; prev.current = last; }
  const d0 = Math.floor((b[b.length - 1]?.t ?? Date.now()) / DAY) * DAY;
  let open = NaN, hi = -Infinity, lo = Infinity, vol = 0, delta = 0;
  for (let i = b.length - 1; i >= 0 && b[i].t >= d0; i--) { open = b[i].o; hi = Math.max(hi, b[i].h); lo = Math.min(lo, b[i].l); vol += b[i].v; delta += b[i].est ? 0 : b[i].b - b[i].s; }
  const ch = isFinite(open) ? last - open : 0, pct = open ? (ch / open) * 100 : 0, upDay = ch >= 0;
  const dv = md?.lastDeriv();
  const range = isFinite(hi) && hi > lo ? ((last - lo) / (hi - lo)) * 100 : 50;
  const starred = !!sym && watch.includes(sym.id);
  const real = sym?.volume === 'real';
  const others = recent.filter(r => r !== sym?.id).slice(0, 4);

  return (
    <div className="ibar">
      <button className="ib-sym" onClick={() => openPalette('symbols')} title="Change market ( / )">
        <span className={`ib-cls ${sym?.cls || ''}`}>{(sym?.cls || '··').slice(0, 3).toUpperCase()}</span>
        <span className="ib-name"><b>{sym?.id || 'Loading…'}</b><small>{sym?.venues}</small></span>
        <I n="chevDown" s={14} />
      </button>
      <button className={`ib-star ${starred ? 'on' : ''}`} title={starred ? 'Remove from watchlist' : 'Add to watchlist'} aria-pressed={starred}
        onClick={() => sym && settings.set(s => ({ watch: starred ? s.watch.filter(x => x !== sym.id) : [...s.watch, sym.id] }))}><I n="star" s={15} /></button>
      <div className="ib-px">
        <span className={`ib-last mono ${dir.current > 0 ? 'up' : dir.current < 0 ? 'dn' : ''}`} key={last}>{last ? fmtPx(last, dec) : '—'}</span>
        <span className={`ib-chg mono ${upDay ? 'up' : 'dn'}`}><I n={upDay ? 'up' : 'down'} s={12} />{upDay ? '+' : ''}{fmtPx(ch, dec)} ({upDay ? '+' : ''}{pct.toFixed(2)}%)</span>
      </div>
      <div className="ib-stats">
        <div className="ib-stat range"><small>Day range</small>
          <div className="rng"><span className="mono">{isFinite(lo) ? fmtPx(lo, dec) : '—'}</span><span className="rng-bar"><i style={{ left: `${Math.max(0, Math.min(100, range))}%` }} /></span><span className="mono">{isFinite(hi) ? fmtPx(hi, dec) : '—'}</span></div>
        </div>
        {real && <div className="ib-stat"><small>Volume</small><b className="mono">{fmtQ(vol)}</b></div>}
        {real && <div className="ib-stat"><small>Delta</small><b className={`mono ${delta >= 0 ? 'up' : 'dn'}`}>{delta >= 0 ? '+' : ''}{fmtQ(delta)}</b></div>}
        {dv?.oi != null && <div className="ib-stat"><small>Open interest</small><b className="mono">{fmtQ(dv.oi)}</b></div>}
        {dv?.fr != null && <div className="ib-stat"><small>Funding</small><b className={`mono ${dv.fr >= 0 ? 'up' : 'dn'}`}>{(dv.fr * 100).toFixed(4)}%</b></div>}
        {!real && sym && <div className="ib-stat"><small>Data</small><b className="warn">Price only</b></div>}
      </div>
      {others.length > 0 && <div className="ib-recent" aria-label="Recent markets">
        {others.map(id => { const s = syms.find(x => x.id === id); return <button key={id} onClick={() => openSymbol(id)} title={s?.desc}>{id}</button>; })}
      </div>}
    </div>
  );
}

/* ================================================================ chart toolbar */
export interface TBProps {
  spec: string; onSpec(k: string): void;
  style: ChartStyle; onStyle(s: ChartStyle): void;
  fpMode: FpMode; onFpMode(m: FpMode): void;
  rowMult: number; rowMults: number[]; rowLabel(m: number): string; onRow(m: number): void;
  ov: Overlays; onOv(k: keyof Overlays): void;
  scripts: Script[]; onScript(id: string): void;
  replaying: boolean; onReplay(): void;
  onSettings(): void;
  onConfigure?(tab: string): void;
  onShare(): void; onShot(): void;
  focus: boolean; onFocus(): void; tray: boolean; onTray(): void;
  sym?: SymbolInfo; md?: MarketData | null; bars?: () => Bar[];
  panel?: string | null; onTrade?(): void;
}

const CONFIGURABLE_OV: Partial<Record<keyof Overlays, string>> = {
  bubbles: 'big',
  visp: 'vp',
  dlyp: 'vp',
  imbl: 'fp',
  walls: 'book',
  book: 'book',
  sessions: 'sess',
  cal: 'cal',
};

function IndicatorsMenu(p: TBProps & { onClose(): void }) {
  const [q, setQ] = useState(''), box = useRef<HTMLDivElement>(null), inp = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inp.current?.focus();
    const c = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.ind-trigger')) p.onClose(); };
    window.addEventListener('mousedown', c); return () => window.removeEventListener('mousedown', c);
  }, []);
  const m = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  return (
    <div className="menu-pop ind-pop" ref={box} role="dialog" aria-label="Indicators">
      <div className="mp-search"><I n="search" s={14} /><input ref={inp} value={q} onChange={e => setQ(e.target.value)} placeholder="Search indicators" onKeyDown={e => e.key === 'Escape' && p.onClose()} /></div>
      <div className="mp-body">
        {OV_GROUPS.map(([g, items]) => {
          const vis = items.filter(([, n, d]) => m(n + d)); if (!vis.length) return null;
          return (
            <div key={g} className="mp-group">
              <h6>{g}</h6>
              {vis.map(([k, n, d]) => {
                const confTab = CONFIGURABLE_OV[k];
                return (
                  <div key={k} className="mp-row-wrap">
                    <button className={`mp-row ${p.ov[k] ? 'on' : ''}`} onClick={() => p.onOv(k)} role="switch" aria-checked={p.ov[k]}>
                      <span className="mp-txt"><b>{n}</b><small>{d}</small></span>
                      <span className={`toggle ${p.ov[k] ? 'on' : ''}`} />
                    </button>
                    {confTab && (
                      <button
                        className="mp-gear"
                        title={`Configure ${n} settings`}
                        aria-label={`Configure ${n} settings`}
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onConfigure?.(confTab);
                          p.onClose();
                        }}
                      >
                        <I n="sliders" s={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="mp-group"><h6>Your scripts</h6>
          {p.scripts.filter(s => m(s.name)).map(s => (
            <button key={s.id} className={`mp-row ${s.on ? 'on' : ''}`} onClick={() => p.onScript(s.id)} role="switch" aria-checked={s.on}>
              <span className="mp-txt"><b>{s.name}</b><small>Custom indicator</small></span><span className={`toggle ${s.on ? 'on' : ''}`} />
            </button>))}
          <a className="mp-link" href="#/indicators"><I n="plus" s={14} />Create or edit scripts</a>
        </div>
      </div>
    </div>
  );
}

const Btn = ({ ic, label, on, onClick, kbd }: { ic: string; label: string; on?: boolean; onClick(): void; kbd?: string }) =>
  <button className={`tbtn tip ${on ? 'on' : ''}`} data-tip={kbd ? `${label}  ${kbd}` : label} aria-label={label} aria-pressed={on} onClick={onClick}><I n={ic} s={16} /></button>;

export function ChartToolbar(p: TBProps) {
  const [open, setOpen] = useState(false);
  const active = (Object.keys(p.ov) as (keyof Overlays)[]).filter(k => p.ov[k]).length + p.scripts.filter(s => s.on).length;
  const more = !FAV_TF.includes(p.spec);

  const b = p.bars ? p.bars() : [];
  const dec = p.sym?.dec ?? 2;
  const last = p.md?.lastPrice || (b.length ? b[b.length - 1].c : 0);
  const d0 = Math.floor((b[b.length - 1]?.t ?? Date.now()) / DAY) * DAY;
  let dayOpen = NaN, hi = -Infinity, lo = Infinity, vol = 0, delta = 0;
  for (let i = b.length - 1; i >= 0 && b[i].t >= d0; i--) {
    dayOpen = b[i].o;
    hi = Math.max(hi, b[i].h);
    lo = Math.min(lo, b[i].l);
    vol += b[i].v;
    delta += b[i].est ? 0 : b[i].b - b[i].s;
  }
  const dv = p.md?.lastDeriv();
  const range = isFinite(hi) && hi > lo ? ((last - lo) / (hi - lo)) * 100 : 50;
  const real = p.sym?.volume === 'real';

  return (
    <div className="ctbar" role="toolbar" aria-label="Chart toolbar">
      <div className="seg2 tf" role="radiogroup" aria-label="Timeframe">
        {FAV_TF.map((k, i) => <button key={k} className={`tip ${p.spec === k ? 'on' : ''}`} data-tip={`Timeframe  ${i + 1}`} onClick={() => p.onSpec(k)}>{specLabel(BAR_SPECS.find(s => specKey(s) === k)!)}</button>)}
        <label className={`seg-sel ${more ? 'on' : ''}`}>
          <span>{more ? specLabel(BAR_SPECS.find(s => specKey(s) === p.spec) || BAR_SPECS[0]) : 'More'}</span><I n="chevDown" s={12} />
          <select value={more ? p.spec : ''} onChange={e => e.target.value && p.onSpec(e.target.value)} aria-label="More bar types">
            <option value="">More bar types</option>
            {BAR_SPECS.filter(s => !FAV_TF.includes(specKey(s))).map(s => <option key={specKey(s)} value={specKey(s)}>{specLabel(s)}</option>)}
          </select>
        </label>
      </div>
      <span className="vr" />
      <div className="seg2" role="radiogroup" aria-label="Chart type">
        {STYLES.map(([k, l, ic, d]) => <button key={k} className={`tip ${p.style === k ? 'on' : ''}`} data-tip={d} onClick={() => p.onStyle(k)}><I n={ic} s={15} /><span className="lbl">{l}</span></button>)}
      </div>
      {p.style === 'footprint' && <div className="seg2 sm" role="radiogroup" aria-label="Footprint cells">
        {([['ba', 'Bid×Ask'], ['delta', 'Delta'], ['vol', 'Volume']] as [FpMode, string][]).map(([m, l]) => <button key={m} className={p.fpMode === m ? 'on' : ''} onClick={() => p.onFpMode(m)}>{l}</button>)}
      </div>}
      {p.style !== 'candles' && <label className="pill-sel tip" data-tip="Price row size"><span className="muted">Row</span><b className="mono">{p.rowLabel(p.rowMult)}</b><I n="chevDown" s={12} />
        <select value={p.rowMult} onChange={e => p.onRow(+e.target.value)} aria-label="Price row size">{p.rowMults.map(m => <option key={m} value={m}>{p.rowLabel(m)}</option>)}</select></label>}
      <span className="vr" />
      <div className="anchor">
        <button className={`tbtn wide ind-trigger ${open ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}><I n="fx" s={16} />Indicators<span className="count mono">{active}</span></button>
        {open && <IndicatorsMenu {...p} onClose={() => setOpen(false)} />}
      </div>
      <Btn ic="replay" label="Bar replay" on={p.replaying} onClick={p.onReplay} />
      {p.sym && isFinite(lo) && isFinite(hi) && (
        <>
          <span className="vr" />
          <div className="tb-telemetry" aria-label="Session stats">
            <div className="tb-chip range-chip tip" data-tip={`24h High: ${fmtPx(hi, dec)} | Low: ${fmtPx(lo, dec)}`}>
              <span className="chip-lbl">24h</span>
              <span className="mono chip-num">{fmtPx(lo, dec)}</span>
              <span className="chip-bar"><i style={{ left: `${Math.max(0, Math.min(100, range))}%` }} /></span>
              <span className="mono chip-num">{fmtPx(hi, dec)}</span>
            </div>
            {real && (
              <div className="tb-chip tip" data-tip="24h Traded Volume">
                <span className="chip-lbl">Vol</span>
                <span className="mono chip-num">{fmtQ(vol)}</span>
              </div>
            )}
            {real && (
              <div className="tb-chip tip" data-tip="24h Net Delta (Bid Vol - Ask Vol)">
                <span className="chip-lbl">Δ</span>
                <span className={`mono chip-num ${delta >= 0 ? 'up' : 'dn'}`}>{delta >= 0 ? '+' : ''}{fmtQ(delta)}</span>
              </div>
            )}
            {dv?.oi != null && (
              <div className="tb-chip tip" data-tip="Open Interest">
                <span className="chip-lbl">OI</span>
                <span className="mono chip-num">{fmtQ(dv.oi)}</span>
              </div>
            )}
            {dv?.fr != null && (
              <div className="tb-chip tip" data-tip="Estimated Funding Rate">
                <span className="chip-lbl">FR</span>
                <span className={`mono chip-num ${dv.fr >= 0 ? 'up' : 'dn'}`}>{(dv.fr * 100).toFixed(4)}%</span>
              </div>
            )}
          </div>
        </>
      )}
      <span className="grow" />
      {p.onTrade && (
        <button
          className={`tb-trade-btn ${p.panel === 'trade' && !p.focus ? 'active' : ''}`}
          onClick={p.onTrade}
          title="Place Paper Trade / Order Ticket (Alt+1)"
        >
          <I n="dollar" s={13} />
          <span>Trade</span>
        </button>
      )}
      <Btn ic="sliders" label="Order-flow settings" onClick={p.onSettings} />
      <Btn ic="camera" label="Screenshot" onClick={p.onShot} />
      <Btn ic="share" label="Copy share link" onClick={p.onShare} />
      <span className="vr" />
      <Btn ic="panelBottom" label="Bottom tray" on={p.tray && !p.focus} onClick={p.onTray} kbd="B" />
      <Btn ic="focus" label="Focus mode" on={p.focus} onClick={p.onFocus} kbd="F" />
    </div>
  );
}

/* ================================================================ status line */
export function StatusLine({ md, connected, sym }: { md: MarketData | null; connected: boolean; sym?: SymbolInfo }) {
  useTick(1000);
  const [diagOpen, setDiagOpen] = useState(false);
  const now = Date.now(), ticks = md?.ticks || [];
  let rate = 0; for (let i = ticks.length - 1; i >= 0 && ticks[i][0] >= now - 5000; i--) rate++;

  const lastT = ticks.length ? ticks[ticks.length - 1][0] : 0;
  const diff = lastT ? now - lastT : Infinity;
  // Non-negative clamping to eliminate negative latency glitch
  const age = Math.max(0, diff);
  const ageLabel = !isFinite(diff)
    ? '—'
    : diff < 0
    ? '< 10 ms'
    : age < 50
    ? '< 50 ms'
    : age < 1000
    ? `${age} ms`
    : age < 60_000
    ? `${(age / 1000).toFixed(1)} s`
    : 'stale';

  const st = md ? Object.entries(md.status) : [], ok = st.filter(([, v]) => v.ok).length;
  const health = !connected ? 'off' : st.length && ok === st.length ? 'ok' : ok ? 'warn' : 'off';
  const healthLabel = !connected
    ? 'Gateway Disconnected'
    : health === 'ok'
    ? 'All Systems Live'
    : health === 'warn'
    ? `${ok}/${st.length} Feeds Live`
    : 'Venues Offline';

  const d = new Date(now);

  return (
    <footer className="sline">
      {/* System Health Capsule */}
      <button
        className={`sl-health-pill ${health}`}
        onClick={() => setDiagOpen(o => !o)}
        title="Connection Health — Click to open live feed diagnostics"
      >
        <span className="sl-pulse-dot">
          <span className="sl-pulse-ring" />
        </span>
        <span className="sl-health-label">{healthLabel}</span>
      </button>

      {/* Venues Chips */}
      <div className="sl-venues-strip">
        {st.map(([k, v]) => (
          <button
            key={k}
            className={`sl-venue-pill ${v.ok ? 'ok' : 'off'}`}
            title={`${k}: ${v.ok ? 'Online & Receiving Live Data' : v.note || 'Feed Disconnected'} (Click for details)`}
            onClick={() => setDiagOpen(true)}
          >
            <i />
            <span className="sl-venue-txt">{k.replace('-f', ' FUT').replace('-s', ' SPOT').toUpperCase()}</span>
          </button>
        ))}
      </div>

      <span className="sl-divider" />

      {/* Live Order-Flow Telemetry */}
      <div className="sl-telem-group">
        <span className="sl-telem-pill" title="Order-Flow Trade Rate (trades per second)">
          <I n="zap" s={11} />
          <span className="mono">{(rate / 5).toFixed(1)}/s</span>
        </span>
        <span className="sl-telem-pill" title={`Exchange-to-Client latency: ${ageLabel}`}>
          <I n="activity" s={11} />
          <span className="mono">{ageLabel}</span>
        </span>
      </div>

      {sym?.volume === 'none' && (
        <span className="sl-warn-pill" title="Price-only synthetic or polled feed — volume profile not supported">
          ⚠️ Price-Only
        </span>
      )}

      {/* Paper Trading Capsule */}
      <span className="sl-paper-pill" title="Paper Trading Environment: Zero capital risk simulated order execution">
        <span className="sl-paper-glow" />
        PAPER
      </span>

      <span className="grow" />

      {/* Dual Precision Clocks */}
      <div className="sl-clocks-capsule">
        <div className="sl-clock-item utc" title="Coordinated Universal Time (UTC)">
          <span className="sl-clock-tag">UTC</span>
          <span className="mono">{d.toISOString().slice(11, 19)}</span>
        </div>
        <div className="sl-clock-item loc" title="Local System Time">
          <span className="sl-clock-tag">LOC</span>
          <span className="mono">{d.toTimeString().slice(0, 8)}</span>
        </div>
      </div>

      {/* Keyboard Shortcuts Trigger */}
      <button className="sl-shortcut-pill" onClick={() => overlays.set({ shortcuts: true })} title="Keyboard Shortcuts (?)">
        <Kbd k="?" />
        <span>Shortcuts</span>
      </button>

      {/* Interactive Diagnostics Popover */}
      {diagOpen && (
        <div className="sl-diag-popover">
          <div className="sl-diag-header">
            <div className="sl-diag-title">
              <I n="activity" s={14} />
              <span>Network & Feed Diagnostics</span>
            </div>
            <button className="sl-diag-close" onClick={() => setDiagOpen(false)} title="Close diagnostics">
              <I n="x" s={13} />
            </button>
          </div>

          <div className="sl-diag-body">
            <div className="sl-diag-row">
              <span className="sl-diag-k">Gateway WebSocket</span>
              <span className={`sl-diag-v ${connected ? 'ok' : 'off'}`}>
                {connected ? '🟢 Connected (RFC 6455)' : '🔴 Disconnected'}
              </span>
            </div>
            <div className="sl-diag-row">
              <span className="sl-diag-k">Active Market</span>
              <span className="mono sl-diag-v">{sym?.id || '—'}</span>
            </div>
            <div className="sl-diag-row">
              <span className="sl-diag-k">Tape Trade Rate</span>
              <span className="mono sl-diag-v">{(rate / 5).toFixed(1)} trades / sec</span>
            </div>
            <div className="sl-diag-row">
              <span className="sl-diag-k">Latency (Last Tick)</span>
              <span className="mono sl-diag-v">{ageLabel}</span>
            </div>
            <div className="sl-diag-row">
              <span className="sl-diag-k">Buffer Ticks Loaded</span>
              <span className="mono sl-diag-v">{ticks.length.toLocaleString()} ticks</span>
            </div>

            <div className="sl-diag-section-title">Exchange Feed Connectors</div>
            <div className="sl-diag-venues">
              {st.map(([k, v]) => (
                <div key={k} className={`sl-diag-venue-item ${v.ok ? 'ok' : 'off'}`}>
                  <div className="sl-diag-venue-left">
                    <i />
                    <span className="mono sl-diag-vname">{k.toUpperCase()}</span>
                  </div>
                  <span className="sl-diag-vstate">{v.ok ? 'ONLINE' : (v.note || 'OFFLINE')}</span>
                </div>
              ))}
            </div>

            <div className="sl-diag-actions">
              <button
                className="sl-diag-btn"
                onClick={() => {
                  data.reconnect();
                  setDiagOpen(false);
                }}
              >
                <I n="replay" s={12} />
                <span>Reconnect Feeds</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
