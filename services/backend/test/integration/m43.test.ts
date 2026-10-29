// M4.3 portfolio views across runs: per-run P&L + totals, allocation, combined history.
import { describe, expect, it } from "vitest";
import { PortfolioAllocation, PortfolioHistory, PortfolioRuns } from "../../contracts/src/api";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup() {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  const login = async (w = "m43-portfolio-user-1") => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${w}` })).j.accessToken; };
  await login();
  const pubs = (await call("GET", "/public/strategies")).j; const marco = pubs.items.find((x: any) => x.author.handle === "@demo_marco");
  const f1 = (await call("POST", `/public/strategies/${marco.id}/fork`)).j; const r1 = (await call("POST", "/runs", { strategyId: f1.id, mode: "paper" })).j;
  const f2 = (await call("POST", `/public/strategies/${marco.id}/fork`)).j; const r2 = (await call("POST", "/runs", { strategyId: f2.id, mode: "paper", paper: { startingEquityUsd: "5000" } })).j;
  for (let i = 0; i < 20; i++) { clock.advance(60_000); await q.runs.tick(r1.id); await q.runs.tick(r2.id); }
  await login(); await call("POST", `/runs/${r2.id}/control`, { action: "stop" }); clock.advance(60_000); await q.runs.tick(r1.id); await login();
  return { q, call, login, r1, r2 };
}

describe("M4.3 portfolio views", () => {
  it("runs: per-run rows (stopped included) and totals that add up", async () => {
    const s = await setup(); const p = PortfolioRuns.parse((await s.call("GET", "/portfolio/runs")).j);
    expect(p.items.map((x) => x.runId)).toEqual([s.r1.id, s.r2.id]); expect(p.items[1]!.status).toBe("stopped");
    const sum = (k: "equityUsd" | "pnlUsd" | "realizedPnlUsd" | "feesUsd") => p.items.reduce((a, x) => a + Number(x[k]), 0);
    for (const k of ["equityUsd", "pnlUsd", "realizedPnlUsd", "feesUsd"] as const) expect(Number(p.totals[k])).toBeCloseTo(sum(k), 1);
    expect(p.totals.startingEquityUsd).toBe("15000"); expect(p.totals.fills).toBeGreaterThan(0);
    for (const x of p.items) expect(Number(x.pnlUsd)).toBeCloseTo(Number(x.equityUsd) - Number(x.startingEquityUsd), 1);
    expect(PortfolioRuns.parse((await s.call("GET", "/portfolio/runs?status=stopped")).j).items.map((x) => x.runId)).toEqual([s.r2.id]);
    expect((await s.call("GET", "/portfolio/runs?status=nope")).status).toBe(422);
  });
  it("allocation: weights sum to 100, gross = long + short, sorted", async () => {
    const s = await setup();
    for (const by of ["venue", "asset_class", "instrument"]) {
      const a = PortfolioAllocation.parse((await s.call("GET", `/portfolio/allocation?by=${by}`)).j); expect(a.items.length).toBeGreaterThan(0);
      expect(a.items.reduce((t, x) => t + Number(x.weightPct), 0)).toBeCloseTo(100, 0);
      expect(Number(a.grossExposureUsd)).toBeCloseTo(a.items.reduce((t, x) => t + Number(x.grossUsd), 0), 1);
      for (let i = 1; i < a.items.length; i++) expect(Number(a.items[i - 1]!.grossUsd)).toBeGreaterThanOrEqual(Number(a.items[i]!.grossUsd));
    }
    expect((await s.call("GET", "/portfolio/allocation?by=color")).status).toBe(422);
  });
  it("history: combined, monotone ts, thinned; other users see nothing", async () => {
    const s = await setup(); const h = PortfolioHistory.parse((await s.call("GET", "/portfolio/history?points=10")).j);
    expect(h.points.length).toBe(10); for (let i = 1; i < h.points.length; i++) expect(Date.parse(h.points[i]!.ts)).toBeGreaterThan(Date.parse(h.points[i - 1]!.ts));
    expect(h.points.at(-1)!.activeRuns).toBe(1);
    await s.login("m43-someone-else-user"); expect(PortfolioRuns.parse((await s.call("GET", "/portfolio/runs")).j).items).toEqual([]);
    expect(PortfolioHistory.parse((await s.call("GET", "/portfolio/history")).j).points).toEqual([]);
  });
});
