import assert from "node:assert/strict";
import { Risk, Strategy, Workflow } from "@/lib/contracts";
import legacyRuleStrategy from "@/lib/api/fixtures/strategy.nvda-fed.json";
import { PaperSessionSchema, type PaperSession } from "@/lib/paper/sessions";
import { createPaper, stepPaper } from "@/services/backend/src/workflows/paper";
import { paperAccount, paperAllocation } from "@/lib/paper/account";

const start = Date.UTC(2026, 9, 1, 10), t = (seconds: number) => start + seconds * 1000;
const risk = Risk.parse({ maxPositionPct: 100, maxTotalExposurePct: 100, maxDailyLossPct: 100, maxOrdersPerDay: 500 });
type W = NonNullable<PaperSession["strategy"]["workflow"]>;
const exits: W["stages"][number]["exits"] = { stopLossPct: null, takeProfitPct: null, trailingStopPct: null, timeExitHours: null, ladder: [], description: "" };
function session(id: string, side: "long" | "short", budget: number, leverage: number, at: number, rules = exits): PaperSession {
  const name = `${side} ${id}`, candidate = { id: "hl:perp:BTC", symbol: "BTC", name: "Bitcoin perpetual", venue: "hyperliquid", kind: "perp", source: "hyperliquid", address: null, url: null, maxLeverage: 25, endDate: null, outcome: null };
  const workflow = Workflow.parse({ version: 1, name, summary: "Verification only", budgetUsd: budget, questions: [], signals: [],
    assets: [{ id: "coin", query: "Bitcoin", sourceText: "Bitcoin", venue: "hyperliquid", kind: "perp", outcome: null, resolution: { status: "matched", selectedId: candidate.id, checkedAt: new Date(at).toISOString(), message: "Recorded identity", candidates: [candidate] } }],
    stages: [{ id: "enter", assetId: "coin", side, sourceText: name, conditionText: "", when: null, after: [], amount: { unit: "usd", value: 100 }, leverage, funding: { kind: "budget", from: [] }, repeat: null, exits: rules }] });
  const strategy = Strategy.parse({ schemaVersion: 1, name, thesis: name, signals: [], triggers: [], actions: [], risk, workflow });
  return PaperSessionSchema.parse({ version: 1, id: `paper_${id}`, strategyId: `stg_${id.padEnd(12, "a")}`, strategyVersion: 1, name, strategy, mode: "quotes", status: "ready", createdAt: at, updatedAt: at, state: null });
}
function observe(s: PaperSession, seconds: number, price: number) {
  const workflow = s.strategy.workflow!, at = t(seconds), state = s.state ?? createPaper(workflow, s.createdAt);
  return PaperSessionSchema.parse({ ...s, status: "running", updatedAt: at,
    state: stepPaper(workflow, state, [{ assetId: "coin", price, observedAt: at, source: "verification input", synthetic: false }], at, risk) });
}
const near = (value: number | null | undefined, expected: number) => {
  assert(value != null && Math.abs(value - expected) < 1e-8, `Expected ${expected}, received ${value}`);
};
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks++; console.log(`PASS ${name}`); };

const readyA = session("alpha", "long", 1000, 2, t(0)), readyB = session("bravo", "short", 500, 1, t(20));
const firstA = observe(readyA, 10, 100), firstB = observe(readyB, 30, 100);
const a = observe(firstA, 40, 110), b = observe(firstB, 50, 80), ready = session("charlie", "long", 200, 1, t(60));

