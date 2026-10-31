import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/index";
import { demoCompile } from "../../src/compile/demo";
import { Strategy } from "../../contracts/src/strategy";
import { CompileEvent } from "../../contracts/src/events";
import { hasErrors, validateStrategy } from "../../src/engine/validate";
import { env } from "../helpers";
const { registry } = env();
const collect = async (g: AsyncGenerator<any>) => { const o: any[] = []; for await (const e of g) o.push(e); return o; };
const ok = (t: string) => { const r = demoCompile(t, registry); if (!r.ok) throw new Error(`unsupported: ${t}: ${r.message}`); Strategy.parse(r.strategy); const v = validateStrategy(r.strategy, { registry, stockTokensAllowed: true }); expect(hasErrors(v.issues), JSON.stringify(v.issues)).toBe(false); return r.strategy as any; };
const cond = (s: any) => s.triggers[0].when;
const conds = (s: any) => (cond(s).op === "and" ? cond(s).args : [cond(s)]);

describe("M3.1 demo compiler (deterministic, no AI)", () => {
  it("price below/above $X on NVDA/AAPL", () => {
    const a = ok("Buy $300 of NVDA if it drops below $120"); expect(a.actions[0].instrument).toMatch(/a1$/); expect(cond(a)).toMatchObject({ op: "lt", right: { lit: 120 } }); expect(a.actions[0].size).toEqual({ unit: "usd", value: "300" });
    const b = ok("buy apple when it goes over $250"); expect(b.actions[0].instrument).toMatch(/a2$/); expect(cond(b)).toMatchObject({ op: "gt", right: { lit: 250 } });
    const c = ok("Long BTC when it breaks above 100k"); expect(cond(c)).toMatchObject({ op: "gt", right: { lit: 100000 } });
  });
  it("% move with window", () => {
    const s = ok("Buy BTC when it falls 5% in a day, take profit 10%");
    const sig = s.signals.find((x: any) => x.kind === "indicator"); expect(sig.params).toMatchObject({ name: "pct_change", period: 24, timeframe: "1h" });
    expect(cond(s)).toMatchObject({ op: "lt", right: { lit: -5 } }); expect(s.actions[0].exits.takeProfit).toEqual({ unit: "pct", value: "10" });
    expect(cond(ok("buy tesla if it jumps 3% in an hour"))).toMatchObject({ op: "gt", right: { lit: 3 } });
  });
  it("crossovers: price vs N-day EMA, golden cross", () => {
    const s = ok("Buy ETH when it crosses above its 20-day EMA"); expect(cond(s).op).toBe("crosses_above"); expect(s.signals.some((x: any) => x.params?.name === "ema" && x.params.period === 20)).toBe(true);
    expect(s.actions[0].instrument).toBe("hl:perp:ETH");
    const g = ok("golden cross on AAPL, buy $1k"); expect(cond(g)).toMatchObject({ op: "crosses_above" }); expect(g.actions[0].size.value).toBe("1000");
    expect(cond(ok("NVDA under its 50-day average, buy"))).toMatchObject({ op: "lt" });
  });
  it("RSI", () => { expect(cond(ok("Buy TSLA when RSI is below 30, trailing stop 7%"))).toMatchObject({ op: "lt", right: { lit: 30 } }); expect(ok("buy SOL when oversold").signals.some((x: any) => x.params?.name === "rsi")).toBe(true); });
  it("time-based / DCA: cron timer, unlimited fires", () => {
    const s = ok("Buy $100 of ETH every Monday at 9am"); const t = s.signals.find((x: any) => x.kind === "timer");
    expect(t.params).toEqual({ cron: "0 9 * * 1", tz: "UTC" }); expect(s.triggers[0].maxFires).toBeNull();
    expect(ok("DCA $50 into NVDA every day at 10:30").signals.find((x: any) => x.kind === "timer").params).toEqual({ cron: "30 10 * * 1-5", tz: "America/New_York" });
    expect(ok("buy $20 of bitcoin every hour").signals.find((x: any) => x.kind === "timer").params.cron).toBe("0 * * * *");
  });
  it("exits: TP / SL / trailing / time exit; perps: short + leverage; % of portfolio", () => {
    const s = ok("Short BTC 3x if it rises 4% in a day, stop loss 2%, take profit 6%, exit after 2 days");
    expect(s.actions[0]).toMatchObject({ side: "short", leverage: 3 }); expect(s.actions[0].exits).toMatchObject({ stopLoss: { value: "2" }, takeProfit: { value: "6" }, timeExitHours: 48 });
    expect(conds(s)[0]).toMatchObject({ op: "gt", right: { lit: 4 } }); // the 2%/6% exits are not misread as moves
    expect(ok("Put 10% of my portfolio in NVDA if it drops 3%").actions[0].size).toEqual({ unit: "pct_equity", value: "10" });
  });
  it("Fed odds + SMA combo (the reference demo prompt)", () => {
    const s = ok("If Fed cut odds go over 70% and NVDA is under its 50-day average, buy $200 of NVDA");
    expect(conds(s).map((x: any) => x.op).sort()).toEqual(["gt", "lt"]); expect(s.signals.some((x: any) => x.kind === "odds")).toBe(true);
  });
  it("symbol + verb but no condition → immediate buy with a warning", () => { const r = demoCompile("buy NVDA", registry); expect(r.ok && r.warnings.join(" ")).toMatch(/right away/); });
  it("unsupported prompts return suggestions", () => {
    for (const t of ["hello", "make me rich", "what do you think about the economy", "short NVDA below $100", "NVDA"]) { const r = demoCompile(t, registry); expect(r.ok, t).toBe(false); if (!r.ok) expect(r.suggestions.length).toBeGreaterThan(2); }
  });
  it("is deterministic and fast (<200ms end-to-end, whole stream)", async () => {
    const t = "Buy $250 of NVDA if it drops below $120, stop loss 8%, take profit 15%";
    expect(JSON.stringify(ok(t))).toBe(JSON.stringify(ok(t)));
    const t0 = performance.now(); const ev = await collect(compile({ thesis: t }, { registry, stockTokensAllowed: true })); const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200); for (const e of ev) CompileEvent.parse(e);
    const r = ev.at(-1); expect(r).toMatchObject({ type: "result", compiler: "demo" }); expect(r.notice).toMatch(/Demo compile/);
  });
});

