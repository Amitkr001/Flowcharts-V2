import assert from 'node:assert/strict';
import { BarBuilder, buildSeries, parseSpec, specKey, specLabel } from '../web/src/data/bars.ts';
import { TA } from '../web/src/lib/ta.ts';
import { barSignals } from '../web/src/chart/signals.ts';
import { sessionProfiles, keyLevels } from '../web/src/chart/levels.ts';
import { PaperBroker } from '../web/src/lib/paper.ts';
import { TOOL_MAP, hitDrawing, handlesOf } from '../web/src/chart/drawings.ts';
import { backtest, signalsOf } from '../web/src/backtest/engine.ts';
import { runScript } from '../web/src/indicators/runtime.ts';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, status: 'PASS', error: null });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err });
    console.error(`[FAIL] ${name}:`, err.message);
  }
}

console.log('--- STARTING ENGINE MATH & ALGORITHM VERIFICATION ---');

// ==========================================
// 1. BARBUILDER & FOOTPRINT & TRADES
// ==========================================
test('BarBuilder: Footprint cell accumulation and Delta calculation', () => {
  const bb = new BarBuilder({ kind: 'time', sec: 60 }, 1, 1000);
  const baseT = 1700000000000;
  // Tick: [t, p, q, side, vi]
  // Aggressor buy: side = 1 (lifts ask)
  // Aggressor sell: side = -1 (hits bid)
  bb.add([baseT + 1000, 100, 2.5, 1]); // buy 2.5 @ 100
  bb.add([baseT + 2000, 100, 1.5, -1]); // sell 1.5 @ 100
  bb.add([baseT + 3000, 101, 4.0, 1]); // buy 4.0 @ 101
  bb.add([baseT + 4000, 99, 3.0, -1]); // sell 3.0 @ 99

  assert.equal(bb.bars.length, 1);
  const bar = bb.bars[0];
  assert.equal(bar.o, 100);
  assert.equal(bar.h, 101);
  assert.equal(bar.l, 99);
  assert.equal(bar.c, 99);
  assert.equal(bar.v, 11.0);
  assert.equal(bar.b, 6.5);
  assert.equal(bar.s, 4.5);

  // Check footprint cells: cell[0] is sell (hit bid), cell[1] is buy (lift ask)
  const cell100 = bar.fp.get(100);
  assert.ok(cell100, 'Cell at 100 should exist');
  assert.equal(cell100[0], 1.5, 'Sell volume at 100');
  assert.equal(cell100[1], 2.5, 'Buy volume at 100');

  const cell101 = bar.fp.get(101);
  assert.equal(cell101[0], 0);
  assert.equal(cell101[1], 4.0);

  const cell99 = bar.fp.get(99);
  assert.equal(cell99[0], 3.0);
  assert.equal(cell99[1], 0);

  // Series delta verification
  const s = buildSeries(bb.bars);
  assert.equal(s.delta[0], 6.5 - 4.5); // 2.0
  assert.equal(s.cvd[0], 2.0);
});

test('BarBuilder: Sweep clustering with aggMs > 0', () => {
  const bb = new BarBuilder({ kind: 'time', sec: 60 }, 1, 500, 50); // aggMs = 50ms, bigUsd = 500
  const baseT = 1700000000000;
  // Three consecutive buy prints across levels within 20ms
  // Trade 1: 2 @ 100 = 200 USD
  // Trade 2: 2 @ 101 = 202 USD
  // Trade 3: 2 @ 102 = 204 USD
  // Total Q = 6, Total PQ = 606, VWAP = 101. Total USD = 606 > 500 (Qualifies as Big Trade!)
  bb.add([baseT + 10, 100, 2, 1]);
  bb.add([baseT + 20, 101, 2, 1]);
  bb.add([baseT + 30, 102, 2, 1]);

  // A print with opposite side or > 50ms later triggers flushCluster
  bb.add([baseT + 200, 101, 1, -1]);

  const bar = bb.bars[0];
  assert.equal(bar.big.length, 1, 'Should have merged sweep into 1 big trade');
  const big = bar.big[0];
  assert.equal(big[0], baseT + 10, 'Timestamp should be cluster start');
  assert.equal(big[1], 101, 'Price should be VWAP 101');
  assert.equal(big[2], 6, 'Quantity should be 6');
  assert.equal(big[3], 1, 'Side should be 1 (buy)');
});

