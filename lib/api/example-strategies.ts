import type { Workflow, Strategy, PlanStage, PlanExpr } from "@/lib/contracts";
import { linkedEntry } from "@/services/backend/src/compile/linked-entry";
import { STRATEGY_ID } from "./fixtures";
import starter from "./fixtures/strategy.nvda-fed.json";

const signal = (
  id: string,
  assetId: string,
  kind: Workflow["signals"][number]["kind"],
  description: string,
): Workflow["signals"][number] => ({
  id,
  assetId,
  kind,
  description,
  indicator: null,
  schedule: null,
});
const cmp = (
  ref: string,
  op: "gt" | "gte" | "eq" | "crosses_above",
  lit: number | boolean,
): PlanExpr => ({ op, left: { ref: ref + ".value" }, right: { lit } });
type Example = {
  symbol: string;
  venue: "robinhood" | "hyperliquid" | "solana";
  thesis: string;
  signals: Workflow["signals"];
  when: PlanExpr;
  amount: number | null;
  leverage?: number;
  questions?: string[];
};
const examples: Record<string, Example> = {
  stg_01HZXAAPLWKND01: {
    symbol: "AAPL",
    venue: "robinhood",
    thesis:
      "On Mondays at 09:30 New York time, buy $150 of AAPL when it is at least 3% below its price 72 hours earlier.",
    signals: [
      {
        ...signal("monday", "asset", "timer", "Monday at 09:30 New York"),
        assetId: null,
        schedule: { cron: "30 9 * * 1", tz: "America/New_York" },
      },
      {
        ...signal("dip", "asset", "drawdown", "Decline from 72 hours ago"),
        drawdown: { reference: "lookback", lookbackMinutes: 4320 },
      },
    ],
    when: {
      op: "and",
      args: [cmp("monday", "eq", true), cmp("dip", "gte", 3)],
    },
    amount: 150,
  },
  stg_01HZXETHFUND001: {
    symbol: "ETH",
    venue: "hyperliquid",
    thesis:
      "Open a $200 ETH long at 2× on Hyperliquid when the funding rate crosses above zero.",
    signals: [signal("funding", "asset", "funding", "ETH hourly funding rate")],
    when: cmp("funding", "crosses_above", 0),
    amount: 200,
    leverage: 2,
  },
  stg_01HZXJUPVOL0001: {
    symbol: "JUP",
    venue: "solana",
    thesis:
      "Buy $100 of JUP when its hourly trading volume doubles compared with the previous hour.",
    signals: [
      signal("volume", "asset", "custom", "Hourly trading volume doubles"),
    ],
    when: cmp("volume", "eq", true),
    amount: 100,
  },
  stg_01HZXSPYEARN001: {
    symbol: "SPY",
    venue: "robinhood",
    thesis:
      "Buy SPY only after my specified earnings event. Choose the event and size before testing.",
    signals: [
      signal(
        "earnings",
        "asset",
        "custom",
        "Selected earnings event has occurred",
      ),
    ],
    when: cmp("earnings", "eq", true),
    amount: null,
    questions: ["Which earnings event should release the SPY order?"],
  },
};

export function exampleStrategy(
  id: string,
  name: string,
  risk: Strategy["risk"],
): Strategy {
  let workflow: Workflow;
  let thesis: string;
  if (id === STRATEGY_ID) {
    thesis = starter.thesis;
    const entry = linkedEntry(thesis);
    if (!entry) throw new Error("The example rules could not be loaded.");
    workflow = { ...entry, name, budgetUsd: 10000 };
  } else {
    const sample = examples[id];
    if (!sample) throw new Error("Unknown example strategy.");
    thesis = sample.thesis;
    const stage: PlanStage = {
      id: "entry",
      assetId: "asset",
      side: sample.leverage ? "long" : "buy",
      sourceText: thesis,
      conditionText: thesis,
      when: sample.when,
      after: [],
      amount: { unit: "usd", value: sample.amount },
      leverage: sample.leverage ?? 1,
      funding: { kind: "budget", from: [] },
      repeat: null,
      exits: {
        stopLossPct: null,
        takeProfitPct: null,
        timeExitHours: null,
        trailingStopPct: null,
        ladder: [],
        description: "",
      },
    };
    workflow = {
      version: 1,
      name,
      summary: thesis,
      budgetUsd: 10000,
      assets: [
        {
          id: "asset",
          query: sample.symbol,
          sourceText: sample.symbol,
          venue: sample.venue,
          kind: sample.leverage ? "perp" : "token",
          outcome: null,
        },
      ],
      signals: sample.signals,
      stages: [stage],
      questions: sample.questions ?? [],
      assumptions: [],
    };
  }
  return {
    schemaVersion: 1,
    name,
    thesis,
    signals: [],
    triggers: [],
    actions: [],
    risk,
    workflow,
  };
}
