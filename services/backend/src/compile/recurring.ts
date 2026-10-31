import type { Workflow } from "../../contracts/src/workflow";
import { canonicalSymbol } from "./markets";

/** Fully anchored grammar for the common recurring-buy request; never a generic fallback. */
export function recurringDraft(text: string): Workflow | null {
  const m = text.trim().match(/^if\s+([a-z][a-z0-9. -]{0,32}?)\s+price\s+(?:falls?\s+|is\s+|goes?\s+)?(?:below|under)\s*\$?\s*(\d+(?:\.\d+)?)\s*,?\s*buy\s+(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:\$|dollars?))\s+(?:of\s+)?([a-z][a-z0-9. -]{0,32}?)\s+every\s+(one|\d+)\s+minutes?\s+until+l?\s+(?:you(?:'re| are)?\s+|the\s+|my\s+)?(?:out of budget|budget (?:runs out|is exhausted))(?:[.!])?$/i);
  if (!m || canonicalSymbol(m[1]) !== canonicalSymbol(m[5])) return null;
  const amount = Number(m[3] ?? m[4]), price = Number(m[2]), interval = m[6].toLowerCase() === "one" ? 1 : Number(m[6]);
  if (!amount || !price || !interval) return null;
  const q = canonicalSymbol(m[1]);
  return { version: 1, name: `${q} recurring buy`, summary: `Buy $${amount} of ${q} every ${interval} minute${interval === 1 ? "" : "s"} after the price condition is met, within a dedicated budget.`, budgetUsd: null,
    assets: [{ id: "asset", query: q, sourceText: m[1], venue: ["NVDA", "AAPL", "TSLA", "MSFT", "SPY"].includes(q) ? "robinhood" : "solana", kind: "token", outcome: null }],
    signals: [{ id: "price", assetId: "asset", kind: "price", indicator: null, schedule: null, description: `${q} price (USD)` }],
    stages: [{ id: "buy", assetId: "asset", side: "buy", sourceText: m[0], conditionText: `${q} price below $${price}`, when: { op: "lt", left: { ref: "price.value" }, right: { lit: price } }, after: [], amount: { unit: "usd", value: amount }, leverage: 1, funding: { kind: "budget", from: [] }, repeat: { intervalMinutes: interval, maxTimes: null, conditionMode: "needs_choice" }, exits: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null, timeExitHours: null, ladder: [], description: "" } }], questions: [], assumptions: [] };
}
