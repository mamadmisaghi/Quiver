import { describe, expect, it, vi } from "vitest";
import { Workflow, workflowProblems } from "../../contracts/src/workflow";
import { CompileEvent } from "../../contracts/src/events";
import { recurringDraft } from "../../src/compile/recurring";
import { localRefine } from "../../src/compile/refine";
import { intentProblems, lowerWorkflow, planCompile } from "../../src/compile/planner";
import { marketJson, resolveMarket } from "../../src/compile/markets";
import { workflowView } from "../../src/engine/workflow-view";
import { strategyNodes } from "../../src/engine/nodes";
import { validateStrategy } from "../../src/engine/validate";
import { Executor } from "../../src/sim/executor";
import { btcStrategy, env, T0 } from "../helpers";

const thesis = "if neet price fall below 0.003 buy 100$ of neet every 1 minutes untill you out of budget";
const base = () => Workflow.parse(recurringDraft(thesis));
const { registry } = env(), deps = { registry, stockTokensAllowed: true };
const collect = async (g: AsyncGenerator<CompileEvent>) => { const out = []; for await (const e of g) out.push(CompileEvent.parse(e)); return out; };
const mint1 = "So11111111111111111111111111111111111111112", mint2 = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const pairs = { pairs: [mint1, mint2].map((address) => ({ chainId: "solana", baseToken: { address, name: "NEET", symbol: "NEET" }, liquidity: { usd: 5000 } })) };

