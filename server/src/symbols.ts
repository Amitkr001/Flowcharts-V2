import type { SymbolDef } from './types.ts';

/**
 * Symbol catalog. Edit freely — every entry is data-driven.
 *
 * Crypto (Aggregated): Perpetual futures and institutional spot merged into unified multi-venue tapes.
 *   Venues: Binance Futures, Bybit, OKX, Coinbase, Binance Spot.
 * Coinbase Institutional Spot: Dedicated Level-2 order book depth and direct trade matches.
 * Gate.io Spot: Live spot trades and altcoin liquidity.
 * Metals: Binance Futures TradFi perps (XAUUSDT / XAGUSDT) and Hyperliquid trade.xyz HIP-3 perps.
 * Indices / commodities: Hyperliquid trade.xyz HIP-3 perps (S&P 500, Nasdaq-100, WTI, Brent).
 * FX / other indices: price-only REST feed (no volume) — clearly labelled in the UI.
 * DEMO: built-in simulator so the app always works, even offline.
 */
export const SYMBOLS: SymbolDef[] = [
  // ---------- crypto (aggregated multi-venue) ----------
  { id: 'BTCUSD', name: 'BTCUSD', desc: 'Bitcoin · aggregated tape (perps & spot)', cls: 'crypto', tick: 0.1, row: 5, dec: 1, bigUsd: 200_000, bigQty: 3, contractUnit: 'BTC', volume: 'real',
    sources: [
      { ex: 'binance-f', sym: 'BTCUSDT' },
      { ex: 'bybit', sym: 'BTCUSDT' },
      { ex: 'okx', sym: 'BTC-USDT-SWAP', ct: 0.01 },
      { ex: 'coinbase', prod: 'BTC-USD' },
      { ex: 'binance-s', sym: 'BTCUSDT' },
    ],
    bookFrom: 0, klinesFrom: 0, venues: 'Binance F · Bybit · OKX · Coinbase · Binance Spot' },
  { id: 'ETHUSD', name: 'ETHUSD', desc: 'Ethereum · aggregated tape (perps & spot)', cls: 'crypto', tick: 0.01, row: 0.5, dec: 2, bigUsd: 100_000, bigQty: 40, contractUnit: 'ETH', volume: 'real',
    sources: [
      { ex: 'binance-f', sym: 'ETHUSDT' },
      { ex: 'bybit', sym: 'ETHUSDT' },
      { ex: 'okx', sym: 'ETH-USDT-SWAP', ct: 0.1 },
      { ex: 'coinbase', prod: 'ETH-USD' },
      { ex: 'binance-s', sym: 'ETHUSDT' },
    ],
    bookFrom: 0, klinesFrom: 0, venues: 'Binance F · Bybit · OKX · Coinbase · Binance Spot' },
  { id: 'SOLUSD', name: 'SOLUSD', desc: 'Solana · aggregated tape (perps & spot)', cls: 'crypto', tick: 0.01, row: 0.05, dec: 2, bigUsd: 50_000, bigQty: 300, contractUnit: 'SOL', volume: 'real',
    sources: [
      { ex: 'binance-f', sym: 'SOLUSDT' },
      { ex: 'bybit', sym: 'SOLUSDT' },
      { ex: 'okx', sym: 'SOL-USDT-SWAP', ct: 1 },
      { ex: 'coinbase', prod: 'SOL-USD' },
      { ex: 'binance-s', sym: 'SOLUSDT' },
    ],
    bookFrom: 0, klinesFrom: 0, venues: 'Binance F · Bybit · OKX · Coinbase · Binance Spot' },
  { id: 'XRPUSD', name: 'XRPUSD', desc: 'XRP · aggregated perps', cls: 'crypto', tick: 0.0001, row: 0.001, dec: 4, bigUsd: 50_000, bigQty: 30_000, contractUnit: 'XRP', volume: 'real',
    sources: [{ ex: 'binance-f', sym: 'XRPUSDT' }, { ex: 'bybit', sym: 'XRPUSDT' }, { ex: 'okx', sym: 'XRP-USDT-SWAP', ct: 100 }],
    bookFrom: 0, klinesFrom: 0, venues: 'Binance · Bybit · OKX' },
  { id: 'DOGEUSD', name: 'DOGEUSD', desc: 'Dogecoin · aggregated perps', cls: 'crypto', tick: 0.00001, row: 0.0002, dec: 5, bigUsd: 50_000, bigQty: 300_000, contractUnit: 'DOGE', volume: 'real',
    sources: [{ ex: 'binance-f', sym: 'DOGEUSDT' }, { ex: 'bybit', sym: 'DOGEUSDT' }, { ex: 'okx', sym: 'DOGE-USDT-SWAP', ct: 1000 }],
    bookFrom: 0, klinesFrom: 0, venues: 'Binance · Bybit · OKX' },
  { id: 'HYPEUSD', name: 'HYPEUSD', desc: 'Hyperliquid HYPE perp', cls: 'crypto', tick: 0.001, row: 0.02, dec: 3, bigUsd: 50_000, bigQty: 1_500, contractUnit: 'HYPE', volume: 'real',
    sources: [{ ex: 'hl', coin: 'HYPE', sig: 4 }], bookFrom: 0, klinesFrom: 0, venues: 'Hyperliquid' },

  // ---------- Coinbase Institutional Spot ----------
  { id: 'BTC-USD', name: 'BTC-USD (Coinbase)', desc: 'Bitcoin USD · Coinbase Spot & Level-2 Book', cls: 'crypto', tick: 0.01, row: 5, dec: 2, bigUsd: 150_000, bigQty: 2, contractUnit: 'BTC', volume: 'real',
    sources: [{ ex: 'coinbase', prod: 'BTC-USD' }], bookFrom: 0, klinesFrom: 0, venues: 'Coinbase' },
  { id: 'ETH-USD', name: 'ETH-USD (Coinbase)', desc: 'Ethereum USD · Coinbase Spot & Level-2 Book', cls: 'crypto', tick: 0.01, row: 0.5, dec: 2, bigUsd: 75_000, bigQty: 30, contractUnit: 'ETH', volume: 'real',
    sources: [{ ex: 'coinbase', prod: 'ETH-USD' }], bookFrom: 0, klinesFrom: 0, venues: 'Coinbase' },
  { id: 'SOL-USD', name: 'SOL-USD (Coinbase)', desc: 'Solana USD · Coinbase Spot & Level-2 Book', cls: 'crypto', tick: 0.01, row: 0.05, dec: 2, bigUsd: 40_000, bigQty: 250, contractUnit: 'SOL', volume: 'real',
    sources: [{ ex: 'coinbase', prod: 'SOL-USD' }], bookFrom: 0, klinesFrom: 0, venues: 'Coinbase' },

  // ---------- Gate.io Spot ----------
  { id: 'BTC_GATE', name: 'BTC_USDT (Gate.io)', desc: 'Bitcoin USDT · Gate.io Spot', cls: 'crypto', tick: 0.1, row: 5, dec: 1, bigUsd: 100_000, bigQty: 1.5, contractUnit: 'BTC', volume: 'real',
    sources: [{ ex: 'gate', pair: 'BTC_USDT' }], bookFrom: -1, klinesFrom: 0, venues: 'Gate.io' },

  // ---------- metals ----------
  { id: 'XAUUSDT', name: 'XAUUSDT', desc: 'Gold · Binance Futures TradFi perp', cls: 'metal', tick: 0.01, row: 0.5, dec: 2, bigUsd: 50_000, bigQty: 20, contractUnit: 'oz', volume: 'real',
    sources: [{ ex: 'binance-f', sym: 'XAUUSDT' }], bookFrom: 0, klinesFrom: 0, venues: 'Binance Futures' },
  { id: 'XAGUSDT', name: 'XAGUSDT', desc: 'Silver · Binance Futures TradFi perp', cls: 'metal', tick: 0.001, row: 0.02, dec: 3, bigUsd: 20_000, bigQty: 600, contractUnit: 'oz', volume: 'real',
    sources: [{ ex: 'binance-f', sym: 'XAGUSDT' }], bookFrom: 0, klinesFrom: 0, venues: 'Binance Futures' },
  { id: 'GOLD', name: 'GOLD', desc: 'Gold · Hyperliquid trade.xyz perp', cls: 'metal', tick: 0.1, row: 0.5, dec: 1, bigUsd: 50_000, bigQty: 20, contractUnit: 'oz', volume: 'real',
    sources: [{ ex: 'hl', coin: 'xyz:GOLD', sig: 4 }], bookFrom: 0, klinesFrom: 0, venues: 'Hyperliquid · trade.xyz' },
  { id: 'SILVER', name: 'SILVER', desc: 'Silver · Hyperliquid trade.xyz perp', cls: 'metal', tick: 0.001, row: 0.02, dec: 3, bigUsd: 15_000, bigQty: 500, contractUnit: 'oz', volume: 'real',
    sources: [{ ex: 'hl', coin: 'xyz:SILVER', sig: 4 }], bookFrom: 0, klinesFrom: 0, venues: 'Hyperliquid · trade.xyz' },

  // ---------- indices ----------
  { id: 'SP500', name: 'SP500', desc: 'S&P 500 · Hyperliquid trade.xyz perp', cls: 'index', tick: 0.1, row: 1, dec: 1, bigUsd: 15_000, bigQty: 2, contractUnit: 'units', volume: 'real',
    sources: [{ ex: 'hl', coin: 'xyz:SP500', sig: 4 }], bookFrom: 0, klinesFrom: 0, venues: 'Hyperliquid · trade.xyz' },
  { id: 'NDX', name: 'NDX', desc: 'Nasdaq-100 (XYZ100) · Hyperliquid trade.xyz perp', cls: 'index', tick: 1, row: 5, dec: 0, bigUsd: 25_000, bigQty: 1, contractUnit: 'units', volume: 'real',
    sources: [{ ex: 'hl', coin: 'xyz:XYZ100', sig: 4 }], bookFrom: 0, klinesFrom: 0, venues: 'Hyperliquid · trade.xyz' },

  // ---------- commodities ----------
  { id: 'WTI', name: 'WTI', desc: 'WTI crude oil · Hyperliquid trade.xyz perp', cls: 'commodity', tick: 0.001, row: 0.05, dec: 3, bigUsd: 20_000, bigQty: 250, contractUnit: 'bbl', volume: 'real',
    sources: [{ ex: 'hl', coin: 'xyz:CL', sig: 4 }], bookFrom: 0, klinesFrom: 0, venues: 'Hyperliquid · trade.xyz' },
  { id: 'BRENT', name: 'BRENT', desc: 'Brent crude oil · Hyperliquid trade.xyz perp', cls: 'commodity', tick: 0.001, row: 0.05, dec: 3, bigUsd: 20_000, bigQty: 250, contractUnit: 'bbl', volume: 'real',
    sources: [{ ex: 'hl', coin: 'xyz:BRENTOIL', sig: 4 }], bookFrom: 0, klinesFrom: 0, venues: 'Hyperliquid · trade.xyz' },

  // ---------- price-only (no real volume via free feeds) — symbol names per biquote.io, verify at https://biquote.io/api/symbols
  { id: 'EURUSD', name: 'EURUSD', desc: 'Euro / US Dollar · price only', cls: 'fx', tick: 0.00001, row: 0.0001, dec: 5, bigUsd: 1e12, bigQty: 1e12, contractUnit: 'units', volume: 'none',
    sources: [{ ex: 'poll', sym: 'EURUSD' }], bookFrom: -1, klinesFrom: -1, venues: 'biquote.io (price only)' },
  { id: 'GER40', name: 'GER40', desc: 'DAX 40 CFD · price only', cls: 'index', tick: 0.1, row: 5, dec: 1, bigUsd: 1e12, bigQty: 1e12, contractUnit: 'units', volume: 'none',
    sources: [{ ex: 'poll', sym: 'GER40' }], bookFrom: -1, klinesFrom: -1, venues: 'biquote.io (price only)' },
  { id: 'JP225', name: 'JP225', desc: 'Nikkei 225 CFD · price only', cls: 'index', tick: 1, row: 10, dec: 0, bigUsd: 1e12, bigQty: 1e12, contractUnit: 'units', volume: 'none',
    sources: [{ ex: 'poll', sym: 'JP225' }], bookFrom: -1, klinesFrom: -1, venues: 'biquote.io (price only)' },

  // ---------- demo ----------
  { id: 'DEMO', name: 'DEMO', desc: 'Simulated order flow (always available)', cls: 'demo', tick: 0.5, row: 5, dec: 1, bigUsd: 250_000, bigQty: 5, contractUnit: 'BTC', volume: 'real',
    sources: [{ ex: 'sim', base: 67250, vol: 1.6 }], bookFrom: 0, klinesFrom: 0, venues: 'Simulator' },
];

export const SYMBOL_MAP = new Map(SYMBOLS.map(s => [s.id, s]));
