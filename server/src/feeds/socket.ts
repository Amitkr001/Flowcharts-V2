import https from 'node:https';
import dns from 'node:dns';
import { log } from '../log.ts';

const dnsResolver = new dns.promises.Resolver();
dnsResolver.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1']);

function resilientGet<T = any>(urlStr: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.get(u, {
      headers: { 'User-Agent': 'FlowScope/1.0', Accept: 'application/json' },
      timeout: timeoutMs,
      lookup: (hostname, options, callback) => {
        const cb = typeof options === 'function' ? options : callback;
        const isAll = typeof options === 'object' && options && (options as any).all;
        dnsResolver.resolve4(hostname).then(ips => {
          if (isAll) cb(null, ips.map(a => ({ address: a, family: 4 } as any)));
          else cb(null, ips[0], 4);
        }).catch(err => {
          dns.lookup(hostname, options as any, cb);
        });
      },
    }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} ${urlStr}`));
      }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout fetching ${urlStr}`));
    });
  });
}

interface Handlers {
  open?(s: LiveSocket): void;
  msg(data: any): void;
  /** Return a heartbeat message to send every pingMs, or null. */
  ping?(): string | null;
  pingMs?: number;
  close?(): void;
}

/**
 * Auto-reconnecting WebSocket client built on Node's global WebSocket (Node >= 22).
 * Exponential backoff up to 30 s; resets after a successful open. Reconnects if silent for 90 s.
 * Supports multiple fallback URLs rotated on failure.
 */
export class LiveSocket {
  ws: WebSocket | null = null;
  ok = false;
  name: string;
  urls: string[];
  urlIdx = 0;
  private h: Handlers;
  private retry = 0;
  private hb: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private lastMsg = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(name: string, url: string | string[], h: Handlers) {
    this.name = name;
    this.urls = Array.isArray(url) ? url : [url];
    this.h = h;
  }

  get currentUrl(): string {
    return this.urls[this.urlIdx % this.urls.length];
  }

  start(): this { this.connect(); return this; }

  stop(): void {
    this.stopped = true;
    if (this.hb) clearInterval(this.hb);
    if (this.watchdog) clearInterval(this.watchdog);
    try { this.ws?.close(); } catch { /* ignore */ }
  }

  send(o: unknown): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  }

  private connect(): void {
    if (this.stopped) return;
    const url = this.currentUrl;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      log.warn(`[${this.name}] connect failed to ${url}: ${(e as Error).message}`);
      this.urlIdx++;
      return this.schedule();
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.ok = true;
      this.retry = 0;
      this.lastMsg = Date.now();
      log.info(`[${this.name}] connected via ${url}`);
      this.h.open?.(this);
      if (this.h.ping) this.hb = setInterval(() => { const m = this.h.ping!(); if (m) this.send(m); }, this.h.pingMs ?? 20_000);
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastMsg > 300_000) {
          log.warn(`[${this.name}] silent, reconnecting`);
          try { ws.close(); } catch { /* */ }
        }
      }, 60_000);
    };
    ws.onmessage = (e) => {
      this.lastMsg = Date.now();
      const raw = typeof e.data === 'string' ? e.data : Buffer.from(e.data as ArrayBuffer).toString('utf8');
      if (raw === 'pong') return;
      let d: unknown;
      try { d = JSON.parse(raw); } catch { return; }
      try { this.h.msg(d); } catch (err) { log.warn(`[${this.name}] handler error: ${(err as Error).message}`); }
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      if (this.hb) clearInterval(this.hb);
      if (this.watchdog) clearInterval(this.watchdog);
      this.hb = this.watchdog = null;
      if (this.ok) log.warn(`[${this.name}] disconnected`);
      this.ok = false;
      this.h.close?.();
      this.urlIdx++;
      this.schedule();
    };
  }

  private schedule(): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }
}

export async function getJSON<T = any>(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { 'User-Agent': 'FlowScope/1.0', ...(init?.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return await r.json() as T;
  } catch (err) {
    if (url.includes('binance') && (!init || !init.method || init.method.toUpperCase() === 'GET')) {
      try {
        return await resilientGet<T>(url, timeoutMs);
      } catch (e2) {
        throw err;
      }
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}
