/**
 * Trade journal — every paper round-trip is recorded automatically (entry → flat), with a chart screenshot
 * at entry and exit. Notes, tags and a 1-5 rating are editable on the Journal page.
 * Trades sync to the cloud when signed in; screenshots stay in this browser (IndexedDB).
 */
import { createStore } from './store';
import { localDoc, saveDoc, pullDoc } from './api';
import { uid } from './format';
import { idb, shrink } from './idb';

export interface JTrade {
  id: string; sym: string; side: 1 | -1;
  t0: number; t1?: number;
  qty: number; entry: number; exit?: number; pnl: number; fills: number;
  note: string; tags: string[]; rating?: number;
  shots: string[];
}

export const journal = createStore<{ trades: JTrade[] }>({ trades: localDoc<JTrade[]>('journal', []) });
const save = () => saveDoc('journal', journal.get().trades.slice(0, 1000));
export async function syncJournalFromCloud() { const r = await pullDoc<JTrade[]>('journal'); if (r) journal.set({ trades: r }); }

export function updateTrade(id: string, patch: Partial<JTrade>) { journal.set(s => ({ trades: s.trades.map(t => t.id === id ? { ...t, ...patch } : t) })); save(); }
export async function deleteTrade(id: string) {
  const t = journal.get().trades.find(x => x.id === id);
  journal.set(s => ({ trades: s.trades.filter(x => x.id !== id) })); save();
  for (const k of t?.shots || []) await idb.del(k);
}

async function snap(shot?: () => string | null): Promise<string | null> {
  try { const png = shot?.(); if (!png) return null; const k = uid(); await idb.put(k, await shrink(png)); return k; } catch { return null; }
}

/** Called by the paper broker after every fill. */
export async function recordFill(sym: string, px: number, pnl: number, posBefore: number, posAfter: number, avg: number, shot?: () => string | null) {
  const trades = journal.get().trades;
  const open = trades.find(t => t.sym === sym && t.t1 == null);
  const now = Date.now();
  const startNew = async (pos: number, entry: number) => {
    const k = await snap(shot);
    const t: JTrade = { id: uid(), sym, side: pos > 0 ? 1 : -1, t0: now, qty: Math.abs(pos), entry, pnl: 0, fills: 1, note: '', tags: [], shots: k ? [k] : [] };
    journal.set(s => ({ trades: [t, ...s.trades] }));
  };
  if (!open) { if (posAfter !== 0) await startNew(posAfter, avg || px); save(); return; }
  const flipped = posAfter !== 0 && Math.sign(posAfter) !== Math.sign(posBefore);
  if (posAfter === 0 || flipped) {
    const k = await snap(shot);
    updateTrade(open.id, { t1: now, exit: px, pnl: open.pnl + pnl, fills: open.fills + 1, shots: k ? [...open.shots, k] : open.shots });
    if (flipped) await startNew(posAfter, px);
  } else {
    updateTrade(open.id, { fills: open.fills + 1, qty: Math.max(open.qty, Math.abs(posAfter)), entry: avg || open.entry, pnl: open.pnl + pnl });
  }
  save();
}

export function journalStats(ts: JTrade[]) {
  const done = ts.filter(t => t.t1 != null), w = done.filter(t => t.pnl > 0), l = done.filter(t => t.pnl <= 0);
  const gw = w.reduce((a, t) => a + t.pnl, 0), gl = -l.reduce((a, t) => a + t.pnl, 0);
  return { n: done.length, open: ts.length - done.length, net: gw - gl, wr: done.length ? (w.length / done.length) * 100 : 0, pf: gl ? gw / gl : gw ? Infinity : 0, aw: w.length ? gw / w.length : 0, al: l.length ? gl / l.length : 0 };
}

export function journalCsv(ts: JTrade[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [['symbol', 'side', 'entry_time', 'exit_time', 'qty', 'entry', 'exit', 'pnl', 'fills', 'rating', 'tags', 'note'].join(',')];
  for (const t of ts) rows.push([t.sym, t.side > 0 ? 'long' : 'short', new Date(t.t0).toISOString(), t.t1 ? new Date(t.t1).toISOString() : '', t.qty, t.entry, t.exit ?? '', t.pnl.toFixed(2), t.fills, t.rating ?? '', esc(t.tags.join(' ')), esc(t.note)].join(','));
  return rows.join('\n');
}
