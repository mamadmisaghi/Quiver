import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { mockApi } from "../lib/api/mock";
import {
  STRATEGIES,
  STRATEGY_ID,
  STRATEGY_RAW,
  USER_ID,
} from "../lib/api/fixtures";
import { Strategy, canonicalizeWorkflow } from "../lib/contracts";
import { exampleStrategy } from "../lib/api/example-strategies";
import {
  readPaperDefaults,
  writePaperDefaults,
} from "../lib/api/browser-settings";
import { previewRecord } from "../lib/preview/records";
import {
  saveConnection,
  listConnections,
  openConnection,
  approvedRpc,
} from "../lib/preview/connections";
import {
  createPaperSession,
  readPaperSession,
  checkpointPaperSession,
  pauseAllPaperSessions,
} from "../lib/paper/sessions";
import { paperProblems } from "../services/backend/src/workflows/paper";
import { linkedEntry } from "../services/backend/src/compile/linked-entry";

const cells = new Map<string, string>();
const storage = {
  clear: () => cells.clear(),
  get length() {
    return cells.size;
  },
  getItem: (k: string) => cells.get(k) ?? null,
  setItem: (k: string, v: string) => cells.set(k, v),
  key: (n: number) => [...cells.keys()][n] ?? null,
  removeItem: (k: string) => cells.delete(k),
} as Storage;
Object.assign(globalThis, { localStorage: storage, window: new EventTarget() });
const savedFetch = globalThis.fetch;
globalThis.fetch = async (_u, opts) =>
  opts?.method === "POST"
    ? Response.json({ message: "guest" }, { status: 401 })
    : Response.json({ authenticated: false, items: [] });
const initial = await mockApi.strategy(STRATEGY_ID);
assert(initial.activeRunId);
assert(initial.strategy.workflow);
await assert.rejects(
  mockApi.updateStrategy(initial.id, initial.strategy, initial.version),
  /Stop/,
);
const copy = await mockApi.createStrategy({
  ...initial.strategy,
  risk: { ...initial.strategy.risk, maxPositionPct: 32 },
});
assert.notEqual(copy.id, initial.id);
assert.equal(
  (await mockApi.strategy(copy.id)).strategy.risk.maxPositionPct,
  32,
);
assert.equal(
  (await mockApi.strategy(initial.id)).strategy.risk.maxPositionPct,
  25,
);
const edited = await mockApi.updateStrategy(
  copy.id,
  { ...copy.strategy, risk: { ...copy.strategy.risk, maxPositionPct: 38 } },
  copy.version,
);
assert.equal(edited.version, 2);
await assert.rejects(
  mockApi.updateStrategy(copy.id, copy.strategy, 1),
  /changed/i,
);
await mockApi.control(initial.activeRunId, "stop_and_flatten");
assert.equal((await mockApi.strategy(initial.id)).activeRunId, null);
for (const [index, symbol] of ["", "AAPL", "ETH", "JUP", "SPY"].entries())
  if (index)
    assert.equal(
      (await mockApi.strategy(STRATEGIES[index].id)).strategy.workflow
        ?.assets[0].query,
      symbol,
    );
writePaperDefaults({ mode: "scenario", budgetUsd: 7500 });
assert.equal(readPaperDefaults().budgetUsd, 7500);
await mockApi.putMyProfile({ displayName: "Workspace QA" });
assert.equal((await mockApi.myProfile()).displayName, "Workspace QA");
const rule = await mockApi.createAlertRule({
  runId: null,
  events: ["fill"],
  enabled: true,
});
assert((await mockApi.alertRules()).some((r) => r.id === rule.id));
await mockApi.deleteAlertRule(rule.id);
assert(!(await mockApi.alertRules()).some((r) => r.id === rule.id));
await mockApi.putAlertChannel("telegram", "@quiver_qa");
assert.equal((await mockApi.alertChannels()).items[0].target, "@quiver_qa");
const legacy = previewRecord(
  Strategy.parse(STRATEGY_RAW),
  "stg_1234567890",
  USER_ID,
);
const legacySession = createPaperSession(legacy, "scenario", storage, 10000);
assert.equal(
  readPaperSession(legacySession.id, storage)?.startingBalance,
  10000,
);
assert.throws(() => createPaperSession(legacy, "quotes", storage, 10000));
const w = linkedEntry(legacy.strategy.thesis)!;
assert(w);
assert.equal(w.stages.length, 2);
assert.deepEqual(
  w.stages.map((s) => s.amount.value),
  [200, 250],
);
assert.equal(w.stages[1].leverage, 2);
assert.equal(w.signals[2].indicator?.period, 20);
assert.equal(linkedEntry(legacy.strategy.thesis + " Then sell BTC."), null);
w.budgetUsd = 10000;
w.stages[0].exits.description = "Stop at −8%.";
assert.deepEqual(paperProblems(w), []);
w.stages[0].exits.description = "Stop at -8% only after Monday";
assert(paperProblems(w).length > 0);
w.stages[0].exits.description = "Stop at -9%";
assert(paperProblems(w).length > 0);
w.stages[0].exits.description = "";
const next = createPaperSession(
  {
    ...copy,
    strategy: { ...copy.strategy, workflow: canonicalizeWorkflow(w) },
  },
  "scenario",
  storage,
);
checkpointPaperSession(next.id, null, "running", storage);
assert.equal(pauseAllPaperSessions(storage), 1);
assert.throws(
  () => checkpointPaperSession(next.id, null, "running", storage),
  /paused/,
);
assert.equal(
  checkpointPaperSession(next.id, null, "running", storage, true).status,
  "running",
);
globalThis.fetch = savedFetch;
const sqlite = new DatabaseSync(":memory:");
for (const file of [
  "0000_careful_susan_delgado",
  "0001_workspace_connections",
  "0002_paper_alerts",
])
  sqlite.exec(
    readFileSync(
      new URL("../drizzle/" + file + ".sql", import.meta.url),
      "utf8",
    ),
  );
