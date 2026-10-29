/**
 * One execution-cost model shared by paper fills, quotes and backtests (all values are ASSUMPTIONS, not venue-verified):
 *  - fee: venue taker fee in bps (Robinhood: Uniswap 0.30% tier assumed; HL: 0.045% base taker per HL fee docs; Solana/Jupiter: 0 platform fee, pool fees inside price)
 *  - gas: flat USD per tx (L2 / Solana estimates)
 *  - half-spread: paid on every fill; widened 3x for Stock Tokens in pre/post sessions
 *  - impact: k·√(notional/depth) bps, k = 100
 *  - latency: decision→inclusion delay; paper charges the adverse drift over that window (floor 1 bp)
 */
import type { Session } from "../venues/market";
export type CostVenue = "robinhood" | "hyperliquid" | "solana" | "polymarket";
export const COSTS: Record<CostVenue, { feeBps: number; gasUsd: number; halfSpreadBps: number; latencyMs: number }> = {
  robinhood: { feeBps: 30, gasUsd: 0.02, halfSpreadBps: 5, latencyMs: 2_000 },
  hyperliquid: { feeBps: 4.5, gasUsd: 0, halfSpreadBps: 1, latencyMs: 500 },
  solana: { feeBps: 0, gasUsd: 0.001, halfSpreadBps: 10, latencyMs: 1_000 },
  polymarket: { feeBps: 0, gasUsd: 0, halfSpreadBps: 0, latencyMs: 0 },
};
export const IMPACT_K_BPS = 100;
export const impactBps = (notional: number, depthUsd: number) => IMPACT_K_BPS * Math.sqrt(Math.max(0, notional) / Math.max(1, depthUsd));
export function spreadBps(venue: CostVenue, isEquity: boolean, session: Session) {
  const b = COSTS[venue].halfSpreadBps;
  return isEquity && (session === "pre" || session === "post") ? b * 3 : b;
}
export interface FillCost { price: number; feeUsd: number; gasUsd: number; spreadBps: number; impactBps: number; latencyBps: number; slippageBps: number }
/** Price + costs for a fill at reference `ref` (sign +1 buy / -1 sell). */
export function modelFill(a: { venue: CostVenue; ref: number; side: 1 | -1; notional: number; depthUsd: number; isEquity: boolean; session: Session; latencyBps?: number; feeModel?: "default" | "zero" }): FillCost {
  const sp = spreadBps(a.venue, a.isEquity, a.session), im = impactBps(a.notional, a.depthUsd), lat = a.latencyBps ?? 0;
  const slippageBps = sp + im + lat;
  const zero = a.feeModel === "zero";
  return { price: a.ref * (1 + (a.side * slippageBps) / 10_000), feeUsd: zero ? 0 : (a.notional * COSTS[a.venue].feeBps) / 10_000, gasUsd: zero ? 0 : COSTS[a.venue].gasUsd,
    spreadBps: sp, impactBps: im, latencyBps: lat, slippageBps };
}
/** Adverse drift over the venue latency window, from the move observed over the same window just before t. */
export function latencyBps(venue: CostVenue, now: number, prev: number | null) {
  if (!prev || !(prev > 0)) return 1;
  return Math.max(1, Math.abs((now - prev) / prev) * 10_000);
}