describe("intent and market identity", () => {
  it("reads market JSON on edge runtimes while rejecting redirects", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.redirect === "error") throw new TypeError("Unsupported redirect mode at the edge");
      return Response.json({ pairs: [] });
    });
    try {
      await expect(marketJson("https://api.dexscreener.com/latest/dex/search?q=edge-test")).resolves.toEqual({ pairs: [] });
      mock.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://unverified.example" } }));
      await expect(marketJson("https://api.dexscreener.com/latest/dex/search?q=redirect-test")).rejects.toThrow("market_lookup_http_302");
      expect(mock).toHaveBeenCalledTimes(2);
    } finally { mock.mockRestore(); }
  });
  it("preserves NEET, $100, 0.003, one minute and missing budget", () => {
    const w = base(); expect(w.assets[0].query).toBe("NEET");
    expect(w.stages[0]).toMatchObject({ amount: { value: 100 }, when: { op: "lt", right: { lit: .003 } }, repeat: { intervalMinutes: 1, maxTimes: null, conditionMode: "needs_choice" } });
    expect(w.budgetUsd).toBeNull(); expect(intentProblems(w, thesis)).toEqual([]);
  });
  it("does not ignore a suffix or purchase a different asset", () => {
    expect(recurringDraft(thesis + " then bet on war")).toBeNull();
    expect(recurringDraft(thesis.replace("of neet", "of NVDA"))).toBeNull();
  });
  it("rejects schema-valid NEET to NVDA substitution", () => {
    const w = base(); w.assets[0].query = "NVDA"; expect(intentProblems(w, thesis).join(" ")).toMatch(/replace|NEET/);
  });
  it("rejects invented amounts and thresholds", () => {
    const w = base(); w.stages[0].amount.value = 250; w.stages[0].when = { op: "lt", left: { ref: "price.value" }, right: { lit: 120 } };
    expect(intentProblems(w, thesis).join(" ")).toMatch(/250/); expect(intentProblems(w, thesis).join(" ")).toMatch(/120/);
  });
  it("recognizes Nvidia and identifies its preview routing honestly", async () => {
    const r = await resolveMarket({ ...base().assets[0], query: "Nvidia", venue: "robinhood" }, async () => { throw new Error("unexpected"); });
    expect(r.status).toBe("matched"); expect(r.candidates[0]).toMatchObject({ symbol: "NVDA", address: null, source: "preview_catalog" });
  });
  it("same-name mints require a choice; liquidity does not select identity", async () => {
    const r = await resolveMarket(base().assets[0], async () => pairs);
    expect(r.status).toBe("choose"); expect(r.selectedId).toBeNull(); expect(r.candidates).toHaveLength(2);
  });
  it("preserves case when looking up an explicit mint", async () => {
    let query = ""; const r = await resolveMarket({ ...base().assets[0], query: mint1 }, async (url) => { query = url; return pairs; });
    expect(query).toContain(mint1); expect(r.selectedId).toBe(`sol:token:${mint1}`);
  });
  it("does not substitute on a provider outage", async () => {
    const r = await resolveMarket(base().assets[0], async () => { throw new Error("offline"); });
    expect(r.status).toBe("unavailable"); expect(r.candidates).toEqual([]); expect(r.message).toContain("NEET");
  });
  it("checks active Hyperliquid listing and current leverage cap", async () => {
    const a = { ...base().assets[0], query: "Pump.fun", venue: "hyperliquid" as const, kind: "perp" as const };
    const r = await resolveMarket(a, async () => ({ universe: [{ name: "PUMP", maxLeverage: 5 }] }));
    expect(r.selectedId).toBe("hl:perp:PUMP"); expect(r.candidates[0].maxLeverage).toBe(5);
    expect((await resolveMarket({ ...a, query: "OLD" }, async () => ({ universe: [{ name: "OLD", isDelisted: true }] }))).status).toBe("not_found");
  });
  it("keeps the exact Polymarket question, deadline and requested NO outcome", async () => {
    const a = { ...base().assets[0], query: "Iran US conflict", venue: "polymarket" as const, kind: "outcome" as const, outcome: "NO" };
    const r = await resolveMarket(a, async () => ({ events: [{ markets: [{ id: "123", question: "US Iran conflict by December?", active: true, outcomes: '["Yes","No"]', clobTokenIds: '["456","789"]', endDate: "2026-12-31" }, { id: "old", question: "Old", closed: true, outcomes: '["No"]', clobTokenIds: '["1"]' }] }] }));
    expect(r.candidates).toHaveLength(1); expect(r.candidates[0].id).toBe("pm:outcome:123:NO"); expect(r.selectedId).toBeNull();
  });
  it("saves a workflow for review but blocks the legacy executor", () => {
    const s = lowerWorkflow(base(), thesis, deps);
    expect(validateStrategy(s, { ...deps, purpose: "draft" }).issues.some((x) => x.severity === "error")).toBe(false);
    expect(validateStrategy(s, deps).issues.some((x) => x.severity === "error")).toBe(true);
    expect(() => new Executor({ strategy: s, ...env(), startingEquity: 10000, stockTokensAllowed: () => true, killSwitch: () => false, fillModel: "quote", emit: () => {} })).toThrow(/Workflow drafts/);
  });
  it("a standalone edit never invents Tesla", async () => {
    const ev = await collect(planCompile({ thesis: "Add a take-profit ladder: sell a third at +10%, a third at +20%, a third at +35%." }, deps));
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "needs_strategy" });
  });
  it("AI failure cannot become a demo-success strategy", async () => {
    const ev = await collect(planCompile({ thesis: "Buy $100 of Nvidia below $120" }, { ...deps, openrouter: { apiKey: "test-placeholder", model: "test", budget: { capUsd: 1, spentToday: () => 0, add: () => {} }, call: async () => { throw new Error("timeout"); } } }));
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "ai_draft_unavailable" }); expect(ev.some((e) => e.type === "result")).toBe(false);
  });
  it("streams NEET consistently through the request, contract and graph", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(pairs));
    try { const ev = await collect(planCompile({ thesis }, deps)), last = ev.at(-1); expect(last?.type).toBe("result"); if (last?.type === "result") { expect(last.strategy.workflow?.assets[0].query).toBe("NEET"); expect(JSON.stringify(last.humanized)).not.toContain("NVDA"); } } finally { mock.mockRestore(); }
  });
  it("requires an independent meaning check before lowering a supported plan", async () => {
    const text = "Buy $100 of Nvidia if price is below $120", w = base();
    w.assets[0] = { ...w.assets[0], query: "Nvidia", sourceText: "Nvidia", venue: "robinhood" };
    w.stages[0].repeat = null; w.stages[0].sourceText = text; w.stages[0].when = { op: "lt", left: { ref: "price.value" }, right: { lit: 120 } };
    const calls: string[] = [];
    const call = async (o: any) => { calls.push(o.schema.name); return { json: o.schema.name === "IntentAudit" ? { faithful: true, issues: [] } : w, inputTokens: 1, outputTokens: 1, costUsd: .001 }; };
    const ev = await collect(planCompile({ thesis: text }, { ...deps, openrouter: { apiKey: "test-placeholder", model: "test", budget: { capUsd: 1, spentToday: () => 0, add: () => {} }, call } }));
    expect(calls).toEqual(["QuiverWorkflow", "IntentAudit"]);
    const result = ev.at(-1); expect(result?.type).toBe("result"); if (result?.type === "result") { expect(result.strategy.workflow).toBeUndefined(); expect(result.strategy.actions[0].size.value).toBe("100"); expect(result.strategy.actions[0].instrument).toContain("robinhood:"); }
  });
  it("repairs an audit-detected direction error and rechecks before returning any result", async () => {
    const text = "Buy $100 of Nvidia if price is below $120", w = base();
    w.assets[0] = { ...w.assets[0], query: "Nvidia", sourceText: "Nvidia", venue: "robinhood" };
    w.stages[0].repeat = null; w.stages[0].sourceText = text;
    w.stages[0].when = { op: "gt", left: { ref: "price.value" }, right: { lit: 120 } };
    let drafts = 0, audits = 0;
    const call = async (o: any) => {
      if (o.schema.name === "IntentAudit") { audits++; return { json: { faithful: drafts === 2, issues: drafts === 2 ? [] : ["Use below, not above, $120."] }, inputTokens: 1, outputTokens: 1, costUsd: .001 }; }
      drafts++; const plan = structuredClone(w);
      if (drafts === 2) { expect(o.repair.issues[0].message).toContain("below"); plan.stages[0].when = { op: "lt", left: { ref: "price.value" }, right: { lit: 120 } }; }
      return { json: plan, inputTokens: 1, outputTokens: 1, costUsd: .001 };
    };
    const ev = await collect(planCompile({ thesis: text }, { ...deps, openrouter: { apiKey: "test-placeholder", model: "test", budget: { capUsd: 1, spentToday: () => 0, add: () => {} }, call } }));
    expect(drafts).toBe(2); expect(audits).toBe(2); expect(ev.filter((e) => e.type === "result")).toHaveLength(1);
    const last = ev.at(-1); if (last?.type !== "result") throw new Error("missing checked result");
    expect(last.strategy.triggers[0].when).toMatchObject({ op: "lt" }); expect(last.usage.attempts).toBe(4); expect(last.usage.costUsd).toBe("0.004000");
  });
  it("an audit mismatch blocks a structurally valid draft", async () => {
    const text = "Buy $100 of NEET if its price is below $0.003", w = base(); w.stages[0].sourceText = text; w.stages[0].repeat = null;
    const call = async (o: any) => ({ json: o.schema.name === "IntentAudit" ? { faithful: false, issues: ["The comparison direction is wrong."] } : w, inputTokens: 1, outputTokens: 1, costUsd: .001 });
    const ev = await collect(planCompile({ thesis: text }, { ...deps, openrouter: { apiKey: "test-placeholder", model: "test", budget: { capUsd: 1, spentToday: () => 0, add: () => {} }, call } }));
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "intent_not_verified" }); expect(ev.some((x) => x.type === "result")).toBe(false);
  });
});

