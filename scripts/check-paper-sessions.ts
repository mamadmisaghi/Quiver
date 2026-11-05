import assert from "node:assert/strict";
import { Strategy, Workflow, Risk } from "../lib/contracts";
import { recurringDraft } from "../services/backend/src/compile/recurring";
import { previewRecord } from "../lib/preview/records";
import { createPaperSession, readPaperSession, listPaperSessions, checkpointPaperSession } from "../lib/paper/sessions";
import { createPaper, stepPaper, paperProblems, type PaperStepEvent } from "../services/backend/src/workflows/paper";
import { resolveMarket } from "../services/backend/src/compile/markets";
import { quoteAsset } from "../services/backend/src/workflows/quotes";
import { workflowView } from "../services/backend/src/engine/workflow-view";
import { paperGraphPulses } from "../lib/paper/graph-events";
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
const mint = "Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump";
const missing = structuredClone(w);
const candidate = { id: "sol:token:" + mint, symbol: "NEET", name: "NEET", venue: "solana" as const, kind: "token" as const, source: "dexscreener" as const, address: mint, url: null, maxLeverage: 1, endDate: null, outcome: null };
w.assets[0].resolution = { checkedAt: new Date().toISOString(), message: "Confirmed", status: "matched", selectedId: candidate.id, candidates: [candidate] };
record.strategy.workflow = structuredClone(w);
const first = createPaperSession(record, storage), second = createPaperSession(record, storage);
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
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: missing } }, storage), /market/i); checks++;
const incomplete = structuredClone(strategy); incomplete.workflow!.budgetUsd = null;
assert.throws(() => createPaperSession({ ...record, strategy: incomplete }, storage), /budget/i); checks++;
const broken = new Memory(); broken.setItem("quiver.paper-session.v1." + first.id, JSON.stringify({ ...first, state: { version: 1 } }));
assert.equal(readPaperSession(first.id, broken), null); assert.deepEqual(listPaperSessions(broken), []); checks++;
const full = new Memory(); full.setItem = () => { throw new Error("Quota exceeded"); };
assert.throws(() => createPaperSession(record, full), /storage/); checks++;
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
// Trace the exact observation that earned a pulse, including split and joined paths.
const branch = structuredClone(multi);
branch.assets.push({ ...branch.assets[0], id: "other", query: "TROLL" });
branch.signals.push({ ...branch.signals[0], id: "other_price", assetId: "other" });
branch.stages[0].when = { op: "or", args: [branch.stages[0].when!, { op: "gt", left: { ref: "other_price.value" }, right: { lit: 10 } }] };
branch.stages[1].when = null;
branch.stages[1].amount = { unit: "pct_profits", value: 50 };
const observation = (price: number, time: number) => [{ assetId: "asset", price, observedAt: time, source: "test", synthetic: false }];
const entering: PaperStepEvent[] = [], quiet: PaperStepEvent[] = [], leaving: PaperStepEvent[] = [];
const before = createPaper(branch, t), after = stepPaper(branch, before, observation(.002, t), t, strategy.risk, entering);
assert.deepEqual(after, stepPaper(branch, before, observation(.002, t), t, strategy.risk));
assert.deepEqual(entering[0], { kind: "condition", stageId: "buy", signals: [branch.signals[0].id] });
const entryLinks = paperGraphPulses(branch, entering, t);
assert.deepEqual(entryLinks.map(p => [p.from, p.to]), [[`wf_sig_${branch.signals[0].id}`, "wf_when_buy"], ["wf_when_buy", "wf_do_buy"]]);
assert(entryLinks[1].delay! > entryLinks[0].delay!); checks++;
stepPaper(branch, after, observation(.002, t), t, strategy.risk, quiet);
stepPaper(branch, after, observation(.002, t + 1), t + 1, strategy.risk, quiet);
assert.deepEqual(quiet, []); checks++;
stepPaper(branch, after, observation(.0025, t + 2), t + 2, strategy.risk, leaving);
const exitLinks = paperGraphPulses(branch, leaving, t + 2);
assert.deepEqual(exitLinks.map(p => [p.from, p.to]), [["wf_do_buy", "wf_exit_buy"], ["wf_exit_buy", "wf_when_next"], ["wf_when_next", "wf_do_next"]]);
assert(exitLinks.every(p => workflowView(branch).edges.some(e => e.from === p.from && e.to === p.to))); checks++;
const blocked: PaperStepEvent[] = [];
const stopped = stepPaper(branch, before, observation(.002, t), t, { ...strategy.risk, maxPositionPct: 1 }, blocked);
assert.equal(stopped.stages.buy.fills, 0); assert(!blocked.some(e => e.kind === "fill" || e.kind === "exit")); checks++;
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
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: hl } }, storage), /budget/); checks++;
hl.budgetUsd = 5000;
assert.deepEqual(paperProblems(hl, true), []);
const quoteSession = createPaperSession({ ...record, strategy: { ...strategy, workflow: hl } }, storage);
assert.equal(quoteSession.status, "ready"); assert.equal(quoteSession.mode, "quotes");
const quoteState = stepPaper(hl, createPaper(hl, t), [{ assetId: "asset", price: 50000, observedAt: t, synthetic: false, source: "test fixture" }], t, strategy.risk);
assert.equal(quoteState.events.length, 1); assert.equal(quoteState.positions.buy.leverage, 5); checks++;
const invalidMarket = structuredClone(hl); invalidMarket.assets[0].resolution!.selectedId = "hl:perp:UNKNOWN";
assert.match(paperProblems(invalidMarket, true).join(" "), /exact market for BTC/);
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: invalidMarket } }, storage), /market/); checks++;
const unresolved = structuredClone(hl); unresolved.assets[0].resolution!.selectedId = null;
unresolved.assets[0].resolution!.message = "Choose a market.";
unresolved.assets.push({ ...structuredClone(unresolved.assets[0]), id: "second_asset", query: "ETH" });
assert.deepEqual(paperProblems(unresolved, true), ["Choose the exact market for BTC to use live quotes.", "Choose the exact market for ETH to use live quotes."]);
assert.deepEqual(paperProblems(unresolved), []);
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: unresolved } }, storage), /exact market/); checks++;
unresolved.stages[0].amount.value = null;
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: unresolved } }, storage), /amount/); checks++;
unresolved.stages[0].amount.value = 100; unresolved.questions = ["Which exit condition should apply?"];
assert.throws(() => createPaperSession({ ...record, strategy: { ...strategy, workflow: unresolved } }, storage), /exit condition/); checks++;
const repeatedNoBudget = structuredClone(w); repeatedNoBudget.budgetUsd = null;
assert.equal(paperProblems(repeatedNoBudget).filter((p) => /budget/.test(p)).length, 1); checks++;
// The reported NVDA stage was a 1× equity long. Shorting or leverage needs a verified perpetual.
const nvda = structuredClone(hl);
nvda.assets[0] = { ...nvda.assets[0], query: "NVIDIA", sourceText: "NVIDIA", venue: "robinhood", kind: "token" };
nvda.assets[0].resolution = await resolveMarket(nvda.assets[0]);
nvda.stages[0].leverage = 1;
assert.deepEqual(paperProblems(nvda, true), []);
const stock = await quoteAsset(nvda.assets[0], async () => [{ last: 185, lastSaleTimestamp: new Date(t).toISOString() }], "test");
assert(stock.quote && !stock.quote.synthetic);
const stockState = stepPaper(nvda, createPaper(nvda, t), [stock.quote], t, strategy.risk);
assert.equal(stockState.events.length, 1); checks++;
nvda.stages[0].side = "short";
assert.match(paperProblems(nvda, true).join(" "), /perpetual market for the NVDA/);
nvda.stages[0].side = "long"; nvda.stages[0].leverage = 2;
assert.match(paperProblems(nvda, true).join(" "), /perpetual market/); checks++;
nvda.assets[0].venue = "hyperliquid"; nvda.assets[0].kind = "perp";
const universe = [{ name: "xyz:TSLA", maxLeverage: 5 }, { name: "xyz:NVDA", maxLeverage: 12 }];
nvda.assets[0].resolution = await resolveMarket(nvda.assets[0], async (_url, init) => {
  assert.deepEqual(JSON.parse(String(init?.body)), { type: "meta", dex: "xyz" }); return { universe };
});
assert.equal(nvda.assets[0].resolution.selectedId, "hl:perp:xyz:NVDA");
assert.deepEqual(paperProblems(nvda, true), []);
const perp = await quoteAsset(nvda.assets[0], async (_url, init) => {
  assert.deepEqual(JSON.parse(String(init?.body)), { type: "metaAndAssetCtxs", dex: "xyz" });
  return [{ universe }, [{ markPx: "475" }, { markPx: "185.25" }]];
});
assert.equal(perp.quote?.price, 185.25); assert.equal(perp.quote?.synthetic, false); checks++;
nvda.stages[0].leverage = 13;
assert.match(paperProblems(nvda, true).join(" "), /up to 12×/);
const absent = await quoteAsset(nvda.assets[0], async () => [{ universe: [{ name: "NVDA" }] }, [{ markPx: "99999" }]]);
assert.equal(absent.quote, null); checks++;
console.log(`PASS: ${checks} checks — saved one-off paper launch, shared preflight, live-only sessions, isolated snapshots, checkpoint recovery, storage failures and horizontal graph topology.`);
