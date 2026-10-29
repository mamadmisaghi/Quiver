/**
 * Performance metrics from an equity curve. Conventions (documented for the UI):
 *  - returns are simple per-sample returns; the starting equity is the first point (so a loss on bar 1 counts)
 *  - Sharpe = mean/stdev(sample, n−1) × √(periods per year), risk-free = 0; periods/year from the median sample spacing
 *    over a 365-day year (crypto-style, 24/7). null if < 3 returns or zero variance.
 *  - Sortino uses downside deviation √(Σmin(r,0)²/(n−1)); null if no negative returns.
 *  - Max drawdown: largest peak-to-trough fall (percent of peak); duration = longest time under a prior peak.
 *  - Win rate / profit factor over CLOSED trades, net of fees on the closing fill.
 */
export interface Metrics { returnPct: number; maxDrawdownPct: number; maxDrawdownDurationMs: number; sharpe: number | null; sortino: number | null; volatilityAnnPct: number | null;
  closedTrades: number; winRatePct: number | null; profitFactor: number | null; avgWinUsd: number | null; avgLossUsd: number | null }
const YEAR = 365 * 86_400_000;
export function computeMetrics(curve: [number, number][], start: number, closed: number[]): Metrics {
  const pts: [number, number][] = curve.length && curve[0][1] === start ? curve : [[curve[0]?.[0] ?? 0, start], ...curve];
  const end = pts.at(-1)![1];
  let peak = pts[0][1], peakT = pts[0][0], mdd = 0, ddDur = 0;
  for (const [t, e] of pts) { if (e >= peak) { peak = e; peakT = t; } else { mdd = Math.max(mdd, (peak - e) / peak); ddDur = Math.max(ddDur, t - peakT); } }
  const r: number[] = []; for (let j = 1; j < pts.length; j++) r.push(pts[j][1] / pts[j - 1][1] - 1);
  const gaps = pts.slice(1).map((p, j) => p[0] - pts[j][0]).sort((a, b) => a - b); const step = gaps.length ? gaps[gaps.length >> 1] : 0;
  const ppy = step > 0 ? YEAR / step : 0;
  let sharpe: number | null = null, sortino: number | null = null, vol: number | null = null;
  if (r.length >= 3 && ppy > 0) {
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
    if (sd > 1e-12) { sharpe = (m / sd) * Math.sqrt(ppy); vol = sd * Math.sqrt(ppy) * 100; }
    const dd = Math.sqrt(r.reduce((a, b) => a + Math.min(b, 0) ** 2, 0) / (r.length - 1));
    if (dd > 1e-12) sortino = (m / dd) * Math.sqrt(ppy);
  }
  const wins = closed.filter((x) => x > 0), losses = closed.filter((x) => x < 0);
  const gw = wins.reduce((a, b) => a + b, 0), gl = -losses.reduce((a, b) => a + b, 0);
  return { returnPct: ((end - start) / start) * 100, maxDrawdownPct: mdd * 100, maxDrawdownDurationMs: ddDur, sharpe, sortino, volatilityAnnPct: vol,
    closedTrades: closed.length, winRatePct: closed.length ? (wins.length / closed.length) * 100 : null, profitFactor: gl > 0 ? gw / gl : null, // null when there are no losses (undefined ratio)
    avgWinUsd: wins.length ? gw / wins.length : null, avgLossUsd: losses.length ? -gl / losses.length : null };
}
