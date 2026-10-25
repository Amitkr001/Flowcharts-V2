/** Technical-analysis helpers. Inputs are plain number arrays; outputs align by index with null warm-up. */
type N = number | null;

export const TA = {
  sma(a: number[], n: number): N[] {
    const o: N[] = new Array(a.length).fill(null); let s = 0;
    for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; }
    return o;
  },
  ema(a: number[], n: number): N[] {
    const o: N[] = new Array(a.length).fill(null); const k = 2 / (n + 1); let e = 0, s = 0;
    for (let i = 0; i < a.length; i++) {
      if (i < n) { s += a[i]; if (i === n - 1) { e = s / n; o[i] = e; } continue; }
      e = a[i] * k + e * (1 - k); o[i] = e;
    }
    return o;
  },
  wma(a: number[], n: number): N[] {
    const o: N[] = new Array(a.length).fill(null), d = (n * (n + 1)) / 2;
    for (let i = n - 1; i < a.length; i++) { let s = 0; for (let j = 0; j < n; j++) s += a[i - j] * (n - j); o[i] = s / d; }
    return o;
  },
  stdev(a: number[], n: number): N[] {
    const m = TA.sma(a, n);
    return a.map((_, i) => { const mi = m[i]; if (mi == null) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += (a[j] - mi) ** 2; return Math.sqrt(s / n); });
  },
  rsi(a: number[], n = 14): N[] {
    const o: N[] = new Array(a.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < a.length; i++) {
      const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = !l && !g ? 50 : l ? 100 - 100 / (1 + g / l) : 100; } continue; }
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = !l && !g ? 50 : l ? 100 - 100 / (1 + g / l) : 100;
    }
    return o;
  },
  atr(h: number[], l: number[], c: number[], n = 14): N[] {
    const tr = h.map((x, i) => i ? Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])) : x - l[i]);
    const o: N[] = new Array(h.length).fill(null); let a = 0;
    for (let i = 0; i < tr.length; i++) { if (i < n) { a += tr[i]; if (i === n - 1) { a /= n; o[i] = a; } continue; } a = (a * (n - 1) + tr[i]) / n; o[i] = a; }
    return o;
  },
  macd(a: number[], f = 12, s = 26, sig = 9) {
    const ef = TA.ema(a, f), es = TA.ema(a, s);
    const m = a.map((_, i) => ef[i] != null && es[i] != null ? ef[i]! - es[i]! : null);
    const start = m.findIndex(x => x != null);
    const sg: N[] = new Array(a.length).fill(null);
    if (start >= 0) { const e = TA.ema(m.slice(start) as number[], sig); e.forEach((v, i) => { sg[start + i] = v; }); }
    return { macd: m, signal: sg, hist: m.map((v, i) => v != null && sg[i] != null ? v - sg[i]! : null) };
  },
  highest(a: number[], n: number): N[] { return a.map((_, i) => i < n - 1 ? null : Math.max(...a.slice(i - n + 1, i + 1))); },
  lowest(a: number[], n: number): N[] { return a.map((_, i) => i < n - 1 ? null : Math.min(...a.slice(i - n + 1, i + 1))); },
  cross(a: N[], b: N[] | number, i: number): boolean {
    const bv = (k: number) => typeof b === 'number' ? b : b[k];
    return i > 0 && a[i] != null && a[i - 1] != null && bv(i) != null && bv(i - 1) != null && a[i - 1]! <= bv(i - 1)! && a[i]! > bv(i)!;
  },
  crossunder(a: N[], b: N[] | number, i: number): boolean {
    const bv = (k: number) => typeof b === 'number' ? b : b[k];
    return i > 0 && a[i] != null && a[i - 1] != null && bv(i) != null && bv(i - 1) != null && a[i - 1]! >= bv(i - 1)! && a[i]! < bv(i)!;
  },
};
