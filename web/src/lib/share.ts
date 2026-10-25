/**
 * Shareable chart links. The link carries symbol, bar type, chart style, overlays and drawings,
 * compressed (deflate) and base64url-encoded in the URL hash — nothing is uploaded to the server.
 */
import type { ChartStyle, Drawing, Overlays } from './types';

export interface SharePayload { v: 1; sym: string; spec: string; style: ChartStyle; ov?: Partial<Overlays>; drawings: Drawing[] }

const b64u = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s: string) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const hasCS = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(u8: Uint8Array, s: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([u8 as BlobPart]).stream().pipeThrough(s));
  return new Uint8Array(await out.arrayBuffer());
}

export async function makeShareLink(p: SharePayload): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(p));
  const code = hasCS() ? 'z' + b64u(await pipe(raw, new CompressionStream('deflate-raw'))) : 'j' + b64u(raw);
  return `${location.origin}${location.pathname}#/chart?share=${code}`;
}

export async function readShare(): Promise<SharePayload | null> {
  const m = location.hash.match(/[?&]share=([A-Za-z0-9_-]+)/); if (!m) return null;
  try {
    const code = m[1], bytes = unb64u(code.slice(1));
    const json = code[0] === 'z' ? new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw'))) : new TextDecoder().decode(bytes);
    const p = JSON.parse(json) as SharePayload;
    return p && p.v === 1 && typeof p.sym === 'string' ? p : null;
  } catch { return null; }
  finally { history.replaceState(null, '', `${location.pathname}#/chart`); }
}