describe("M3.1 LLM path never hangs", () => {
  const budget = { spentToday: () => 0, add: () => {}, capUsd: 5 };
  const thesis = "Buy BTC when it falls 5% in a day";
  it("times out per call without inventing a fallback", async () => {
    const hang = (o: { signal?: AbortSignal }) => new Promise<never>((_, rej) => o.signal!.addEventListener("abort", () => rej(o.signal!.reason)));
    const t0 = Date.now(); const ev = await collect(compile({ thesis }, { registry, stockTokensAllowed: true, openrouter: { apiKey: "test", model: "x", budget, callTimeoutMs: 100, totalBudgetMs: 400, call: hang as any } }));
    expect(Date.now() - t0).toBeLessThan(1500); const r = ev.at(-1); expect(r).toMatchObject({ type: "error", code: "ai_draft_unavailable" });
  });
  it("network error → explicit failure", async () => {
    const ev = await collect(compile({ thesis }, { registry, stockTokensAllowed: true, openrouter: { apiKey: "test", model: "x", budget, call: (async () => { throw new TypeError("fetch failed"); }) as any } }));
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "ai_draft_unavailable" });
  });
  it("invalid AI output after repairs → explicit failure", async () => {
    let n = 0; const bad = async () => { n++; return { json: { nope: true }, inputTokens: 1, outputTokens: 1, costUsd: 0 }; };
    const ev = await collect(compile({ thesis }, { registry, stockTokensAllowed: true, openrouter: { apiKey: "test", model: "x", budget, call: bad as any } }));
    expect(n).toBe(3); expect(ev.at(-1)).toMatchObject({ type: "error", code: "ai_draft_unavailable" });
  });
  it("valid AI output → compiler ai", async () => {
    const good = async () => ({ json: demoCompile(thesis, registry).ok ? (demoCompile(thesis, registry) as any).strategy : null, inputTokens: 1, outputTokens: 1, costUsd: 0.001 });
    const ev = await collect(compile({ thesis }, { registry, stockTokensAllowed: true, openrouter: { apiKey: "test", model: "x", budget, call: good as any } }));
    expect(ev.at(-1)).toMatchObject({ type: "result", compiler: "ai", notice: null });
  });
});
