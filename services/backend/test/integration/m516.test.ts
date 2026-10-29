// M5.16: CORS exposes x-quiver-rpc; GET /activity?handle= shows only a trader's public activity (M5.10 limited rules).
import { describe, expect, it } from "vitest";
import { ActivityRes } from "../../contracts/src/social";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup() {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const call = async (who: string, m: string, p: string, b?: unknown, h: Record<string, string> = {}) => {
    toks[who] ??= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m516-${who}-user-label-xx` }) })).json() as any).accessToken;
    const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who]}`, ...h }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, h: r.headers, j: await r.json() as any };
  };
  return { q, clock, call };
}

describe("M5.16", () => {
  it("CORS exposes x-quiver-rpc to allowed origins (actual + preflight unaffected)", async () => {
    const s = await setup();
    const r = await s.call("ana", "GET", "/status", undefined, { origin: "http://localhost:3000" });
    expect(r.h.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect((r.h.get("access-control-expose-headers") ?? "").toLowerCase()).toContain("x-quiver-rpc");
    const bad = await s.call("ana", "GET", "/status", undefined, { origin: "https://evil.example" });
    expect(bad.h.get("access-control-allow-origin")).toBeNull();
  });
  it("?handle= shows public strategies + their paper runs only; no run ids, private strategies or copies", async () => {
    const s = await setup();
    const seed = (await s.call("ana", "GET", "/public/strategies")).j.items[0];
    const pub = (await s.call("ana", "POST", `/public/strategies/${seed.id}/fork`)).j; await s.call("ana", "POST", `/strategies/${pub.id}/publish`, { public: true });
    const priv = (await s.call("ana", "POST", `/public/strategies/${seed.id}/fork`)).j;
    s.clock.advance(60_000); const pr = (await s.call("ana", "POST", "/runs", { strategyId: pub.id, mode: "paper" })).j;
    s.clock.advance(60_000); expect((await s.call("ana", "POST", `/runs/${pr.id}/control`, { action: "stop" })).status).toBeLessThan(300);
    s.clock.advance(61_000); const xr = (await s.call("ana", "POST", "/runs", { strategyId: priv.id, mode: "paper" })).j; expect(xr.id).toBeTruthy();
    await s.call("ana", "POST", "/copy", { publicStrategyId: seed.id });
    const ana = (await s.call("ana", "GET", "/me/profile")).j.handle as string;
    const r = await s.call("ben", "GET", `/activity?handle=${encodeURIComponent(ana)}`); expect(r.status).toBe(200);
    const f = ActivityRes.parse(r.j);
    expect(f.limited).toBe(false);
    expect(f.items.map((x) => x.kind)).toEqual(["run_stopped", "run_started", "strategy_published"]);
    expect(f.items.every((x) => x.run === null && x.actor.handle === ana && !x.actor.isYou && x.strategy.publicStrategyId === pub.id)).toBe(true);
    const raw = JSON.stringify(r.j); for (const id of [pr.id, xr.id, priv.id]) expect(raw).not.toContain(id); expect(raw).not.toMatch(/usr_|did:privy/);
    const mine = ActivityRes.parse((await s.call("ana", "GET", `/activity?handle=${encodeURIComponent(ana)}`)).j); // own public view is the same, marked isYou
    expect(mine.items).toHaveLength(3); expect(mine.items[0].actor.isYou).toBe(true); expect(mine.items[0].run).toBeNull();
    const pg = ActivityRes.parse((await s.call("ben", "GET", `/activity?handle=${encodeURIComponent(ana)}&limit=2`)).j); expect(pg.items).toHaveLength(2); expect(pg.nextCursor).toBeTruthy();
    const pg2 = ActivityRes.parse((await s.call("ben", "GET", `/activity?handle=${encodeURIComponent(ana)}&limit=2&cursor=${encodeURIComponent(pg.nextCursor!)}`)).j); expect(pg2.items.map((x) => x.kind)).toEqual(["strategy_published"]);
  });
  it("limited trader (no public strategies) → empty + limited; demo handle works; unknown/bad handle → 404/422", async () => {
    const s = await setup();
    const cara = (await s.call("cara", "GET", "/me/profile")).j.handle as string;
    const seed = (await s.call("cara", "GET", "/public/strategies")).j.items[0];
    const f = (await s.call("cara", "POST", `/public/strategies/${seed.id}/fork`)).j; await s.call("cara", "POST", "/runs", { strategyId: f.id, mode: "paper" });
    const lim = ActivityRes.parse((await s.call("ben", "GET", `/activity?handle=${encodeURIComponent(cara)}`)).j);
    expect(lim).toEqual({ items: [], nextCursor: null, limited: true });
    const demo = ActivityRes.parse((await s.call("ben", "GET", `/activity?handle=${encodeURIComponent(seed.author.handle)}`)).j);
    expect(demo.limited).toBe(false); expect(demo.items.length).toBeGreaterThan(0); expect(demo.items.every((x) => x.kind === "strategy_published" || x.kind === "strategy_updated")).toBe(true);
    expect((await s.call("ben", "GET", `/activity?handle=${encodeURIComponent("@nobody_here")}`)).status).toBe(404);
    expect((await s.call("ben", "GET", `/activity?handle=nope`)).status).toBe(422);
  });
});
