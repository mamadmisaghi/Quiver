// M5.7 shareable video replays: frozen public snapshot, revoke, render job (stub renderer + injected renderer).
import { describe, expect, it } from "vitest";
import { PublicReplay, RenderJob, ReplayShareView } from "../../contracts/src/replayshare";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup(renderer?: any) {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0, renderer });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown, t: string | null = tok) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); const x = await r.text(); return { status: r.status, j: x ? JSON.parse(x) : null }; };
  const login = async (w = "m57-replay-user-0001") => (tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${w}` })).j.accessToken);
  await login();
  const pubs = (await call("GET", "/public/strategies")).j; const marco = pubs.items.find((x: any) => x.author.handle === "@demo_marco");
  const f = (await call("POST", `/public/strategies/${marco.id}/fork`)).j; const run = (await call("POST", "/runs", { strategyId: f.id, mode: "paper" })).j;
  for (let i = 0; i < 20; i++) { clock.advance(60_000); await q.runs.tick(run.id); }
  await login();
  return { q, call, login, run, clock };
}

describe("M5.7 shareable replays", () => {
  it("share → public frozen snapshot without ids; owner list; other users can't touch it; revoke → 404", async () => {
    const s = await setup();
    const v = ReplayShareView.parse((await s.call("POST", `/runs/${s.run.id}/replay/share`, { title: "My\u0007 run" })).j);
    expect(v.render.status).toBe("none"); expect(v.title).toBe("My run"); expect(v.frames).toBeGreaterThan(0);
    const pub = await s.call("GET", `/public/replays/${v.token}`, undefined, null); expect(pub.status).toBe(200);
    const p = PublicReplay.parse(pub.j); expect(p.digest).toBe(v.digest); expect(JSON.stringify(pub.j)).not.toContain(s.run.id); expect(JSON.stringify(pub.j)).not.toMatch(/usr_/);
    for (let i = 0; i < 5; i++) { s.clock.advance(60_000); await s.q.runs.tick(s.run.id); } // later activity doesn't change the frozen snapshot
    expect((await s.call("GET", `/public/replays/${v.token}`, undefined, null)).j.digest).toBe(v.digest);
    expect((await s.call("GET", "/me/replays")).j.items).toHaveLength(1);
    const own = await s.login(); await s.login("m57-other-user-00001");
    expect((await s.call("DELETE", `/replays/${v.token}`)).status).toBe(404);
    expect((await s.call("POST", `/replays/${v.token}/render`, {})).status).toBe(404);
    expect((await s.call("POST", `/runs/${s.run.id}/replay/share`, {})).status).toBe(404);
    expect((await s.call("DELETE", `/replays/${v.token}`, undefined, own)).status).toBe(204);
    expect((await s.call("GET", `/public/replays/${v.token}`, undefined, null)).status).toBe(404);
    expect((await s.call("GET", `/public/replays/rpl_bad`, undefined, null)).status).toBe(404);
    expect((await s.call("POST", `/runs/${s.run.id}/replay/share`, { maxFrames: 9999 }, own)).status).toBe(422);
  });
  it("render jobs: stub ends not_configured; injected renderer → done with URLs; 409 while queued; revoked can't render", async () => {
    const s = await setup();
    const v = ReplayShareView.parse((await s.call("POST", `/runs/${s.run.id}/replay/share`, { render: { aspect: "16:9", fps: 24, durationSec: 10 } })).j);
    expect(v.render).toMatchObject({ status: "queued", renderer: "stub", spec: { width: 1920, height: 1080, fps: 24, durationSec: 10, totalFrames: 240 } });
    expect((await s.call("POST", `/replays/${v.token}/render`, {})).status).toBe(409);
    await s.q.replays.processRenders();
    const after = (await s.call("GET", "/me/replays")).j.items[0].render; expect(after.status).toBe("not_configured"); expect(after.videoUrl).toBeNull();
    const again = RenderJob.parse((await s.call("POST", `/replays/${v.token}/render`, { aspect: "1:1" })).j); expect(again).toMatchObject({ status: "queued", spec: { width: 1080, height: 1080, fps: 30, durationSec: 20 } });
    await s.call("DELETE", `/replays/${v.token}`); expect((await s.call("POST", `/replays/${v.token}/render`, {})).status).toBe(409);

    const seen: any[] = []; const t = await setup({ name: "fake", configured: true, render: async (i: any) => { seen.push(i); return { ok: true, videoUrl: `https://cdn.example.com/${i.token}.mp4`, posterUrl: null }; } });
    const w = (await t.call("POST", `/runs/${t.run.id}/replay/share`, { render: {} })).j; await t.q.replays.processRenders();
    const pub = (await t.call("GET", `/public/replays/${w.token}`, undefined, null)).j; expect(pub.render).toEqual({ status: "done", videoUrl: `https://cdn.example.com/${w.token}.mp4`, posterUrl: null });
    expect(seen[0]).toMatchObject({ width: 1080, height: 1920, fps: 30, durationSec: 20, totalFrames: 600 });
  });
});
