// Landing-page product copy (not data). Venue names/tags and the sample thesis shown in the hero.
export type Venue = "robinhood" | "solana" | "hyperliquid" | "polymarket";
export const VENUES: Record<Venue, { name: string; short: string; tag: string }> = {
  robinhood: { name: "Robinhood Chain", short: "RH", tag: "Stock tokens · Uniswap" },
  solana: { name: "Solana", short: "SOL", tag: "SPL · Jupiter" },
  hyperliquid: { name: "Hyperliquid", short: "HL", tag: "Perps" },
  polymarket: { name: "Polymarket", short: "PM", tag: "Odds · watch only" },
};
export const SAMPLE_PROMPT =
  "If Fed-cut odds on Polymarket pass 70% and NVDA trades under its 20-day average, buy $200 of NVDA on Robinhood Chain and open a 2× SOL long with $250 on Hyperliquid. Stop at −8%.";
/** Example session-key policy on the landing Safety section. Same numbers as the API defaults
 *  (GET /v1/session-keys/defaults: 250 / 1000 / 1%); min swap = ceil($1,000 ÷ 64) = $15.63. */
export const EXAMPLE_POLICY = { perTxCapUsd: "$250", dailyCapUsd: "$1,000", maxSlippagePct: "1%", minSwapUsd: "$15.63" } as const;
