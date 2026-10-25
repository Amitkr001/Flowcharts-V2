/**
 * Application top bar (Master Command Header - Option 1).
 *   brand · active market widget · quick watchlist ticker tape · search (⌘K) · primary navigation · connection · alerts · shortcuts · account
 */
import { useEffect, useReducer, useRef, type ReactNode } from 'react';
import { I, Kbd, MOD } from './ui/Icons';
import { session } from '../lib/api';
import { net, type MarketData } from '../data/client';
import { alerts } from '../lib/alerts';
import { settings, openSymbol, setUI, togglePanel } from '../lib/settings';
import { openPalette, overlays } from '../lib/commands';
import type { Bar, SymbolInfo } from '../lib/types';
import { fmtPx } from '../lib/format';
import { pwa, triggerInstall } from '../lib/pwa';

const DAY = 86_400_000;

function useTick(ms: number) {
  const [, f] = useReducer(x => x + 1, 0);
  useEffect(() => {
    const h = setInterval(f, ms);
    return () => clearInterval(h);
  }, [ms]);
}

const LINKS: [string, string, string][] = [
  ['chart', 'Trade', 'chart'], ['multi', 'Layouts', 'grid'], ['indicators', 'Scripts', 'code'],
  ['backtest', 'Backtest', 'flask'], ['journal', 'Journal', 'book'],
];

const Logo = () => (
  <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
    <defs>
      <linearGradient id="fp-bid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#34d399" />
        <stop offset="1" stopColor="#10b981" />
      </linearGradient>
      <linearGradient id="fp-ask" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#c084fc" />
        <stop offset="1" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8" fill="#0c1017" stroke="#1e293b" strokeWidth="1" />
    {/* Left Bid Footprint Blocks */}
    <rect x="6.5" y="8.5" width="7.5" height="4" rx="1.5" fill="url(#fp-bid)" />
    <rect x="9" y="14" width="5" height="4" rx="1.5" fill="url(#fp-bid)" opacity="0.85" />
    <rect x="5.5" y="19.5" width="8.5" height="4" rx="1.5" fill="url(#fp-bid)" />
    {/* Central Point of Control (POC) laser line */}
    <line x1="16" y1="5.5" x2="16" y2="26.5" stroke="#38bdf8" strokeWidth="1.2" strokeDasharray="1.5 1.5" opacity="0.9" />
    {/* Right Ask Footprint Blocks */}
    <rect x="18" y="8.5" width="5.5" height="4" rx="1.5" fill="url(#fp-ask)" opacity="0.85" />
    <rect x="18" y="14" width="8.5" height="4" rx="1.5" fill="url(#fp-ask)" />
    <rect x="18" y="19.5" width="6.5" height="4" rx="1.5" fill="url(#fp-ask)" opacity="0.9" />
  </svg>
);

export interface MenuBarProps {
  active: string;
  sym?: SymbolInfo;
  md?: MarketData | null;
  bars?: () => Bar[];
  center?: ReactNode;
  right?: ReactNode;
}

