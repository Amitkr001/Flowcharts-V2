export type Side = 1 | -1;
/** [time, price, qty, side, venueIndex] — venue index points into MarketData.venues */
export type Tick = [number, number, number, Side, number?];
export interface HeatCol { t: number; l: [number, number, Side][] }
export interface Book { b: [number, number][]; a: [number, number][] }

export interface SymbolInfo {
  id: string; name: string; desc: string; cls: string;
  tick: number; row: number; dec: number; bigUsd: number;
  bigQty?: number; contractUnit?: string;
  volume: 'real' | 'none'; venues: string; hasBook: boolean;
  last: number; live: boolean; recordedFrom: number | null;
}

export type BigTradeMode = 'usd' | 'qty' | 'auto';

export interface BigTradeConfig {
  mode: BigTradeMode;
  bigUsd: number;
  bigQty: number;
  autoPct: number;
}

/** Candle with footprint. fp key = round(price/row); value = [sellVol, buyVol]. */
export interface Bar {
  t: number; o: number; h: number; l: number; c: number;
  v: number; b: number; s: number;
  fp: Map<number, [number, number]>;
  big: Tick[];
  /** per-venue delta and volume (index = venue index) */
  vd?: number[]; vv?: number[];
  /** true when built from klines (no tick detail) */
  k?: boolean;
  /** true when buy/sell split is unknown */
  est?: boolean;
}

export interface KBar { t: number; o: number; h: number; l: number; c: number; v: number; b: number; s: number }

/** Liquidation. s = forced order side: 1 = shorts liquidated (forced buy), -1 = longs liquidated (forced sell). */
export interface Liq { t: number; p: number; q: number; s: Side; v: number }
/** Open interest (base units), funding rate per interval, mark price. */
export interface Deriv { t: number; oi: number | null; fr: number | null; mark: number | null }
export interface CalEvent { t: number; title: string; country: string; impact: string; user?: boolean }

export type BarSpec = { kind: 'time'; sec: number } | { kind: 'vol'; size: number } | { kind: 'tick'; count: number };

export type ChartStyle = 'candles' | 'footprint' | 'heatmap';

/** Footprint cell display: bid × ask numbers, delta per price, or total volume per price. */
export type FpMode = 'ba' | 'delta' | 'vol';

/** Volume profile layout mode: split (Left Delta + Right Normal Volume), normal (right side), delta. */
export type VpMode = 'split' | 'normal' | 'delta';

export interface Overlays {
  bubbles: boolean; volume: boolean; vwap: boolean; cvd: boolean; delta: boolean;
  imbl: boolean; visp: boolean; dlyp: boolean;
  stats: boolean; walls: boolean; signals: boolean; book: boolean; liqs: boolean;
  sessions: boolean; levels: boolean; oi: boolean; cal: boolean;
}

/** Order-flow engine settings. */
export interface FlowOpts {
  fpRatio: number;
  fpMinVol: number;
  aggMs: number;
  sess: { asia: boolean; london: boolean; ny: boolean };
  orMin: number;
  heatContrast: number;
  heatCutoff: number;
  vpMode: VpMode;
  vpVaPct: number;
  vpWidth: number;
  keepTool: boolean;
}

export interface Plot { name: string; values: (number | null)[]; color: string; pane?: 'main' | 'sub'; type?: 'line' | 'hist' | 'dots' }

export interface Pt { t: number; p: number }
export interface Drawing {
  id: string; type: string; pts: Pt[];
  color: string; width: number; dash: 0 | 1 | 2;
  text?: string; locked?: boolean; hidden?: boolean; fill?: boolean;
}

export type PresetThemeKey = 'terminal' | 'tradingview' | 'deepcharts' | 'cyberpunk' | 'monochrome' | 'custom';

export interface CandleTheme {
  bullBody: string;
  bearBody: string;
  bullWick: string;
  bearWick: string;
  hollowBull?: boolean;
}

export interface ChartVisuals {
  grid: boolean;
  gridOpacity: number; // 0 - 20 (%)
  watermark: boolean;
  watermarkOpacity: number; // 0 - 15 (%)
  sessionLines: boolean;
  crosshair: 'dashed' | 'dotted' | 'solid';
}

export interface ThemeSettings {
  preset: PresetThemeKey;
  candles: CandleTheme;
  visuals: ChartVisuals;
}

export interface ExecutionSettings {
  defaultQtyMode: 'fixed' | 'usd' | 'risk';
  fixedQty: number;
  usdQty: number;
  riskPct: number;
  oneClick: boolean;
  autoBracket: boolean;
  stopLossTicks: number;
  takeProfitTicks: number;
  autoBreakeven: boolean;
  breakevenProfitTicks: number;
  showOnChart: boolean;
}

export interface SoundSettings {
  enabled: boolean;
  volume: number; // 0 - 100
  bigTrades: boolean;
  liquidations: boolean;
  executions: boolean;
  alerts: boolean;
}

export interface SystemSettings {
  timezone: 'UTC' | 'Local' | 'NewYork' | 'London' | 'Tokyo';
  candleCountdown: boolean;
  highPrecision: boolean;
}
