// M5.12 activity feed: followed traders' public activity + your own runs/copies; cursor pagination; no private ids leak.
import { describe, expect, it } from "vitest";
import { ActivityRes } from "../../contracts/src/social";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup() {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const call = async (who: string, m: string, p: string, b?: unknown) => {
    toks[who] ??= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m512-${who}-user-label-xx` }) })).json() as any).accessToken;
    const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who]}` }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any };
  };
  const seed = (await call("ana", "GET", "/public/strategies")).j.items[0];
  const pub = (await call("ana", "POST", `/public/strategies/${seed.id}/fork`)).j; await call("ana", "POST", `/strategies/${pub.id}/publish`, { public: true });
  const priv = (await call("ana", "POST", `/public/strategies/${seed.id}/fork`)).j; // ana's private strategy
  const anaRun = (await call("ana", "POST", "/runs", { strategyId: priv.id, mode: "paper" })).j;
  const ana = (await call("ana", "GET", "/me/profile")).j.handle as string;
  return { clock, call, seed, pub, priv, anaRun, ana, enc: encodeURIComponent(ana) };
}
const feed = async (s: any, who: string, qs = "") => { const r = await s.call(who, "GET", "/activity" + qs); expect(r.status).toBe(200); return ActivityRes.parse(r.j); };

describe("M5.12 activity feed", () => {
  it("empty for a new user; shows followed trader's publish + update; own runs and copies; scopes", async () => {
    const s = await setup();
    expect((await feed(s, "ben")).items).toEqual([]);
    await s.call("ben", "POST", `/profiles/${s.enc}/follow`);
    s.clock.advance(60_000);
    const cur = (await s.call("ana", "GET", `/strategies/${s.pub.id}`)).j;
    expect((await s.call("ana", "PUT", `/strategies/${s.pub.id}`, { strategy: { ...cur.strategy, name: "Ana v2" }, expectedVersion: cur.version })).status).toBe(200);
    s.clock.advance(60_000);
    const cp = await s.call("ben", "POST", "/copy", { publicStrategyId: s.pub.id }); expect(cp.status).toBe(201);
    const f = await feed(s, "ben");
    expect(f.items.map((x) => x.kind)).toEqual(["run_started", "copy_started", "strategy_updated", "strategy_published"]);
    expect(f.items[2]).toMatchObject({ actor: { handle: s.ana, isYou: false }, strategy: { publicStrategyId: s.pub.id, name: "Ana v2", version: cur.version + 1 }, run: null });
    expect(f.items[0].run?.runId).toBe(cp.j.runId);
    expect((await feed(s, "ben", "?scope=following")).items.map((x) => x.kind)).toEqual(["strategy_updated", "strategy_published"]);
    expect((await feed(s, "ben", "?scope=mine")).items.every((x) => x.actor.isYou)).toBe(true);
    // unfollow -> copy_detached + run_stopped appear; ana's activity disappears
    s.clock.advance(60_000); await s.call("ben", "DELETE", `/profiles/${s.enc}/follow`);
    const g = await feed(s, "ben"); expect(g.items.map((x) => x.kind)).toEqual(expect.arrayContaining(["copy_detached", "run_stopped"]));
    expect(g.items.some((x) => x.kind.startsWith("strategy_"))).toBe(false);
  });
  it("never leaks another user's private ids or runs", async () => {
    const s = await setup(); await s.call("ben", "POST", `/profiles/${s.enc}/follow`);
    const raw = JSON.stringify((await s.call("ben", "GET", "/activity")).j);
    expect(raw).not.toContain(s.priv.id); expect(raw).not.toContain(s.anaRun.id); expect(raw).not.toMatch(/usr_|ownerId|userId|dev:/);
    const own = await feed(s, "ana"); expect(own.items.map((x) => x.kind)).toEqual(["run_started"]); expect(own.items[0].strategy.publicStrategyId).toBeNull();
    // following an unpublished-only demo seed handle shows its publish, never someone's run
    await s.call("ben", "POST", `/profiles/${encodeURIComponent(s.seed.author.handle)}/follow`);
    expect((await feed(s, "ben")).items.every((x) => x.run === null)).toBe(true);
  });
  it("cursor pagination is stable and complete; bad input handled", async () => {
    const s = await setup();
    for (let i = 0; i < 5; i++) { s.clock.advance(61_000); const f = (await s.call("ana", "POST", `/public/strategies/${s.seed.id}/fork`)).j; const r = await s.call("ana", "POST", "/runs", { strategyId: f.id, mode: "paper" }); expect(r.status).toBe(201); await s.call("ana", "POST", `/runs/${r.j.id}/control`, { action: "stop" }); }
    const all = (await feed(s, "ana", "?limit=50")).items; expect(all.length).toBe(11);
    const seen: string[] = []; let c: string | null = null;
    do { const p = await feed(s, "ana", `?limit=2${c ? `&cursor=${c}` : ""}`); seen.push(...p.items.map((x) => x.id)); c = p.nextCursor; } while (c);
    expect(seen).toEqual(all.map((x) => x.id)); expect(new Set(seen).size).toBe(11);
    expect((await feed(s, "ana", "?cursor=garbage")).items).toEqual([]);
    expect((await s.call("ana", "GET", "/activity?limit=500")).status).toBe(422);
    expect((await s.call("ana", "GET", "/activity?scope=everyone")).status).toBe(422);
  });
});
