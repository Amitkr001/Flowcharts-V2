/**
 * Custom indicator scripts. A script is the body of a JavaScript function:
 *
 *   (d, ta, input, plot) => { ... }
 *     d      Series — time, open, high, low, close, volume, buy, sell, delta, cvd, vwap, bigBuy, bigSell (arrays)
 *     ta     TA helpers — sma, ema, wma, stdev, rsi, atr, macd, highest, lowest, cross, crossunder
 *     input  your inputs by key, e.g. input.len
 *     plot   plot(name, values, { color, pane: 'main' | 'sub', type: 'line' | 'hist' | 'dots' })
 *
 * Scripts run in your browser only. They are saved locally and synced to your account when signed in.
 */
import type { Plot } from '../lib/types';
import type { Series } from '../data/bars';
import { TA } from '../lib/ta';
import { createStore } from '../lib/store';
import { localDoc, saveDoc, pullDoc } from '../lib/api';
import { uid } from '../lib/format';

export interface ScriptInput { k: string; label: string; v: number }
export interface Script { id: string; name: string; on: boolean; inputs: ScriptInput[]; code: string }

export const SAMPLE_SCRIPTS: Script[] = [
  { id: 'ema-ribbon', name: 'EMA 8 / 33', on: false, inputs: [{ k: 'fast', label: 'Fast EMA', v: 8 }, { k: 'slow', label: 'Slow EMA', v: 33 }],
    code: `const f = ta.ema(d.close, input.fast), s = ta.ema(d.close, input.slow);
plot('EMA ' + input.fast, f, { color: '#4c8dff' });
plot('EMA ' + input.slow, s, { color: '#f5b544' });
// diamonds where the fast EMA crosses the slow one
plot('Cross', d.close.map((c, i) => ta.cross(f, s, i) || ta.crossunder(f, s, i) ? c : null), { color: '#e9edf2', type: 'dots' });` },
  { id: 'delta-div', name: 'Delta divergence', on: false, inputs: [{ k: 'min', label: 'Min |delta| % of volume', v: 15 }],
    code: `// up bars with strong selling, or down bars with strong buying
plot('Bearish div', d.close.map((c, i) => c > d.open[i] && -d.delta[i] > d.volume[i] * input.min / 100 ? d.high[i] : null), { color: '#a47cf2', type: 'dots' });
plot('Bullish div', d.close.map((c, i) => c < d.open[i] && d.delta[i] > d.volume[i] * input.min / 100 ? d.low[i] : null), { color: '#22c58b', type: 'dots' });` },
  { id: 'big-pressure', name: 'Big-trade pressure', on: false, inputs: [{ k: 'len', label: 'Smoothing', v: 10 }],
    code: `const net = d.bigBuy.map((b, i) => b - d.bigSell[i]);
plot('Big Δ', net, { color: '#22c58b', pane: 'sub', type: 'hist' });
plot('Big Δ avg', ta.ema(net, input.len), { color: '#f5b544', pane: 'sub' });` },
  { id: 'cvd-slope', name: 'CVD momentum', on: false, inputs: [{ k: 'len', label: 'Lookback', v: 20 }],
    code: `const m = d.cvd.map((v, i) => i >= input.len ? v - d.cvd[i - input.len] : null);
plot('CVD momentum', m, { color: '#38bdf8', pane: 'sub', type: 'hist' });` },
  { id: 'absorption', name: 'Absorption finder', on: false, inputs: [{ k: 'vol', label: 'Volume × average', v: 1.8 }, { k: 'body', label: 'Max body % of range', v: 35 }],
    code: `const avg = ta.sma(d.volume, 20);
const hit = (i) => avg[i] && d.volume[i] > avg[i] * input.vol && Math.abs(d.close[i] - d.open[i]) <= (d.high[i] - d.low[i]) * input.body / 100;
// sellers absorbed (closes in upper half with negative delta) → mark the low
plot('Sellers absorbed', d.close.map((c, i) => hit(i) && d.delta[i] < 0 && c >= (d.high[i] + d.low[i]) / 2 ? d.low[i] : null), { color: '#22c58b', type: 'dots' });
plot('Buyers absorbed', d.close.map((c, i) => hit(i) && d.delta[i] > 0 && c <= (d.high[i] + d.low[i]) / 2 ? d.high[i] : null), { color: '#a47cf2', type: 'dots' });` },
];

export const scripts = createStore<{ list: Script[] }>({ list: localDoc<Script[]>('scripts', SAMPLE_SCRIPTS) });
export function saveScripts(list: Script[]) { scripts.set({ list }); saveDoc('scripts', list); }
export async function syncScripts() { const r = await pullDoc<Script[]>('scripts'); if (r && Array.isArray(r)) scripts.set({ list: r }); }
export const newScript = (): Script => ({ id: uid(), name: 'New indicator', on: true, inputs: [{ k: 'len', label: 'Length', v: 20 }],
  code: `plot('SMA ' + input.len, ta.sma(d.close, input.len), { color: '#4c8dff' });` });

const compiled = new Map<string, Function>();
function compile(code: string): Function {
  let f = compiled.get(code);
  if (!f) {
    f = new Function('d', 'ta', 'input', 'plot', '"use strict";\n' + code);
    compiled.set(code, f);
    if (compiled.size > 100) compiled.delete(compiled.keys().next().value!);
  }
  return f;
}

/** Run a script against a series. Never throws: errors are returned in `err`. */
export function runScript(s: Script, d: Series): { plots: Plot[]; err: string | null; ms: number } {
  const t0 = performance.now(), plots: Plot[] = [];
  const input: Record<string, number> = {}; for (const i of s.inputs) input[i.k] = i.v;
  const plot = (name: string, values: (number | null | undefined)[], o: { color?: string; pane?: 'main' | 'sub'; type?: 'line' | 'hist' | 'dots' } = {}) => {
    if (!Array.isArray(values)) throw new Error(`plot("${name}"): values must be an array`);
    if (plots.length >= 12) throw new Error('a script can draw at most 12 plots');
    const v = values.length === d.length ? values : values.slice(-d.length);
    plots.push({ name: String(name), values: v.map(x => (x == null || !isFinite(x as number) ? null : +x)), color: o.color || '#4c8dff', pane: o.pane || 'main', type: o.type || 'line' });
  };
  try { compile(s.code)(d, TA, input, plot); return { plots, err: null, ms: performance.now() - t0 }; }
  catch (e) { return { plots: [], err: (e as Error).message || String(e), ms: performance.now() - t0 }; }
}
