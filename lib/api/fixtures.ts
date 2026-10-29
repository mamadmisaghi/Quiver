import { MOCK_INSTRUMENTS } from "@/services/backend/src/venues/registry";
// MOCK — fixture-derived objects for every endpoint. Shapes come from lib/contracts; every object is
// zod-parsed in lib/api/mock.ts so drift from Sage's schemas fails loudly.
// Prices, ids and handles are placeholders. Robinhood token addresses 0x…a1–a4 are NOT real tokens.
import strategyJson from "./fixtures/strategy.nvda-fed.json";
import eventsJson from "./fixtures/events.paper.json";

export const STRATEGY_RAW = strategyJson as unknown; // parsed strictly in mock.ts (no _comment since M3.1)
export const EVENTS_RAW = eventsJson as unknown[];
export const RUN_ID = "run_01HZXK8P2Q4M";
export const STRATEGY_ID = "stg_01HZXFEDNVDA01";
export const USER_ID = "usr_01HZX0DEMO0001";
const T0 = "2026-10-27T09:30:00Z";

// MOCK — would come from the server (humanized is generated server-side; render verbatim).
export const HUMANIZED = {
  watch: ["Polymarket odds of a Fed cut in December", "NVDA stock token price (Chainlink stream)", "NVDA 20-day average (daily)", "SOL perp funding on Hyperliquid"],
  when: ["Odds above 70%, NVDA below its 20-day average and SOL funding under 0.01% — held for 15 minutes. Fires once, 60-minute cooldown."],
  do: ["Buy $200 of NVDA on Robinhood Chain (market, max 0.5% slippage)", "Open a 2× SOL long with $250 on Hyperliquid (market, max 0.5% slippage)"],
  exit: ["Stop each position at −8%. Take profit at +15%."],
};

// MOCK — compile `partial.node` frames (contract shape {id, kind, title, detail, venue}).
export const PARTIAL_NODES = [
  { id: "fed_odds", kind: "watch", title: "Fed cut odds", detail: "December · YES", venue: "polymarket" },
  { id: "nvda_px", kind: "watch", title: "NVDA price", detail: "Chainlink stream", venue: "robinhood" },
  { id: "nvda_sma20", kind: "watch", title: "NVDA 20-day avg", detail: "SMA 20 · 1d", venue: "robinhood" },
  { id: "sol_funding", kind: "watch", title: "SOL funding", detail: "per hour", venue: "hyperliquid" },
  { id: "t1", kind: "when", title: "All conditions hold", detail: "for 15 min · fires once" },
  { id: "a1", kind: "do", title: "Buy NVDA", detail: "$200 · max slip 0.5%", venue: "robinhood" },
  { id: "a2", kind: "do", title: "Long SOL 2×", detail: "$250 · market", venue: "hyperliquid" },
  { id: "a1.exit", kind: "exit", title: "Stop −8% · TP +15%", detail: "NVDA" },
  { id: "a2.exit", kind: "exit", title: "Stop −8% · TP +15%", detail: "SOL 2×" },
] as const;

export const COMPILE_STEPS = [
  ["reading", "Reading your thesis"],
  ["resolving_markets", "Resolving markets on 3 venues"],
  ["choosing_feeds", "Choosing price feeds"],
  ["writing_rules", "Writing triggers and exits"],
  ["checking_risk", "Checking risk limits"],
] as const;

export const ME = {
  id: USER_ID, createdAt: "2026-10-20T08:00:00Z", displayName: null, wallets: [],
  eligibility: { country: null, selfDeclaredNonUsPerson: false, stockTokens: "unknown", reason: "Confirm you are not a US person to trade stock tokens." },
  enabledModes: ["paper"], quotas: { compilesPerDay: 30, compilesUsedToday: 3 },
};