describe("graph and workflow semantics", () => {
  it("all nodes are connected to actual conditions or funding", () => {
    const v = workflowView(base()), connected = new Set(v.edges.flatMap((e) => [e.from, e.to]));
    expect(v.nodes.every((n) => connected.has(n.id))).toBe(true); expect(v.humanized.when[0]).toContain("0.003"); expect(v.humanized.do[0]).toContain("$100");
  });
  it("profit dependencies connect after an exit, not an entry fill", () => {
    const w = base(); w.stages[0].repeat = null;
    w.stages.push({ ...structuredClone(w.stages[0]), id: "second", when: null, after: [{ stageId: "buy", event: "realized_profit" }], funding: { kind: "profits", from: ["buy"] } });
    expect(workflowProblems(w)).toEqual([]); const view = workflowView(w);
    expect(view.edges).toContainEqual({ from: "wf_exit_buy", to: "wf_when_second" }); expect(view.nodes.find((n) => n.id === "wf_do_second")?.detail).toMatch(/preserve principal/);
  });
  it("rejects cycles and unearned-profit funding", () => {
    const w = base(); w.stages[0].funding = { kind: "profits", from: ["buy"] }; w.stages[0].after = [{ stageId: "buy", event: "filled" }];
    expect(workflowProblems(w).join(" ")).toMatch(/cycle/); expect(workflowProblems(w).join(" ")).toMatch(/realized-profit/);
  });
  it("removes unused declarations without fabricating graph edges", () => {
    const s = btcStrategy(); s.signals.push({ id: "unused", kind: "price", maxAgeSeconds: 120, params: { instrument: "hl:perp:ETH", source: "venue_mid" } });
    expect(strategyNodes(s, registry).some((n) => n.id === "unused")).toBe(false);
  });
  it("represents Hyperliquid → profitable Polymarket settlement → two profit-funded purchases", () => {
    const w = base(), template = structuredClone(w.stages[0]); w.signals = []; w.budgetUsd = 1000;
    w.assets = [
      { id: "pump", query: "PUMP", sourceText: "Pump.fun", venue: "hyperliquid", kind: "perp", outcome: null },
      { id: "pm", query: "Iran US conflict", sourceText: "Iran US conflict", venue: "polymarket", kind: "outcome", outcome: "YES" },
      { ...w.assets[0], id: "neet" },
      { id: "nvda", query: "NVDA", sourceText: "Nvidia", venue: "robinhood", kind: "token", outcome: null },
    ];
    const stage = (id: string, assetId: string, value: number | null) => ({ ...structuredClone(template), id, assetId, amount: { unit: "usd" as const, value }, when: null, repeat: null });
    w.stages = [
      { ...stage("open", "pump", null), side: "long", leverage: 5 },
      { ...stage("bet", "pm", null), after: [{ stageId: "open", event: "realized_profit" }], funding: { kind: "profits", from: ["open"] } },
      { ...stage("token", "neet", 250), after: [{ stageId: "bet", event: "resolved_profit" }], funding: { kind: "profits", from: ["bet"] } },
      { ...stage("stock", "nvda", 500), after: [{ stageId: "bet", event: "resolved_profit" }], funding: { kind: "profits", from: ["bet"] } },
    ];
    expect(workflowProblems(w)).toEqual([]); const v = workflowView(w), connected = new Set(v.edges.flatMap((e) => [e.from, e.to]));
    expect(v.nodes.every((n) => connected.has(n.id))).toBe(true);
    expect(v.edges).toContainEqual({ from: "wf_exit_bet", to: "wf_when_token" }); expect(v.edges).toContainEqual({ from: "wf_exit_bet", to: "wf_when_stock" });
    expect(v.humanized.do.join(" ")).toMatch(/5× long/); expect(v.humanized.do.join(" ")).toMatch(/\$250/); expect(v.humanized.do.join(" ")).toMatch(/\$500/);
  });
});

