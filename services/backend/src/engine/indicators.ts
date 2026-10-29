export const TF_MS = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 } as const;
export type Tf = keyof typeof TF_MS;

export function sma(c: number[], p: number) { if (c.length < p) return null; const s = c.slice(-p); return s.reduce((a, b) => a + b, 0) / p; }
export function ema(c: number[], p: number) {
  if (c.length < p) return null; const k = 2 / (p + 1);
  let e = c.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < c.length; i++) e = c[i] * k + e * (1 - k);
  return e;
}
export function rsi(c: number[], p: number) {
  if (c.length < p + 1) return null; let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (p - 1) + Math.max(d, 0)) / p; al = (al * (p - 1) + Math.max(-d, 0)) / p; }
  if (al === 0) return 100; return 100 - 100 / (1 + ag / al);
}
export function atr(b: { h: number; l: number; c: number }[], p: number) {
  if (b.length < p + 1) return null; const tr: number[] = [];
  for (let i = 1; i < b.length; i++) tr.push(Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)));
  return sma(tr, p);
}
export function bb(c: number[], p: number, side: 1 | -1) {
  const m = sma(c, p); if (m == null) return null; const s = c.slice(-p);
  const sd = Math.sqrt(s.reduce((a, x) => a + (x - m) ** 2, 0) / p); return m + side * 2 * sd;
}
export function pctChange(c: number[], p: number) { if (c.length < p + 1) return null; const a = c[c.length - 1 - p]; return ((c[c.length - 1] - a) / a) * 100; }
/** Bars of history required (EMA/RSI use 3x warm-up). */
export const lookback = (name: string, p: number) => (name === "ema" || name === "rsi" ? p * 3 + 1 : p + 1);
