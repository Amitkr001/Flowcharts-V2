import type {
  BarSpec, BigTradeMode, CalEvent, CandleTheme, ChartStyle, ChartVisuals, Drawing,
  ExecutionSettings, FlowOpts, FpMode, Overlays, PresetThemeKey,
  SoundSettings, SystemSettings, ThemeSettings, VpMode,
} from './types';
import { createStore, loadRaw } from './store';
import { localDoc, saveDoc, pullDoc } from './api';

export type DockKey = 'dom' | 'tp' | 'ts' | 'wl' | 'al' | 'bt' | 'vn';
export interface Pane { sym: string; spec: string; style: ChartStyle }
/** Right-panel tabs (widget bar) and bottom-tray tabs. */
export type PanelKey = 'trade' | 'book' | 'tape' | 'alerts' | 'watch' | 'flow';
export type TrayTab = 'positions' | 'orders' | 'fills' | 'big' | 'alerts';
export interface WorkspaceUI {
  panel: PanelKey | null; rpW: number;
  tray: boolean; trayTab: TrayTab; trayH: number;
  focus: boolean; recent: string[];
}

export const THEME_PRESETS: Record<PresetThemeKey, CandleTheme> = {
  terminal: {
    bullBody: '#22c58b',
    bearBody: '#8b5cf6',
    bullWick: '#22c58b',
    bearWick: '#8b5cf6',
    hollowBull: false,
  },
  tradingview: {
    bullBody: '#089981',
    bearBody: '#f23645',
    bullWick: '#089981',
    bearWick: '#f23645',
    hollowBull: false,
  },
  deepcharts: {
    bullBody: '#43cc43',
    bearBody: '#7e42cc',
    bullWick: '#43cc43',
    bearWick: '#7e42cc',
    hollowBull: false,
  },
  cyberpunk: {
    bullBody: '#00e5ff',
    bearBody: '#ff3df5',
    bullWick: '#00e5ff',
    bearWick: '#ff3df5',
    hollowBull: false,
  },
  monochrome: {
    bullBody: '#f8fafc',
    bearBody: '#475569',
    bullWick: '#f8fafc',
    bearWick: '#475569',
    hollowBull: false,
  },
  custom: {
    bullBody: '#22c58b',
    bearBody: '#8b5cf6',
    bullWick: '#22c58b',
    bearWick: '#8b5cf6',
    hollowBull: false,
  },
};

export interface Settings {
  sym: string; spec: string; style: ChartStyle; ov: Overlays;
  docks: Record<DockKey, boolean>;
  rowMult: number; bigUsd: Record<string, number>;
  bigMode: Record<string, BigTradeMode>;
  bigQty: Record<string, number>;
  bigAutoPct: number;
  acct: { size: number; risk: number }; magnet: boolean;
  tabs: string[]; watch: string[];
  fpMode: FpMode;
  flow: FlowOpts;
  wallMult: number;
  sound: boolean; notify: boolean;
  calImpact: 'High' | 'Medium' | 'Low'; calCountries: string; events: CalEvent[];
  multi: { n: 1 | 2 | 4; link: boolean; cross: boolean; panes: Pane[] };
  ui: WorkspaceUI;
  theme: ThemeSettings;
  execution: ExecutionSettings;
  audio: SoundSettings;
  system: SystemSettings;
}

const DEFAULTS: Settings = {
  sym: 'BTCUSD', spec: 't:60', style: 'candles',
  ov: { bubbles: true, volume: true, vwap: false, cvd: false, delta: false, imbl: true, visp: false, dlyp: false, stats: true, walls: true,
    signals: true, book: true, liqs: true, sessions: false, levels: true, oi: false, cal: true },
  docks: { dom: false, tp: true, ts: false, wl: false, al: false, bt: false, vn: false },
  rowMult: 1, bigUsd: {}, bigMode: {}, bigQty: {}, bigAutoPct: 0.99, acct: { size: 10_000, risk: 1 }, magnet: true,
  tabs: ['BTCUSD', 'XAUUSDT', 'SP500'], watch: ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XAUUSDT', 'XAGUSDT', 'GOLD', 'SILVER', 'SP500', 'NDX', 'WTI', 'DEMO'],
  fpMode: 'ba',
  flow: {
    fpRatio: 3, fpMinVol: 0, aggMs: 250,
    sess: { asia: true, london: true, ny: true }, orMin: 30,
    heatContrast: 0.55, heatCutoff: 4,
    vpMode: 'split', vpVaPct: 70, vpWidth: 22,
    keepTool: false,
  },
  wallMult: 4,
  sound: true, notify: false,
  calImpact: 'High', calCountries: 'USD', events: [],
  multi: { n: 2, link: false, cross: true, panes: [
    { sym: 'BTCUSD', spec: 't:60', style: 'candles' }, { sym: 'XAUUSDT', spec: 't:60', style: 'candles' },
    { sym: 'SP500', spec: 't:300', style: 'candles' }, { sym: 'ETHUSD', spec: 't:60', style: 'footprint' },
  ] },
  ui: { panel: 'trade', rpW: 320, tray: true, trayTab: 'positions', trayH: 190, focus: false, recent: [] },
  theme: {
    preset: 'terminal',
    candles: { ...THEME_PRESETS.terminal },
    visuals: {
      grid: true,
      gridOpacity: 4,
      watermark: true,
      watermarkOpacity: 3,
      sessionLines: true,
      crosshair: 'dashed',
    },
  },
  execution: {
    defaultQtyMode: 'usd',
    fixedQty: 0.1,
    usdQty: 1000,
    riskPct: 1,
    oneClick: false,
    autoBracket: true,
    stopLossTicks: 25,
    takeProfitTicks: 50,
    autoBreakeven: false,
    breakevenProfitTicks: 20,
    showOnChart: true,
  },
  audio: {
    enabled: true,
    volume: 70,
    bigTrades: true,
    liquidations: true,
    executions: true,
    alerts: true,
  },
  system: {
    timezone: 'UTC',
    candleCountdown: true,
    highPrecision: true,
  },
};

