/**
 * High-value derivative feeds:
 *   Liquidations   Binance  <sym>@forceOrder        (USDⓈ-M futures, market route)
 *                  Bybit    allLiquidation.<sym>    (v5 linear)
 *                  OKX      liquidation-orders      (channel, instType=SWAP)
 *   Open interest  Binance  /fapi/v1/openInterest   + /fapi/v1/premiumIndex (funding, mark)
 *                  Bybit    /v5/market/open-interest
 *                  Hyperliq /info {type:'metaAndAssetCtxs'}
 */
import type { FeedEvents, SymbolDef } from '../types.ts';
import { ENDPOINTS, type Running } from './exchanges.ts';
import { LiveSocket, getJSON } from './socket.ts';
import { simGen } from './sim.ts';
import { log } from '../log.ts';

const POLL_MS = Number(process.env.DERIV_POLL_MS) || 15_000;

export function startDerivs(def: SymbolDef, ev: FeedEvents): Running {
  const stops: (() => void)[] = [], id = def.id;
  let polled = false;
  for (const src of def.sources) {
    if (src.ex === 'binance-f') {
      const liqUrls = (Array.isArray(ENDPOINTS.binanceFutMarket) ? ENDPOINTS.binanceFutMarket : [ENDPOINTS.binanceFutMarket])
        .map(u => `${u}?streams=${src.sym.toLowerCase()}@forceOrder`);
      const s = new LiveSocket(`binance-f:${src.sym}:liq`, liqUrls, {
        msg: (m) => {
          const o = (m.data ?? m).o; if (!o) return;
          ev.liq(id, { t: +o.T, p: +o.ap || +o.p, q: +o.z || +o.q, s: o.S === 'BUY' ? 1 : -1, ex: 'binance-f' });
        },
      }).start();
      stops.push(() => s.stop());
      if (!polled) { polled = true; stops.push(pollBinance(id, src.sym, ev)); }
    } else if (src.ex === 'bybit') {
      const sym = src.sym;
      const s = new LiveSocket(`bybit:${sym}:liq`, ENDPOINTS.bybitWs, {
        open: so => so.send({ op: 'subscribe', args: [`allLiquidation.${sym}`] }),
        ping: () => JSON.stringify({ op: 'ping' }), pingMs: 20_000,
        msg: (m) => {
          if (!m.topic?.startsWith('allLiquidation') || !Array.isArray(m.data)) return;
          // Bybit: S = position side. "Buy" = a long was liquidated → forced sell.
          for (const d of m.data) ev.liq(id, { t: +d.T, p: +d.p, q: +d.v, s: d.S === 'Buy' ? -1 : 1, ex: 'bybit' });
        },
      }).start();
      stops.push(() => s.stop());
    } else if (src.ex === 'okx') {
      const inst = src.sym, ct = src.ct;
      const s = new LiveSocket(`okx:${inst}:liq`, ENDPOINTS.okxWs, {
        open: so => so.send({ op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] }),
        ping: () => 'ping', pingMs: 25_000,
        msg: (m) => {
          if (m.arg?.channel !== 'liquidation-orders' || !Array.isArray(m.data)) return;
          for (const d of m.data) {
            if (d.instId !== inst) continue;
            for (const x of d.details || []) ev.liq(id, { t: +x.ts, p: +x.bkPx, q: +x.sz * ct, s: x.side === 'buy' ? 1 : -1, ex: 'okx' });
          }
        },
      }).start();
      stops.push(() => s.stop());
    } else if (src.ex === 'hl' && !polled) {
      polled = true; stops.push(pollHL(id, src.coin, ev));
    } else if (src.ex === 'sim') {
      stops.push(simDerivs(def, ev));
    }
  }
  return { stop: () => stops.forEach(f => f()) };
}

function loop(fn: () => Promise<void>): () => void {
  let stop = false, fails = 0;
  const go = async () => {
    if (stop) return;
    try { await fn(); fails = 0; } catch (e) { if (++fails === 3) log.warn(`deriv poll: ${(e as Error).message}`); }
    setTimeout(go, fails > 3 ? POLL_MS * 4 : POLL_MS);
  };
  go();
  return () => { stop = true; };
}

function pollBinance(id: string, sym: string, ev: FeedEvents) {
  return loop(async () => {
    const [pi, oi] = await Promise.all([
      getJSON<any>(`${ENDPOINTS.binanceFutRest}/fapi/v1/premiumIndex?symbol=${sym}`),
      getJSON<any>(`${ENDPOINTS.binanceFutRest}/fapi/v1/openInterest?symbol=${sym}`),
    ]);
    ev.deriv(id, { t: Date.now(), oi: +oi.openInterest, fr: +pi.lastFundingRate, mark: +pi.markPrice });
  });
}

function pollHL(id: string, coin: string, ev: FeedEvents) {
  const dex = coin.includes(':') ? coin.split(':')[0] : undefined, short = coin.split(':').pop();
  return loop(async () => {
    const r = await getJSON<any>(ENDPOINTS.hlRest, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' }) });
    const uni: { name: string }[] = r?.[0]?.universe || [], ctxs: any[] = r?.[1] || [];
    let i = uni.findIndex(u => u.name === coin); if (i < 0) i = uni.findIndex(u => u.name === short);
    if (i < 0 || !ctxs[i]) throw new Error(`hyperliquid ctx not found for ${coin}`);
    const c = ctxs[i];
    ev.deriv(id, { t: Date.now(), oi: +c.openInterest, fr: +c.funding, mark: +c.markPx });
  });
}

/** DEMO: plausible liquidations and open interest so every feature is visible offline. */
function simDerivs(def: SymbolDef, ev: FeedEvents) {
  const g = simGen(def);
  let oi = 52_000;
  const a = setInterval(() => {
    oi = Math.max(1000, oi * (1 + (Math.random() - 0.5) * 0.004));
    ev.deriv(def.id, { t: Date.now(), oi, fr: 0.0001 + (Math.random() - 0.5) * 0.0002, mark: g.p });
  }, POLL_MS);
  let tm: ReturnType<typeof setTimeout>;
  const liq = () => {
    const s = Math.random() < 0.5 ? 1 : -1, q = Math.exp(Math.random() * 3) * 0.2;
    ev.liq(def.id, { t: Date.now(), p: g.p + s * def.tick * 4, q, s, ex: 'sim' });
    tm = setTimeout(liq, 2000 + Math.random() * 9000);
  };
  liq();
  ev.deriv(def.id, { t: Date.now(), oi, fr: 0.0001, mark: g.p });
  return () => { clearInterval(a); clearTimeout(tm); };
}
