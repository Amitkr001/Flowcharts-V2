import { createStore, loadRaw, saveRaw } from './store';

/** Base URL of the FlowScope server. Empty = same origin (production). */
export const API_BASE: string = (import.meta as any).env?.VITE_API_URL || '';

export interface User { id: string; email: string; name: string }
export const session = createStore<{ token: string | null; user: User | null }>(loadRaw('fs.session', { token: null, user: null }));
session.subscribe(() => saveRaw('fs.session', session.get()));

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const tok = session.get().token;
  const r = await fetch(API_BASE + path, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && tok && path.startsWith('/api/docs')) session.set({ token: null, user: null });
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  return j as T;
}

export function setSession(token: string, user: User) { session.set({ token, user }); }
export function logout() { session.set({ token: null, user: null }); }

/* ---- per-user documents: localStorage always, cloud when signed in (debounced) ---- */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function saveDoc(kind: string, data: unknown) {
  saveRaw(`fs.doc.${kind}`, data);
  if (!session.get().token) return;
  clearTimeout(timers.get(kind));
  timers.set(kind, setTimeout(() => { api(`/api/docs/${kind}`, { method: 'PUT', body: { data } }).catch(() => {}); }, 1200));
}
export function localDoc<T>(kind: string, fallback: T): T { return loadRaw(`fs.doc.${kind}`, fallback); }
export async function pullDoc<T>(kind: string): Promise<T | null> {
  if (!session.get().token) return null;
  try { const r = await api<{ data: T | null }>(`/api/docs/${kind}`); if (r.data != null) saveRaw(`fs.doc.${kind}`, r.data); return r.data; }
  catch { return null; }
}

/* ---- toasts ---- */
export const toasts = createStore<{ msg: string; n: number }>({ msg: '', n: 0 });
export const toast = (msg: string) => toasts.set(s => ({ msg, n: s.n + 1 }));
