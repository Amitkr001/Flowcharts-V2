import assert from 'node:assert/strict';
import { BarBuilder, buildSeries } from '../web/src/data/bars.ts';
import { TA } from '../web/src/lib/ta.ts';
import { sessionProfiles, keyLevels } from '../web/src/chart/levels.ts';
import { PaperBroker } from '../web/src/lib/paper.ts';

console.log('--- RUNNING STRESS & EDGE-CASE AUDIT ---');

// Edge Case 1: All bars have identical price (collapsed price range)
const collapsedBars = [];
const baseT = 1700000000000;
for (let i = 0; i < 20; i++) {
  collapsedBars.push({
    t: baseT + i * 60000,
    o: 100, h: 100, l: 100, c: 100,
    v: 10, b: 5, s: 5,
    fp: new Map([[100, [5, 5]]]),
    big: [], est: false, k: false
  });
}
const sCollapsed = buildSeries(collapsedBars);
assert.equal(sCollapsed.vwap[0], 100);
assert.equal(sCollapsed.delta[0], 0);

// Edge Case 2: Zero volume bars
const zeroVolBars = [];
for (let i = 0; i < 10; i++) {
  zeroVolBars.push({
    t: baseT + i * 60000,
    o: 100, h: 100, l: 100, c: 100,
    v: 0, b: 0, s: 0,
    fp: new Map(),
    big: [], est: false, k: false
  });
}
const sZero = buildSeries(zeroVolBars);
assert.equal(sZero.volume[0], 0);
assert.equal(sZero.vwap[0], 100); // fallback to c

// Edge Case 3: TA indicator edge cases
// EMA with n = 1
const ema1 = TA.ema([10, 20, 30], 1);
assert.deepEqual(ema1, [10, 20, 30]);

// SMA with n > array.length
const smaLarge = TA.sma([10, 20], 5);
assert.deepEqual(smaLarge, [null, null]);

// RSI with 0 gain and 0 loss (all flat)
const rsiFlat = TA.rsi([100, 100, 100, 100, 100, 100], 5);
console.log('RSI flat result (value at idx 5):', rsiFlat[5]);

// StDev with period 1
const sd1 = TA.stdev([10, 20, 30], 1);
assert.deepEqual(sd1, [0, 0, 0]);

// Edge Case 4: Zero volume session profile
const sessZero = sessionProfiles(zeroVolBars, 1, { asia: true, london: true, ny: true });
console.log('Session profiles on zero volume bars count:', sessZero.length);
if (sessZero.length > 0) {
  console.log('Zero vol profile VAH/VAL:', sessZero[0].vah, sessZero[0].val);
}

// Edge Case 5: Paper broker double trigger prevention
const broker = new PaperBroker('STRESS-TEST');
broker.reset();
broker.place('lmt', 1, 1, 100);
// Send tick with price crossing limit
broker.onTicks([[1000, 99, 1, -1]]);
assert.equal(broker.orders.length, 0);
assert.equal(broker.pos.qty, 1);

console.log('--- STRESS & EDGE-CASE AUDIT COMPLETE ---');
