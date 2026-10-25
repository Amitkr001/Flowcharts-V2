/** Tiny IndexedDB key/value store for journal screenshots (too big for localStorage). */
const DB = 'flowscope', STORE = 'shots';
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ||= new Promise((ok, bad) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  }));
}
function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(d => new Promise<T>((ok, bad) => { const q = f(d.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => ok(q.result as T); q.onerror = () => bad(q.error); }));
}
export const idb = {
  get: (k: string) => tx<string | undefined>('readonly', s => s.get(k)).catch(() => undefined),
  put: (k: string, v: string) => tx<IDBValidKey>('readwrite', s => s.put(v, k)).catch(() => undefined),
  del: (k: string) => tx<undefined>('readwrite', s => s.delete(k)).catch(() => undefined),
};

/** Downscale a PNG data URL to a JPEG thumbnail (keeps the journal small). */
export function shrink(src: string, maxW = 900, q = 0.72): Promise<string> {
  return new Promise(ok => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxW / img.width), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => ok(src);
    img.src = src;
  });
}