const FP_MODES: FpMode[] = ['ba', 'delta', 'vol'];

/** Merge saved settings with defaults so new keys always exist and bad values are reset. */
function normalize(s: Partial<Settings>): Settings {
  const out: Settings = {
    ...DEFAULTS, ...s,
    ov: { ...DEFAULTS.ov, ...(s.ov || {}) },
    docks: { ...DEFAULTS.docks, ...(s.docks || {}) },
    acct: { ...DEFAULTS.acct, ...(s.acct || {}) },
    bigUsd: { ...(s.bigUsd || {}) },
    bigMode: { ...(s.bigMode || {}) },
    bigQty: { ...(s.bigQty || {}) },
    bigAutoPct: typeof s.bigAutoPct === 'number' && s.bigAutoPct > 0.5 && s.bigAutoPct <= 0.999 ? s.bigAutoPct : DEFAULTS.bigAutoPct,
    flow: {
      ...DEFAULTS.flow,
      ...(s.flow || {}),
      sess: { ...DEFAULTS.flow.sess, ...(s.flow?.sess || {}) },
      heatContrast: s.flow?.heatContrast ?? DEFAULTS.flow.heatContrast,
      heatCutoff: s.flow?.heatCutoff ?? DEFAULTS.flow.heatCutoff,
      vpMode: (s.flow?.vpMode && ['split', 'normal', 'delta'].includes(s.flow.vpMode)) ? s.flow.vpMode : DEFAULTS.flow.vpMode,
      vpVaPct: s.flow?.vpVaPct ?? DEFAULTS.flow.vpVaPct,
      vpWidth: s.flow?.vpWidth ?? DEFAULTS.flow.vpWidth,
      keepTool: Boolean(s.flow?.keepTool),
    },
    multi: { ...DEFAULTS.multi, ...(s.multi || {}) },
    ui: { ...DEFAULTS.ui, ...(s.ui || {}) },
    theme: {
      preset: s.theme?.preset ?? DEFAULTS.theme.preset,
      candles: { ...DEFAULTS.theme.candles, ...(s.theme?.candles || {}) },
      visuals: { ...DEFAULTS.theme.visuals, ...(s.theme?.visuals || {}) },
    },
    execution: { ...DEFAULTS.execution, ...(s.execution || {}) },
    audio: { ...DEFAULTS.audio, ...(s.audio || {}) },
    system: { ...DEFAULTS.system, ...(s.system || {}) },
  };
  if (!FP_MODES.includes(out.fpMode)) out.fpMode = DEFAULTS.fpMode;
  if (!Array.isArray(out.tabs) || !out.tabs.length) out.tabs = DEFAULTS.tabs;
  if (!Array.isArray(out.watch)) out.watch = DEFAULTS.watch;
  if (!Array.isArray(out.events)) out.events = [];
  if (!Array.isArray(out.multi.panes) || out.multi.panes.length < 4) out.multi.panes = DEFAULTS.multi.panes;
  if (![1, 2, 4].includes(out.multi.n)) out.multi.n = 2;
  const P: (PanelKey | null)[] = ['trade', 'book', 'tape', 'alerts', 'watch', 'flow', null];
  if (!P.includes(out.ui.panel)) out.ui.panel = 'trade';
  if (!['positions', 'orders', 'fills', 'big', 'alerts'].includes(out.ui.trayTab)) out.ui.trayTab = 'positions';
  out.ui.rpW = Math.max(260, Math.min(560, +out.ui.rpW || 320));
  out.ui.trayH = Math.max(110, Math.min(520, +out.ui.trayH || 190));
  if (!Array.isArray(out.ui.recent)) out.ui.recent = [];
  return out;
}