export function MenuBar({ active, sym, md, bars, center, right }: MenuBarProps) {
  useTick(500);
  const user = session.use(s => s.user), connected = net.use(s => s.connected), unread = alerts.use(s => s.unread);
  const watch = settings.use(s => s.watch), recent = settings.use(s => s.ui.recent);
  const isStandalone = pwa.use(s => s.isStandalone), installed = pwa.use(s => s.installed);
  const prev = useRef(0), dir = useRef<0 | 1 | -1>(0);

  const b = bars ? bars() : [];
  const dec = sym?.dec ?? 2;
  const last = md?.lastPrice || (b.length ? b[b.length - 1].c : 0);
  if (last && last !== prev.current) {
    dir.current = last > prev.current ? 1 : -1;
    prev.current = last;
  }

  const d0 = Math.floor((b[b.length - 1]?.t ?? Date.now()) / DAY) * DAY;
  let open = NaN;
  for (let i = b.length - 1; i >= 0 && b[i].t >= d0; i--) {
    open = b[i].o;
  }
  const ch = isFinite(open) && open > 0 ? last - open : 0;
  const pct = open ? (ch / open) * 100 : 0;
  const upDay = ch >= 0;
  const starred = !!sym && watch.includes(sym.id);
  const tickers = Array.from(new Set([...recent, ...watch])).slice(0, 5);

  return (
    <header className="app-top">
      {/* Left: Brand + Active Market Widget */}
      <div className="top-left">
        <a className="brand" href="#/chart" aria-label="FlowCharts home">
          <Logo />
          <span className="brand-title">Flow<span className="brand-accent">Charts</span></span>
        </a>

        {sym && (
          <>
            <span className="top-vr" />
            <div className="top-market-chip">
              <button className="top-sym-btn" onClick={() => openPalette('symbols')} title="Change market ( / )">
                <span className={`ib-cls ${sym.cls || ''}`}>{(sym.cls || '··').slice(0, 3).toUpperCase()}</span>
                <span className="top-sym-name">{sym.id}</span>
                <I n="chevDown" s={11} />
              </button>
              <button
                className={`top-star ${starred ? 'on' : ''}`}
                title={starred ? 'Remove from watchlist' : 'Add to watchlist'}
                aria-pressed={starred}
                onClick={() => settings.set(s => ({ watch: starred ? s.watch.filter(x => x !== sym.id) : [...s.watch, sym.id] }))}
              >
                <I n="star" s={13} />
              </button>
              <div className="top-px-strip">
                <span className={`top-last mono ${dir.current > 0 ? 'up' : dir.current < 0 ? 'dn' : ''}`} key={last}>
                  {last ? fmtPx(last, dec) : '—'}
                </span>
                <span className={`top-chg mono ${upDay ? 'up' : 'dn'}`}>
                  {upDay ? '+' : ''}{pct.toFixed(2)}%
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Center: Live Watchlist Ticker Tape or custom slot */}
      <div className="top-center">
        {center ? center : tickers.length > 0 && (
          <div className="top-ticker-tape" aria-label="Quick watchlist">
            {tickers.map(id => {
              const isCur = id === sym?.id;
              return (
                <button
                  key={id}
                  className={`top-ticker-pill ${isCur ? 'active' : ''}`}
                  onClick={() => openSymbol(id)}
                  title={`Open ${id}`}
                >
                  <span className="mono">{id}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: Quick Search, Navigation, System Status, User Account */}
      <div className="top-right">
        {right}
        <button className="cmdk-compact" onClick={() => openPalette('all')} title="Search markets, indicators, actions (Ctrl+K)">
          <I n="search" s={13} />
          <span className="cmdk-txt">Search...</span>
          <span className="kbds"><Kbd k={MOD} /><Kbd k="K" /></span>
        </button>

        <nav className="nav" aria-label="Main navigation">
          {LINKS.map(([k, l, ic]) => (
            <a
              key={k}
              href={`#/${k}`}
              className={active === k ? 'on' : ''}
              aria-current={active === k ? 'page' : undefined}
              title={l}
              onClick={() => {
                if (k === 'chart') {
                  togglePanel('trade');
                }
              }}
            >
              <I n={ic} s={14} />
              <span className="nav-lbl">{l}</span>
            </a>
          ))}
        </nav>

        {!isStandalone && !installed && (
          <button
            className="top-install-btn"
            onClick={triggerInstall}
            title="Install FlowCharts Desktop App (Creates Desktop Shortcut)"
            aria-label="Install FlowCharts Desktop App"
          >
            <I n="download" s={13} />
            <span>Install App</span>
          </button>
        )}

        <span className={`conn ${connected ? 'ok' : 'off'}`} title={connected ? 'Connected to FlowScope data server' : 'Reconnecting to data server…'}>
          <i />
          <span>{connected ? 'Live' : 'Offline'}</span>
        </span>

        <button className="icon-btn" title="Alerts" aria-label={`Alerts${unread ? `, ${unread} unread` : ''}`} onClick={() => { setUI({ panel: 'alerts', focus: false }); if (!/chart/.test(location.hash) && location.hash) location.hash = '#/chart'; }}>
          <I n="bell" s={15} />{unread > 0 && <b className="badge">{unread > 99 ? '99+' : unread}</b>}
        </button>

        <button className="icon-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => overlays.set({ shortcuts: true })}>
          <I n="keyboard" s={15} />
        </button>

        <a className={`acct ${active === 'account' ? 'on' : ''}`} href="#/account" title={user ? user.email : 'Sign in to sync layouts and journal'}>
          <span className={`avatar ${user ? '' : 'guest'}`}>{user ? user.name.slice(0, 1).toUpperCase() : <I n="user" s={13} />}</span>
          <span className="acct-name">{user ? user.name : 'Sign in'}</span>
        </a>
      </div>
    </header>
  );
}
