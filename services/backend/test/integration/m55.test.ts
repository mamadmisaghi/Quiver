// M5.5 profiles, follow, paper copy-trading.
import { describe, expect, it } from "vitest";
import { CopyListRes, CopyView, FollowRes, Profile } from "../../contracts/src/social";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup() {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const call = async (who: string, m: string, p: string, b?: unknown) => {
    toks[who] ??= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m55-${who}-user-label-xx` }) })).json() as any).accessToken;
    const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who]}` }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any };
  };
  // ana forks a seed, publishes it -> she has a profile with one public strategy
  const seed = (await call("ana", "GET", "/public/strategies")).j.items[0];
  const mine = (await call("ana", "POST", `/public/strategies/${seed.id}/fork`)).j; await call("ana", "POST", `/strategies/${mine.id}/publish`, { public: true });
  const ana = "@m55-ana-user-label-xx"; const enc = encodeURIComponent(ana);
  return { q, call, mine, ana, enc, seed };
}

describe("M5.5 profiles + follow", () => {
  it("profile view, edit own profile (sanitized), follow/unfollow counts, can't follow self or unknown", async () => {
    const s = await setup();
    const up = await s.call("ana", "PUT", "/me/profile", { displayName: "Ana\u0007 ", bio: "Momentum on SOL." }); expect(up.status).toBe(200); expect(up.j).toMatchObject({ displayName: "Ana", bio: "Momentum on SOL.", isYou: true });
    expect((await s.call("ana", "PUT", "/me/profile", { bio: "x".repeat(281) })).status).toBe(422);
    const p = Profile.parse((await s.call("ben", "GET", `/profiles/${s.enc}`)).j); expect(p).toMatchObject({ handle: s.ana, isYou: false, isFollowing: false, followers: 0, demo: false }); expect(p.strategies).toHaveLength(1);
    expect(FollowRes.parse((await s.call("ben", "POST", `/profiles/${s.enc}/follow`)).j)).toEqual({ handle: s.ana, following: true, followers: 1 });
    expect((await s.call("ben", "POST", `/profiles/${s.enc}/follow`)).j.followers).toBe(1); // idempotent
    expect((await s.call("ben", "GET", "/me/following")).j.items).toEqual([{ handle: s.ana, displayName: "Ana", strategies: 1 }]);
    expect((await s.call("ana", "GET", `/profiles/${s.enc}`)).j).toMatchObject({ isYou: true, followers: 1 });
    expect((await s.call("ana", "POST", `/profiles/${s.enc}/follow`)).status).toBe(422);
    expect((await s.call("ben", "GET", `/profiles/${encodeURIComponent("@nobody_here")}`)).status).toBe(404);
    expect((await s.call("ben", "GET", `/profiles/${encodeURIComponent(s.seed.author.handle)}`)).j.demo).toBe(true);
    expect((await s.call("ben", "DELETE", `/profiles/${s.enc}/follow`)).j).toEqual({ handle: s.ana, following: false, followers: 0 });
  });
});
describe("M5.5 copy-trading (paper only)", () => {
  it("requires follow; starts a paper run; duplicate 409; non-paper 403; sync pulls the source's new version into the live run", async () => {
    const s = await setup(); const req = { publicStrategyId: s.mine.id };
    expect((await s.call("ben", "POST", "/copy", req)).status).toBe(403); // not following
    await s.call("ben", "POST", `/profiles/${s.enc}/follow`);
    expect((await s.call("ben", "POST", "/copy", { ...req, mode: "live" })).status).toBe(403);
    const r = await s.call("ben", "POST", "/copy", req); expect(r.status).toBe(201);
    const v = CopyView.parse(r.j); expect(v).toMatchObject({ sourceHandle: s.ana, sourceVersion: 1, latestSourceVersion: 1, behind: false, mode: "paper" }); expect(v.runId).not.toBeNull();
    expect(s.q.store.runs.get(v.runId!)!.mode).toBe("paper");
    expect((await s.call("ben", "POST", "/copy", req)).status).toBe(409);
    expect((await s.call("ana", "POST", "/copy", req)).status).toBe(422); // own strategy
    const cur = (await s.call("ana", "GET", `/strategies/${s.mine.id}`)).j; const st = cur.strategy ?? cur.versions?.at(-1)?.strategy;
    expect((await s.call("ana", "PUT", `/strategies/${s.mine.id}`, { expectedVersion: 1, strategy: { ...st, name: "Ana v2" } })).status).toBe(200);
    expect(CopyListRes.parse((await s.call("ben", "GET", "/copy")).j).items[0]).toMatchObject({ behind: true, latestSourceVersion: 2 });
    const sy = CopyView.parse((await s.call("ben", "POST", `/copy/${v.strategyId}/sync`)).j); expect(sy).toMatchObject({ behind: false, sourceVersion: 2 });
    expect(s.q.store.runs.get(v.runId!)!.strategyVersion).toBe(2);
    expect((await s.call("ana", "POST", `/copy/${v.strategyId}/sync`)).status).toBe(404);
  });
});
