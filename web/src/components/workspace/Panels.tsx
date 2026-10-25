/**
 * Workspace panels:
 *   WidgetBar   far-right icon rail — one click opens a tool, clicking it again collapses
 *   RightPanel  resizable column next to the price axis
 *   BottomTray  positions / orders / fills / big trades / alert log
 */
import { useEffect, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { I } from '../ui/Icons';
import { settings, setUI, togglePanel, openSymbol, type PanelKey } from '../../lib/settings';
import { PANELS, TRAY } from './meta';
import { alerts, clearAlertLog } from '../../lib/alerts';
import { loadRaw } from '../../lib/store';
import { net } from '../../data/client';
import type { PaperBroker } from '../../lib/paper';
import { fmtPx, fmtUsd, fmtT } from '../../lib/format';

function useTick(ms: number) { const [, f] = useReducer(x => x + 1, 0); useEffect(() => { const h = setInterval(f, ms); return () => clearInterval(h); }, [ms]); }

function Resizer({ axis, value, min, max, onChange }: { axis: 'x' | 'y'; value: number; min: number; max: number; onChange(v: number): void }) {
  const start = useRef<{ p: number; v: number } | null>(null);
  useEffect(() => {
    const mv = (e: MouseEvent) => { if (!start.current) return; const d = (axis === 'x' ? e.clientX : e.clientY) - start.current.p; onChange(Math.max(min, Math.min(max, start.current.v - d))); };
    const up = () => { if (start.current) { start.current = null; document.body.classList.remove('resizing'); } };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [axis, min, max, onChange]);
  return <div className={`resizer ${axis}`} role="separator" aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} title="Drag to resize · double-click to reset"
    onMouseDown={e => { start.current = { p: axis === 'x' ? e.clientX : e.clientY, v: value }; document.body.classList.add('resizing'); e.preventDefault(); }}
    onDoubleClick={() => onChange(axis === 'x' ? 320 : 190)} />;
}

export function WidgetBar({ unread }: { unread: number }) {
  const panel = settings.use(s => s.ui.panel), focus = settings.use(s => s.ui.focus);
  return (
    <nav className="wbar" aria-label="Tools">
      {PANELS.map(([k, l, ic, kb]) => (
        <button key={k} className={`wb-btn tip-l ${panel === k && !focus ? 'on' : ''}`} data-tip={`${l}  ${kb}`} aria-label={l} aria-pressed={panel === k && !focus} onClick={() => togglePanel(k)}>
          <I n={ic} s={18} />{k === 'alerts' && unread > 0 && <b className="badge">{unread > 9 ? '9+' : unread}</b>}
        </button>
      ))}
      <span className="grow" />
      <button className={`wb-btn tip-l ${focus ? 'on' : ''}`} data-tip="Focus mode  F" aria-label="Focus mode" onClick={() => setUI({ focus: !focus })}><I n="focus" s={18} /></button>
    </nav>
  );
}

export function RightPanel({ children }: { children: Record<PanelKey, () => ReactNode> }) {
  const panel = settings.use(s => s.ui.panel), w = settings.use(s => s.ui.rpW), focus = settings.use(s => s.ui.focus);
  if (!panel || focus) return null;
  return (
    <aside className="rpanel" style={{ width: w }} aria-label={PANELS.find(p => p[0] === panel)?.[1]}>
      <Resizer axis="x" value={w} min={260} max={560} onChange={v => setUI({ rpW: Math.round(v) })} />
      <button className="rp-close" aria-label="Collapse panel" title="Collapse  Alt+0" onClick={() => setUI({ panel: null })}><I n="chevRight" s={15} /></button>
      <div className="rp-body">{children[panel]()}</div>
    </aside>
  );
}

interface PosRow { sym: string; qty: number; avg: number; realized: number; orders: number }
function allPositions(): PosRow[] {
  const out: PosRow[] = [];
  for (const s of net.get().symbols) {
    const p = loadRaw<any>(`fs.paper.${s.id}`, null); if (!p) continue;
    if (p.pos?.qty || p.orders?.length || p.realized) out.push({ sym: s.id, qty: p.pos?.qty || 0, avg: p.pos?.avg || 0, realized: p.realized || 0, orders: p.orders?.length || 0 });
  }
  return out;
}

export function BottomTray({ broker, curSym, mark, big }: { broker: PaperBroker | null; curSym?: string; mark: number; big: () => ReactNode }) {
  useTick(800);
  const ui = settings.use(s => s.ui), syms = net.use(s => s.symbols), log = alerts.use(s => s.log);
  if (ui.focus) return null;
  const rows = allPositions();
  if (broker && curSym) { const i = rows.findIndex(r => r.sym === curSym), live = { sym: curSym, qty: broker.pos.qty, avg: broker.pos.avg, realized: broker.realized, orders: broker.orders.length }; if (i >= 0) rows[i] = live; else rows.push(live); }
  const open = rows.filter(r => r.qty);
  const markOf = (id: string) => id === curSym ? mark : syms.find(s => s.id === id)?.last || 0;
  const decOf = (id: string) => syms.find(s => s.id === id)?.dec ?? 2;
  const count: Record<string, number> = { positions: open.length, orders: broker?.orders.length || 0, fills: broker?.fills.length || 0, alerts: log.length };
  const tab = ui.trayTab;
  return (
    <section className={`tray ${ui.tray ? 'open' : ''}`} style={ui.tray ? { height: ui.trayH } : undefined} aria-label="Account tray">
      {ui.tray && <Resizer axis="y" value={ui.trayH} min={110} max={520} onChange={v => setUI({ trayH: Math.round(v) })} />}
      <div className="tray-h" role="tablist">
        {TRAY.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k && ui.tray} className={tab === k && ui.tray ? 'on' : ''} onClick={() => setUI(tab === k && ui.tray ? { tray: false } : { trayTab: k, tray: true })}>
            {l}{count[k] ? <span className="cnt mono">{count[k]}</span> : null}
          </button>
        ))}
        <span className="grow" />
        {ui.tray && tab === 'alerts' && log.length > 0 && <button className="tray-act" onClick={clearAlertLog}>Clear log</button>}
        {ui.tray && tab === 'orders' && (broker?.orders.length || 0) > 0 && <button className="tray-act" onClick={() => broker!.cancelAll()}>Cancel all</button>}
        <button className="tray-toggle" aria-label={ui.tray ? 'Collapse tray' : 'Expand tray'} title="Toggle tray  B" onClick={() => setUI({ tray: !ui.tray })}><I n={ui.tray ? 'chevDown' : 'chevUp'} s={15} /></button>
      </div>
      {ui.tray && <div className="tray-b">
        {tab === 'positions' && (open.length ? <table className="dt"><thead><tr><th>Market</th><th>Side</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Mark</th><th className="r">Unrealised P&amp;L</th><th className="r">Realised</th><th /></tr></thead><tbody>
          {open.map(r => { const m = markOf(r.sym), pnl = m ? (m - r.avg) * r.qty : 0, d = decOf(r.sym); return (
            <tr key={r.sym}><td><button className="link" onClick={() => openSymbol(r.sym)}>{r.sym}</button></td>
              <td><span className={`side-badge ${r.qty > 0 ? 'long' : 'short'}`}>{r.qty > 0 ? 'LONG' : 'SHORT'}</span></td>
              <td className="r mono">{Math.abs(r.qty)}</td><td className="r mono">{fmtPx(r.avg, d)}</td><td className="r mono">{m ? fmtPx(m, d) : '—'}</td>
              <td className={`r mono ${pnl >= 0 ? 'up' : 'dn'}`}>{pnl >= 0 ? '+' : ''}{fmtUsd(pnl)} <span className="muted">({r.avg ? ((((m - r.avg) / r.avg) * 100) * Math.sign(r.qty)).toFixed(2) : '0.00'}%)</span></td>
              <td className={`r mono ${r.realized >= 0 ? 'up' : 'dn'}`}>{fmtUsd(r.realized)}</td>
              <td className="r">{r.sym === curSym && broker ? <button className="row-btn" onClick={() => broker.flatten()}>Close</button> : <button className="row-btn" onClick={() => openSymbol(r.sym)}>Open</button>}</td></tr>); })}
        </tbody></table> : <Empty icon="dollar" title="No open positions" sub="Use the order ticket (Alt+1) to place a paper trade. Positions across every market show here." />)}

        {tab === 'orders' && (broker?.orders.length ? <table className="dt"><thead><tr><th>Market</th><th>Side</th><th>Type</th><th className="r">Size</th><th className="r">Price</th><th className="r">Distance</th><th /></tr></thead><tbody>
          {broker.orders.map(o => { const d = decOf(curSym || ''); const dist = mark ? ((o.px - mark) / mark) * 100 : 0; return (
            <tr key={o.id}><td>{curSym}</td><td className={o.side > 0 ? 'up' : 'dn'}>{o.side > 0 ? 'Buy' : 'Sell'}</td><td>{o.type === 'lmt' ? 'Limit' : 'Stop'}{o.oco ? ' · bracket' : ''}</td>
              <td className="r mono">{o.qty}</td><td className="r mono">{fmtPx(o.px, d)}</td><td className="r mono muted">{dist >= 0 ? '+' : ''}{dist.toFixed(2)}%</td>
              <td className="r"><button className="row-btn" onClick={() => broker.cancel(o.id)}>Cancel</button></td></tr>); })}
        </tbody></table> : <Empty icon="list" title="No working orders" sub={`Limit and stop orders for ${curSym || 'this market'} appear here.`} />)}

        {tab === 'fills' && (broker?.fills.length ? <table className="dt"><thead><tr><th>Time</th><th>Side</th><th className="r">Size</th><th className="r">Price</th><th className="r">Realised P&amp;L</th></tr></thead><tbody>
          {[...broker.fills].reverse().slice(0, 100).map((f, i) => (
            <tr key={i}><td className="mono">{fmtT(f.t)}</td><td className={f.side > 0 ? 'up' : 'dn'}>{f.side > 0 ? 'Buy' : 'Sell'}</td><td className="r mono">{f.qty}</td><td className="r mono">{fmtPx(f.px, decOf(curSym || ''))}</td><td className={`r mono ${f.pnl > 0 ? 'up' : f.pnl < 0 ? 'dn' : 'muted'}`}>{f.pnl ? fmtUsd(f.pnl) : '—'}</td></tr>))}
        </tbody></table> : <Empty icon="check" title="No fills yet" sub="Every paper execution is listed here and journaled automatically." />)}

        {tab === 'big' && big()}

        {tab === 'alerts' && (log.length ? <table className="dt"><thead><tr><th>Time</th><th>Market</th><th>Alert</th></tr></thead><tbody>
          {log.map(h => <tr key={h.id}><td className="mono">{fmtT(h.t)}</td><td><button className="link" onClick={() => openSymbol(h.sym)}>{h.sym}</button></td><td>{h.msg}</td></tr>)}
        </tbody></table> : <Empty icon="bell" title="No alerts fired" sub="Create alerts from the Alerts tool (Alt+4) or right-click a price on the chart." />)}
      </div>}
    </section>
  );
}

const Empty = ({ icon, title, sub }: { icon: string; title: string; sub: string }) => (
  <div className="empty"><span className="e-ic"><I n={icon} s={18} /></span><b>{title}</b><small>{sub}</small></div>
);
