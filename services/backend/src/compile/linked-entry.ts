import type {
  Workflow,
  PlanExpr,
  PlanStage,
} from "../../contracts/src/workflow";
import { canonicalSymbol } from "./markets";

/** Fully specified odds + moving-average entry. If any clause is different, use the general planner. */
export function linkedEntry(text: string): Workflow | null {
  const pattern =
    /^if (.{2,90}?) odds on polymarket (?:pass|exceed) (\d+(?:\.\d+)?)% and ([a-z.]{1,12}) trades (?:under|below) its (\d+)-day (?:moving )?average, buy \$(\d+(?:\.\d+)?) of ([a-z.]{1,12}) on robinhood chain and open a (\d+(?:\.\d+)?)[×x] ([a-z.]{1,12}) long with \$(\d+(?:\.\d+)?) on hyperliquid\. stop at [−-](\d+(?:\.\d+)?)%\.?$/i;
  const m = text.trim().match(pattern);
  if (!m) return null;
  const [
    event,
    odds,
    stock,
    period,
    buy,
    bought,
    leverage,
    collateral,
    margin,
    stop,
  ] = m.slice(1);
  const symbol = canonicalSymbol(stock),
    perp = canonicalSymbol(collateral);
  const nums = [odds, period, buy, leverage, margin, stop].map(Number);
  if (
    symbol !== canonicalSymbol(bought) ||
    nums.some((v) => !Number.isFinite(v) || v <= 0) ||
    +odds > 100 ||
    +stop > 100 ||
    +period < 2 ||
    +period > 500 ||
    +leverage > 100 ||
    +buy > 1e12 ||
    +margin > 1e12
  )
    return null;
  const when: PlanExpr = {
    op: "and",
    args: [
      { op: "gt", left: { ref: "odds.value" }, right: { lit: +odds / 100 } },
      {
        op: "lt",
        left: { ref: "price.value" },
        right: { ref: "average.value" },
      },
    ],
  };
  const conditionText = `${event} odds above ${odds}% and ${symbol} below its ${period}-day average`;
  const base = {
    when,
    conditionText,
    after: [],
    funding: { kind: "budget" as const, from: [] },
    repeat: null,
    exits: {
      stopLossPct: +stop,
      takeProfitPct: null,
      trailingStopPct: null,
      timeExitHours: null,
      ladder: [],
      description: "",
    },
  };
  const stages: PlanStage[] = [
    {
      ...base,
      id: "buy_stock",
      assetId: "stock",
      side: "buy",
      sourceText: text.match(/buy \$[^,]+? on robinhood chain/i)![0],
      amount: { unit: "usd", value: +buy },
      leverage: 1,
    },
    {
      ...base,
      id: "long_perp",
      assetId: "perp",
      side: "long",
      sourceText: text.match(/open a .+? on hyperliquid/i)![0],
      amount: { unit: "usd", value: +margin },
      leverage: +leverage,
    },
  ];
  return {
    version: 1,
    name: (event + " + " + symbol + " dip").slice(0, 80),
    summary: conditionText,
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
        sourceText: stock,
        venue: "robinhood",
        kind: "token",
        outcome: null,
      },
      {
        id: "perp",
        query: perp,
        sourceText: collateral,
        venue: "hyperliquid",
        kind: "perp",
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
      {
        id: "price",
        assetId: "stock",
        kind: "price",
        indicator: null,
        schedule: null,
        description: symbol + " price",
      },
      {
        id: "average",
        assetId: "stock",
        kind: "indicator",
        indicator: { name: "sma", period: +period, timeframe: "1d" },
        schedule: null,
        description: symbol + " " + period + "-day average",
      },
    ],
    stages,
    questions: [],
    assumptions: [],
  };
}
