// M5.20: public profile, bounded replay frames, absolute FFMPEG_PATH, per-user Tiingo cap, search no longer echoes q.
import { describe, expect, it } from "vitest";
import { PublicProfile } from "../../contracts/src/public";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { frameIter, frameDims, MAX_FRAMES, MAX_IH } from "../../src/replay/ffmpeg";
import { TiingoHistory, type TiingoHttp } from "../../src/venues/tiingo";

async function setup(env: Record<string, string> = {}) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock: new ManualClock(Date.parse("2026-10-27T15:00:00Z")), autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const call = async (who: string | null, m: string, p: string, b?: unknown) => {
    if (who) toks[who] ??= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m520-${who}-user-label-xx` }) })).json() as any).accessToken;
    const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${toks[who]}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: r.status, h: r.headers, j: await r.json() as any };
  };
  return { q, call };
}
const pp = (s: any, h: string) => s.call(null, "GET", "/public/profiles/" + encodeURIComponent(h));

describe("M5.20 public profile", () => {
  it("demo trader: 200, safe fields only, noindex; unknown/invalid handle: 404", async () => {
    const s = await setup(); const pub = (await s.call("ben", "GET", "/public/strategies")).j.items[0];
    const r = await pp(s, pub.author.handle); expect(r.status).toBe(200); expect(r.h.get("x-robots-tag")).toBe("noindex");
    const p = PublicProfile.parse(r.j); expect(p).toMatchObject({ handle: pub.author.handle, exists: true, limited: false, demo: true }); expect(p.publicStrategies).toBeGreaterThan(0);
    expect(Object.keys(r.j).sort()).toEqual(["bio", "demo", "displayName", "exists", "followers", "handle", "limited", "publicStrategies"]);
    expect((await pp(s, "@nobody_here_zz")).status).toBe(404); expect((await pp(s, "not a handle")).status).toBe(404);
    expect((await s.call(null, "GET", "/public/profiles/%E0%A4%A")).status).toBe(404);
  });
  it("M5.10 limited rule: no bio/displayName until a strategy is public; never ids or DIDs", async () => {
    const s = await setup(); const me = (await s.call("ana", "PUT", "/me/profile", { displayName: "Ana Secret", bio: "private bio" })).j;
    let r = await pp(s, me.handle); expect(r.status).toBe(200);
    expect(r.j).toMatchObject({ exists: true, limited: true, displayName: null, bio: null, publicStrategies: 0, demo: false });
    const seed = (await s.call("ana", "GET", "/public/strategies")).j.items[0]; const f = (await s.call("ana", "POST", `/public/strategies/${seed.id}/fork`)).j;
    expect((await s.call("ana", "POST", `/strategies/${f.id}/publish`, { public: true })).status).toBe(200);
    r = await pp(s, me.handle); expect(r.j).toMatchObject({ limited: false, displayName: "Ana Secret", bio: "private bio", publicStrategies: 1 });
    expect(JSON.stringify(r.j)).not.toMatch(/usr_|did:|dev:|stg_|run_|0x[0-9a-f]{40}/i);
  });
  it("rate limited per IP at 60/min", async () => {
    const s = await setup(); const h = (await s.call("ben", "GET", "/public/strategies")).j.items[0].author.handle;
    for (let i = 0; i < 60; i++) expect((await pp(s, h)).status).toBe(200);
    expect((await pp(s, h)).status).toBe(429);
  });
});

describe("M5.20 Robin findings", () => {
  it("replay frames are lazy and bounded (< 64 MB peak)", () => {
    const eq = Array.from({ length: 100_000 }, (_, i) => 100 + Math.sin(i / 50));
    const { iw, ih } = frameDims(1080, 1920); expect(ih).toBeLessThanOrEqual(MAX_IH); expect(frameDims(10, 10_000).ih).toBe(MAX_IH);
    const lazy = frameIter(eq, 1080, 1920); expect(lazy.next().done).toBe(false); // lazy: one frame produced, rest not yet drawn
    const it = frameIter(eq, 1080, 1920); let n = 0;
    for (const b of it) { expect(b.length).toBe(iw * ih * 3); n++; }
    expect(n).toBe(MAX_FRAMES); expect(iw * ih * 3 * 2).toBeLessThan(64 * 1024 * 1024);
    expect(iw * MAX_IH * 3).toBeLessThan(200_000); // one live frame ≈ 173 KB (+1 canvas) vs ~311 MB before
    expect([...frameIter(eq, 1080, 1920, "last")]).toHaveLength(1);
  });
  it("FFMPEG_PATH must be absolute", () => {
    expect(() => loadConfig({ QUIVR_MODE: "mock", FFMPEG_PATH: "ffmpeg" })).toThrow();
    expect(() => loadConfig({ QUIVR_MODE: "mock", FFMPEG_PATH: "/usr/../tmp/ffmpeg" })).toThrow();
    expect(loadConfig({ QUIVR_MODE: "mock", FFMPEG_PATH: "C:\\ffmpeg\\bin\\ffmpeg.exe" }).FFMPEG_PATH).toMatch(/ffmpeg\.exe$/);
    expect(loadConfig({ QUIVR_MODE: "mock" }).FFMPEG_PATH).toBe("/usr/bin/ffmpeg");
  });
  it("Tiingo: one user cannot drain the shared hourly budget", async () => {
    let now = Date.parse("2026-10-27T15:00:00Z"); const http: TiingoHttp = async () => ({ status: 200, text: "[]" });
    const t = new TiingoHistory({ key: "k_placeholder", http, now: () => now, maxPerHour: 45, maxPerOwnerHour: 3, log: () => {} });
    for (let i = 0; i < 5; i++) await t.bars("SPY", 86_400_000, now - (i + 2) * 86_400_000, now, "usr_a");
    expect(t.stats.requests).toBe(3); expect(t.stats.rateLimited).toBe(2);
    await t.bars("QQQ", 86_400_000, now - 2 * 86_400_000, now, "usr_b"); expect(t.stats.requests).toBe(4);
    now += 3_600_001; await t.bars("SPY", 86_400_000, now - 9 * 86_400_000, now, "usr_a"); expect(t.stats.requests).toBe(5);
  });
  it("search no longer echoes q; 1-char queries do not list traders", async () => {
    const s = await setup(); const r = (await s.call("ben", "GET", "/search?q=a")).j;
    expect(r.q).toBeUndefined(); expect(r.traders).toEqual([]);
  });
});
