// M5.1 market detail helpers.
// - CHART_RANGES: the tf/range pairs the page requests. Each stays under the server's 500-bar cap (contracts market.ts).
// - mockHistory/mockDetail: a deterministic MOCK of GET /markets/:id/history and /detail for NEXT_PUBLIC_API_MODE=mock.
//   The same instrument, tf and range always give the same bars (seeded by a string hash), and the last close equals the quote.
// - publicRefs: PROPOSED — awaiting Sage. A stand-in for "strategies on this market". // MOCK
import { ApiErr } from "./types";
import type { Market, MarketDetailRes, MarketHistoryRes, MarketRange, MarketStrategyRef, MarketTf } from "./types";

const TF_MIN: Record<MarketTf, number> = { "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };
const RANGE_MIN: Record<MarketRange, number> = { "1d": 1440, "7d": 10080, "30d": 43200, "90d": 129600, "1y": 525600 };
export const MAX_BARS = 500;
export const barsFor = (tf: MarketTf, range: MarketRange) => Math.ceil(RANGE_MIN[range] / TF_MIN[tf]);
export const CHART_RANGES: { range: MarketRange; tf: MarketTf; label: string }[] = [
  { range: "1d", tf: "15m", label: "1D" }, { range: "7d", tf: "1h", label: "1W" }, { range: "30d", tf: "4h", label: "1M" },
  { range: "90d", tf: "1d", label: "3M" }, { range: "1y", tf: "1d", label: "1Y" },
]; // 96 / 168 / 180 / 90 / 365 bars

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dp = (m: Market) => (m.kind === "outcome" ? 4 : Number(m.price ?? 0) < 2 ? 4 : 2);
const NOTICE = "Example data: simulated history, not market prices.";

export function mockHistory(m: Market, tf: MarketTf, range: MarketRange, now = Date.now()): MarketHistoryRes {
  const n = barsFor(tf, range);
  if (n > MAX_BARS) throw new ApiErr("validation_failed", `That range needs ${n} bars; the limit is ${MAX_BARS}.`, 422);
  const step = TF_MIN[tf] * 60000, vol = 0.0025 * Math.sqrt(TF_MIN[tf] / 15), f = dp(m);
  const clamp = (v: number) => (m.kind === "outcome" ? Math.min(0.99, Math.max(0.01, v)) : v);
  const rand = rng(hash(`${m.id}|${tf}|${range}`)); const closes = [Number(m.price ?? (m.kind === "outcome" ? 0.5 : 100))];
  for (let i = 1; i < n; i++) closes.push(clamp(closes[i - 1] * (1 + (rand() - 0.5) * 2 * vol)));
  closes.reverse();
  const end = Math.floor(now / step) * step;
  const bars = closes.map((c, i) => { const o = i ? closes[i - 1] : c; const w = Math.abs(c - o) + c * vol * rand() * 0.5;
    return { t: new Date(end - (n - 1 - i) * step).toISOString(), o: o.toFixed(f), h: clamp(Math.max(o, c) + w / 2).toFixed(f), l: clamp(Math.min(o, c) - w / 2).toFixed(f), c: c.toFixed(f) }; });
  const hi = Math.max(...bars.map((b) => Number(b.h))), lo = Math.min(...bars.map((b) => Number(b.l))), first = Number(bars[0].o), last = Number(bars[n - 1].c);
  const lr = closes.slice(1).map((c, i) => Math.log(c / closes[i])); const mu = lr.reduce((a, b) => a + b, 0) / (lr.length || 1);
  const sd = Math.sqrt(lr.reduce((a, b) => a + (b - mu) ** 2, 0) / (lr.length || 1)) * 100;
  return { instrumentId: m.id, tf, range, from: bars[0].t, to: bars[n - 1].t, bars, synthetic: true, notice: NOTICE, dataSource: "fallback" as const, warmup: false, warmupNotice: null,
    stats: { open: bars[0].o, high: hi.toFixed(f), low: lo.toFixed(f), last: bars[n - 1].c, changePct: (((last - first) / first) * 100).toFixed(2), rangePct: (((hi - lo) / lo) * 100).toFixed(2), volatilityPct: sd.toFixed(3), bars: n },
    coverage: [{ source: "mock", from: bars[0].t, to: bars[n - 1].t, gaps: 0, synthetic: true }] };
}
export function mockDetail(m: Market): MarketDetailRes {
  const h = mockHistory(m, "4h", "30d"); const c = h.bars.map((b) => Number(b.c)), last = c[c.length - 1];
  const ret = (k: number) => (((last - c[Math.max(0, c.length - 1 - k)]) / c[Math.max(0, c.length - 1 - k)]) * 100).toFixed(2);
  return { market: m, returns: { "1d": ret(6), "7d": ret(42), "30d": ret(c.length - 1) }, high30d: h.stats.high, low30d: h.stats.low, volatility30dPct: h.stats.volatilityPct, synthetic: true, notice: NOTICE };
}
/** PROPOSED — awaiting Sage: public strategies on the same venue, a stand-in until the server indexes strategies by instrument. // MOCK */
export const publicRefs = (items: { id: string; name: string; venues: string[] }[], m: Market | undefined): MarketStrategyRef[] =>
  m ? items.filter((s) => s.venues.includes(m.venue)).slice(0, 3).map((s) => ({ strategyId: s.id, name: s.name, runId: null, mine: false, status: "idle" })) : [];