export const VENUES = [
  { id: "robinhood", name: "Robinhood Chain", status: "up", capabilities: ["read", "paper"], note: "Stock tokens via Uniswap. Testnet." },
  { id: "solana", name: "Solana", status: "up", capabilities: ["read", "paper"], note: "SPL tokens via Jupiter." },
  { id: "hyperliquid", name: "Hyperliquid", status: "degraded", capabilities: ["read", "paper"], note: "Quotes slower than usual." },
  { id: "polymarket", name: "Polymarket", status: "up", capabilities: ["read"], note: "Watch-only. Odds can trigger trades elsewhere." },
];

// Canonical preview instruments: names and IDs match the compiler/backtest registry.
const rh = (n: string) => `robinhood:token:0x${"0".repeat(38)}${n}`;
export const MARKETS = MOCK_INSTRUMENTS.map((m) => ({
  id: m.id, venue: m.venue, kind: m.kind, symbol: m.symbol, assetClass: m.assetClass, name: m.name,
  price: String(m.base), change24hPct: "0.00", priceAt: "2026-10-27T09:30:00Z",
  priceSource: m.venue === "robinhood" ? "mock_chainlink" : m.venue === "hyperliquid" ? "mock_hyperliquid" : m.venue === "solana" ? "mock_jupiter" : "mock_polymarket",
  marketSession: m.assetClass === "equity" || m.assetClass === "etf" ? "open" : "always",
  geoRestricted: m.venue === "robinhood", tradable: m.venue !== "polymarket",
}));

const sum = (id: string, name: string, status: string, venues: string[], updatedAt: string, activeRunId: string | null) => ({ id, name, version: 1, status, venues, updatedAt, activeRunId });
export const STRATEGIES = [
  sum(STRATEGY_ID, "Fed cut + NVDA dip", "valid", ["polymarket", "robinhood", "hyperliquid"], "2026-10-27T09:29:00Z", RUN_ID),
  sum("stg_01HZXAAPLWKND01", "AAPL weekend dip", "valid", ["robinhood"], "2026-10-26T18:10:00Z", "run_01HZXAAPLRUN001"),
  sum("stg_01HZXETHFUND001", "ETH funding flip", "valid", ["hyperliquid"], "2026-10-26T07:40:00Z", "run_01HZXETHRUN0001"),
  sum("stg_01HZXJUPVOL0001", "JUP volume spike", "valid", ["solana"], "2026-10-22T12:00:00Z", null),
  sum("stg_01HZXSPYEARN001", "SPY earnings guard", "draft", ["robinhood"], "2026-10-25T15:00:00Z", null),
];

const run = (id: string, strategyId: string, status: string, startedAt: string, equityUsd: string, pnlUsd: string, pnlPct: string, lastSeq: number) =>
  ({ id, strategyId, strategyVersion: 1, mode: "paper", status, startedAt, stoppedAt: null, lastSeq, equityUsd, pnlUsd, pnlPct });
export const RUNS = [
  run(RUN_ID, STRATEGY_ID, "running", T0, "9998.00", "-2.00", "-0.02", 91),
  run("run_01HZXAAPLRUN001", "stg_01HZXAAPLWKND01", "running", "2026-10-24T20:00:00Z", "10000.00", "0.00", "0.00", 402),
  run("run_01HZXETHRUN0001", "stg_01HZXETHFUND001", "paused", "2026-10-26T07:45:00Z", "9868.20", "-131.80", "-1.32", 3310),
];

export const PORTFOLIO = {
  mode: "paper", equityUsd: "9998.00", cashUsd: "9498.66", realizedPnlUsd: "-1.50", unrealizedPnlUsd: "-0.50",
  positions: [{ instrument: rh("a1"), symbol: "NVDA", venue: "robinhood", qty: "2.7524", avgEntry: "181.6", markPrice: "181.42", valueUsd: "499.34", unrealizedPnlUsd: "-0.50", runId: RUN_ID }],
  asOf: "2026-10-27T09:45:16Z",
};
