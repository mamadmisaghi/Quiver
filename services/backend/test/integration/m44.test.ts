// M4.4 run replay: deterministic frames from stored events.
import { describe, expect, it } from "vitest";
import { Replay } from "../../contracts/src/api";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup() {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  const login = async (w = "m44-replay-user-0001") => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${w}` })).j.accessToken; };
  await login();
  const pubs = (await call("GET", "/public/strategies")).j; const marco = pubs.items.find((x: any) => x.author.handle === "@demo_marco");
  const f = (await call("POST", `/public/strategies/${marco.id}/fork`)).j; const run = (await call("POST", "/runs", { strategyId: f.id, mode: "paper" })).j;
  for (let i = 0; i < 20; i++) { clock.advance(60_000); await q.runs.tick(run.id); }
  await login(); await call("POST", `/runs/${run.id}/control`, { action: "stop" });
  return { q, call, login, run, evs: () => q.store.runs.get(run.id)!.events };
}

describe("M4.4 replay", () => {
  it("frames cover every event once, positions match the last fill, stable digest", async () => {
    const s = await setup(); const a = Replay.parse((await s.call("GET", `/runs/${s.run.id}/replay?frameMs=60000`)).j);
    expect(a.totalFrames).toBe(a.frames.length); expect(a.truncated).toBe(false); expect(a.frames.length).toBeGreaterThanOrEqual(20);
    expect(a.frames.map((f) => f.i)).toEqual(a.frames.map((_, i) => i));
    const fills = s.evs().filter((e) => e.type === "fill"); expect(a.frames.reduce((t, f) => t + f.counts.fills, 0)).toBe(fills.length);
    expect(a.frames.at(-1)!.lastSeq).toBe(s.evs().at(-1)!.seq);
    const lastPos = new Map<string, string>(); for (const e of fills) if (e.type === "fill") lastPos.set(e.instrument, e.position.qty);
    const want = [...lastPos].filter(([, q]) => Number(q) !== 0).map(([k]) => k).sort(); expect(a.frames.at(-1)!.positions.map((p) => p.instrument)).toEqual(want);
    expect(a.chapters.some((c) => c.type === "status")).toBe(true); expect(a.chapters.filter((c) => c.type === "fill").length).toBe(1);
    const b = Replay.parse((await s.call("GET", `/runs/${s.run.id}/replay?frameMs=60000`)).j); expect(b.digest).toBe(a.digest); expect(b).toEqual(a);
  });
  it("window, frame cap, validation, ownership", async () => {
    const s = await setup(); const all = Replay.parse((await s.call("GET", `/runs/${s.run.id}/replay?frameMs=60000`)).j);
    const cap = Replay.parse((await s.call("GET", `/runs/${s.run.id}/replay?frameMs=60000&maxFrames=5`)).j); expect(cap.frames.length).toBe(5); expect(cap.truncated).toBe(true); expect(cap.frames).toEqual(all.frames.slice(0, 5));
    const from = all.frames[10]!.ts; const w = Replay.parse((await s.call("GET", `/runs/${s.run.id}/replay?frameMs=60000&from=${from}`)).j);
    expect(w.startTs).toBe(from); expect(w.frames[0]!.positions).toEqual(all.frames[10]!.positions); // state folded in before the window
    const coarse = Replay.parse((await s.call("GET", `/runs/${s.run.id}/replay?frameMs=600000`)).j); expect(coarse.frames.reduce((t, f) => t + f.counts.fills, 0)).toBe(all.frames.reduce((t, f) => t + f.counts.fills, 0));
    expect((await s.call("GET", `/runs/${s.run.id}/replay?frameMs=10`)).status).toBe(422);
    expect((await s.call("GET", `/runs/${s.run.id}/replay?from=2026-10-28T00:00:00Z&to=2026-10-27T00:00:00Z`)).status).toBe(422);
    await s.login("m44-someone-else-user"); expect((await s.call("GET", `/runs/${s.run.id}/replay`)).status).toBe(404);
  });
});
