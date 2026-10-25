/**
 * Toaster — stacked notifications (top-centre over the chart). Newest on top, max 4 visible,
 * auto-dismiss after 4 s (alerts stay 8 s), hover pauses, click × to dismiss. Same `toast()` API as before.
 */
import { useEffect, useRef, useState } from 'react';
import { toasts } from '../lib/api';
import { I } from './ui/Icons';

interface T { id: number; msg: string; kind: 'alert' | 'ok' | 'err' | 'info'; at: number; ttl: number }
const kindOf = (m: string): T['kind'] => m.startsWith('🔔') ? 'alert' : /fail|error|not |blocked|unavailable|no open/i.test(m) ? 'err' : /bought|sold|saved|copied|added|set|loaded|cancelled|moved/i.test(m) ? 'ok' : 'info';
const ICON: Record<T['kind'], string> = { alert: 'bell', ok: 'check', err: 'alert', info: 'info' };

export function Toast() {
  const t = toasts.use(s => s);
  const [list, setList] = useState<T[]>([]), hover = useRef(false);
  useEffect(() => {
    if (!t.n || !t.msg) return;
    const kind = kindOf(t.msg), msg = t.msg.replace(/^🔔\s*/, '');
    setList(l => [{ id: t.n, msg, kind, at: Date.now(), ttl: kind === 'alert' ? 8000 : 4000 }, ...l].slice(0, 4));
  }, [t.n]);
  useEffect(() => {
    const h = setInterval(() => { if (!hover.current) setList(l => l.filter(x => Date.now() - x.at < x.ttl)); }, 300);
    return () => clearInterval(h);
  }, []);
  return (
    <div className="toaster" role="status" aria-live="polite" onMouseEnter={() => { hover.current = true; }} onMouseLeave={() => { hover.current = false; setList(l => l.map(x => ({ ...x, at: Date.now() }))); }}>
      {list.map(x => (
        <div key={x.id} className={`toast2 ${x.kind}`}>
          <span className="t-ic"><I n={ICON[x.kind]} s={15} /></span>
          <span className="t-msg">{x.msg}</span>
          <button className="t-x" aria-label="Dismiss" onClick={() => setList(l => l.filter(y => y.id !== x.id))}><I n="x" s={13} /></button>
        </div>
      ))}
    </div>
  );
}