check("empty workspace and explicit cash allocation without a chart or fill", () => {
  const empty = paperAccount([]);
  assert.deepEqual(empty.totals, { budget: 0, cash: 0, equity: 0, realized: 0, unrealized: 0, pnl: 0, returnPct: null, fees: 0, fills: 0, openPositions: 0 });
  assert.deepEqual([empty.sessions, empty.positions, empty.history, empty.activity], [[], [], [], []]); assert.equal(empty.asOf, null);
  const funded = paperAccount([ready]); near(funded.totals.equity, 200); near(funded.totals.cash, 200);
  assert.deepEqual(funded.history, []); assert.deepEqual(funded.activity.map(e => e.kind), ["session_created"]);
});
check("real session IDs, source links and independent marks on the same market", () => {
  const result = paperAccount([a, b, ready]);
  assert.equal(result.sessions.length, 3); assert.equal(result.totals.fills, 2); assert.equal(result.totals.openPositions, 2);
  near(result.totals.budget, 1700); near(result.totals.cash, 1499.7); near(result.totals.equity, 1739.7);
  near(result.totals.realized, 0); near(result.totals.unrealized, 39.7); near(result.totals.pnl, 39.7); near(result.totals.fees, .30); near(result.totals.returnPct, 39.7 / 17);
  assert.deepEqual(result.positions.map(p => [p.id, p.side, p.symbol, p.qty, p.entry, p.mark, p.markedAt, p.assetClass]).sort(), [
    ["paper_alpha:enter", "long", "BTC", 2, 100, 110, t(40), "Perpetual"], ["paper_bravo:enter", "short", "BTC", 1, 100, 80, t(50), "Perpetual"]]);
  for (const item of result.activity) assert.equal(item.href, `/app/run/${item.sessionId}`);
  assert.deepEqual(result.activity.filter(e => e.kind === "buy").map(e => e.action), ["short", "long"]);
  assert.deepEqual(result.activity.map(e => e.at), [60, 30, 20, 10, 0].map(t));
  const alloc = paperAllocation(result.positions, "instrument"); assert.equal(alloc.items.length, 1); near(alloc.gross, 300); near(alloc.net, 140); near(alloc.items[0].weightPct, 100);
});
check("merged times, neutral funding, duplicate snapshots, simultaneous observations", () => {
  const result = paperAccount([ready, b, firstA, a]);
  const expected = [[10, 999.8, -.2], [20, 1499.8, -.2], [30, 1499.7, -.3], [40, 1519.7, 19.7], [50, 1539.7, 39.7], [60, 1739.7, 39.7]];
  assert.equal(result.history.length, expected.length);
  result.history.forEach((p, i) => { assert.equal(Date.parse(p.ts), t(expected[i][0])); near(p.equityUsd, expected[i][1]); near(p.pnlUsd, expected[i][2]); });
  const sameTick = paperAccount([observe(firstA, 50, 110), b]);
  assert.equal(sameTick.history.filter(p => Date.parse(p.ts) === t(50)).length, 1); near(sameTick.history.at(-1)?.equityUsd, 1539.7);
  assert.equal(result.sessions.find(r => r.id === a.id)?.status, "running");
  assert.equal(paperAccount([a], t(101)).sessions[0].status, "paused");
});
check("two partial ladder exits at one tick, then a complete net-of-fees exit", () => {
  const rules = { ...exits, takeProfitPct: 25, ladder: [{ atPct: 5, fraction: .25 }, { atPct: 10, fraction: .25 }] };
  const first = observe(session("ladder", "long", 1000, 2, t(0), rules), 10, 100), half = observe(first, 20, 115);
  const partial = paperAccount([half]); near(partial.totals.cash, 964.685); near(partial.totals.equity, 1029.685);
  near(partial.totals.realized, 14.785); near(partial.totals.unrealized, 14.9); near(partial.positions[0].unrealized, 14.9); near(partial.totals.fees, .315);
  assert.equal(partial.totals.fills, 3); assert.equal(partial.activity.filter(e => e.kind === "exit").length, 2);
  assert.equal(new Set(partial.activity.map(e => e.id)).size, partial.activity.length);
  const closed = paperAccount([observe(half, 30, 130)]); near(closed.totals.cash, 1044.555); near(closed.totals.equity, 1044.555);
  near(closed.totals.realized, 44.555); assert.equal(closed.totals.unrealized, 0); near(closed.totals.fees, .445); assert.equal(closed.totals.fills, 4); assert.deepEqual(closed.positions, []);
});
check("two stages in one strategy hold separate lots in one market", () => {
  const double = session("double", "long", 1000, 2, t(0)), stages = double.strategy.workflow!.stages;
  stages.push({ ...structuredClone(stages[0]), id: "hedge", side: "short", leverage: 1 });
  const result = paperAccount([observe(observe(double, 10, 100), 20, 110)]);
  assert.deepEqual(result.positions.map(p => p.id), ["paper_double:enter", "paper_double:hedge"]);
  near(result.totals.cash, 799.7); near(result.totals.equity, 1009.7); near(result.totals.unrealized, 9.7); near(result.totals.realized, 0);
  near(result.positions[0].unrealized, 19.8); near(result.positions[1].unrealized, -10.1);
  const allocation = paperAllocation(result.positions, "instrument"); near(allocation.gross, 330); near(allocation.net, 110);
});
check("isolated short liquidation keeps loss to collateral plus prepaid entry fee", () => {
  const opened = observe(session("liquidation", "short", 500, 2, t(0)), 10, 100);
  const closed = paperAccount([observe(opened, 20, 190)]);
  near(closed.totals.cash, 399.8); near(closed.totals.equity, 399.8); near(closed.totals.realized, -100.2); near(closed.totals.fees, .58); assert.deepEqual(closed.positions, []);
});
check("a missing mark withholds totals and weights without replacing a price or suppressing cash", () => {
  const missing = structuredClone(a); delete missing.state!.quotes.coin;
  const result = paperAccount([missing, b]);
  const row = result.positions.find(p => p.sessionId === a.id)!;
  assert.deepEqual([row.mark, row.markedAt, row.notional, row.unrealized], [null, null, null, null]);
  assert.deepEqual([result.totals.equity, result.totals.pnl, result.totals.unrealized, result.totals.returnPct], [null, null, null, null]);
  near(result.totals.cash, 1299.7); near(result.totals.fees, .30); assert.equal(result.totals.fills, 2);
  assert.deepEqual(result.history, []); const alloc = paperAllocation(result.positions, "venue"); assert.equal(alloc.gross, null); assert.equal(alloc.items[0].weightPct, null);
});
check("archived workflows, legacy sessions and mixed synthetic checkpoints are isolated", () => {
  const synthetic = structuredClone(a); synthetic.id = "paper_synthetic"; synthetic.state!.quotes.coin.synthetic = true;
  const archived = PaperSessionSchema.parse({ ...a, id: "paper_archived", mode: "scenario" });
  const legacy = PaperSessionSchema.parse({ ...archived, id: "paper_legacy", state: null, startingBalance: 99555, strategy: legacyRuleStrategy });
  const result = paperAccount([a, synthetic, archived, legacy]);
  assert.deepEqual(result, paperAccount([a]));
  assert.deepEqual(paperAccount([a, { ...synthetic, id: a.id, updatedAt: a.updatedAt + 1 }]).sessions, []);
});
check("an exhausted historical ring does not masquerade as a deposit at its oldest point", () => {
  const old = session("old", "long", 50, 1, t(0)); old.state = createPaper(old.strategy.workflow!, t(0));
  old.state.curve = Array.from({ length: 1000 }, (_, i): [number, number] => [t(25 + i), 50]); old.state.lastAt = t(1024); old.updatedAt = t(1024);
  const result = paperAccount([old, a]); assert.equal(Date.parse(result.history[0].ts), t(25)); near(result.history[0].equityUsd, 1049.8);
  near(result.history.at(-1)?.equityUsd, 1069.8);
});
console.log(`${checks} numerical and isolation checks passed.`);
