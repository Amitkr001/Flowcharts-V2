import { useEffect, useState } from 'react';
import { alerts, addAlert, updateAlert, removeAlert, clearAlertLog, markAlertsRead, enableNotifications, ALERT_TYPES, type AlertType } from '../lib/alerts';
import { settings } from '../lib/settings';
import { net } from '../data/client';
import type { SymbolInfo } from '../lib/types';

export function AlertsPanel({ sym, price }: { sym: SymbolInfo; price: number }) {
  const { rules, log } = alerts.use(s => s), syms = net.use(s => s.symbols), st = settings.use(s => s);
  const [type, setType] = useState<AlertType>('price'), [s, setS] = useState(sym.id), [val, setVal] = useState(price || 0), [dir, setDir] = useState<'above' | 'below' | 'cross'>('cross'), [once, setOnce] = useState(true), [note, setNote] = useState('');
  const [tab, setTab] = useState<'rules' | 'log'>('rules');
  useEffect(() => { setS(sym.id); }, [sym.id]);
  useEffect(() => { setVal(type === 'price' ? +(price || 0).toFixed(sym.dec) : ALERT_TYPES[type].def); }, [type]);
  useEffect(() => { if (tab === 'log') markAlertsRead(); }, [tab, log.length]);
  const T = ALERT_TYPES[type];
  const add = () => { addAlert({ sym: s, type, value: T.noValue ? 0 : val, dir, once, note: note.trim() || undefined }); setNote(''); };
  return (
    <section className="dock" style={{ width: 300 }} aria-label="Alerts">
      <h5>Alerts
        <span className="seg-mini"><span className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>Rules {rules.filter(r => r.on).length}</span><span className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Log {log.length}</span></span>
      </h5>
      {tab === 'rules' ? <div className="body alert-body">
        <div className="alert-form">
          <div className="row2">
            <select value={s} onChange={e => setS(e.target.value)} aria-label="Symbol">{syms.map(x => <option key={x.id}>{x.id}</option>)}</select>
            <select value={type} onChange={e => setType(e.target.value as AlertType)} aria-label="Alert type">{(Object.keys(ALERT_TYPES) as AlertType[]).map(k => <option key={k} value={k}>{ALERT_TYPES[k].label}</option>)}</select>
          </div>
          {!T.noValue && <div className="row2">
            <label className="fld">{T.unit || 'value'}<input type="number" value={val} step="any" onChange={e => setVal(+e.target.value)} /></label>
            {type === 'price' ? <select value={dir} onChange={e => setDir(e.target.value as any)}><option value="cross">Crosses</option><option value="above">Crosses above</option><option value="below">Crosses below</option></select> : <span />}
          </div>}
          <input className="note-in" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <p className="hint">{T.hint}</p>
          <div className="row2">
            <label className="mini"><span className={`chk ${once ? 'on' : ''}`} onClick={() => setOnce(!once)} role="checkbox" aria-checked={once} />Fire once</label>
            <button className="btn pri" onClick={add} style={{ justifyContent: 'center', height: 30 }}>Add alert</button>
          </div>
          <div className="row2" style={{ marginTop: 4 }}>
            <label className="mini"><span className={`chk ${st.sound ? 'on' : ''}`} onClick={() => settings.set({ sound: !st.sound })} role="checkbox" aria-checked={st.sound} />Sound</label>
            <button className="btn" style={{ height: 28, justifyContent: 'center' }} onClick={() => st.notify ? settings.set({ notify: false }) : enableNotifications()}>{st.notify ? '✓ Notifications' : 'Enable notifications'}</button>
          </div>
        </div>
        {rules.map(r => (
          <div key={r.id} className={`alert-rule ${r.on ? '' : 'off'}`}>
            <button className={`toggle ${r.on ? 'on' : ''}`} style={{ border: 0, padding: 0 }} onClick={() => updateAlert(r.id, { on: !r.on })} role="switch" aria-checked={r.on} aria-label="Enable alert" />
            <div className="ar-txt">
              <b>{r.sym} · {ALERT_TYPES[r.type].label}</b>
              <small>{ALERT_TYPES[r.type].noValue ? '' : r.type === 'price' ? `${r.dir} ${r.value}` : `≥ ${r.value} ${ALERT_TYPES[r.type].unit}`}{r.once ? ' · once' : ''}{r.note ? ` · ${r.note}` : ''}</small>
            </div>
            <button className="mini-btn" onClick={() => removeAlert(r.id)} aria-label="Delete alert">✕</button>
          </div>
        ))}
        {!rules.length && <p className="muted" style={{ padding: 14 }}>No alerts yet. Alerts keep running for every symbol while FlowScope is open in a tab.</p>}
      </div> : <div className="body alert-body">
        <div style={{ padding: '6px 10px', textAlign: 'right' }}><button className="mini-btn" onClick={clearAlertLog} disabled={!log.length}>Clear</button></div>
        {log.map(h => <div key={h.id} className="alert-hit"><small>{new Date(h.t).toLocaleTimeString('en-GB')} · {h.sym}</small><div>{h.msg}</div></div>)}
        {!log.length && <p className="muted" style={{ padding: 14 }}>Nothing fired yet.</p>}
      </div>}
    </section>
  );
}