describe("context-preserving refinements and partial exits", () => {
  const ladder = "Add a take-profit ladder: sell a third at +10%, a third at +20%, a third at +35%.";
  it("preserves the existing entry and risk when adding the ladder", () => {
    const original = btcStrategy(), updated = localRefine(original, ladder)!;
    expect(updated.signals).toEqual(original.signals); expect(updated.triggers).toEqual(original.triggers); expect(updated.risk).toEqual(original.risk);
    expect(updated.actions[0].instrument).toBe(original.actions[0].instrument); expect(updated.actions[0].size).toEqual(original.actions[0].size);
    expect(updated.actions[0].exits?.takeProfits?.map((x) => x.atPct)).toEqual(["10", "20", "35"]);
  });
  it("risk edit changes only the requested field", () => {
    const original = btcStrategy(), updated = localRefine(original, "Change max position to 80%")!;
    expect(updated).toEqual({ ...original, risk: { ...original.risk, maxPositionPct: 80 } }); expect(original.risk.maxPositionPct).toBe(25);
  });
  it("closes original thirds once per rung and keeps that state after restoration", async () => {
    const strategy = localRefine(btcStrategy(), ladder)!, e = env(); let px = 101000; e.mkt.overrides.set("hl:perp:BTC", () => px);
    const make = () => new Executor({ strategy, ...e, startingEquity: 10000, stockTokensAllowed: () => true, killSwitch: () => false, fillModel: "quote", feeModel: "zero", emit: () => {} });
    let ex = make(); await ex.cycle(T0); const entry = ex.acct.positions.get("hl:perp:BTC")!, original = entry.qty, price = entry.avgEntry;
    px = price * 1.11; await ex.cycle(T0 + 15000); expect(ex.acct.positions.get("hl:perp:BTC")!.qty).toBeCloseTo(original * 2 / 3, 9);
    await ex.cycle(T0 + 30000); expect(ex.fills.filter((f) => f.reducing)).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify([...ex.acct.positions])); const next = make(); next.st = ex.st; next.acct.positions = new Map(saved); next.acct.cash = ex.acct.cash; ex = next;
    px = price * 1.21; await ex.cycle(T0 + 45000); expect(ex.acct.positions.get("hl:perp:BTC")!.qty).toBeCloseTo(original / 3, 9);
    px = price * 1.36; await ex.cycle(T0 + 60000); expect(ex.acct.positions.has("hl:perp:BTC")).toBe(false);
  });
  it("deferred exits are not duplicated and cannot reverse the position", async () => {
    const strategy = localRefine(btcStrategy(), ladder)!, e = env(); let px = 101000; e.mkt.overrides.set("hl:perp:BTC", () => px);
    const ex = new Executor({ strategy, ...e, startingEquity: 10000, stockTokensAllowed: () => true, killSwitch: () => false, fillModel: "next_bar", feeModel: "zero", emit: () => {} });
    await ex.cycle(T0); ex.settlePending(T0 + 1000); const entry = ex.acct.positions.get("hl:perp:BTC")!;
    px = entry.avgEntry * 1.40; await ex.cycle(T0 + 15000); expect(ex.pending).toHaveLength(3);
    await ex.cycle(T0 + 16000); expect(ex.pending).toHaveLength(3); ex.settlePending(T0 + 20000); expect(ex.acct.positions.has("hl:perp:BTC")).toBe(false);
  });
});
