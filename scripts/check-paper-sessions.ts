import assert from "node:assert/strict";
import { Strategy, Workflow, Risk } from "../lib/contracts";
import { recurringDraft } from "../services/backend/src/compile/recurring";
import { previewRecord } from "../lib/preview/records";
import { createPaperSession, readPaperSession, listPaperSessions, checkpointPaperSession } from "../lib/paper/sessions";
import { createPaper, stepPaper, paperProblems } from "../services/backend/src/workflows/paper";
import { workflowView } from "../services/backend/src/engine/workflow-view";
import { graphLayout, GRAPH_GAP, NODE_WIDTH } from "../lib/graph-layout";
class Memory implements Storage {
  data = new Map<string, string>(); get length() { return this.data.size; }
  clear() { this.data.clear(); } getItem(k: string) { return this.data.get(k) ?? null; } key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); } setItem(k: string, v: string) { this.data.set(k, v); }
}
let checks = 0;
const w = Workflow.parse(recurringDraft("if NEET price below 0.003 buy $100 of NEET every one minute until out of budget"));
w.budgetUsd = 1000; w.stages[0].repeat!.conditionMode = "each_time";
const strategy = Strategy.parse({ schemaVersion: 1, name: w.name, thesis: w.stages[0].sourceText, signals: [], triggers: [], actions: [], risk: Risk.parse({}), workflow: w });
const record = previewRecord(strategy, "stg_test00000001", "usr_test00000001", new Date().toISOString(), null);
const storage = new Memory();
const first = createPaperSession(record, "scenario", storage), second = createPaperSession(record, "scenario", storage);
assert.notEqual(first.id, second.id); assert.equal(listPaperSessions(storage).length, 2); checks++;
assert.equal(first.strategyId, record.id); assert.equal(first.strategyVersion, record.version); checks++;
record.strategy.workflow!.budgetUsd = 5000;
assert.equal(readPaperSession(first.id, storage)!.strategy.workflow!.budgetUsd, 1000); checks++;
const t = Date.parse("2026-11-01T10:00:00Z");
let state = createPaper(w, t); state = stepPaper(w, state, [{ assetId: "asset", price: .002, observedAt: t, synthetic: true, source: "test" }], t, strategy.risk);
const saved = checkpointPaperSession(first.id, state, "paused", storage);
assert.deepEqual(saved.state, state); assert.deepEqual(readPaperSession(first.id, storage)!.state, state); checks++;
assert.equal(readPaperSession(second.id, storage)!.state, null); checks++;
assert.equal(stepPaper(w, readPaperSession(first.id, storage)!.state!, [], t, strategy.risk).events.length, 1); checks++;
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: w } }, "quotes", storage), /market/i); checks++;
const incomplete = structuredClone(strategy); incomplete.workflow!.budgetUsd = null;
assert.throws(() => createPaperSession({ ...record, strategy: incomplete }, "scenario", storage), /budget/i); checks++;
const broken = new Memory(); broken.setItem("quiver.paper-session.v1." + first.id, JSON.stringify({ ...first, state: { version: 1 } }));
assert.equal(readPaperSession(first.id, broken), null); assert.deepEqual(listPaperSessions(broken), []); checks++;
const full = new Memory(); full.setItem = () => { throw new Error("Quota exceeded"); };
assert.throws(() => createPaperSession(record, "scenario", full), /storage/); checks++;
const view = workflowView(w), graph = graphLayout(view.nodes, view.edges, 340);
assert.equal(GRAPH_GAP, 61.60000000000001); assert(graph.W > 340);
for (const edge of view.edges) { const a = graph.boxes[edge.from], b = graph.boxes[edge.to]; assert(a && b); assert(b.x >= a.x + a.w + GRAPH_GAP - .001); }
checks++;
const partial = graphLayout(view.nodes, [], 340); assert(partial.boxes.wf_do_buy.x > partial.boxes.wf_when_buy.x); assert(partial.boxes.wf_when_buy.x > partial.boxes.wf_budget.x); checks++;
const multi = structuredClone(w); multi.stages[0].repeat = null; multi.stages[0].exits.takeProfitPct = 10;
multi.stages.push({ ...structuredClone(multi.stages[0]), id: "next", after: [{ stageId: "buy", event: "realized_profit" }], funding: { kind: "profits", from: ["buy"] } });
const v2 = workflowView(multi), g2 = graphLayout(v2.nodes, v2.edges, 1000);
for (const e of v2.edges) assert(g2.boxes[e.to].x > g2.boxes[e.from].x);
for (const a of Object.values(g2.boxes)) for (const b of Object.values(g2.boxes)) if (a !== b) assert(a.x + NODE_WIDTH <= b.x || b.x + NODE_WIDTH <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
checks++;
// Regression: a saved, one-off Hyperliquid draft used to look ready without a
// budget while both launch buttons stayed disabled. Setup and launch must use
// the same preflight, and adding a budget must be enough to open a quote session.
const hl = structuredClone(w); hl.name = "BTC paper launch check"; hl.signals = []; hl.questions = [];
hl.stages[0] = { ...hl.stages[0], side: "long", leverage: 5, when: null, repeat: null };
hl.assets[0] = { ...hl.assets[0], query: "BTC", sourceText: "BTC on Hyperliquid", venue: "hyperliquid", kind: "perp", resolution: {
  status: "matched", selectedId: "hl:perp:BTC", checkedAt: new Date(t).toISOString(), message: "Matched BTC perpetual.",
  candidates: [{ id: "hl:perp:BTC", symbol: "BTC", name: "BTC perpetual", venue: "hyperliquid", kind: "perp", source: "hyperliquid", address: null, url: null, maxLeverage: 10, endDate: null, outcome: null }],
} };
hl.budgetUsd = null;
assert.deepEqual(paperProblems(hl, true), ["Enter a starting budget for paper trading."]);
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: hl } }, "quotes", storage), /budget/); checks++;
hl.budgetUsd = 5000;
assert.deepEqual(paperProblems(hl, true), []);
const quoteSession = createPaperSession({ ...record, strategy: { ...strategy, workflow: hl } }, "quotes", storage);
assert.equal(quoteSession.status, "ready"); assert.equal(quoteSession.mode, "quotes");
const quoteState = stepPaper(hl, createPaper(hl, t), [{ assetId: "asset", price: 50000, observedAt: t, synthetic: false, source: "test fixture" }], t, strategy.risk);
assert.equal(quoteState.events.length, 1); assert.equal(quoteState.positions.buy.leverage, 5); checks++;
const invalidMarket = structuredClone(hl); invalidMarket.assets[0].resolution!.selectedId = "hl:perp:UNKNOWN";
assert.match(paperProblems(invalidMarket, true).join(" "), /exact market for BTC/);
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: invalidMarket } }, "quotes", storage), /market/); checks++;
const unresolved = structuredClone(hl); unresolved.assets[0].resolution!.selectedId = null;
unresolved.assets[0].resolution!.message = "Choose a market.";
unresolved.assets.push({ ...structuredClone(unresolved.assets[0]), id: "second_asset", query: "ETH" });
assert.deepEqual(paperProblems(unresolved, true), ["Choose the exact market for BTC to use live quotes.", "Choose the exact market for ETH to use live quotes."]);
assert.deepEqual(paperProblems(unresolved), []);
assert.equal(createPaperSession({ ...record, strategy: { ...strategy, workflow: unresolved } }, "scenario", storage).mode, "scenario"); checks++;
unresolved.stages[0].amount.value = null;
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: unresolved } }, "scenario", storage), /amount/); checks++;
unresolved.stages[0].amount.value = 100; unresolved.questions = ["Which exit condition should apply?"];
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: unresolved } }, "scenario", storage), /exit condition/); checks++;
const repeatedNoBudget = structuredClone(w); repeatedNoBudget.budgetUsd = null;
assert.equal(paperProblems(repeatedNoBudget).filter((p) => /budget/.test(p)).length, 1); checks++;
console.log(`PASS: ${checks} checks — saved one-off paper launch, shared preflight, explicit price modes, isolated snapshots, checkpoint recovery, storage failures and horizontal graph topology.`);
