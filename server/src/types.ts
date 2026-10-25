/** 1 = buyer was the aggressor (lifted the offer), -1 = seller hit the bid. */
export type Side = 1 | -1;

/** Normalised trade from any venue. q is in base units (BTC, oz, index units…). */
export interface Trade { t: number; p: number; q: number; s: Side; ex: string }

/** Compact wire / storage format: [timeMs, price, qty, side, venueIndex]. */
export type Tick = [number, number, number, Side, number?];

/** Heatmap column: time + resting liquidity per binned price ([price, size, side]). */
export interface HeatCol { t: number; l: [number, number, Side][] }

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; b: number; s: number }

/** Liquidation. s = side of the forced order: 1 = shorts liquidated (forced buy), -1 = longs liquidated (forced sell). v = venue index. */
export interface Liq { t: number; p: number; q: number; s: Side; v: number }
/** Derivatives snapshot: open interest (base units), funding rate (per interval, e.g. 0.0001 = 0.01 %), mark price. */
export interface Deriv { t: number; oi: number | null; fr: number | null; mark: number | null }

export type AssetClass = 'crypto' | 'metal' | 'index' | 'commodity' | 'fx' | 'demo';

export type SourceDef =
  | { ex: 'binance-f'; sym: string }
  | { ex: 'binance-s'; sym: string }
  | { ex: 'bybit'; sym: string }
  | { ex: 'okx'; sym: string; ct: number }
  | { ex: 'hl'; coin: string; sig?: number }
  | { ex: 'coinbase'; prod: string }
  | { ex: 'gate'; pair: string }
  | { ex: 'poll'; sym: string }
  | { ex: 'sim'; base: number; vol: number };

export interface SymbolDef {
  id: string;
  name: string;
  desc: string;
  cls: AssetClass;
  tick: number;
  row: number;
  dec: number;
  bigUsd: number;
  bigQty?: number;
  contractUnit?: string;
  volume: 'real' | 'none';
  sources: SourceDef[];
  bookFrom: number;
  klinesFrom: number;
  venues: string;
}

export interface FeedEvents {
  trade(symId: string, t: Trade): void;
  book(symId: string, bids: [number, number][], asks: [number, number][], snapshot: boolean): void;
  status(symId: string, ex: string, ok: boolean, note?: string): void;
  liq(symId: string, l: { t: number; p: number; q: number; s: Side; ex: string }): void;
  deriv(symId: string, d: Deriv): void;
}