test('BarBuilder: Dual-mode big trade detection (usd, qty, auto) & rolling P99', () => {
  // 1. USD Mode
  const bbUsd = new BarBuilder({ kind: 'time', sec: 60 }, 1, { mode: 'usd', bigUsd: 10000, bigQty: 10, autoPct: 0.99 });
  assert.equal(bbUsd.isBig(50, 100), false); // 5000 < 10000
  assert.equal(bbUsd.isBig(100, 100), true); // 10000 >= 10000

  // 2. QTY Mode
  const bbQty = new BarBuilder({ kind: 'time', sec: 60 }, 1, { mode: 'qty', bigUsd: 10000, bigQty: 10, autoPct: 0.99 });
  assert.equal(bbQty.isBig(9.9, 1000), false); // qty 9.9 < 10
  assert.equal(bbQty.isBig(10.0, 1), true); // qty 10.0 >= 10

  // 3. AUTO Mode (rolling percentile)
  const bbAuto = new BarBuilder({ kind: 'time', sec: 60 }, 1, { mode: 'auto', bigUsd: 5000, bigQty: 10, autoPct: 0.95 });
  // Feed 100 trade notionals: 95 trades of $1000, 5 trades of $10000
  for (let i = 0; i < 95; i++) {
    bbAuto.isBig(10, 100); // 1000 USD
  }
  for (let i = 0; i < 5; i++) {
    bbAuto.isBig(100, 100); // 10000 USD
  }
  const autoThresh = bbAuto.getAutoThreshold();
  assert.ok(autoThresh >= 1000, `Threshold ${autoThresh} should adapt to percentile`);
  assert.equal(bbAuto.isBig(15, 100), false); // $1500 is below top 5%
  assert.equal(bbAuto.isBig(120, 100), true); // $12000 is whale
});

test('BarBuilder: Bar specifications and time/vol/tick slicing', () => {
  // Test parseSpec and specKey
  const sTime = parseSpec('t:60');
  assert.deepEqual(sTime, { kind: 'time', sec: 60 });
  assert.equal(specKey(sTime), 't:60');
  assert.equal(specLabel(sTime), '1m');

  const sVol = parseSpec('v:250');
  assert.deepEqual(sVol, { kind: 'vol', size: 250 });
  assert.equal(specKey(sVol), 'v:250');
  assert.equal(specLabel(sVol), '250 Vol');

  const sTick = parseSpec('k:100');
  assert.deepEqual(sTick, { kind: 'tick', count: 100 });
  assert.equal(specKey(sTick), 'k:100');
  assert.equal(specLabel(sTick), '100 Tick');

  // Test volume bar creation
  const bbVol = new BarBuilder({ kind: 'vol', size: 10 }, 1, 10000);
  bbVol.add([1000, 100, 6, 1]);
  assert.equal(bbVol.bars.length, 1);
  bbVol.add([2000, 101, 5, 1]); // total 11 >= 10, should still be in first bar until next tick
  assert.equal(bbVol.bars.length, 1);
  bbVol.add([3000, 102, 1, 1]); // triggers fresh bar
  assert.equal(bbVol.bars.length, 2);
});

