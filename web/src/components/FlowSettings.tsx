import { useRef, useState } from 'react';
import {
  settings, setFlow, setBigUsd, bigFor, bigModeFor, setBigMode, bigQtyFor, setBigQty, setBigAutoPct,
  setTheme, applyPreset, setExecution, setAudio, setSystem, exportSettingsJSON, importSettingsJSON,
  resetAllSettings, THEME_PRESETS,
} from '../lib/settings';
import { soundFX } from '../lib/audio';
import { enableNotifications } from '../lib/alerts';
import type { BigTradeMode, PresetThemeKey, SymbolInfo, VpMode } from '../lib/types';
import { fmtQ } from '../lib/format';

const N = ({ label, v, step, min, on, hint }: { label: string; v: number; step: number; min: number; on(v: number): void; hint?: string }) => (
  <label title={hint} className="set-field">
    <span>{label}</span>
    <input type="number" value={v} step={step} min={min} onChange={e => on(Math.max(min, +e.target.value))} />
  </label>
);

const C = ({ label, v, on }: { label: string; v: boolean; on(): void }) => (
  <label className="mini chk-lbl">
    <span className={`chk ${v ? 'on' : ''}`} onClick={on} role="checkbox" aria-checked={v} />
    <span>{label}</span>
  </label>
);

export type FlowTab =
  | 'theme'
  | 'trade'
  | 'audio'
  | 'time'
  | 'big'
  | 'heat'
  | 'vp'
  | 'fp'
  | 'book'
  | 'sess'
  | 'cal'
  | 'backup';

interface Props {
  onClose(): void;
  sym?: SymbolInfo;
  initialTab?: FlowTab;
}

