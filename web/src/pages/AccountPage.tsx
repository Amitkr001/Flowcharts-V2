/** Account: sign in / register (sync across devices), trading preferences, data export / import. */
import { useState, type FormEvent } from 'react';
import { MenuBar } from '../components/MenuBar';
import { I } from '../components/ui/Icons';
import { api, session, setSession, logout, toast, type User } from '../lib/api';
import { settings, syncFromCloud, drawingsStore } from '../lib/settings';
import { scripts, syncScripts } from '../indicators/runtime';
import { alerts, syncAlertsFromCloud } from '../lib/alerts';
import { journal, syncJournalFromCloud } from '../lib/journal';
import { net } from '../data/client';
import { loadRaw, saveRaw } from '../lib/store';

function Auth() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [name, setName] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api<{ token: string; user: User }>(`/api/auth/${mode}`, { body: { email, password: pw, name } });
      setSession(r.token, r.user);
      await Promise.all([syncFromCloud(), syncScripts(), syncAlertsFromCloud(), syncJournalFromCloud()]);
      toast(mode === 'login' ? `Welcome back, ${r.user.name}` : 'Account created — your layout now syncs');
    } catch (e2) { setErr((e2 as Error).message); }
    setBusy(false);
  };
  return (
    <div className="ac-card ac-auth">
      <div className="tabs-u" role="tablist">
        <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
        <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Create account</button>
      </div>
      <form onSubmit={submit} className="ac-form">
        {mode === 'register' && <label className="f2">Name<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>}
        <label className="f2">Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
        <label className="f2">Password<input type="password" required minLength={8} value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {mode === 'register' && <p className="hint">At least 8 characters.</p>}
        {err && <div className="sc-err"><I n="alert" s={14} /><span>{err}</span></div>}
        <button className="btn pri" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="hint">Signing in syncs settings, drawings, scripts, alerts and your trade journal across devices. Everything also works without an account — it's saved in this browser.</p>
    </div>
  );
}

export function AccountPage() {
  const user = session.use(s => s.user), st = settings.use(s => s), syms = net.use(s => s.symbols);
  const nScripts = scripts.use(s => s.list.length), nAlerts = alerts.use(s => s.rules.length), nTrades = journal.use(s => s.trades.length);
  const nDraw = Object.values(drawingsStore.use(s => s.bySym)).reduce((a, l) => a + l.length, 0);
  const [syncing, setSyncing] = useState(false);
  const sync = async () => { setSyncing(true); await Promise.all([syncFromCloud(), syncScripts(), syncAlertsFromCloud(), syncJournalFromCloud()]); setSyncing(false); toast('Synced from the cloud'); };
  const exportAll = () => {
    const keys = ['settings', 'drawings', 'scripts', 'alerts', 'journal'], out: Record<string, unknown> = { flowscope: 1, at: new Date().toISOString() };
    for (const k of keys) out[k] = loadRaw(`fs.doc.${k}`, null);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })); a.download = 'flowscope-backup.json'; a.click();
  };
  const importAll = (f: File) => f.text().then(t => {
    try { const j = JSON.parse(t); if (!j.flowscope) throw new Error('not a FlowScope backup');
      for (const k of ['settings', 'drawings', 'scripts', 'alerts', 'journal']) if (j[k] != null) saveRaw(`fs.doc.${k}`, j[k]);
      toast('Backup restored — reloading'); setTimeout(() => location.reload(), 800);
    } catch (e) { toast('Import failed: ' + (e as Error).message); }
  });
  const big = (id: string, v: number) => settings.set(s => { const bigUsd = { ...s.bigUsd }; if (v > 0) bigUsd[id] = v; else delete bigUsd[id]; return { bigUsd }; });

  return (
    <div className="page">
      <MenuBar active="account" />
      <div className="ac-wrap">
        <div className="ac-grid">
          {user ? (
            <div className="ac-card">
              <div className="ac-prof"><span className="avatar lg">{user.name.slice(0, 1).toUpperCase()}</span><div><b>{user.name}</b><small className="muted">{user.email}</small></div><span className="grow" /><span className="conn ok"><i />Syncing</span></div>
              <div className="ac-stats">
                {([['Drawings', nDraw], ['Scripts', nScripts], ['Alerts', nAlerts], ['Journal trades', nTrades]] as [string, number][]).map(([k, v]) => <div key={k} className="kpi"><small>{k}</small><b className="mono">{v}</b></div>)}
              </div>
              <div className="ac-row"><button className="btn" onClick={sync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button><button className="btn" onClick={() => { logout(); toast('Signed out — your data stays in this browser'); }}>Sign out</button></div>
            </div>
          ) : <Auth />}

          <div className="ac-card">
            <h3>Paper trading</h3>
            <div className="g2">
              <label className="f2">Account size ($)<input type="number" min={100} step={100} value={st.acct.size} onChange={e => settings.set(s => ({ acct: { ...s.acct, size: Math.max(100, +e.target.value) } }))} /></label>
              <label className="f2">Risk per trade (%)<input type="number" min={0.1} max={10} step={0.1} value={st.acct.risk} onChange={e => settings.set(s => ({ acct: { ...s.acct, risk: Math.max(0.1, +e.target.value) } }))} /></label>
            </div>
            <p className="hint">Used by the order ticket (% buttons) and the long/short position tools to size positions.</p>
          </div>

          <div className="ac-card wide">
            <h3>Big-trade thresholds</h3>
            <p className="hint">A print (or aggregated burst) at or above this USD value is a "big trade": bubbles, the big-trade log and alerts. Leave empty for the default.</p>
            <div className="ac-big">
              {syms.filter(s => s.volume === 'real').map(s => (
                <label key={s.id} className="f2 row"><span><b>{s.id}</b> <small className="muted">default ${(s.bigUsd / 1000).toFixed(0)}K</small></span>
                  <input type="number" min={0} step={10000} placeholder={String(s.bigUsd)} value={st.bigUsd[s.id] ?? ''} onChange={e => big(s.id, +e.target.value)} /></label>))}
            </div>
          </div>

          <div className="ac-card">
            <h3>Backup</h3>
            <p className="hint">Download everything stored in this browser (settings, drawings, scripts, alerts, journal) or restore a backup.</p>
            <div className="ac-row">
              <button className="btn" onClick={exportAll}><I n="share" s={14} />Export backup</button>
              <label className="btn"><I n="copy" s={14} />Import backup<input type="file" accept="application/json" hidden onChange={e => e.target.files?.[0] && importAll(e.target.files[0])} /></label>
            </div>
          </div>

          <div className="ac-card">
            <h3>About</h3>
            <p className="hint">FlowScope — order-flow charting with aggregated crypto, metals and index perpetuals. Market data comes from public exchange feeds; paper trading only, no real orders are sent. Not investment advice.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