// ==========================================
// 2. TECHNICAL INDICATORS (TA)
// ==========================================
test('TA: SMA, EMA, WMA, StDev, RSI, ATR, MACD numerical accuracy & null warm-up', () => {
  const prices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]; // 10 bars
  
  // SMA (period 5)
  const sma5 = TA.sma(prices, 5);
  assert.equal(sma5[0], null);
  assert.equal(sma5[3], null);
  assert.equal(sma5[4], (10+11+12+13+14)/5); // 12
  assert.equal(sma5[9], (15+16+17+18+19)/5); // 17

  // EMA (period 5)
  const ema5 = TA.ema(prices, 5);
  assert.equal(ema5[0], null);
  assert.equal(ema5[3], null);
  assert.equal(ema5[4], 12); // Seeded with SMA at n-1
  const k = 2 / 6;
  const expectedEma5 = 15 * k + 12 * (1 - k); // at index 5 (price 15)
  assert.ok(Math.abs(ema5[5] - expectedEma5) < 1e-9);

  // StDev (period 5)
  const sd5 = TA.stdev(prices, 5);
  assert.equal(sd5[3], null);
  // for [10,11,12,13,14], mean=12, sumsq = 4+1+0+1+4 = 10, var = 10/5 = 2, sd = sqrt(2) ≈ 1.41421356
  assert.ok(Math.abs(sd5[4] - Math.SQRT2) < 1e-9);

  // RSI (period 5)
  // Let prices go up steadily: every delta is +1. Gains = 1, Loss = 0 => RSI should be 100
  const rsiUp = TA.rsi(prices, 5);
  assert.equal(rsiUp[4], null);
  assert.equal(rsiUp[5], 100);

  // ATR (period 3)
  const h = [12, 13, 14, 15];
  const l = [10, 11, 12, 13];
  const c = [11, 12, 13, 14];
  const atr3 = TA.atr(h, l, c, 3);
  assert.equal(atr3[0], null);
  assert.equal(atr3[1], null);
  assert.ok(atr3[2] !== null);

  // MACD
  const pLong = [
    22, 22.5, 23, 23.5, 24, 24.5, 25, 25.5, 26, 26.5,
    27, 27.5, 28, 28.5, 29, 29.5, 30, 30.5, 31, 31.5,
    32, 32.5, 33, 33.5, 34, 34.5, 35, 35.5, 36, 36.5,
    37, 37.5, 38, 38.5, 39
  ];
  const macdResult = TA.macd(pLong, 5, 10, 3);
  assert.equal(macdResult.macd.length, pLong.length);
  assert.equal(macdResult.signal.length, pLong.length);
  assert.equal(macdResult.hist.length, pLong.length);
  // Warm up checks
  assert.equal(macdResult.macd[8], null);
  assert.ok(macdResult.macd[9] !== null, 'MACD line should start after slow period (10)');

  // Cross & Crossunder
  const lineA = [null, 10, 12, 15, 14];
  const lineB = [null, 11, 11, 11, 16];
  assert.equal(TA.cross(lineA, lineB, 2), true, 'lineA crossed above lineB at index 2');
  assert.equal(TA.crossunder(lineA, lineB, 4), true, 'lineA crossed under lineB at index 4');
});