export function FlowSettings({ onClose, sym, initialTab = 'theme' }: Props) {
  const st = settings.use(s => s), f = st.flow;
  const th = st.theme, exec = st.execution, aud = st.audio, sys = st.system;
  const [tab, setTab] = useState<FlowTab>(initialTab);
  const [evT, setEvT] = useState(''), [evName, setEvName] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const curSymId = sym?.id || st.sym;
  const curMode = bigModeFor(curSymId);
  const curBigUsd = bigFor(curSymId, sym?.bigUsd || 50_000);
  const curBigQty = bigQtyFor(curSymId, sym?.bigQty || 1);
  const unit = sym?.contractUnit || 'units';
  const lastPrice = sym?.last || 1;

  const TABS: [FlowTab, string][] = [
    ['theme', '🎨 Themes & Candles'],
    ['trade', '⚡ Trading & Risk'],
    ['audio', '🔊 Audio FX'],
    ['time', '🕒 Timezone'],
    ['big', 'Big trades'],
    ['heat', 'Heatmap'],
    ['vp', 'Volume profile'],
    ['fp', 'Footprint & Imb'],
    ['book', 'Book & Walls'],
    ['sess', 'Sessions'],
    ['cal', 'Calendar & Alerts'],
    ['backup', '💾 Backup & Reset'],
  ];

  const PRESETS: { id: PresetThemeKey; name: string }[] = [
    { id: 'terminal', name: 'Terminal Dark' },
    { id: 'tradingview', name: 'Classic TradingView' },
    { id: 'deepcharts', name: 'Deepcharts dxFeed' },
    { id: 'cyberpunk', name: 'Cyberpunk Neon' },
    { id: 'monochrome', name: 'Monochrome Pro' },
    { id: 'custom', name: 'Custom Palette' },
  ];

  const usdPresets = sym?.cls === 'index'
    ? [10_000, 25_000, 50_000, 100_000, 250_000]
    : sym?.cls === 'crypto'
      ? [50_000, 100_000, 250_000, 500_000, 1_000_000]
      : [15_000, 25_000, 50_000, 100_000, 250_000];

  const qtyPresets = (() => {
    switch (curSymId) {
      case 'SP500': return [1, 2, 5, 10, 25];
      case 'NDX': return [0.5, 1, 2, 5, 10];
      case 'WTI':
      case 'BRENT': return [50, 100, 250, 500, 1000];
      case 'GOLD':
      case 'XAUUSDT': return [5, 10, 20, 50, 100];
      case 'SILVER':
      case 'XAGUSDT': return [100, 250, 500, 1000, 2500];
      case 'BTCUSD': return [1, 2, 3, 5, 10];
      case 'ETHUSD': return [10, 25, 40, 100, 250];
      case 'SOLUSD': return [50, 100, 300, 500, 1000];
      case 'XRPUSD': return [5000, 10000, 30000, 50000, 100000];
      case 'DOGEUSD': return [50000, 100000, 300000, 500000, 1000000];
      case 'HYPEUSD': return [500, 1000, 1500, 5000, 10000];
      default: return [1, 2, 5, 10, 50];
    }
  })();

  const autoPctOptions = [
    { pct: 0.995, label: 'Top 0.5% (Mega Whales)', desc: 'Only extreme prints' },
    { pct: 0.990, label: 'Top 1.0% (Standard Whales)', desc: 'Recommended — 99th percentile' },
    { pct: 0.980, label: 'Top 2.0% (Large Orders)', desc: 'Active aggressive momentum' },
    { pct: 0.950, label: 'Top 5.0% (Notable Prints)', desc: 'Frequent order-flow activity' },
  ];

  const handleExport = () => {
    const json = exportSettingsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flowscope-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const content = ev.target?.result as string;
      if (content && importSettingsJSON(content)) {
        setImportStatus('Settings imported successfully!');
        setTimeout(() => setImportStatus(null), 3500);
      } else {
        setImportStatus('Error: Invalid settings JSON file');
        setTimeout(() => setImportStatus(null), 3500);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal flow-set" role="dialog" aria-label="Order-flow indicator settings">
        <div className="mh">
          <b>Preferences &amp; Settings</b>
          <span style={{ flex: 1 }} />
          <button className="tb" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="set-tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={`set-tab ${tab === k ? 'on' : ''}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mb set-body">
          {/* TAB: THEMES & CANDLES */}
          {tab === 'theme' && (
            <div className="set-pane">
              <h6>Candle &amp; Chart Preset Themes</h6>
              <div className="theme-grid">
                {PRESETS.map(p => {
                  const colors = THEME_PRESETS[p.id];
                  return (
                    <button
                      key={p.id}
                      className={`theme-card ${th.preset === p.id ? 'on' : ''}`}
                      onClick={() => applyPreset(p.id)}
                    >
                      <b>{p.name}</b>
                      <div className="theme-preview">
                        <i style={{ background: colors.bullBody }} />
                        <i style={{ background: colors.bearBody }} />
                      </div>
                    </button>
                  );
                })}
              </div>

              <h6>Custom Candle Colors</h6>
              <div className="set-grid" style={{ marginBottom: 14 }}>
                <div className="color-row">
                  <span>Bullish candle body</span>
                  <div className="color-pick-wrap">
                    <span>{th.candles.bullBody}</span>
                    <input
                      type="color"
                      value={th.candles.bullBody}
                      onChange={e => setTheme({ preset: 'custom', candles: { ...th.candles, bullBody: e.target.value } })}
                    />
                  </div>
                </div>

                <div className="color-row">
                  <span>Bearish candle body</span>
                  <div className="color-pick-wrap">
                    <span>{th.candles.bearBody}</span>
                    <input
                      type="color"
                      value={th.candles.bearBody}
                      onChange={e => setTheme({ preset: 'custom', candles: { ...th.candles, bearBody: e.target.value } })}
                    />
                  </div>
                </div>

                <div className="color-row">
                  <span>Bullish wick &amp; border</span>
                  <div className="color-pick-wrap">
                    <span>{th.candles.bullWick}</span>
                    <input
                      type="color"
                      value={th.candles.bullWick}
                      onChange={e => setTheme({ preset: 'custom', candles: { ...th.candles, bullWick: e.target.value } })}
                    />
                  </div>
                </div>

                <div className="color-row">
                  <span>Bearish wick &amp; border</span>
                  <div className="color-pick-wrap">
                    <span>{th.candles.bearWick}</span>
                    <input
                      type="color"
                      value={th.candles.bearWick}
                      onChange={e => setTheme({ preset: 'custom', candles: { ...th.candles, bearWick: e.target.value } })}
                    />
                  </div>
                </div>

                <C
                  label="Hollow bullish candles (transparent body with colored border)"
                  v={!!th.candles.hollowBull}
                  on={() => setTheme({ candles: { ...th.candles, hollowBull: !th.candles.hollowBull } })}
                />
              </div>

              <h6>Chart Visuals &amp; Background</h6>
              <div className="set-grid">
                <C
                  label="Show price &amp; time gridlines"
                  v={th.visuals.grid}
                  on={() => setTheme({ visuals: { ...th.visuals, grid: !th.visuals.grid } })}
                />

                <label className="set-field">
                  <span>Gridlines opacity ({th.visuals.gridOpacity}%)</span>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={th.visuals.gridOpacity}
                    onChange={e => setTheme({ visuals: { ...th.visuals, gridOpacity: +e.target.value } })}
                  />
                </label>

                <C
                  label="Show background symbol watermark"
                  v={th.visuals.watermark}
                  on={() => setTheme({ visuals: { ...th.visuals, watermark: !th.visuals.watermark } })}
                />

                <label className="set-field">
                  <span>Watermark opacity ({th.visuals.watermarkOpacity}%)</span>
                  <input
                    type="range"
                    min="0"
                    max="15"
                    value={th.visuals.watermarkOpacity}
                    onChange={e => setTheme({ visuals: { ...th.visuals, watermarkOpacity: +e.target.value } })}
                  />
                </label>

                <C
                  label="Show midnight session separator lines (UTC)"
                  v={th.visuals.sessionLines}
                  on={() => setTheme({ visuals: { ...th.visuals, sessionLines: !th.visuals.sessionLines } })}
                />

                <label className="set-field">
                  <span>Crosshair line style</span>
                  <select
                    value={th.visuals.crosshair}
                    onChange={e => setTheme({ visuals: { ...th.visuals, crosshair: e.target.value as any } })}
                  >
                    <option value="dashed">Dashed line</option>
                    <option value="dotted">Dotted line</option>
                    <option value="solid">Solid hairline</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* TAB: TRADING & RISK */}
          {tab === 'trade' && (
            <div className="set-pane">
              <h6>Order Execution Defaults</h6>
              <div className="set-grid" style={{ marginBottom: 14 }}>
                <label className="set-field">
                  <span>Default order sizing mode</span>
                  <select
                    value={exec.defaultQtyMode}
                    onChange={e => setExecution({ defaultQtyMode: e.target.value as any })}
                  >
                    <option value="usd">Fixed Notional USD ($)</option>
                    <option value="fixed">Fixed Contracts / Units</option>
                    <option value="risk">% of Account Equity Risk</option>
                  </select>
                </label>

                {exec.defaultQtyMode === 'usd' && (
                  <N
                    label="Default order notional ($)"
                    v={exec.usdQty}
                    step={500}
                    min={100}
                    on={v => setExecution({ usdQty: v })}
                    hint="Dollar value per order"
                  />
                )}

                {exec.defaultQtyMode === 'fixed' && (
                  <N
                    label="Default contracts / units"
                    v={exec.fixedQty}
                    step={0.1}
                    min={0.001}
                    on={v => setExecution({ fixedQty: v })}
                  />
                )}

                {exec.defaultQtyMode === 'risk' && (
                  <N
                    label="Risk per trade (%)"
                    v={exec.riskPct}
                    step={0.5}
                    min={0.1}
                    on={v => setExecution({ riskPct: v })}
                    hint="Percent of account equity risked"
                  />
                )}

                <C
                  label="One-Click instant execution (submits order immediately without confirmation)"
                  v={exec.oneClick}
                  on={() => setExecution({ oneClick: !exec.oneClick })}
                />
              </div>

              <h6>Bracket Orders (SL &amp; TP)</h6>
              <div className="set-grid" style={{ marginBottom: 14 }}>
                <C
                  label="Automatically attach Stop Loss &amp; Take Profit to entries"
                  v={exec.autoBracket}
                  on={() => setExecution({ autoBracket: !exec.autoBracket })}
                />

                <N
                  label="Default Stop Loss (ticks)"
                  v={exec.stopLossTicks}
                  step={5}
                  min={5}
                  on={v => setExecution({ stopLossTicks: v })}
                />

                <N
                  label="Default Take Profit (ticks)"
                  v={exec.takeProfitTicks}
                  step={10}
                  min={10}
                  on={v => setExecution({ takeProfitTicks: v })}
                />
              </div>

              <h6>Dynamic Risk Management</h6>
              <div className="set-grid">
                <C
                  label="Auto-move Stop Loss to breakeven when in profit"
                  v={exec.autoBreakeven}
                  on={() => setExecution({ autoBreakeven: !exec.autoBreakeven })}
                />

                <N
                  label="Trigger breakeven after (+ticks in profit)"
                  v={exec.breakevenProfitTicks}
                  step={5}
                  min={5}
                  on={v => setExecution({ breakevenProfitTicks: v })}
                />

                <C
                  label="Show position &amp; open order lines on chart canvas"
                  v={exec.showOnChart}
                  on={() => setExecution({ showOnChart: !exec.showOnChart })}
                />
              </div>
            </div>
          )}

          {/* TAB: AUDIO & SOUND FX */}
          {tab === 'audio' && (
            <div className="set-pane">
              <h6>Acoustic Order Flow Audio</h6>
              <div className="set-grid" style={{ marginBottom: 16 }}>
                <C
                  label="Enable acoustic audio synthesizer"
                  v={aud.enabled}
                  on={() => setAudio({ enabled: !aud.enabled })}
                />

                <label className="set-field">
                  <span>Master audio volume ({aud.volume}%)</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={aud.volume}
                    onChange={e => setAudio({ volume: +e.target.value })}
                  />
                </label>
              </div>

              <h6>Event Sound Toggles &amp; Live Tests</h6>
              <div className="set-grid">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <C
                    label="Big aggressive trade pings (Buy chime / Sell thud)"
                    v={aud.bigTrades}
                    on={() => setAudio({ bigTrades: !aud.bigTrades })}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="sound-test-btn" onClick={() => soundFX.test('bigBuy')}>▶ Test Buy</button>
                    <button className="sound-test-btn" onClick={() => soundFX.test('bigSell')}>▶ Test Sell</button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <C
                    label="Liquidation cascade warning tone"
                    v={aud.liquidations}
                    on={() => setAudio({ liquidations: !aud.liquidations })}
                  />
                  <button className="sound-test-btn" onClick={() => soundFX.test('liq')}>▶ Test Tone</button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <C
                    label="Order execution / fill confirmation chime"
                    v={aud.executions}
                    on={() => setAudio({ executions: !aud.executions })}
                  />
                  <button className="sound-test-btn" onClick={() => soundFX.test('exec')}>▶ Test Chime</button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <C
                    label="Price alert trigger sound"
                    v={aud.alerts}
                    on={() => setAudio({ alerts: !aud.alerts })}
                  />
                  <button className="sound-test-btn" onClick={() => soundFX.test('alert')}>▶ Test Alert</button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: TIMEZONE & CLOCKS */}
          {tab === 'time' && (
            <div className="set-pane">
              <h6>Timezone &amp; Session Clocks</h6>
              <div className="set-grid">
                <label className="set-field">
                  <span>Display timezone</span>
                  <select
                    value={sys.timezone}
                    onChange={e => setSystem({ timezone: e.target.value as any })}
                  >
                    <option value="UTC">UTC (Exchange Standard 00:00:00)</option>
                    <option value="Local">Local Browser Time</option>
                    <option value="NewYork">New York (EST / EDT — US Session)</option>
                    <option value="London">London (GMT / BST — EU Session)</option>
                    <option value="Tokyo">Tokyo (JST — Asia Session)</option>
                  </select>
                </label>

                <C
                  label="Show candle close countdown clock on price scale"
                  v={sys.candleCountdown}
                  on={() => setSystem({ candleCountdown: !sys.candleCountdown })}
                />

                <C
                  label="High-precision millisecond latency counters in status line"
                  v={sys.highPrecision}
                  on={() => setSystem({ highPrecision: !sys.highPrecision })}
                />
              </div>
            </div>
          )}

          {/* TAB: BIG TRADES */}
          {tab === 'big' && (
            <div className="set-pane">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <h6>Aggressive Big Trade Detection</h6>
                <span className="mono muted" style={{ fontSize: 11, background: '#1e293b', padding: '2px 8px', borderRadius: 4 }}>
                  {curSymId} · {unit}
                </span>
              </div>
              <p className="hint">
                Large market orders that aggressively consume book liquidity appear as bubbles on the tape and chart canvas.
              </p>

              {sym?.volume === 'none' && (
                <div style={{ padding: '8px 12px', background: '#3b1820', border: '1px solid #7f1d1d', borderRadius: 6, marginBottom: 14, fontSize: 12, color: '#fca5a5' }}>
                  ⚠️ <b>Price-Only Feed:</b> {curSymId} does not transmit trade volume on the free feed. Footprint volume and big trade bubbles will remain quiet for this instrument.
                </div>
              )}

              {/* Mode Switcher */}
              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                  Filtering Mode
                </span>
                <div className="seg" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                  <button
                    className={`seg-btn ${curMode === 'usd' ? 'on' : ''}`}
                    onClick={() => setBigMode(curSymId, 'usd')}
                    style={{ padding: '6px 8px', fontSize: 12 }}
                  >
                    💲 USD Value
                  </button>
                  <button
                    className={`seg-btn ${curMode === 'qty' ? 'on' : ''}`}
                    onClick={() => setBigMode(curSymId, 'qty')}
                    style={{ padding: '6px 8px', fontSize: 12 }}
                  >
                    📦 Contracts ({unit})
                  </button>
                  <button
                    className={`seg-btn ${curMode === 'auto' ? 'on' : ''}`}
                    onClick={() => setBigMode(curSymId, 'auto')}
                    style={{ padding: '6px 8px', fontSize: 12 }}
                  >
                    🎯 Auto Top 1%
                  </button>
                </div>
              </div>

              {/* Mode 1: USD Notional */}
              {curMode === 'usd' && (
                <div>
                  <div className="set-field">
                    <span>Threshold in USD ($)</span>
                    <div className="set-input-row">
                      <input
                        type="number"
                        value={curBigUsd}
                        step={sym?.cls === 'index' ? 5_000 : 10_000}
                        min={1_000}
                        onChange={e => setBigUsd(curSymId, Math.max(1_000, +e.target.value))}
                      />
                      <span className="mono" style={{ minWidth: 70, textAlign: 'right' }}>${fmtQ(curBigUsd)}</span>
                    </div>
                  </div>
                  {lastPrice > 0 && (
                    <div className="muted mono" style={{ fontSize: 11, marginTop: 4, marginBottom: 10 }}>
                      ≈ {(curBigUsd / lastPrice).toFixed(sym?.cls === 'index' ? 2 : 1)} {unit} at last price (${fmtQ(lastPrice)})
                    </div>
                  )}
                  <div className="set-presets" style={{ marginTop: 8 }}>
                    <span className="pill-btn muted">Quick presets:</span>
                    {usdPresets.map(p => (
                      <button
                        key={p}
                        className={`pill-btn ${curBigUsd === p ? 'on' : ''}`}
                        onClick={() => setBigUsd(curSymId, p)}
                      >
                        ${fmtQ(p)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mode 2: Contracts / Units */}
              {curMode === 'qty' && (
                <div>
                  <div className="set-field">
                    <span>Threshold in {unit} ({curSymId})</span>
                    <div className="set-input-row">
                      <input
                        type="number"
                        value={curBigQty}
                        step={sym?.cls === 'index' ? 0.5 : 1}
                        min={0.001}
                        onChange={e => setBigQty(curSymId, Math.max(0.001, +e.target.value))}
                      />
                      <span className="mono" style={{ minWidth: 70, textAlign: 'right' }}>{fmtQ(curBigQty)} {unit}</span>
                    </div>
                  </div>
                  {lastPrice > 0 && (
                    <div className="muted mono" style={{ fontSize: 11, marginTop: 4, marginBottom: 10 }}>
                      ≈ ${fmtQ(curBigQty * lastPrice)} notional at last price (${fmtQ(lastPrice)})
                    </div>
                  )}
                  <div className="set-presets" style={{ marginTop: 8 }}>
                    <span className="pill-btn muted">Presets ({unit}):</span>
                    {qtyPresets.map(q => (
                      <button
                        key={q}
                        className={`pill-btn ${curBigQty === q ? 'on' : ''}`}
                        onClick={() => setBigQty(curSymId, q)}
                      >
                        {fmtQ(q)} {unit}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mode 3: Auto Whale Percentile */}
              {curMode === 'auto' && (
                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                    Percentile Sensitivity
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {autoPctOptions.map(opt => (
                      <div
                        key={opt.pct}
                        onClick={() => setBigAutoPct(opt.pct)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: (st.bigAutoPct ?? 0.99) === opt.pct ? '#0369a133' : '#1e293b44',
                          border: `1px solid ${(st.bigAutoPct ?? 0.99) === opt.pct ? '#38bdf8' : '#334155'}`,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: (st.bigAutoPct ?? 0.99) === opt.pct ? '#38bdf8' : '#e2e8f0' }}>
                            {opt.label}
                          </div>
                          <div style={{ fontSize: 10, color: '#94a3b8' }}>{opt.desc}</div>
                        </div>
                        <span className={`chk ${(st.bigAutoPct ?? 0.99) === opt.pct ? 'on' : ''}`} role="checkbox" aria-checked={(st.bigAutoPct ?? 0.99) === opt.pct} />
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '8px 12px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11, color: '#94a3b8' }}>
                    💡 <b>Dynamic Whale Mode:</b> Continuously evaluates the last 1,000 market trades and calculates the top percentile in real-time. Automatically scales whether trading Indices, Crude Oil, or Bitcoin without manual reconfiguration.
                  </div>
                </div>
              )}

              {/* Aggressive Sweep Clustering */}
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Aggressive Sweep Window</span>
                  <span className="mono" style={{ fontSize: 11, color: '#38bdf8' }}>{f.aggMs ?? 250} ms</span>
                </div>
                <p className="hint" style={{ marginBottom: 8 }}>
                  Consecutive market prints in the same direction within this window are clustered into one swept order before threshold evaluation.
                </p>
                <div className="set-presets">
                  {[0, 50, 150, 250, 500].map(ms => (
                    <button
                      key={ms}
                      className={`pill-btn ${(f.aggMs ?? 250) === ms ? 'on' : ''}`}
                      onClick={() => setFlow({ aggMs: ms })}
                    >
                      {ms === 0 ? 'Off (Raw)' : `${ms}ms`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: HEATMAP */}
          {tab === 'heat' && (
            <div className="set-pane">
              <h6>Liquidity Heatmap Contrast</h6>
              <p className="hint">Controls resting limit order density and contrast on the canvas.</p>
              <div className="set-grid">
                <label className="set-field">
                  <span>Visual contrast ({Math.round((f.heatContrast ?? 0.55) * 100)}%)</span>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    value={Math.round((f.heatContrast ?? 0.55) * 100)}
                    onChange={e => setFlow({ heatContrast: +e.target.value / 100 })}
                  />
                </label>
                <label className="set-field">
                  <span>Cutoff filter (hide orders &lt; level)</span>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={f.heatCutoff ?? 4}
                    onChange={e => setFlow({ heatCutoff: +e.target.value })}
                  />
                </label>
              </div>
            </div>
          )}

          {/* TAB: VOLUME PROFILE */}
          {tab === 'vp' && (
            <div className="set-pane">
              <h6>Volume Profile (DeepCharts style)</h6>
              <p className="hint">Dual-profile provides normal volume histogram on the right and net delta profile on the left.</p>
              <div className="set-grid">
                <label className="set-field">
                  <span>Profile layout mode</span>
                  <select
                    value={f.vpMode || 'split'}
                    onChange={e => setFlow({ vpMode: e.target.value as VpMode })}
                  >
                    <option value="split">Dual-sided: Left Delta Profile + Right Normal Volume (DeepCharts style)</option>
                    <option value="normal">Normal Volume Profile only (Right side)</option>
                    <option value="delta">Delta Profile only (Left side)</option>
                  </select>
                </label>

                <N
                  label="Value Area percentage (%)"
                  v={f.vpVaPct ?? 70}
                  step={1}
                  min={50}
                  on={v => setFlow({ vpVaPct: Math.min(95, v) })}
                  hint="Standard value area is 70% (1 standard deviation)"
                />

                <N
                  label="Profile width (% of chart)"
                  v={f.vpWidth ?? 22}
                  step={2}
                  min={12}
                  on={v => setFlow({ vpWidth: Math.min(40, v) })}
                  hint="Width of the volume profile histogram"
                />
              </div>
            </div>
          )}

          {/* TAB: FOOTPRINT & IMBALANCES */}
          {tab === 'fp' && (
            <div className="set-pane">
              <h6>Footprint &amp; stacked imbalances</h6>
              <div className="set-grid">
                <label className="set-field">
                  <span>Diagonal imbalance ratio</span>
                  <select value={f.fpRatio} onChange={e => setFlow({ fpRatio: +e.target.value })}>
                    {[1.5, 2, 2.5, 3, 3.5, 4, 5].map(r => <option key={r} value={r}>{r * 100}%</option>)}
                  </select>
                </label>
                <N
                  label="Minimum volume filter (contracts)"
                  v={f.fpMinVol}
                  step={1}
                  min={0}
                  on={v => setFlow({ fpMinVol: v })}
                />
                <label className="set-field">
                  <span>Tick clustering aggregation</span>
                  <select value={f.aggMs} onChange={e => setFlow({ aggMs: +e.target.value })}>
                    <option value={0}>Instant (0 ms)</option>
                    <option value={100}>100 ms buffer</option>
                    <option value={250}>250 ms (default)</option>
                    <option value={500}>500 ms (low CPU)</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* TAB: BOOK & WALLS */}
          {tab === 'book' && (
            <div className="set-pane">
              <h6>Order book walls</h6>
              <div className="set-grid">
                <N
                  label="Wall multiplier (relative to median resting depth)"
                  v={st.wallMult}
                  step={1}
                  min={2}
                  on={v => settings.set({ wallMult: Math.max(2, v) })}
                />
              </div>
            </div>
          )}

          {/* TAB: SESSIONS */}
          {tab === 'sess' && (
            <div className="set-pane">
              <h6>Trading sessions (UTC)</h6>
              <div className="set-grid">
                <C label="Asia session (00:00–07:00 UTC)" v={f.sess.asia} on={() => setFlow({ sess: { ...f.sess, asia: !f.sess.asia } })} />
                <C label="London session (07:00–13:30 UTC)" v={f.sess.london} on={() => setFlow({ sess: { ...f.sess, london: !f.sess.london } })} />
                <C label="New York session (13:30–21:00 UTC)" v={f.sess.ny} on={() => setFlow({ sess: { ...f.sess, ny: !f.sess.ny } })} />
                <N label="Opening range duration (minutes from NY open)" v={f.orMin} step={5} min={5} on={v => setFlow({ orMin: v })} />
              </div>
            </div>
          )}

          {/* TAB: CALENDAR & ALERTS */}
          {tab === 'cal' && (
            <div className="set-pane">
              <h6>Alerts &amp; notifications</h6>
              <div className="set-grid" style={{ marginBottom: 16 }}>
                <C label="Play alert sound on trigger" v={st.sound} on={() => settings.set({ sound: !st.sound })} />
                <button className="btn" onClick={() => st.notify ? settings.set({ notify: false }) : enableNotifications()}>
                  {st.notify ? '✓ Browser notifications enabled' : 'Enable browser notifications'}
                </button>
              </div>

              <h6>Economic calendar</h6>
              <div className="set-grid">
                <label className="set-field">
                  <span>Minimum impact</span>
                  <select value={st.calImpact} onChange={e => settings.set({ calImpact: e.target.value as any })}>
                    <option>High</option><option>Medium</option><option>Low</option>
                  </select>
                </label>
                <label className="set-field">
                  <span>Currencies filter</span>
                  <input value={st.calCountries} onChange={e => settings.set({ calCountries: e.target.value.toUpperCase() })} placeholder="USD, EUR, GBP" />
                </label>
              </div>

              <div className="ev-add" style={{ marginTop: 12 }}>
                <input type="datetime-local" value={evT} onChange={e => setEvT(e.target.value)} aria-label="Event time" />
                <input placeholder="Custom event title (e.g. CPI / FOMC)" value={evName} onChange={e => setEvName(e.target.value)} />
                <button
                  className="btn"
                  disabled={!evT || !evName.trim()}
                  onClick={() => {
                    settings.set({ events: [...st.events, { t: new Date(evT).getTime(), title: evName.trim(), country: '', impact: 'High', user: true }] });
                    setEvName('');
                  }}
                >
                  Add event
                </button>
              </div>

              {st.events.map((e, i) => (
                <div key={e.t + ':' + i} className="ev-row">
                  <span>{new Date(e.t).toLocaleString('en-GB')}</span>
                  <b>{e.title}</b>
                  <button className="mini-btn" onClick={() => settings.set({ events: st.events.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* TAB: BACKUP & PRESETS */}
          {tab === 'backup' && (
            <div className="set-pane">
              <h6>Export &amp; Import Workspace Backup</h6>
              <p className="hint">Save all your candle themes, drawings, customized settings, and scripts into a portable JSON backup file.</p>
              
              <div style={{ display: 'flex', gap: 10, marginTop: 12, marginBottom: 16 }}>
                <button className="btn" onClick={handleExport}>
                  📥 Download Backup (JSON)
                </button>
                <button className="btn" onClick={() => fileInputRef.current?.click()}>
                  📤 Restore Backup from File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={handleImport}
                />
              </div>

              {importStatus && (
                <div style={{ padding: '8px 12px', borderRadius: 4, background: 'rgba(34,197,139,0.15)', color: '#2ebd85', fontSize: 12, marginBottom: 16 }}>
                  {importStatus}
                </div>
              )}

              <h6>Factory Reset</h6>
              <p className="hint">Reset all chart themes, execution defaults, and order-flow settings back to original factory defaults.</p>
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  style={{ background: '#7f1d1d', color: '#fecaca', borderColor: '#b91c1c' }}
                  onClick={() => {
                    if (confirm('Are you sure you want to reset all settings to defaults? Your drawings will remain preserved.')) {
                      resetAllSettings();
                    }
                  }}
                >
                  ⚠️ Reset All Settings to Factory Default
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
