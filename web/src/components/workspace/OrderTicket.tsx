/**
 * Order ticket (right panel, "Trade").
 * Side toggle → order type → price → size → bracket → one verb-labelled submit button,
 * then the live position card and working orders. Paper trading only.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { PaperBroker } from '../../lib/paper';
import type { SymbolInfo } from '../../lib/types';
import { settings } from '../../lib/settings';
import { fmtPx, fmtUsd } from '../../lib/format';
import { I } from '../ui/Icons';

type OT = 'mkt' | 'lmt' | 'stp';
const decOf = (step: number) => Math.max(0, Math.min(8, -Math.floor(Math.log10(step))));

export function OrderTicket({ broker, sym }: { broker: PaperBroker; sym: SymbolInfo }) {
  const [, force] = useReducer(x => x + 1, 0);
  useEffect(() => { const h = setInterval(force, 400); return () => clearInterval(h); }, []);
  const acct = settings.use(s => s.acct);
  const px = broker.last, dec = sym.dec, tick = sym.tick;
  const qStep = px > 10_000 ? 0.001 : px > 100 ? 0.01 : px > 1 ? 0.1 : 1, qDec = decOf(qStep);
  const [side, setSide] = useState<1 | -1>(1), [type, setType] = useState<OT>('mkt');
  const [qty, setQty] = useState(0), [price, setPrice] = useState('');
  const [br, setBr] = useState(broker.oco.on), [sl, setSl] = useState(broker.oco.sl), [tp, setTp] = useState(broker.oco.tp);
  const symRef = useRef('');
  const defQty = () => {
    if (!px || px <= 0) return 1;
    const computed = (acct.size * 0.1) / px;
    return +Math.max(qStep, isFinite(computed) ? computed : 1).toFixed(qDec);
  };
  useEffect(() => {
    if (symRef.current !== sym.id) { symRef.current = sym.id; setPrice(px ? px.toFixed(dec) : ''); setQty(px ? defQty() : 1); }
    else if (!qty && px) { setQty(defQty()); setPrice(px.toFixed(dec)); }
  }, [sym.id, px > 0]);
  useEffect(() => { broker.oco.on = br; broker.oco.sl = sl; broker.oco.tp = tp; }, [br, sl, tp, broker]);

  const activeQty = qty > 0 ? qty : defQty();
  const lp = type === 'mkt' ? px : +price || px;
  const notional = activeQty * lp, risk = br ? sl * tick * activeQty : 0, reward = br ? tp * tick * activeQty : 0;
  const marketable = type === 'lmt' && px && ((side > 0 && lp >= px) || (side < 0 && lp <= px));
  const wrongStop = type === 'stp' && px && ((side > 0 && lp <= px) || (side < 0 && lp >= px));
  const verb = side > 0 ? 'Buy' : 'Sell', where = type === 'mkt' ? 'at market' : `${type === 'lmt' ? 'limit' : 'stop'} @ ${fmtPx(lp, dec)}`;
  const can = activeQty > 0 && px > 0 && !wrongStop;
  const submit = () => {
    if (!can) return;
    if (type === 'mkt') broker.exec(side, activeQty, +(px + side * tick).toFixed(dec));
    else broker.place(type, side, activeQty, +lp.toFixed(dec));
  };
  const nudge = (d: number) => setPrice(((+price || px) + d * tick).toFixed(dec));
  const pos = broker.pos, upnl = broker.openPnl(), rNow = pos.qty && br ? upnl / (sl * tick * Math.abs(pos.qty) || 1) : null;

  return (
    <section className="dock ticket" aria-label="Order ticket">
      <h5>Trade <span className="tag-paper">Paper</span></h5>
      <div className="tk-body" onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submit(); }}>
        <div className={`side-toggle ${side > 0 ? 'buy' : 'sell'}`} role="radiogroup" aria-label="Side">
          <button className={side > 0 ? 'on' : ''} onClick={() => setSide(1)} role="radio" aria-checked={side > 0}>Buy / Long</button>
          <button className={side < 0 ? 'on' : ''} onClick={() => setSide(-1)} role="radio" aria-checked={side < 0}>Sell / Short</button>
          <i />
        </div>
        <div className="tabs-u" role="tablist" aria-label="Order type">
          {([['mkt', 'Market'], ['lmt', 'Limit'], ['stp', 'Stop']] as [OT, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={type === k} className={type === k ? 'on' : ''} onClick={() => { setType(k); if (k !== 'mkt') setPrice(px.toFixed(dec)); }}>{l}</button>)}
        </div>

        {type !== 'mkt' && <label className="field">
          <span className="f-l">{type === 'lmt' ? 'Limit price' : 'Stop trigger'}</span>
          <div className="f-in"><button className="step" onClick={() => nudge(-1)} aria-label="Down one tick"><I n="minus" s={12} /></button>
            <input className="mono" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
            <button className="step" onClick={() => nudge(1)} aria-label="Up one tick"><I n="plus" s={12} /></button>
            <button className="f-chip" onClick={() => setPrice(px.toFixed(dec))}>Last</button></div>
          {marketable && <span className="f-warn">Marketable — fills immediately at {fmtPx(px, dec)}</span>}
          {wrongStop && <span className="f-err">A {verb.toLowerCase()} stop must be {side > 0 ? 'above' : 'below'} the last price</span>}
        </label>}

        <label className="field">
          <span className="f-l">Size <span className="muted">· {sym.id.replace(/USDT?$/, '') || 'units'}</span></span>
          <div className="f-in"><button className="step" onClick={() => setQty(q => +Math.max(0, q - qStep).toFixed(qDec))} aria-label="Decrease size"><I n="minus" s={12} /></button>
            <input className="mono" type="number" min={0} step={qStep} value={qty} onChange={e => setQty(Math.max(0, +e.target.value))} />
            <button className="step" onClick={() => setQty(q => +(q + qStep).toFixed(qDec))} aria-label="Increase size"><I n="plus" s={12} /></button></div>
          <div className="pcts">{[0.1, 0.25, 0.5, 1].map(f => <button key={f} onClick={() => px && setQty(+Math.max(qStep, (acct.size * f) / px).toFixed(qDec))}>{f * 100}%</button>)}<span className="muted">of ${(acct.size / 1000).toFixed(0)}K</span></div>
        </label>

        <div className={`bracket ${br ? 'on' : ''}`}>
          <button className="br-h" onClick={() => setBr(!br)} role="switch" aria-checked={br}><span>Take profit / Stop loss</span><span className={`toggle ${br ? 'on' : ''}`} /></button>
          {br && <div className="br-grid">
            <label className="field sm"><span className="f-l up">TP · ticks</span><div className="f-in"><input className="mono" type="number" min={1} value={tp} onChange={e => setTp(Math.max(1, +e.target.value))} /></div><span className="f-sub mono">{fmtPx(lp + side * tp * tick, dec)}</span></label>
            <label className="field sm"><span className="f-l dn">SL · ticks</span><div className="f-in"><input className="mono" type="number" min={1} value={sl} onChange={e => setSl(Math.max(1, +e.target.value))} /></div><span className="f-sub mono">{fmtPx(lp - side * sl * tick, dec)}</span></label>
          </div>}
        </div>

        <dl className="summary">
          <div><dt>Notional</dt><dd className="mono">{fmtUsd(notional)}</dd></div>
          {br && <div><dt>Risk / reward</dt><dd className="mono"><span className="dn">−{fmtUsd(risk)}</span> / <span className="up">+{fmtUsd(reward)}</span></dd></div>}
          {br && <div><dt>R:R · acct risk</dt><dd className="mono">1 : {(reward / (risk || 1)).toFixed(2)} · {((risk / acct.size) * 100).toFixed(2)}%</dd></div>}
        </dl>

        <button className={`submit ${side > 0 ? 'buy' : 'sell'}`} disabled={!can} onClick={submit}>
          {verb} {activeQty} {sym.id} {where}
        </button>

        {pos.qty !== 0 && (
          <div className={`posbox ${pos.qty > 0 ? 'long' : 'short'}`}>
            <div className="pb-h"><span className={`side-badge ${pos.qty > 0 ? 'long' : 'short'}`}>{pos.qty > 0 ? 'LONG' : 'SHORT'}</span><b className="mono">{Math.abs(pos.qty)}</b><span className="muted mono">@ {fmtPx(pos.avg, dec)}</span><span className="grow" /><b className={`mono ${upnl >= 0 ? 'up' : 'dn'}`}>{upnl >= 0 ? '+' : ''}{fmtUsd(upnl)}</b></div>
            <div className="pb-sub mono"><span>Mark {fmtPx(px, dec)}</span><span>{(((px - pos.avg) / pos.avg) * 100 * Math.sign(pos.qty)).toFixed(2)}%</span>{rNow != null && <span>{rNow >= 0 ? '+' : ''}{rNow.toFixed(2)}R</span>}</div>
            <div className="pb-act">
              <button onClick={() => broker.flatten()}>Close</button>
              <button onClick={() => broker.reverse()}><I n="swap" s={13} />Reverse</button>
              <button onClick={() => broker.breakeven()}><I n="target" s={13} />Breakeven</button>
            </div>
          </div>
        )}

        {broker.orders.length > 0 && <div className="wo">
          <div className="wo-h"><span>Working orders · {broker.orders.length}</span><button onClick={() => broker.cancelAll()}>Cancel all</button></div>
          {broker.orders.map(o => (
            <div key={o.id} className="wo-row mono">
              <span className={o.side > 0 ? 'up' : 'dn'}>{o.side > 0 ? 'BUY' : 'SELL'}</span><span>{o.type === 'lmt' ? 'LMT' : 'STP'}{o.oco ? ' · OCO' : ''}</span><span>{o.qty}</span><span>@ {fmtPx(o.px, dec)}</span>
              <button aria-label="Cancel order" onClick={() => broker.cancel(o.id)}><I n="x" s={12} /></button>
            </div>))}
        </div>}

        <div className="tk-foot"><span>Realised <b className={`mono ${broker.realized >= 0 ? 'up' : 'dn'}`}>{fmtUsd(broker.realized)}</b></span>
          <button onClick={() => { if (confirm(`Reset the ${sym.id} paper account?`)) broker.reset(); }}>Reset</button></div>
        <p className="tk-note">Simulated fills against the live tape. No orders are sent to any exchange.</p>
      </div>
    </section>
  );
}
