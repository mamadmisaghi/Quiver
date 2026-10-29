// M4.9.2 — conservative LLM reservation + in-flight cap under concurrency; refused instructs refund the quota.
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup(w: string, env: Record<string, string> = {}) {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock, autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const login = async (who: string) => (toks[who] = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:${who}` }) })).json() as any).accessToken);
  const call = async (m: string, p: string, b?: unknown, who: string = w) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who] ?? (await login(who))}` }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, j }; };
  await login(w); return { q, call };
}
const real = globalThis.fetch; afterEach(() => { globalThis.fetch = real; });
const stubOR = (cost: number, delayMs: number) => { const o = { calls: 0, inflight: 0, maxIn: 0, bodies: [] as any[] };
  globalThis.fetch = (async (u: any, init: any) => { if (!String(u).includes("openrouter.ai")) return real(u, init);
    o.calls++; o.inflight++; o.maxIn = Math.max(o.maxIn, o.inflight); o.bodies.push(JSON.parse(init.body)); await new Promise((r) => setTimeout(r, delayMs)); o.inflight--;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { cost } }), { status: 200, headers: { "content-type": "application/json" } }); }) as any;
  return o; };
const OR = { OPENROUTER_API_KEY: "sk-or-test-placeholder", LLM_DAILY_BUDGET_USD: "1" };
const users = (p: string, n = 12) => Array.from({ length: n }, (_, i) => `m492-${p}-u${String(i).padStart(2, "0")}-aaaaaaaa`);
const TH = "buy ETH when it drops 5% in a day";

describe("M4.9.2 LLM budget under concurrency", () => {
  it("cold day, default estimate: 12 concurrent compiles at $0.40 each stay under the $1 cap", async () => {
    const s = await setup("m492-cold-user-aaaaaaaaaa", OR); const o = stubOR(0.4, 80);
    await Promise.all(users("cold").map((u) => s.call("POST", "/compile", { thesis: TH }, u)));
    expect(o.calls).toBeGreaterThan(0); expect(o.calls * 0.4).toBeLessThanOrEqual(1);
    expect(o.bodies.every((b) => b.max_tokens === 4000)).toBe(true); // output bounded per call
  });
  it("in-flight cap: never more than LLM_MAX_INFLIGHT calls at once; extra callers get the demo compiler, not an error", async () => {
    const s = await setup("m492-busy-user-aaaaaaaaaa", { ...OR, LLM_DAILY_BUDGET_USD: "50", LLM_MAX_INFLIGHT: "3" }); const o = stubOR(0.01, 80);
    const rs = await Promise.all(users("busy").map((u) => s.call("POST", "/compile", { thesis: TH }, u)));
    expect(o.maxIn).toBeLessThanOrEqual(3); expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.some((r) => /busy/.test(JSON.stringify(r.j)))).toBe(true);
  });
  it("priced worst case: reservation = max input × in price + max output × out price, so actual ≤ reserved", async () => {
    const s = await setup("m492-priced-user-aaaaaaaa", { ...OR, LLM_PRICE_IN_PER_MTOK: "20", LLM_PRICE_OUT_PER_MTOK: "80" }); const o = stubOR(0.6, 60); // priced = 0.32 + 0.32 = 0.64
    await Promise.all(users("priced").map((u) => s.call("POST", "/compile", { thesis: TH }, u)));
    expect(o.calls).toBe(1); expect(o.calls * 0.6).toBeLessThanOrEqual(1); // 0.64 + 0.64 > 1 → only one reservation fits
  });
  it("LLM_EST_CALL_USD below $0.50 is raised to the floor (an old .env never breaks boot)", () => {
    expect(loadConfig({ QUIVR_MODE: "mock", LLM_EST_CALL_USD: "0.05" }).LLM_EST_CALL_USD).toBe(0.5);
  });
});

describe("M4.9.2 refused instruct refunds the quota", () => {
  it("422 instructs do not use up compiles; valid ones do", async () => {
    const w = "m492-refund-user-aaaaaaaa"; const s = await setup(w, { LLM_USER_DAILY_COMPILES: "2" });
    const pubs = (await s.call("GET", "/public/strategies")).j.items;
    const marco = (await s.call("POST", `/public/strategies/${pubs.find((x: any) => x.author.handle === "@demo_marco").id}/fork`)).j;
    const run = (await s.call("POST", "/runs", { strategyId: marco.id, mode: "paper" })).j; const st = (await s.call("GET", `/strategies/${marco.id}`)).j;
    const ids = st.strategy.triggers.map((t: any) => t.id).join(" and ");
    for (let i = 0; i < 4; i++) {
      expect((await s.call("POST", `/runs/${run.id}/instruct`, { text: `pause rule ${ids}` })).j.error.code).toBe("strategy_invalid");
      expect((await s.call("POST", `/runs/${run.id}/instruct`, { text: "tell me a joke" })).j.error.code).toBe("unsupported_prompt");
    }
    expect((await s.call("POST", `/runs/${run.id}/instruct`, { text: "daily loss limit 4%" })).status).toBe(201);
    expect((await s.call("POST", `/runs/${run.id}/instruct`, { text: "daily loss limit 5%" })).status).toBe(201);
    expect((await s.call("POST", `/runs/${run.id}/instruct`, { text: "daily loss limit 6%" })).status).toBe(429);
  });
});
