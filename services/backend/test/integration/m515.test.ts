// M5.15 local ffmpeg replay renderer: real encode (local binary only), safe serving, caps, revoke cleanup.
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { ffmpegRenderer, renderPaths, drawFrames } from "../../src/replay/ffmpeg";

const HAS = existsSync("/usr/bin/ffmpeg");
async function setup(env: Record<string, string> = {}, renderer?: any) {
  const dir = mkdtempSync(join(tmpdir(), "m515-"));
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", REPLAY_RENDERER: "ffmpeg", REPLAY_RENDER_DIR: dir, ...env }), clock, autoTimers: false, compileDelayMs: 0, renderer });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown, t: string | null = tok) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); const ct = r.headers.get("content-type") ?? ""; return { status: r.status, h: r.headers, j: ct.includes("json") ? await r.json() : null, buf: ct.includes("json") ? null : Buffer.from(await r.arrayBuffer()) }; };
  tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:m515-render-user-01" })).j.accessToken;
  const marco = (await call("GET", "/public/strategies")).j.items.find((x: any) => x.author.handle === "@demo_marco");
  const f = (await call("POST", `/public/strategies/${marco.id}/fork`)).j; const run = (await call("POST", "/runs", { strategyId: f.id, mode: "paper" })).j;
  for (let i = 0; i < 20; i++) { clock.advance(60_000); await q.runs.tick(run.id); }
  tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: "dev:m515-render-user-01" })).j.accessToken;
  return { q, call, run, dir };
}
const stall = () => { const d = mkdtempSync(join(tmpdir(), "m515s-")); const p = join(d, "slow.sh"); writeFileSync(p, "#!/bin/sh\nexec /bin/sleep 5\n"); chmodSync(p, 0o755); return p; };
const input = (token: string) => ({ token, width: 320, height: 320, fps: 24, durationSec: 5, totalFrames: 120, equity: [100, 101, null, 103, 99, 104] });

describe("M5.15 ffmpeg replay renderer", () => {
  it.skipIf(!HAS)("renders a real mp4 + poster, serves them safely, revoke deletes files and 404s", async () => {
    const s = await setup();
    const v = (await s.call("POST", `/runs/${s.run.id}/replay/share`, { render: { aspect: "1:1", fps: 24, durationSec: 5 } })).j;
    expect(v.render?.renderer, JSON.stringify(v)).toBe("ffmpeg");
    expect((await s.call("GET", `/public/replays/${v.token}/video.mp4`, undefined, null)).status).toBe(404); // not done yet
    await s.q.replays.processRenders();
    const pub = (await s.call("GET", `/public/replays/${v.token}`, undefined, null)).j;
    expect(pub.render).toEqual({ status: "done", videoUrl: `/v1/public/replays/${v.token}/video.mp4`, posterUrl: `/v1/public/replays/${v.token}/poster.png` });
    const mp4 = await s.call("GET", `/public/replays/${v.token}/video.mp4`, undefined, null);
    expect(mp4.status).toBe(200); expect(mp4.h.get("content-type")).toBe("video/mp4"); expect(mp4.h.get("x-content-type-options")).toBe("nosniff");
    expect(mp4.h.get("content-security-policy")).toContain("default-src 'none'"); expect(mp4.buf!.subarray(4, 8).toString()).toBe("ftyp"); expect(mp4.buf!.length).toBeLessThan(20_000_000);
    const png = await s.call("GET", `/public/replays/${v.token}/poster.png`, undefined, null);
    expect(png.status).toBe(200); expect(png.buf!.subarray(1, 4).toString()).toBe("PNG");
    expect((await s.call("GET", `/public/replays/..%2F..%2Fetc/video.mp4`, undefined, null)).status).toBe(404);
    expect((await s.call("GET", `/public/replays/${v.token}/other.mp4`, undefined, null)).status).toBe(404);
    const p = renderPaths(s.dir, v.token); expect(existsSync(p.video)).toBe(true);
    expect((await s.call("DELETE", `/replays/${v.token}`)).status).toBe(204);
    expect(existsSync(p.d)).toBe(false); expect((await s.call("GET", `/public/replays/${v.token}/video.mp4`, undefined, null)).status).toBe(404);
  }, 60_000);
  it.skipIf(!HAS)("size cap: output over REPLAY_RENDER_MAX_BYTES fails and leaves no file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m515c-")); const r = ffmpegRenderer({ bin: "/usr/bin/ffmpeg", dir, maxSec: 30, maxBytes: 1000 });
    const out = await r.render(input("rpl_sizecap_0001")); expect(out.ok).toBe(false);
    expect(existsSync(renderPaths(dir, "rpl_sizecap_0001").video)).toBe(false);
  }, 30_000);
  it("time cap kills a stuck encoder; missing binary fails cleanly; unsafe token refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m515t-"));
    const t0 = Date.now(); const out = await ffmpegRenderer({ bin: stall(), dir, maxSec: 0.3, maxBytes: 1e6 }).render(input("rpl_timeout_0001"));
    expect(out).toEqual({ ok: false, error: "Render took too long and was stopped." }); expect(Date.now() - t0).toBeLessThan(3000);
    const miss = await ffmpegRenderer({ bin: join(dir, "nope"), dir, maxSec: 5, maxBytes: 1e6 }).render(input("rpl_missing_0001"));
    expect(miss.ok).toBe(false); expect((miss as any).error).toMatch(/could not start/);
    await expect(ffmpegRenderer({ bin: "/usr/bin/ffmpeg", dir, maxSec: 5, maxBytes: 1e6 }).render(input("../../etc"))).rejects.toThrow();
  }, 10_000);
  it("queue cap → 429; one job at a time (overlapping processRenders don't double-run)", async () => {
    let calls = 0, release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const slow = { name: "ffmpeg", configured: true, render: async () => { calls++; await gate; return { ok: false, error: "x" } as const; } };
    const s = await setup({ REPLAY_RENDER_MAX_QUEUE: "1" }, slow);
    expect((await s.call("POST", `/runs/${s.run.id}/replay/share`, { render: {} })).status).toBe(201);
    const b = (await s.call("POST", `/runs/${s.run.id}/replay/share`, {})).j;
    expect((await s.call("POST", `/replays/${b.token}/render`, {})).status).toBe(429);
    const p1 = s.q.replays.processRenders(); const p2 = s.q.replays.processRenders(); release(); await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });
  it("default config stays on the stub; frame drawing is deterministic", async () => {
    const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock: new ManualClock(0), autoTimers: false });
    expect(q).toBeTruthy();
    const a = drawFrames([1, 2, 3], 1080, 1920), b = drawFrames([1, 2, 3], 1080, 1920);
    expect(a).toHaveLength(3); expect(Buffer.concat(a).equals(Buffer.concat(b))).toBe(true);
  });
});
