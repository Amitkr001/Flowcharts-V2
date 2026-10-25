import { useEffect, useMemo, useState } from 'react';
import { MenuBar } from '../components/MenuBar';
import { journal, journalStats, journalCsv, updateTrade, deleteTrade, type JTrade } from '../lib/journal';
import { idb } from '../lib/idb';
import { settings } from '../lib/settings';
import { fmtUsd } from '../lib/format';

function Shot({ k, onOpen }: { k: string; onOpen(src: string): void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; idb.get(k).then(v => { if (on) setSrc(v || null); }); return () => { on = false; }; }, [k]);
  return src ? <img className="j-shot" src={src} alt="Chart at fill" onClick={() => onOpen(src)} /> : <div className="j-shot empty" />;
}

const dur = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${(m / 1440).toFixed(1)}d`; };

function Row({ t, onOpen }: { t: JTrade; onOpen(src: string): void }) {
  const [note, setNote] = useState(t.note), [tags, setTags] = useState(t.tags.join(' '));
  useEffect(() => { setNote(t.note); setTags(t.tags.join(' ')); }, [t.id]);
  return (
    <div className={`j-row ${t.t1 == null ? 'open' : t.pnl > 0 ? 'win' : 'loss'}`}>
      <div className="j-main">
        <div className="j-head">
          <b>{t.sym}</b><span className={t.side > 0 ? 'pos' : 'neg'}>{t.side > 0 ? 'LONG' : 'SHORT'}</span>
          <span className="muted">{new Date(t.t0).toLocaleString('en-GB')}{t.t1 ? ` · ${dur(t.t1 - t.t0)}` : ' · open'}</span>
          <span style={{ flex: 1 }} />
          <b className={t.pnl >= 0 ? 'pos' : 'neg'}>{t.t1 == null ? 'open' : fmtUsd(t.pnl)}</b>
        </div>
        <div className="j-meta">Qty {t.qty} · entry {t.entry}{t.exit != null ? ` · exit ${t.exit}` : ''} · {t.fills} fill(s)
          <span className="stars">{[1, 2, 3, 4, 5].map(n => <span key={n} className={(t.rating || 0) >= n ? 'on' : ''} onClick={() => updateTrade(t.id, { rating: n })}>★</span>)}</span>
        </div>
        <textarea placeholder="What did you see in the order flow? Why did you enter / exit?" value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== t.note && updateTrade(t.id, { note })} />
        <div className="j-foot">
          <input placeholder="tags (space separated) e.g. absorption vwap" value={tags} onChange={e => setTags(e.target.value)} onBlur={() => updateTrade(t.id, { tags: tags.split(/\s+/).filter(Boolean) })} />
          <button className="mini-btn" onClick={() => { settings.set({ sym: t.sym }); location.hash = '#/chart'; }}>Open chart</button>
          <button className="mini-btn" onClick={() => { if (confirm('Delete this journal entry?')) deleteTrade(t.id); }}>Delete</button>
        </div>
      </div>
      <div className="j-shots">{t.shots.map(k => <Shot key={k} k={k} onOpen={onOpen} />)}{!t.shots.length && <div className="j-shot empty">no screenshot</div>}</div>
    </div>
  );
}

export function JournalPage() {
  const trades = journal.use(s => s.trades);
  const [q, setQ] = useState(''), [res, setRes] = useState<'all' | 'win' | 'loss' | 'open'>('all'), [big, setBig] = useState<string | null>(null);
  const shown = useMemo(() => trades.filter(t => (!q || (t.sym + ' ' + t.tags.join(' ') + ' ' + t.note).toLowerCase().includes(q.toLowerCase())) && (res === 'all' || (res === 'open' ? t.t1 == null : t.t1 != null && (res === 'win' ? t.pnl > 0 : t.pnl <= 0)))), [trades, q, res]);
  const s = journalStats(shown);
  const csv = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([journalCsv(shown)], { type: 'text/csv' })); a.download = 'flowscope-journal.csv'; a.click(); };
  return (
    <div className="page">
      <MenuBar active="journal" />
      <div className="journal">
        <div className="j-stats">
          {([['Trades', String(s.n)], ['Net P&L', fmtUsd(s.net)], ['Win rate', `${s.wr.toFixed(1)}%`], ['Profit factor', isFinite(s.pf) ? s.pf.toFixed(2) : '∞'], ['Avg win', fmtUsd(s.aw)], ['Avg loss', fmtUsd(-s.al)], ['Open', String(s.open)]] as [string, string][]).map(([k, v]) => <div key={k} className="kpi"><small>{k}</small><b className={k === 'Net P&L' ? (s.net >= 0 ? 'pos' : 'neg') : ''}>{v}</b></div>)}
        </div>
        <div className="j-tools">
          <input placeholder="Search symbol, tag or note" value={q} onChange={e => setQ(e.target.value)} />
          <span className="seg-mini big">{(['all', 'win', 'loss', 'open'] as const).map(r => <span key={r} className={res === r ? 'on' : ''} onClick={() => setRes(r)}>{r}</span>)}</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={csv} disabled={!shown.length}>Export CSV</button>
        </div>
        {shown.map(t => <Row key={t.id} t={t} onOpen={setBig} />)}
        {!shown.length && <p className="muted" style={{ padding: 30, textAlign: 'center' }}>No trades yet. Every paper trade from the order ticket is journaled here automatically, with a screenshot at entry and exit.</p>}
      </div>
      {big && <div className="modal-bg" onMouseDown={() => setBig(null)}><img src={big} alt="Chart screenshot" style={{ maxWidth: '94vw', maxHeight: '90vh', border: '1px solid #222831' }} /></div>}
    </div>
  );
}
