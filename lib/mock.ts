// MOCK — all strategy, price and venue data in this file is placeholder demo data.
import type { Venue } from "@/src/content/landing";
export { VENUES, SAMPLE_PROMPT, type Venue } from "@/src/content/landing";

export type NodeKind = "watch" | "when" | "do" | "exit";
export type GNode = { id: string; kind: NodeKind; title: string; detail: string; venue?: Venue; value?: string; state?: "met" | "waiting" | "armed" };
export type GEdge = { from: string; to: string; hot?: boolean };

export const SUGGESTIONS = [
  "Buy $200 of AAPL on Robinhood Chain every Monday the market opens red.",
  "Long ETH 3× on Hyperliquid if funding turns negative for 2 hours. 10% stop.",
  "Buy 1 SOL of JUP when its 1h volume doubles. Take profit at +25%.",
];

export const DRAFT_STEPS = [
  "Reading your thesis",
  "Resolving markets on 3 venues",
  "Choosing price feeds",
  "Writing triggers and exits",
  "Checking risk limits",
];

export const NODES: GNode[] = [
  { id: "s1", kind: "watch", title: "Fed cut odds", detail: "Dec meeting · YES", venue: "polymarket", value: "72.4%", state: "met" },
  { id: "s2", kind: "watch", title: "NVDA vs 20D avg", detail: "Chainlink feed", venue: "robinhood", value: "−2.1%", state: "met" },
  { id: "s3", kind: "watch", title: "SOL funding", detail: "per hour", venue: "hyperliquid", value: "0.0041%", state: "waiting" },
  { id: "t1", kind: "when", title: "All three hold", detail: "for 15 min · once", state: "armed" },
  { id: "a1", kind: "do", title: "Buy NVDA", detail: "$200 · max slip 0.5%", venue: "robinhood" },
  { id: "a2", kind: "do", title: "Long SOL 2×", detail: "$250 · market", venue: "hyperliquid" },
  { id: "x1", kind: "exit", title: "Stop −8% · TP +15%", detail: "per position" },
];

export const EDGES: GEdge[] = [
  { from: "s1", to: "t1", hot: true },
  { from: "s2", to: "t1", hot: true },
  { from: "s3", to: "t1" },
  { from: "t1", to: "a1" },
  { from: "t1", to: "a2" },
  { from: "a1", to: "x1" },
  { from: "a2", to: "x1" },
];

export const RULES = {
  watch: ["Polymarket odds of a Fed cut at the December meeting", "NVDA stock token price vs its 20-day average (Chainlink)", "SOL perp funding rate on Hyperliquid"],
  when: "Odds are above 70%, NVDA is below its 20-day average, and SOL funding is under 0.01% an hour — all for 15 minutes straight. Fires once.",
  do: ["Buy $200 of NVDA on Robinhood Chain (Uniswap, max 0.5% slippage)", "Open a 2× SOL long with $250 on Hyperliquid"],
  exit: "Stop each position at −8%. Take profit at +15%.",
};

export const REFINE = ["Add a weekend-only filter", "Scale in over 3 buys", "Use a trailing stop", "Swap SOL for ETH"];

