// M3.8: landing-page data served by the backend (was static web/lib/mock.ts TRADES / SIGNALS).
// Copy matches the web mock so Wren can swap the import for GET /v1/public/landing without layout changes;
// "supported" is honest about which tiles a v1 signal kind actually backs.
import type { Venue } from "../../contracts/src/common";
import type { z } from "zod";

export const LANDING_TRADES: { id: string; label: string; venues: z.infer<typeof Venue>[]; example: string }[] = [
  { id: "stocks", label: "Tokenized stocks", venues: ["robinhood"], example: "Buy NVDA when it dips under its 20-day average" },
  { id: "perps", label: "Perpetuals", venues: ["hyperliquid"], example: "Long SOL 2× when funding turns negative" },
  { id: "solana", label: "Solana tokens", venues: ["solana"], example: "Buy JUP when its price jumps 5% in an hour" },
  { id: "odds", label: "Prediction markets", venues: ["polymarket"], example: "Use Fed-cut odds as a signal for any trade" },
  { id: "cross", label: "Cross-venue", venues: ["robinhood", "hyperliquid", "polymarket"], example: "One trigger, actions on several venues at once" },
];

export const LANDING_SIGNALS = [
  { id: "price", label: "Price", detail: "crosses, gaps, ranges", supported: true, signalKinds: ["price"], note: null },
  { id: "ma", label: "Moving averages", detail: "SMA · EMA", supported: true, signalKinds: ["indicator:sma", "indicator:ema"], note: "VWAP is not available in v1." },
  { id: "funding", label: "Funding", detail: "Hyperliquid per hour", supported: true, signalKinds: ["funding"], note: null },
  { id: "odds", label: "Odds", detail: "Polymarket YES / NO", supported: true, signalKinds: ["odds"], note: "Read-only signal; Polymarket is never traded." },
  { id: "hours", label: "Market hours", detail: "NYSE open · closed · weekend", supported: true, signalKinds: ["market_session"], note: null },
  { id: "momentum", label: "Momentum", detail: "RSI · % change", supported: true, signalKinds: ["indicator:rsi", "indicator:pct_change"], note: null },
  { id: "volatility", label: "Volatility", detail: "ATR · Bollinger", supported: true, signalKinds: ["indicator:atr", "indicator:bb_upper", "indicator:bb_lower"], note: null },
  { id: "time", label: "Time", detail: "schedule · every N hours", supported: true, signalKinds: ["timer"], note: null },
  { id: "positions", label: "Your positions", detail: "size · PnL", supported: true, signalKinds: ["position"], note: null },
  { id: "earnings", label: "Earnings", detail: "days to report", supported: false, signalKinds: [], note: "Needs an earnings-calendar data source (not chosen)." },
  { id: "premium", label: "Token premium", detail: "stock token vs reference", supported: false, signalKinds: [], note: "Needs a reference-price comparison signal (planned)." },
  { id: "volume", label: "Volume", detail: "1h · 24h change", supported: false, signalKinds: [], note: "No volume feed in v1." },
] as const;

/** Seed strategy shown in the landing "Paper preview" card (cross-venue Fed odds × NVDA). */
export const LANDING_PREVIEW_ID = "stg_demo0000000000000000000003";
export const LANDING_NOTICE = "Example data. Paper results on {prices}; not real performance and not a promise of future returns. Nothing here trades real money.";