const db = {
  prepare(query: string) {
    const statement = sqlite.prepare(query);
    let args: SQLInputValue[] = [];
    return {
      bind(...values: SQLInputValue[]) {
        args = values;
        return this;
      },
      async first() {
        return statement.get(...args) ?? null;
      },
      async all() {
        return { results: statement.all(...args) };
      },
      async run() {
        return { meta: { changes: Number(statement.run(...args).changes) } };
      },
    };
  },
} as unknown as D1Database;
process.env.SECRETS_MASTER_KEY = randomBytes(32).toString("hex");
const sample = "sk-or-" + randomBytes(15).toString("hex");
await saveConnection(
  db,
  "owner-a",
  "ai_key",
  sample,
  "My key",
  "…" + sample.slice(-4),
);
assert.equal(await openConnection(db, "owner-a", "ai_key", true), sample);
assert.equal(await openConnection(db, "owner-b", "ai_key"), null);
assert(!JSON.stringify(await listConnections(db, "owner-a")).includes(sample));
assert(
  !JSON.stringify(
    sqlite.prepare("SELECT * FROM preview_connections").all(),
  ).includes(sample),
);
assert.equal((await listConnections(db, "owner-b")).length, 0);
assert.throws(() => approvedRpc("https://127.0.0.1"));
assert.throws(() =>
  approvedRpc("https://rpc.testnet.chain.robinhood.com.attacker.example"),
);
assert.throws(() => approvedRpc("https://x@rpc.testnet.chain.robinhood.com"));
sqlite.close();
console.log(
  "PASS: active-version isolation, all example identities, saved preferences, alert rules, legacy sessions, exact linked entries, preserved exit conditions, cross-tab pause and encrypted owner-only connections.",
);

// An actual joint drop must buy both coins on one tick before the 5× BTC long.
{
  const { createPaper, stepPaper } = await import(
    "../services/backend/src/workflows/paper"
  );
  const { drawdownDraft } = await import(
    "../services/backend/src/compile/drawdown"
  );
  const plan = drawdownDraft("Buy $100 of NEET every time NEET drops 10%")!;
  const drop = plan.signals[0];
  drop.drawdown = { reference: "last_fill", lookbackMinutes: null };
  plan.assets.push(
    { ...plan.assets[0], id: "troll", query: "TROLL", sourceText: "TROLL" },
    {
      ...plan.assets[0],
      id: "btc",
      query: "BTC",
      sourceText: "BTC",
      venue: "hyperliquid",
      kind: "perp",
    },
  );
  plan.signals.push({ ...drop, id: "drop_troll", assetId: "troll" });
  const buy = plan.stages[0];
  buy.when = {
    op: "and",
    args: [
      buy.when!,
      { op: "gte", left: { ref: "drop_troll.value" }, right: { lit: 10 } },
    ],
  };
  const other = { ...structuredClone(buy), id: "buy_troll", assetId: "troll" };
  const long = {
    ...structuredClone(buy),
    id: "long_btc",
    assetId: "btc",
    side: "long" as const,
    leverage: 5,
    when: null,
    amount: { unit: "usd" as const, value: 200 },
    after: [
      { stageId: buy.id, event: "filled" as const },
      { stageId: other.id, event: "filled" as const },
    ],
  };
  plan.stages = [long, buy, other];
  plan.budgetUsd = 10000;
  plan.questions = [];
  const frame = (at: number, ratio: number) =>
    plan.assets.map((a, i) => ({
      assetId: a.id,
      price: [1, 10, 100][i] * ratio,
      observedAt: at,
      synthetic: true,
      source: "test",
    }));
  const at = 1700000000000;
  let st = stepPaper(plan, createPaper(plan, at), frame(at, 1), at);
  st = stepPaper(plan, st, frame(at + 60000, 0.9), at + 60000);
  assert.deepEqual(
    st.events.map((e) => e.stageId),
    [buy.id, other.id, long.id],
  );
  assert.deepEqual(
    st.events.map((e) => e.at),
    Array(3).fill(at + 60000),
  );
  st = stepPaper(plan, st, frame(at + 120000, 0.9), at + 120000);
  assert.equal(st.events.length, 3);
  st = stepPaper(plan, st, frame(at + 180000, 0.81), at + 180000);
  assert.equal(st.events.length, 6);
  console.log(
    "PASS: two joint 10% declines, both market orders on each observation, then the 5× BTC long, including out-of-order stage declarations.",
  );
}
