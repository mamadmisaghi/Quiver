// MOCK social data: example authors, public strategies, skills, quests. Placeholder handles (prefixed "demo_");
// no real people, no real figures. Paper returns are computed by backtesting on the mock (synthetic) market.
import { Strategy } from "../../contracts/src/strategy";
import fixture from "../../contracts/fixtures/strategy.nvda-fed.json";

const risk = { maxPositionPct: 25, maxTotalExposurePct: 100, maxDailyLossPct: 10, maxOrdersPerDay: 20, equityWhenFeedStale: "skip" };
const mk = (o: Record<string, unknown>) => Strategy.parse({ schemaVersion: 1, risk, ...o });
const { _comment, ...nvda } = fixture as Record<string, unknown>;

export interface SeedPublic { id: string; handle: string; publishedAt: string; strategy: Strategy }
export const SEED_PUBLIC: SeedPublic[] = [
  { id: "stg_demo0000000000000000000001", handle: "@demo_lena", publishedAt: "2026-10-01T00:00:00Z", strategy: mk({
    name: "BTC oversold bounce", thesis: "Buy a small BTC perp when hourly RSI is oversold; fixed stop and take-profit.",
    signals: [{ id: "rsi", kind: "indicator", maxAgeSeconds: 7200, params: { instrument: "hl:perp:BTC", name: "rsi", period: 14, timeframe: "1h" } }],
    triggers: [{ id: "oversold", forMinutes: 0, cooldownMinutes: 240, maxFires: null, when: { op: "lt", left: { ref: "rsi.value" }, right: { lit: 30 } } }],
    actions: [{ id: "buy", type: "open", on: ["oversold"], instrument: "hl:perp:BTC", side: "long", size: { unit: "usd", value: "200" }, leverage: 1, order: { type: "market", maxSlippageBps: 100, maxPriceImpactBps: 200 }, exits: { stopLoss: { unit: "pct", value: "3" }, takeProfit: { unit: "pct", value: "4" } } }] }) },
  { id: "stg_demo0000000000000000000002", handle: "@demo_okafor", publishedAt: "2026-10-05T00:00:00Z", strategy: mk({
    name: "ETH trend follow", thesis: "Go long ETH when price crosses above its 50-hour average.",
    signals: [{ id: "px", kind: "price", maxAgeSeconds: 120, params: { instrument: "hl:perp:ETH" } }, { id: "ma", kind: "indicator", maxAgeSeconds: 7200, params: { instrument: "hl:perp:ETH", name: "sma", period: 50, timeframe: "1h" } }],
    triggers: [{ id: "cross", forMinutes: 0, cooldownMinutes: 360, maxFires: null, when: { op: "crosses_above", left: { ref: "px.value" }, right: { ref: "ma.value" } } }],
    actions: [{ id: "long", type: "open", on: ["cross"], instrument: "hl:perp:ETH", side: "long", size: { unit: "usd", value: "200" }, leverage: 1, order: { type: "market", maxSlippageBps: 100, maxPriceImpactBps: 200 }, exits: { stopLoss: { unit: "pct", value: "4" }, takeProfit: { unit: "pct", value: "6" } } }] }) },
  { id: "stg_demo0000000000000000000003", handle: "@demo_marco", publishedAt: "2026-10-10T00:00:00Z", strategy: Strategy.parse(nvda) },
];

/** Same fields as web/lib/mock.ts SKILLS (minus "earnings": no earnings-calendar data source in v1), plus a compile prompt. */
export const SKILLS = [
  { id: "dip", name: "Weekend dip", by: "quiver", desc: "Buys a stock token when it trades below Friday's close while the market is shut.", venues: ["robinhood"], blocks: 4, prompt: "Buy $200 of NVDA stock token when the US market is closed and NVDA is 3% below its daily average; stop loss 5%." },
  { id: "funding", name: "Funding flip", by: "quiver", desc: "Opens a perp when funding changes sign and holds for an hour.", venues: ["hyperliquid"], blocks: 3, prompt: "Long $200 of SOL perp when SOL funding turns negative and stays negative for 60 minutes; stop loss 4%." },
  { id: "odds", name: "Odds breakout", by: "quiver", desc: "Uses a Polymarket probability crossing a level as a trigger for any venue.", venues: ["polymarket"], blocks: 2, prompt: "When Fed-cut-in-December odds cross above 70%, buy $300 of SPY stock token; take profit 3%." },
  { id: "ladder", name: "Take-profit ladder", by: "quiver", desc: "Sells in three steps at +10%, +20% and +35%, then trails the rest.", venues: [], blocks: 1, prompt: "Add a take-profit ladder: sell a third at +10%, a third at +20%, a third at +35%." },
  { id: "dca", name: "Scale in", by: "quiver", desc: "Splits an entry into equal buys spaced by time or by price.", venues: [], blocks: 1, prompt: "Buy $100 of ETH perp every day at 14:00 UTC." },
] as const;

/** EXAMPLE points per quest and season (UI layout only; no program is live). */
export const QUEST_POINTS: Record<string, number> = { draft: 100, paper24h: 250, publish: 300, forked: 500 };
export const EXAMPLE_SEASON = { id: "s0-example", name: "Season 0 (example)", startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-12-31T23:59:59.000Z" };
export const QUESTS = [
  { id: "draft", title: "Draft your first strategy" },
  { id: "paper24h", title: "Run a paper trade for 24h" },
  { id: "publish", title: "Publish a strategy" },
  { id: "forked", title: "Get forked by another trader" },
] as const;

/** M3.2: notices say "Example data" and only mention the price mode that is actually active. */
/** M4.5.2: one wording for the configured price source (landing notice + example notices). */
export const pricesPhrase = (priceSource: "mock" | "mainnet-readonly") => priceSource === "mock" ? "synthetic (mock) prices" : "Chainlink mainnet read-only prices for Robinhood Stock Tokens and ETH, synthetic prices for other venues";
export function exampleNotices(priceSource: "mock" | "mainnet-readonly") {
  const prices = pricesPhrase(priceSource);
  return {
    leaderboard: `Example data. Placeholder handles; returns are paper backtests on ${prices}, not real performance and not a promise of future returns.`,
    rewards: "Example data. No rewards program is live. Points, seasons and any conversion are to be confirmed; nothing here is a promise of value.",
    revenue: "Example data. No creator fees are live. The fee split is to be confirmed; amounts are zero until it is.",
  };
}
/** Back-compat alias (mock price mode). */
export const MOCK_NOTICE = exampleNotices("mock");
