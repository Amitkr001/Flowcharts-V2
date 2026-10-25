/** Shared labels for overlays, panels and timeframes (toolbar, command palette and shortcuts use the same names). */
import type { ChartStyle, Overlays } from '../../lib/types';
import type { PanelKey, TrayTab } from '../../lib/settings';

export const OV_GROUPS: [string, [keyof Overlays, string, string][]][] = [
  ['Order flow', [
    ['bubbles', 'Big-trade bubbles', 'Aggressive prints above your size threshold'],
    ['signals', 'Order-flow signals', 'Absorption, exhaustion, unfinished auctions, delta divergence'],
    ['imbl', 'Stacked imbalances', 'Zones of 3+ diagonal imbalances, open until traded through'],
    ['walls', 'Liquidity walls', 'Largest resting bids and asks in the live book'],
    ['book', 'Iceberg & pulled liquidity', 'Refilling levels and large orders that vanish'],
    ['liqs', 'Liquidations', 'Forced long / short exits from the exchanges'],
  ]],
  ['Panes', [
    ['volume', 'Volume', 'Buy / sell split per bar'],
    ['cvd', 'Cumulative delta', 'Running buy − sell aggression'],
    ['delta', 'Delta', 'Buy − sell volume per bar'],
    ['stats', 'Bar statistics', 'Volume, delta, delta % and big-trade delta table'],
    ['oi', 'Open interest', 'With funding rate'],
  ]],
  ['Levels & context', [
    ['vwap', 'VWAP', 'Session VWAP with deviation bands'],
    ['sessions', 'Session profiles', 'Asia / London / NY value areas and naked POCs'],
    ['levels', 'Key levels', 'Prev. day high/low/close, day & week open, opening range'],
    ['visp', 'Visible range profile', 'Volume profile of what is on screen'],
    ['dlyp', 'Daily profile', 'Volume profile since the day open'],
    ['cal', 'Economic calendar', 'High-impact news markers'],
  ]],
];
export const OV_LABEL = Object.fromEntries(OV_GROUPS.flatMap(([, it]) => it.map(([k, l]) => [k, l]))) as Record<keyof Overlays, string>;

export const STYLES: [ChartStyle, string, string, string][] = [
  ['candles', 'Candles', 'candles', 'Price bars with big-trade bubbles'],
  ['footprint', 'Footprint', 'footprint', 'Bid × ask volume at every price'],
  ['heatmap', 'Heatmap', 'flame', 'Resting liquidity over time'],
];

export const PANELS: [PanelKey, string, string, string][] = [
  ['trade', 'Order ticket', 'dollar', 'Alt+1'],
  ['book', 'Order book', 'ladder', 'Alt+2'],
  ['tape', 'Time & sales', 'list', 'Alt+3'],
  ['alerts', 'Alerts', 'bell', 'Alt+4'],
  ['watch', 'Watchlist', 'star', 'Alt+5'],
  ['flow', 'Venue flow', 'activity', 'Alt+6'],
];

export const TRAY: [TrayTab, string][] = [['positions', 'Positions'], ['orders', 'Open orders'], ['fills', 'Fills'], ['big', 'Big trades'], ['alerts', 'Alert log']];

/** Favourite timeframes shown as buttons (keys 1–6 select them). */
export const FAV_TF = ['t:60', 't:300', 't:900', 't:3600', 't:14400', 't:86400'];
