import { describe, it, expect, vi } from "vitest";
import { drawdownDraft } from "../../src/compile/drawdown";
import { Workflow, workflowProblems } from "../../contracts/src/workflow";
import { recurringDraft } from "../../src/compile/recurring";
import { Risk } from "../../contracts/src/strategy";
import { createPaper, stepPaper, paperEquity, paperProblems, type PaperQuote } from "../../src/workflows/paper";
import { quoteAsset } from "../../src/workflows/quotes";
const risk = Risk.parse({ maxPositionPct: 100, maxTotalExposurePct: 100, maxDailyLossPct: 100, maxOrdersPerDay: 500 });
const T = Date.parse("2026-10-31T10:00:00Z");
const drop = () => { const w = Workflow.parse(drawdownDraft("Every time NEET drops 30%, buy $100 of NEET")); w.budgetUsd = 1000; w.signals[0].drawdown!.reference = "last_fill"; return w; };
const quote = (price: number, at: number, assetId = "asset"): PaperQuote => ({ assetId, price, observedAt: at, synthetic: true, source: "test" });
const tick = (w: Workflow, s: ReturnType<typeof createPaper>, price: number, n: number) => stepPaper(w, s, [quote(price, T + n * 60000)], T + n * 60000, risk);
describe("percentage dip intent", () => {
  it.each(["هر بار نیت ۳۰ درصد میریزه برام نیت بخر", "هر بار قیمت نیت ۳۰ درصد افت کرد، ۱۰۰ دلار نیت بخر", "Buy NEET whenever it drops by 30%", "every time NEET falls 30 percent buy 100 dollars of NEET"])("understands %s without inventing a price or amount", (text) => {
    const w = Workflow.parse(drawdownDraft(text)); expect(w.assets[0].query).toBe("NEET"); expect(w.stages[0].when).toMatchObject({ op: "gte", right: { lit: 30 } }); expect(w.signals[0].kind).toBe("drawdown"); expect(w.signals[0].drawdown?.reference).toBe("needs_choice");
    if (!text.includes("100") && !text.includes("۱۰۰")) expect(w.stages[0].amount.value).toBeNull(); expect(workflowProblems(w)).toEqual([]);
  });
  it("does not ignore suffixes or a different purchased asset", () => { expect(drawdownDraft("Buy NEET whenever it drops 30% then buy NVDA")).toBeNull(); expect(drawdownDraft("every time NEET drops 30% buy $100 of NVDA")).toBeNull(); });
  it("requires reference, amount and budget before running", () => { const w = Workflow.parse(drawdownDraft("Buy NEET whenever it drops 30%")); expect(paperProblems(w).join(" ")).toMatch(/reference/); expect(() => createPaper(w)).toThrow(); });
});
describe("paper workflow accounting and triggers", () => {
  it("buys once per successive 30% decline, not every unchanged quote; checkpoint restore does not duplicate", () => {
    const w = drop(); let s = createPaper(w, T); s = tick(w, s, 100, 0); s = tick(w, s, 70, 1); expect(s.stages.buy.fills).toBe(1);
    s = tick(w, JSON.parse(JSON.stringify(s)), 70, 2); expect(s.stages.buy.fills).toBe(1); s = tick(w, s, 49, 3); expect(s.stages.buy.fills).toBe(2); expect(s.fees).toBeCloseTo(.2); expect(s.principal).toBeCloseTo(799.8);
  });
  it("stops when a full next order plus its fee does not fit", () => { const w = drop(); w.budgetUsd = 200; let s = createPaper(w, T); s = tick(w, s, 100, 0); s = tick(w, s, 70, 1); s = tick(w, s, 49, 2); expect(s.stages.buy.fills).toBe(1); expect(s.stages.buy.status).toContain("Budget"); expect(s.principal).toBeCloseTo(99.9); });
  it("honors the one-minute repeat interval and rechecks the price", () => {
    const w = Workflow.parse(recurringDraft("if neet price fall below 0.003 buy 100$ of neet every 1 minutes untill you out of budget")); w.budgetUsd = 1000; w.stages[0].repeat!.conditionMode = "each_time";
    let s = createPaper(w, T); s = tick(w, s, .002, 0); s = stepPaper(w, s, [quote(.002, T + 30000)], T + 30000, risk); expect(s.stages.buy.fills).toBe(1); s = tick(w, s, .002, 1); expect(s.stages.buy.fills).toBe(2); s = tick(w, s, .004, 2); expect(s.stages.buy.fills).toBe(2);
  });
  it("does not trade on stale data or NOT unknown", () => {
    const w = drop(); w.stages[0].when = { op: "not", arg: { op: "gt", left: { ref: "drop.value" }, right: { lit: 30 } } };
    let s = createPaper(w, T); s = stepPaper(w, s, [], T, risk); expect(s.events).toHaveLength(0); s = stepPaper(w, s, [quote(100, T - 180000)], T + 1, risk); expect(s.events).toHaveLength(0);
  });
  it("a take-profit ladder closes original thirds only once and conserves equity net of fees", () => {
    const w = drop(); w.signals = []; const st = w.stages[0]; st.when = null; st.repeat = null; st.exits.ladder = [10,20,35].map((atPct) => ({ atPct, fraction: 1/3 }));
    let s = createPaper(w, T); s = tick(w, s, 100, 0); s = tick(w, s, 111, 1); const qty = s.positions.buy.qty; s = tick(w, JSON.parse(JSON.stringify(s)), 111, 2); expect(s.positions.buy.qty).toBeCloseTo(qty); s = tick(w, s, 121, 3); s = tick(w, s, 136, 4);
    expect(s.positions.buy).toBeUndefined(); expect(s.events.filter((e) => e.kind === "exit")).toHaveLength(3); expect(paperEquity(s)).toBeCloseTo(1000 + s.realized, 7); expect(s.realized).toBeGreaterThan(0);
  });
  it("profits unlock only after a close and cannot be spent twice by parallel stages", () => {
    const w = drop(); w.signals = []; const a = w.stages[0]; a.when = null; a.repeat = null; a.exits.takeProfitPct = 10;
    w.stages.push(...["second", "third"].map((id) => ({ ...structuredClone(a), id, amount: { unit: "usd" as const, value: 8 }, exits: { ...a.exits, takeProfitPct: null }, after: [{ stageId: "buy", event: "realized_profit" as const }], funding: { kind: "profits" as const, from: ["buy"] } })));
    let s = createPaper(w, T); s = tick(w, s, 100, 0); expect(s.stages.second.fills).toBe(0); s = tick(w, s, 105, 1); expect(s.stages.second.fills).toBe(0); s = tick(w, s, 111, 2); expect(s.stages.second.fills).toBe(1); expect(s.stages.third.fills).toBe(0); expect(s.pools.buy).toBeGreaterThanOrEqual(0); expect(paperEquity(s)).toBeCloseTo(1000 + s.realized - .008, 7);
  });
  it("a profitable outcome settlement unlocks its successor, while an unrealized midpoint does not", () => {
    const w = drop(); w.signals = []; w.assets[0].kind = "outcome"; const a = w.stages[0]; a.when = null; a.repeat = null;
    w.assets.push({ ...w.assets[0], id: "second_asset", query: "NVDA", kind: "token" }); w.stages.push({ ...structuredClone(a), id: "next", assetId: "second_asset", amount: { unit: "usd", value: 50 }, after: [{ stageId: "buy", event: "resolved_profit" }], funding: { kind: "profits", from: ["buy"] } });
    let s = createPaper(w, T); s = stepPaper(w, s, [quote(.5,T),quote(100,T,"second_asset")],T,risk); s = stepPaper(w,s,[quote(.9,T+60000),quote(100,T+60000,"second_asset")],T+60000,risk); expect(s.stages.next.fills).toBe(0);
    s=stepPaper(w,s,[{...quote(1,T+120000),settled:true,payout:1},quote(100,T+120000,"second_asset")],T+120000,risk); expect(s.stages.next.fills).toBe(1); expect(s.stages.buy.resolved).toBe(true);
  });
  it("enforces risk before debiting cash", () => { const w = drop(); w.signals=[];w.stages[0].when=null;w.stages[0].repeat=null; let s=createPaper(w,T);s=stepPaper(w,s,[quote(100,T)],T,Risk.parse({maxPositionPct:1}));expect(s.events).toHaveLength(0);expect(s.principal).toBe(1000); });
});
describe("selected market quote connections", () => {
  const asset=()=>{ const a=drop().assets[0];a.resolution={status:"matched",selectedId:"sol:token:So11111111111111111111111111111111111111112",checkedAt:new Date(T).toISOString(),message:"ok",candidates:[{id:"sol:token:So11111111111111111111111111111111111111112",address:"So11111111111111111111111111111111111111112",symbol:"NEET",name:"NEET",venue:"solana",kind:"token",source:"dexscreener",url:null,maxLeverage:1,endDate:null,outcome:null}]};return a;};
  it("requires an exact selected mint and does not quote another base token",async()=>{const a=asset();let url="";const get=async(u:string)=>{url=u;return[{chainId:"solana",baseToken:{address:"wrong"},priceUsd:"99",liquidity:{usd:99999}},{chainId:"solana",baseToken:{address:a.resolution!.candidates[0].address},priceUsd:".003",liquidity:{usd:10}}];};const r=await quoteAsset(a,get);expect(r.quote?.price).toBe(.003);expect(url).toContain(a.resolution!.candidates[0].address);});
  it("never falls back to synthetic data on failure",async()=>{const r=await quoteAsset(asset(),async()=>{throw new Error("offline");});expect(r.quote).toBeNull();expect(r.message).toContain("No synthetic");});
});
