import assert from "node:assert/strict";
import { Strategy, Workflow, Risk } from "../lib/contracts";
import { recurringDraft } from "../services/backend/src/compile/recurring";
import { previewRecord } from "../lib/preview/records";
import { createPaperSession, readPaperSession, listPaperSessions, checkpointPaperSession } from "../lib/paper/sessions";
import { createPaper, stepPaper } from "../services/backend/src/workflows/paper";
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
console.log(`PASS: ${checks} checks — isolated session IDs and snapshots, checkpoint recovery, no duplicate fills, incomplete-market gating, storage failures and horizontal graph topology.`);