// MOCK — landing + app demo content
export const TICKER = "$QUIVR";
export const TRADES = [
  { k: "Tokenized stocks", v: ["robinhood"] as Venue[], ex: "Buy NVDA when it dips under its 20-day average", status: "Paper" },
  { k: "Perpetuals", v: ["hyperliquid"] as Venue[], ex: "Long SOL 2× when funding turns negative", status: "Paper" },
  { k: "Solana tokens", v: ["solana"] as Venue[], ex: "Buy JUP when 1h volume doubles", status: "Paper" },
  { k: "Prediction markets", v: ["polymarket"] as Venue[], ex: "Use Fed-cut odds as a signal for any trade", status: "Watch only" },
  { k: "Cross-venue", v: ["robinhood", "hyperliquid", "polymarket"] as Venue[], ex: "One trigger, actions on several venues at once", status: "Paper" },
];
export const SIGNALS = [
  ["Price", "crosses, gaps, ranges"], ["Moving averages", "SMA · EMA · VWAP"], ["Funding", "Hyperliquid per hour"],
  ["Odds", "Polymarket YES / NO"], ["Market hours", "NYSE open · closed · weekend"], ["Earnings", "days to report"],
  ["Token premium", "stock token vs reference"], ["Volume", "1h · 24h change"], ["Volatility", "ATR · Bollinger"],
  ["Time", "schedule · every N hours"], ["Wallet", "balance · position size"], ["Your positions", "PnL · drawdown"],
] as const;
export const SKILLS = [
  { id: "dip", name: "Weekend dip", by: "quiver", desc: "Buys a stock token when it trades below Friday's close while the market is shut.", venues: ["robinhood"] as Venue[], blocks: 4 },
  { id: "funding", name: "Funding flip", by: "quiver", desc: "Opens a perp when funding changes sign and holds for an hour.", venues: ["hyperliquid"] as Venue[], blocks: 3 },
  { id: "earnings", name: "Earnings guard", by: "quiver", desc: "Closes or trims any stock position two days before it reports.", venues: ["robinhood"] as Venue[], blocks: 2 },
  { id: "odds", name: "Odds breakout", by: "quiver", desc: "Uses a Polymarket probability crossing a level as a trigger for any venue.", venues: ["polymarket"] as Venue[], blocks: 2 },
  { id: "ladder", name: "Take-profit ladder", by: "quiver", desc: "Sells in three steps at +10%, +20% and +35%, then trails the rest.", venues: [] as Venue[], blocks: 1 },
  { id: "dca", name: "Scale in", by: "quiver", desc: "Splits an entry into equal buys spaced by time or by price.", venues: [] as Venue[], blocks: 1 },
];
export const RUN_EVENTS = [
  { t: "14:02:11", type: "tick", msg: "Fed-cut odds 72.4% · NVDA −2.1% vs 20D · SOL funding 0.0041%" },
  { t: "14:02:11", type: "met", msg: "Trigger “All three hold” met · holding 15:00" },
  { t: "14:17:11", type: "fired", msg: "Trigger fired after 15 min" },
  { t: "14:17:12", type: "fill", msg: "Bought 2.71 NVDA at $184.52 · Robinhood Chain (paper)" },
  { t: "14:17:12", type: "fill", msg: "Long 2.6 SOL 2× at $192.10 · Hyperliquid (paper)" },
  { t: "14:31:40", type: "tick", msg: "NVDA $185.90 · SOL $193.44" },
];
export const EQUITY = [10000, 10004, 9998, 10011, 10026, 10019, 10034, 10051, 10046, 10062, 10071, 10066, 10088, 10094];
export const STRATEGIES = [
  { id: "fed-nvda", name: "Fed odds × NVDA dip", venues: ["polymarket", "robinhood", "hyperliquid"] as Venue[], state: "running", pnl: 0.94, runtime: "2h 14m", fills: 2, spark: EQUITY },
  { id: "weekend-aapl", name: "AAPL weekend dip", venues: ["robinhood"] as Venue[], state: "waiting", pnl: 0, runtime: "3d 6h", fills: 0, spark: [0, 0, 0, 0, 0, 0] },
  { id: "funding-eth", name: "ETH funding flip", venues: ["hyperliquid"] as Venue[], state: "running", pnl: -1.32, runtime: "19h 02m", fills: 3, spark: [10, 9.8, 9.9, 9.6, 9.7, 9.5, 9.6, 9.4] },
  { id: "jup-volume", name: "JUP volume spike", venues: ["solana"] as Venue[], state: "paused", pnl: 4.1, runtime: "5d 11h", fills: 4, spark: [10, 10.2, 10.1, 10.5, 10.4, 10.9, 10.8, 11] },
  { id: "spy-earn", name: "SPY earnings guard", venues: ["robinhood"] as Venue[], state: "draft", pnl: 0, runtime: "—", fills: 0, spark: [0, 0, 0, 0] },
];
export const MARKETS = [
  { sym: "NVDA", name: "NVIDIA", venue: "robinhood" as Venue, cls: "Stock token", px: 184.52, ch: -2.1, vol: "—", spark: [190, 189, 188, 189, 187, 186, 185, 184.5] },
  { sym: "AAPL", name: "Apple", venue: "robinhood" as Venue, cls: "Stock token", px: 231.08, ch: 0.6, vol: "—", spark: [229, 230, 229.5, 230.4, 231, 230.8, 231.1] },
  { sym: "SPY", name: "S&P 500 ETF", venue: "robinhood" as Venue, cls: "Stock token", px: 612.4, ch: 0.2, vol: "—", spark: [610, 611, 610.5, 611.8, 612, 612.4] },
  { sym: "MSFT", name: "Microsoft", venue: "robinhood" as Venue, cls: "Stock token", px: 498.77, ch: -0.4, vol: "—", spark: [501, 500, 499.6, 500.2, 499, 498.8] },
  { sym: "SOL-PERP", name: "Solana", venue: "hyperliquid" as Venue, cls: "Perp", px: 192.1, ch: 3.4, vol: "—", spark: [185, 186, 188, 187, 190, 191, 192.1] },
  { sym: "ETH-PERP", name: "Ether", venue: "hyperliquid" as Venue, cls: "Perp", px: 3912.5, ch: 1.1, vol: "—", spark: [3860, 3880, 3870, 3895, 3900, 3912] },
  { sym: "JUP", name: "Jupiter", venue: "solana" as Venue, cls: "SPL token", px: 0.912, ch: 7.8, vol: "—", spark: [0.84, 0.85, 0.87, 0.86, 0.89, 0.9, 0.91] },
  { sym: "FED-DEC", name: "Fed cuts in December", venue: "polymarket" as Venue, cls: "Odds", px: 0.724, ch: 4.2, vol: "—", spark: [0.66, 0.68, 0.69, 0.7, 0.71, 0.72] },
];
