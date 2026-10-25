/** Loads bars for a market + bar type (exchange candles for history, live ticks for order flow) and keeps them updating. */
import { useEffect, useRef, useState } from 'react';
import { data, net } from '../data/client';
import { BarBuilder, buildSeries, parseSpec, type Series } from '../data/bars';
import type { Bar } from '../lib/types';
import { bigFor } from '../lib/settings';

export function useSeries(symId: string, specKey: string, live = true) {
  const [state, setState] = useState<{ bars: Bar[]; series: Series | null; loading: boolean }>({ bars: [], series: null, loading: true });
  const tick = useRef(0);
  useEffect(() => {
    const sym = net.get().symbols.find(s => s.id === symId); if (!sym) return;
    const spec = parseSpec(specKey), m = data.get(symId);
    let B = new BarBuilder(spec, sym.row, bigFor(sym.id, sym.bigUsd));
    let k: Awaited<ReturnType<typeof data.klines>> = [], alive = true;
    const rebuild = () => { B = new BarBuilder(spec, sym.row, bigFor(sym.id, sym.bigUsd)); B.addAll(m.ticks); if (spec.kind === 'time') B.seedKlines(k, false); publish(); };
    const publish = () => { if (alive) setState({ bars: B.bars, series: buildSeries(B.bars), loading: false }); };
    setState(s => ({ ...s, loading: true }));
    if (spec.kind === 'time' && spec.sec >= 60) data.klines(symId, spec.sec, 1000).then(r => { k = r; rebuild(); }); else rebuild();
    const off = m.on((e, d) => { if (e === 'snap') rebuild(); else if (e === 'tk' && live) { for (const t of d) B.add(t); if (++tick.current % 10 === 0) publish(); } });
    return () => { alive = false; off(); data.release(symId); };
  }, [symId, specKey, live]);
  return state;
}