export const settings = createStore<Settings>(normalize(localDoc<Partial<Settings>>('settings', {})));
settings.subscribe(() => saveDoc('settings', settings.get()));

export const setFlow = (patch: Partial<FlowOpts>) => settings.set(s => ({ flow: { ...s.flow, ...patch } }));
export const toggleOverlay = (k: keyof Overlays) => settings.set(s => { const ov = { ...s.ov }; ov[k] = !ov[k]; return { ov }; });
export const setUI = (patch: Partial<WorkspaceUI>) => settings.set(s => ({ ui: { ...s.ui, ...patch } }));
/** Open a right-panel tab; clicking the active tab collapses the panel. */
export const togglePanel = (k: PanelKey) => settings.set(s => ({ ui: { ...s.ui, panel: s.ui.panel === k ? null : k, focus: false } }));
/** Switch symbol and remember it in the recent list. */
export const openSymbol = (id: string) => settings.set(s => ({ sym: id, tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id].slice(-10), ui: { ...s.ui, recent: [id, ...s.ui.recent.filter(x => x !== id)].slice(0, 8) } }));
export const toggleDock = (k: DockKey) => settings.set(s => { const docks = { ...s.docks }; docks[k] = !docks[k]; return { docks }; });
export const specOf = (k: string): BarSpec => { const [a, b] = k.split(':'); return a === 't' ? { kind: 'time', sec: +b } : a === 'v' ? { kind: 'vol', size: +b } : { kind: 'tick', count: +b }; };

/* ---- drawings per symbol ---- */
export const drawingsStore = createStore<{ bySym: Record<string, Drawing[]> }>({ bySym: localDoc('drawings', {}) });
export function saveDrawings(sym: string, list: Drawing[]) {
  drawingsStore.set(s => { const bySym = { ...s.bySym }; bySym[sym] = list; return { bySym }; });
  saveDoc('drawings', drawingsStore.get().bySym);
}

/** After sign-in: pull cloud copies (cloud wins if present). */
export async function syncFromCloud() {
  const [s, d] = await Promise.all([pullDoc<Settings>('settings'), pullDoc<Record<string, Drawing[]>>('drawings')]);
  if (s) settings.set(normalize(s));
  if (d) drawingsStore.set({ bySym: d });
}
export const bigFor = (id: string, def: number) => settings.get().bigUsd[id] ?? def;
export const setBigUsd = (id: string, val: number) => settings.set(s => { const bigUsd = { ...s.bigUsd }; bigUsd[id] = val; return { bigUsd }; });

export const bigModeFor = (id: string): BigTradeMode => settings.get().bigMode?.[id] ?? 'usd';
export const setBigMode = (id: string, mode: BigTradeMode) => settings.set(s => { const bigMode = { ...(s.bigMode || {}) }; bigMode[id] = mode; return { bigMode }; });

export const bigQtyFor = (id: string, def?: number) => settings.get().bigQty?.[id] ?? def ?? 1;
export const setBigQty = (id: string, val: number) => settings.set(s => { const bigQty = { ...(s.bigQty || {}) }; bigQty[id] = val; return { bigQty }; });

export const setBigAutoPct = (val: number) => settings.set(() => ({ bigAutoPct: val }));

export const setTheme = (patch: Partial<ThemeSettings>) => settings.set(s => ({
  theme: {
    ...s.theme,
    ...patch,
    candles: { ...s.theme.candles, ...(patch.candles || {}) },
    visuals: { ...s.theme.visuals, ...(patch.visuals || {}) },
  },
}));

export const applyPreset = (key: PresetThemeKey) => {
  const preset = THEME_PRESETS[key];
  if (!preset) return;
  settings.set(s => ({
    theme: {
      ...s.theme,
      preset: key,
      candles: { ...preset },
    },
  }));
};

export const setExecution = (patch: Partial<ExecutionSettings>) => settings.set(s => ({ execution: { ...s.execution, ...patch } }));
export const setAudio = (patch: Partial<SoundSettings>) => settings.set(s => ({ audio: { ...s.audio, ...patch } }));
export const setSystem = (patch: Partial<SystemSettings>) => settings.set(s => ({ system: { ...s.system, ...patch } }));

export function exportSettingsJSON(): string {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: settings.get(),
    drawings: drawingsStore.get().bySym,
  };
  return JSON.stringify(data, null, 2);
}

export function importSettingsJSON(jsonStr: string): boolean {
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.settings) settings.set(normalize(parsed.settings));
    if (parsed.drawings && typeof parsed.drawings === 'object') {
      drawingsStore.set({ bySym: parsed.drawings });
      saveDoc('drawings', parsed.drawings);
    }
    return true;
  } catch {
    return false;
  }
}

export function resetAllSettings() {
  settings.set({ ...DEFAULTS });
}

export { loadRaw };
