import { afterAll, describe, expect, it } from "vitest";
import * as A from "../../contracts/src/api";
import * as X from "../../contracts/src/ext";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { btcStrategy, T0 } from "../helpers";

const clock = new ManualClock(T0);
const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
afterAll(() => q.runs.shutdown());
const tokens: Record<string, string> = {};
const call = async (who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await q.app.request("/v1" + path, { method, headers: { "content-type": "application/json", ...(tokens[who] ? { authorization: `Bearer ${tokens[who]}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text(); let json: any; try { json = JSON.parse(t); } catch { json = t; } return { status: res.status, json };
};
const login = async (who: string) => { const r = await call(who, "POST", "/auth/exchange", { provider: "privy", idToken: `dev:${who}-extension-tests` }); tokens[who] = r.json.accessToken; };

describe("v1.1 contract extensions (mock)", () => {
  let mine = "";
  it("login two users", async () => { await login("ana"); await login("ben"); expect(tokens.ana && tokens.ben).toBeTruthy(); });

  it("markets carry a 24-point sparkline", async () => {
    const r = await call("ana", "GET", "/markets?limit=50"); expect(r.status).toBe(200);
    for (const m of r.json.items) { A.Market.parse(m); expect(m.spark.length).toBe(24); expect(Math.abs(m.spark.at(-1) / Number(m.price) - 1)).toBeLessThan(1e-5); }
  });

  it("strategy records carry titled nodes", async () => {
    const r = await call("ana", "POST", "/strategies", { strategy: btcStrategy() }); expect(r.status).toBe(201);
    A.StrategyRecord.parse(r.json); mine = r.json.id;
    expect(r.json.nodes.map((n: any) => n.kind)).toEqual(["watch", "when", "do", "exit"]);
    expect(r.json.nodes[2]).toMatchObject({ id: "a1", venue: "hyperliquid" }); expect(r.json.nodes[2].title).toMatch(/BTC/);
    expect(r.json.public).toBe(false); expect(r.json.forkedFrom).toBeNull();
  });

  it("paper run equity series: timestamped equity, pnl, drawdown", async () => {
    const s = await call("ana", "POST", "/runs", { strategyId: mine, mode: "paper", startingEquityUsd: "10000" }); expect(s.status).toBe(201);
    for (let i = 0; i < 5; i++) { clock.advance(60_000); await q.runs.tick(s.json.id); }
    const r = await call("ana", "GET", `/runs/${s.json.id}/equity?points=3`); expect(r.status).toBe(200);
    const e = X.EquitySeries.parse(r.json); expect(e.points.length).toBe(3); expect(e.synthetic).toBe(true);
    expect([e.points[0].equityUsd, e.points[0].pnlUsd, e.points[0].drawdownPct].map(Number)).toEqual([10000, 0, 0]);
    expect(Date.parse(e.points[2].ts)).toBeGreaterThan(Date.parse(e.points[0].ts));
    expect((await call("ben", "GET", `/runs/${s.json.id}/equity`)).status).toBe(404);
    await call("ana", "POST", `/runs/${s.json.id}/control`, { action: "stop" });
  });

  it("backtest result has equitySeries with consistent drawdown", async () => {
    const r = await call("ana", "POST", "/backtests", { strategy: btcStrategy(), from: "2026-10-20T00:00:00Z", to: "2026-10-27T00:00:00Z", resolution: "1h", startingEquityUsd: "10000" });
    expect(r.status).toBe(202);
    let b: any; for (let i = 0; i < 50; i++) { b = (await call("ana", "GET", `/backtests/${r.json.id}`)).json; if (b.status === "done") break; await new Promise((x) => setTimeout(x, 20)); }
    const res = A.BacktestRes.parse(b); expect(res.result!.equitySeries.length).toBe(res.result!.equityCurve.length);
    let peak = 10000; for (const p of res.result!.equitySeries) { const e = Number(p.equityUsd); peak = Math.max(peak, e); expect(Number(p.drawdownPct)).toBeCloseTo(((peak - e) / peak) * 100, 1); expect(Number(p.pnlUsd)).toBeCloseTo(e - 10000, 1); }
  });

  it("public strategies list/detail are mock-labelled; fork copies into my strategies", async () => {
    const l = await call("ana", "GET", "/public/strategies"); expect(l.status).toBe(200); X.PublicStrategiesRes.parse(l.json);
    expect(l.json.items.length).toBe(3); expect(l.json.items.every((x: any) => x.mock && x.author.handle.startsWith("@demo_"))).toBe(true);
    const id = l.json.items[0].id;
    const d = await call("ana", "GET", `/public/strategies/${id}`); X.PublicStrategyDetail.parse(d.json); expect(d.json.nodes.length).toBeGreaterThan(2);
    const f = await call("ana", "POST", `/public/strategies/${id}/fork`, {}, { "idempotency-key": "fork-1" }); expect(f.status).toBe(201);
    expect(f.json.forkedFrom).toBe(id); expect(f.json.ownerId).not.toBe(d.json.author.handle);
    const again = await call("ana", "POST", `/public/strategies/${id}/fork`, {}, { "idempotency-key": "fork-1" }); expect(again.json.id).toBe(f.json.id);
    expect((await call("ana", "GET", `/public/strategies/${id}`)).json.forks).toBe(1);
    expect((await call("ana", "GET", "/public/strategies/stg_nope")).status).toBe(404);
  });

  it("publish → visible to others, fork counts, revenue rows stay zero", async () => {
    const p = await call("ana", "POST", `/strategies/${mine}/publish`, { public: true }); expect(p.json.public).toBe(true);
    const l = await call("ben", "GET", "/public/strategies?sort=new"); expect(l.json.items[0]).toMatchObject({ id: mine, author: { handle: "@ana-extension-tests", isYou: false } });
    expect((await call("ben", "POST", `/public/strategies/${mine}/fork`)).status).toBe(201);
    const rev = X.RevenueRes.parse((await call("ana", "GET", "/revenue")).json);
    expect(rev).toMatchObject({ mock: true, forks: 1, creatorSharePct: null, claimEnabled: false });
    expect(Number(rev.earnedUsd) + Number(rev.claimableUsd) + Number(rev.rows[0].earnedUsd)).toBe(0); expect(rev.rows[0]).toMatchObject({ strategyId: mine, forks: 1 }); expect(rev.notice).toMatch(/Example data/);
    expect((await call("ben", "POST", `/strategies/${mine}/publish`, { public: false })).status).toBe(404);
  });

  it("rewards: complete EXAMPLE data (no nulls), labelled mock, quests reflect activity", async () => {
    const raw = (await call("ana", "GET", "/rewards")).json; const r = X.RewardsRes.parse(raw);
    expect(JSON.stringify(raw)).not.toMatch(/null/); expect(r.example).toBe(true); expect(r.mock).toBe(true);
    expect(r.points).toBeGreaterThan(0); expect(r.rank).toBeGreaterThan(0); expect(r.season.name).toMatch(/example/i); expect(r.history.length).toBeGreaterThan(0); expect(r.notice).toMatch(/No rewards program is live/);
    expect(Object.fromEntries(r.quests.map((x) => [x.id, x.done]))).toEqual({ draft: true, paper24h: false, publish: true, forked: true });
  });

  it("traders leaderboard: paper basis, ranked, includes you", async () => {
    for (const w of ["7d", "30d", "all"]) {
      const r = X.LeaderboardRes.parse((await call("ben", "GET", `/traders?window=${w}`)).json);
      expect(r.basis).toBe("paper"); expect(r.mock).toBe(true); expect(r.items.map((x) => x.rank)).toEqual(r.items.map((_, i) => i + 1));
      const vals = r.items.map((x) => (x.paperReturnPct == null ? -Infinity : Number(x.paperReturnPct))); expect([...vals].sort((a, b) => b - a)).toEqual(vals);
      expect(r.items.filter((x) => x.isYou).length).toBe(1);
    }
    expect((await call("ben", "GET", "/traders?window=1y")).status).toBe(422);
  });

  it("skills match web SKILLS fields plus prompt", async () => {
    const r = X.SkillsRes.parse((await call("ana", "GET", "/skills")).json);
    expect(r.items.map((s) => s.id)).toEqual(["dip", "funding", "odds", "ladder", "dca"]);
  });
});
