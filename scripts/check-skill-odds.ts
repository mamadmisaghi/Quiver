import assert from "node:assert/strict";
import test from "node:test";
import { oddsEntry } from "../services/backend/src/compile/odds-entry";
import {
  intentProblems,
  planCompile,
} from "../services/backend/src/compile/planner";
import {
  Registry,
  MOCK_INSTRUMENTS,
} from "../services/backend/src/venues/registry";
import { Workflow, Risk } from "../lib/contracts";
import {
  createPaper,
  stepPaper,
} from "../services/backend/src/workflows/paper";
import { hyperliquidBook } from "../lib/live-market-data";
import samples from "../lib/api/fixtures/ext/ext.skills.json";

const text = samples.items.find((s) => s.id === "odds")!.prompt;
test("the built-in odds skill preserves exact event, true crossing, amount, exit and unresolved choices", () => {
  const w = Workflow.parse(oddsEntry(text));
  assert.equal(w.budgetUsd, null);
  assert.equal(w.assets[0].query, "Fed-cut-in-December");
  assert.equal(w.assets[0].outcome, null);
  assert.equal(w.assets[0].resolution, undefined);
  assert.equal(w.assets[1].query, "SPY");
  assert.equal(w.stages[0].amount.value, 300);
  assert.equal(w.stages[0].exits.takeProfitPct, 3);
  assert.deepEqual(w.stages[0].when, {
    op: "crosses_above",
    left: { ref: "odds.value" },
    right: { lit: 0.7 },
  });
  assert.deepEqual(intentProblems(w, text), []);
  const alternative = oddsEntry(
    "When Election winner odds cross below 45%, buy $120 of AAPL stock token; take profit 6%.",
  )!;
  assert.equal(alternative.assets[0].query, "Election winner");
  assert.equal(alternative.assets[1].query, "AAPL");
  assert.equal(alternative.stages[0].when?.op, "crosses_below");
  assert.equal(alternative.stages[0].amount.value, 120);
  for (const suffix of [
    " Then short BTC.",
    " Repeat every minute.",
    " Only if SOL falls 5%.",
  ])
    assert.equal(oddsEntry(text + suffix), null);
});
test("grounded stock descriptors pass while changed assets and ungrounded clauses are still rejected", () => {
  const w = Workflow.parse(oddsEntry(text));
  w.assets[1].sourceText = "SPY stock token";
  assert.deepEqual(intentProblems(w, text), []);
  w.assets[1].query = "TSLA";
  assert.match(intentProblems(w, text).join(" "), /replace/);
  w.assets[1].query = "SPY";
  w.assets[1].sourceText = "SPY option";
  assert.match(intentProblems(w, text).join(" "), /grounded|replace/);
});
test("crossing waits for an observed transition and retains the requested take-profit", () => {
  const w = Workflow.parse(oddsEntry(text));
  w.budgetUsd = 1000;
  const start = Date.parse("2026-11-04T12:00:00Z"),
    risk = Risk.parse({ maxPositionPct: 100 });
  const frame = (p: number, at: number) => [
    {
      assetId: "event",
      price: p,
      observedAt: at,
      source: "Test market",
      synthetic: false,
    },
    {
      assetId: "stock",
      price: 100,
      observedAt: at,
      source: "Test equity",
      synthetic: false,
    },
  ];
  let s = stepPaper(w, createPaper(w, start), frame(0.72, start), start, risk);
  assert.equal(s.events.length, 0);
  s = stepPaper(w, s, frame(0.68, start + 1000), start + 1000, risk);
  assert.equal(s.events.length, 0);
  s = stepPaper(w, s, frame(0.71, start + 2000), start + 2000, risk);
  assert.equal(s.events.filter((e) => e.kind === "buy").length, 1);
  assert.equal(s.events[0].amount, 300);
});
test("the normal draft entry returns the built-in skill without AI and leaves exact prediction-market selection to the user", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      markets: [
        {
          id: "event-2026",
          question: "Fed rate cut in December 2026?",
          outcomes: ["Yes", "No"],
          clobTokenIds: ["yes-token", "no-token"],
          active: true,
        },
      ],
    });
  };
  try {
    const events = [];
    for await (const e of planCompile(
      { thesis: text },
      {
        registry: new Registry(MOCK_INSTRUMENTS),
        stockTokensAllowed: true,
        retainWorkflow: true,
      },
    ))
      events.push(e);
    const result = events.find((e) => e.type === "result");
    assert(result && result.type === "result", JSON.stringify(events));
    assert.equal(result.compiler, "rules");
    assert.equal(
      result.strategy.workflow!.assets[0].resolution?.selectedId,
      null,
    );
    assert(calls > 0);
    assert(!events.some((e) => e.type === "error"));
  } finally {
    globalThis.fetch = original;
  }
});
test("streamed and HTTP order books share identity, freshness and valid-sided-price checks", () => {
  const at = Date.now(),
    book = {
      coin: "BTC",
      time: at,
      levels: [[{ px: "80000", sz: "2" }], [{ px: "80002", sz: "3" }]],
    };
  assert.equal(hyperliquidBook(book, "BTC", at)?.price, 80001);
  assert.equal(hyperliquidBook(book, "ETH", at), null);
  assert.equal(hyperliquidBook(book, "BTC", at + 31000), null);
  assert.equal(
    hyperliquidBook(
      {
        ...book,
        levels: [[{ px: "80002", sz: "1" }], [{ px: "80000", sz: "1" }]],
      },
      "BTC",
      at,
    ),
    null,
  );
});