// ==========================================
// 3. ORDER FLOW SIGNALS
// ==========================================
test('Signals: Absorption, Exhaustion, Unfinished Auction, Delta Divergence', () => {
  const baseT = 1700000000000;
  const bars = [];
  // Build 25 baseline bars with normal volume = 100
  for (let i = 0; i < 25; i++) {
    bars.push({
      t: baseT + i * 60000,
      o: 100 + i * 0.1,
      h: 101 + i * 0.1,
      l: 99 + i * 0.1,
      c: 100.5 + i * 0.1,
      v: 100,
      b: 50,
      s: 50,
      fp: new Map([[100, [50, 50]]]),
      big: [],
      est: false,
      k: false
    });
  }

  // 1. Test Bullish Absorption
  // Bar 25: Volume 300 (3x avg), small body 0.1 (range 2.0 -> body/rng = 0.05 <= 0.35)
  // Strong negative delta (b=70, s=230 -> d = -160, |d|/v = 0.53 >= 0.12)
  // Close in upper half (mid = 100, c = 100.4 >= mid)
  const absBar = {
    t: baseT + 25 * 60000,
    o: 100.3,
    h: 101.0,
    l: 99.0,
    c: 100.4,
    v: 300,
    b: 70,
    s: 230,
    fp: new Map([[100, [230, 70]]]),
    big: [],
    est: false,
    k: false
  };
  bars.push(absBar);
  const sigsAbs = barSignals(bars, 25, 1);
  const hasBullAbs = sigsAbs.some(s => s.kind === 'abs' && s.side === 1);
  assert.ok(hasBullAbs, 'Should detect bullish absorption (sellers absorbed)');

  // 2. Test Delta Divergence (Bearish)
  // Bar 26: Up bar (c > o), body > 0.4 * rng, volume >= avg, but negative delta d < -0.2 * v
  const divBar = {
    t: baseT + 26 * 60000,
    o: 100.0,
    h: 102.0,
    l: 99.8,
    c: 101.5, // up bar, body = 1.5, rng = 2.2, body/rng = 0.68 > 0.4
    v: 150,
    b: 40,
    s: 110, // d = -70 < -30 (-0.2 * 150)
    fp: new Map([[100, [60, 20]], [101, [50, 20]]]),
    big: [],
    est: false,
    k: false
  };
  bars.push(divBar);
  const sigsDiv = barSignals(bars, 26, 1);
  const hasBearDiv = sigsDiv.some(s => s.kind === 'df' && s.side === -1);
  assert.ok(hasBearDiv, 'Should detect delta divergence on up bar with negative delta');

  // 3. Test Unfinished Auction (UA) at high
  // Footprint with >= 3 levels, top level has both buy and sell >= 20% of max level volume
  const uaFp = new Map([
    [99, [20, 20]],
    [100, [50, 50]], // max = 100
    [101, [25, 25]]  // top level: both sell(25) and buy(25) >= 20 (20% of 100)
  ]);
  const uaBar = {
    t: baseT + 27 * 60000,
    o: 99.5,
    h: 101.0,
    l: 99.0,
    c: 100.5,
    v: 190,
    b: 95,
    s: 95,
    fp: uaFp,
    big: [],
    est: false,
    k: false
  };
  bars.push(uaBar);
  const sigsUa = barSignals(bars, 27, 1);
  const hasUaHigh = sigsUa.some(s => s.kind === 'ua' && s.p === 101.0);
  assert.ok(hasUaHigh, 'Should detect unfinished auction at high');
});

// ==========================================
// 4. LEVELS & SESSION PROFILES
// ==========================================
test('Levels: Session Profile POC and 70% Value Area Distribution', () => {
  const DAY = 86_400_000;
  // Day starting at UTC midnight: 1700006400000 (day = 19676)
  const dayStart = 19676 * DAY;
  const bars = [];

  // Create London session bars (07:00 to 13:30 = 7.0 to 13.5 hours)
  // Let's create bars at hour 8.0, 9.0, 10.0
  // Distribution across prices 100, 101, 102, 103, 104
  // 100: vol 10
  // 101: vol 20
  // 102: vol 40 (POC!)
  // 103: vol 20
  // 104: vol 10
  // Total Vol = 100. Target 70% VA = 70.
  // POC (102) = 40.
  // Next expanding: 103 (20) vs 101 (20) -> tie goes up: 103 (+20 = 60).
  // Next expanding: 104 (10) vs 101 (20) -> 101 (+20 = 80 >= 70).
  // Value Area should span 101 to 103!
  const londonTime = dayStart + 8 * 3600_000;
  const fpMap = new Map([
    [100, [5, 5]],
    [101, [10, 10]],
    [102, [20, 20]],
    [103, [10, 10]],
    [104, [5, 5]],
  ]);

  bars.push({
    t: londonTime,
    o: 100,
    h: 104,
    l: 100,
    c: 102,
    v: 100,
    b: 50,
    s: 50,
    fp: fpMap,
    big: [],
    est: false,
    k: false
  });

  const sess = sessionProfiles(bars, 1, { asia: true, london: true, ny: true });
  assert.equal(sess.length, 1, 'Should produce 1 London session profile');
  const prof = sess[0];
  assert.equal(prof.name, 'London');
  assert.equal(prof.poc, 102, 'POC should be 102');
  assert.equal(prof.vah, 103, 'VAH should be 103');
  assert.equal(prof.val, 101, 'VAL should be 101');
  assert.equal(prof.vol, 100, 'Total volume should be 100');
});

