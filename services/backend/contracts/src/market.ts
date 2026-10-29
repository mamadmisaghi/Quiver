// M5.1: per-market detail page (chart history + stats). Paper/read-only data; same price sources as /markets.
import { z } from "zod";
import { WarmupNotice } from "./common";
import { Market } from "./api";

export const MarketTf = z.enum(["15m", "1h", "4h", "1d"]);
export const MarketRange = z.enum(["1d", "7d", "30d", "90d", "1y"]);
export const MarketHistoryQuery = z.object({ tf: MarketTf.default("1h"), range: MarketRange.default("7d") });
export const MarketBar = z.object({ t: z.string(), o: z.string(), h: z.string(), l: z.string(), c: z.string() });
export const MarketStats = z.object({
  open: z.string().nullable(), high: z.string().nullable(), low: z.string().nullable(), last: z.string().nullable(),
  changePct: z.string().nullable(), rangePct: z.string().nullable(),
  /** stdev of bar-to-bar log returns ×100 (not annualised). */
  volatilityPct: z.string().nullable(), bars: z.number().int(),
});
export const MarketHistoryRes = z.object({
  instrumentId: z.string(), tf: MarketTf, range: MarketRange, from: z.string(), to: z.string(),
  bars: z.array(MarketBar), stats: MarketStats, synthetic: z.boolean(),
  /** M5.18: "tiingo" = Tiingo daily/IEX bars (stock/ETF, key set); "fallback" = the current source. */
  dataSource: z.enum(["tiingo", "fallback"]),
  coverage: z.array(z.object({ source: z.string(), from: z.string(), to: z.string(), gaps: z.number().int(), synthetic: z.boolean(), modeled: z.boolean().optional() })),
  notice: z.string().nullable(),
  /** M5.22: true while the server is warming up after a restart (history may be partial). */
  warmup: z.boolean().default(false),
  warmupNotice: WarmupNotice.nullable().default(null),
});
export const MarketDetailRes = z.object({
  market: Market,
  returns: z.object({ "1d": z.string().nullable(), "7d": z.string().nullable(), "30d": z.string().nullable() }),
  high30d: z.string().nullable(), low30d: z.string().nullable(), volatility30dPct: z.string().nullable(),
  synthetic: z.boolean(), notice: z.string().nullable(),
});
export type MarketHistoryRes = z.infer<typeof MarketHistoryRes>;
export type MarketDetailRes = z.infer<typeof MarketDetailRes>;
