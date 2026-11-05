import type { Workflow } from "../../contracts/src/workflow";
import { canonicalSymbol } from "./markets";
import { isEquitySymbol } from "../venues/registry";

/** Complete odds-crossing stock entry. Extra clauses must go through the general planner. */
export function oddsEntry(text: string): Workflow | null {
  const match = text
    .trim()
    .match(
      /^when\s+(.{2,180}?)\s+odds\s+(?:on\s+polymarket\s+)?cross(?:es)?\s+(above|below)\s+(\d+(?:\.\d+)?)%\s*,\s*(buy\s+\$\s*(\d+(?:\.\d+)?)\s+of\s+([a-z][a-z0-9.]{0,11})\s+stock\s+token\s*;\s*take[ -]profit\s+(\d+(?:\.\d+)?)%)[.]?$/i,
    );
  if (!match) return null;
  const [, event, direction, odds, action, amount, ticker, profit] = match;
  const symbol = canonicalSymbol(ticker);
  const threshold = Number(odds),
    size = Number(amount),
    takeProfitPct = Number(profit);
  if (
    !isEquitySymbol(symbol) ||
    !(threshold > 0 && threshold < 100) ||
    !(size > 0 && size <= 1e12) ||
    !(takeProfitPct > 0 && takeProfitPct <= 100)
  )
    return null;
  return {
    version: 1,
    name: (event + " → " + symbol).slice(0, 80),
    summary: `Buy $${size} of ${symbol} when ${event} odds cross ${direction} ${threshold}%. Take profit ${takeProfitPct}%.`,
    budgetUsd: null,
    assets: [
      {
        id: "event",
        query: event,
        sourceText: event,
        venue: "polymarket",
        kind: "outcome",
        outcome: null,
      },
      {
        id: "stock",
        query: symbol,
        sourceText: ticker,
        venue: "robinhood",
        kind: "token",
        outcome: null,
      },
    ],
    signals: [
      {
        id: "odds",
        assetId: "event",
        kind: "odds",
        indicator: null,
        schedule: null,
        description: event + " odds",
      },
    ],
    stages: [
      {
        id: "buy_stock",
        assetId: "stock",
        side: "buy",
        sourceText: action,
        conditionText: `${event} odds cross ${direction} ${threshold}%`,
        when: {
          op:
            direction.toLowerCase() === "above"
              ? "crosses_above"
              : "crosses_below",
          left: { ref: "odds.value" },
          right: { lit: threshold / 100 },
        },
        after: [],
        amount: { unit: "usd", value: size },
        leverage: 1,
        funding: { kind: "budget", from: [] },
        repeat: null,
        exits: {
          stopLossPct: null,
          takeProfitPct,
          trailingStopPct: null,
          timeExitHours: null,
          ladder: [],
          description: "",
        },
      },
    ],
    questions: [],
    assumptions: [],
  };
}