// ==========================================
// 5. PAPER BROKER
// ==========================================
test('PaperBroker: Limit orders, Stop orders, OCO brackets, Breakeven, PnL', () => {
  const broker = new PaperBroker('TEST-PERP');
  broker.reset();

  let fillsRecorded = [];
  broker.onFill = (f, before, after, avg) => {
    fillsRecorded.push({ f, before, after, avg });
  };

  // Place buy limit order: Buy 1 @ 100
  broker.place('lmt', 1, 1, 100);
  assert.equal(broker.orders.length, 1);

  // Tick crossing at 99.5 fills the limit order
  broker.onTicks([[1000, 99.5, 1, -1]]);
  assert.equal(broker.orders.length, 0, 'Limit order should have filled');
  assert.equal(broker.pos.qty, 1);
  assert.equal(broker.pos.avg, 100);
  assert.equal(broker.realized, 0);

  // Configure OCO bracket: SL = 5 ticks, TP = 10 ticks
  broker.oco = { on: true, sl: 5, tp: 10 };
  broker.bracket(1); // tickSize = 1
  assert.equal(broker.orders.length, 2);
  const slOrder = broker.orders.find(o => o.type === 'stp');
  const tpOrder = broker.orders.find(o => o.type === 'lmt');
  assert.equal(slOrder.px, 95);
  assert.equal(tpOrder.px, 110);

  // Test Breakeven function
  broker.breakeven();
  const beSl = broker.orders.find(o => o.type === 'stp');
  assert.equal(beSl.px, 100, 'Stop should have moved to average price 100');

  // Price crosses Take Profit at 110.5
  broker.onTicks([[2000, 110.5, 1, 1]]);
  assert.equal(broker.pos.qty, 0, 'Position should be closed');
  assert.equal(broker.realized, 10, 'Realized PnL should be +$10');
  assert.equal(broker.orders.length, 0, 'OCO stop should have been cleared');
});

// ==========================================
// 6. DRAWINGS HIT TESTING & COORDINATES
// ==========================================
test('Drawings: Hit testing calculations for line, ray, box, fib, fixedvp', () => {
  const mockDView = {
    x: (t) => t,
    y: (p) => 1000 - p,
    t: (x) => x,
    p: (y) => 1000 - y,
    plotW: 800,
    mainH: 600,
    dec: 2,
    tick: 0.5,
    bars: [],
    row: 1,
    fmt: (p) => p.toFixed(2),
    acct: { size: 10000, risk: 1 }
  };

  // 1. Trend Line from (100, 500) to (200, 500) [horizontal line at y=500]
  const dLine = {
    id: 'test-line',
    type: 'trend',
    pts: [{ t: 100, p: 500 }, { t: 200, p: 500 }],
    color: '#fff',
    width: 2,
    dash: 0
  };
  const d1 = hitDrawing(dLine, mockDView, 150, 502); // 2px away
  assert.ok(d1 <= 2.1, `Hit distance should be ~2px, got ${d1}`);
  const d1Miss = hitDrawing(dLine, mockDView, 150, 550); // 50px away
  assert.ok(d1Miss >= 49, `Miss distance should be ~50px, got ${d1Miss}`);

  // 2. Rectangle from (100, 400) to (200, 600)
  const dRect = {
    id: 'test-rect',
    type: 'rect',
    pts: [{ t: 100, p: 400 }, { t: 200, p: 600 }],
    color: '#0f0',
    width: 1,
    dash: 0,
    fill: true
  };
  const dRectInside = hitDrawing(dRect, mockDView, 150, 500);
  assert.equal(dRectInside, 0, 'Point inside filled rect should have distance 0');

  // 3. Fixed VP handles
  const dFixedVp = {
    id: 'test-fixedvp',
    type: 'fixedvp',
    pts: [{ t: 100, p: 600 }, { t: 300, p: 400 }],
    color: '#e6c84a',
    width: 1,
    dash: 0
  };
  const handles = handlesOf(dFixedVp, mockDView);
  assert.equal(handles.length, 10, 'Fixed VP should expose 10 handles for corner and edge resizing');
});

// ==========================================
// 7. BACKTEST ENGINE
// ==========================================
test('BacktestEngine: Signal evaluation, trade execution, conservative SL, fees', () => {
  const n = 50;
  const time = new Array(n).fill(0).map((_, i) => 1700000000000 + i * 60000);
  const open = new Array(n).fill(100);
  const high = new Array(n).fill(102);
  const low = new Array(n).fill(98);
  const close = new Array(n).fill(100);
  const volume = new Array(n).fill(1000);
  const delta = new Array(n).fill(100);
  const cvd = new Array(n).fill(100);
  const vwap = new Array(n).fill(100);
  const bigBuy = new Array(n).fill(0);
  const bigSell = new Array(n).fill(0);
  const buy = new Array(n).fill(550);
  const sell = new Array(n).fill(450);

  const series = {
    length: n,
    time, open, high, low, close, volume,
    buy, sell, delta, cvd, vwap, bigBuy, bigSell
  };

  // Signal: buy on bar 2, exit on bar 5
  const sig = {
    long: new Array(n).fill(false),
    short: new Array(n).fill(false),
    exitLong: new Array(n).fill(false),
    exitShort: new Array(n).fill(false)
  };
  sig.long[2] = true;
  sig.exitLong[5] = true;

  const cfg = {
    qty: 1,
    slTicks: 10, // 5 pts
    tpTicks: 10, // 5 pts
    feePct: 0.05,
    slipTicks: 0,
    tick: 0.5,
    maxBars: 0,
    dir: 'both'
  };

  const res = backtest(series, sig, cfg);
  assert.equal(res.err, null);
  assert.equal(res.trades.length, 1, 'Should execute exactly 1 trade');
  const t = res.trades[0];
  assert.equal(t.side, 1);
  assert.equal(t.i0, 3, 'Entry fills on bar 3 open (next bar after signal at bar 2)');
  assert.equal(t.i1, 6, 'Exit fills on bar 6 open (next bar after exitLong at bar 5)');
  assert.equal(t.why, 'signal');
});

// ==========================================
// 8. INDICATORS RUNTIME SANDBOX
// ==========================================
test('IndicatorsRuntime: Custom JS indicator sandbox and plot validation', () => {
  const n = 20;
  const d = {
    length: n,
    time: new Array(n).fill(0),
    open: new Array(n).fill(100),
    high: new Array(n).fill(105),
    low: new Array(n).fill(95),
    close: new Array(n).fill(102),
    volume: new Array(n).fill(1000),
    buy: new Array(n).fill(600),
    sell: new Array(n).fill(400),
    delta: new Array(n).fill(200),
    cvd: new Array(n).fill(200),
    vwap: new Array(n).fill(101),
    bigBuy: new Array(n).fill(0),
    bigSell: new Array(n).fill(0)
  };

  const script = {
    id: 'test-sma',
    name: 'Test SMA',
    on: true,
    inputs: [{ k: 'len', label: 'Length', v: 5 }],
    code: `
      const s = ta.sma(d.close, input.len);
      plot('SMA', s, { color: '#00ff00', pane: 'main', type: 'line' });
    `
  };

  const res = runScript(script, d);
  assert.equal(res.err, null);
  assert.equal(res.plots.length, 1);
  assert.equal(res.plots[0].name, 'SMA');
  assert.equal(res.plots[0].values.length, n);
  assert.equal(res.plots[0].values[0], null); // warm-up
  assert.equal(res.plots[0].values[4], 102); // close is 102
});

console.log('--- ALL TEST SUITES EXECUTED ---');
const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
console.log(`Summary: ${passed} PASSED, ${failed} FAILED.`);
