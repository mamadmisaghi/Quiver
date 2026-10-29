// M4.5.1 — Robin gate 5d5c80f regressions (ported from qa/poc/robin-g5d5-*), expectations flipped to the safe behaviour.
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { AlertService, type Transport } from "../../src/alerts/service";
import { DnsTimeout, resolvePublic } from "../../src/alerts/ssrf";

async function setup(w = "m451-autopilot-user-0001", persistPath?: string, clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"))) {
  const q = createApp({ config: loadConfig({ DEV_LOGIN_ENABLED: "true", QUIVR_MODE: "mock" }), clock, autoTimers: false, compileDelayMs: 0, persistPath });
  const toks: Record<string, string> = {};
  const login = async (who = w) => (toks[who] = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:${who}` }) })).json() as any).accessToken);
  const call = async (m: string, p: string, b?: unknown, who = w) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who] ?? (await login(who))}` }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => null) as any }; };
  await login(); const pubs = (await call("GET", "/public/strategies")).j.items; const ids: string[] = [];
  for (const p of pubs.slice(0, 3)) ids.push((await call("POST", `/public/strategies/${p.id}/fork`)).j.id);
  const uid = [...q.store.users.values()].find((u) => u.label === w)!.id;
  const mine = () => [...q.runs.live.values()].filter((l) => l.run.ownerId === uid);
  const block = (runId: string, ms: number) => { const l = q.runs.live.get(runId)!; l.chain = l.chain.then(() => new Promise((r) => setTimeout(r, ms))); };
  return { q, clock, call, login, ids, uid, mine, block };
}
const cfg = (ids: string[], extra: Record<string, unknown> = {}) => ({ enabled: true, strategyIds: ids, rotateEveryMin: 15, ...extra });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("M4.5.1 autopilot P1/P2", () => {
  it("P1 kill while a rotation is mid-stop → killed, nothing live, nothing tracked", async () => {
    const s = await setup("m451-ap-killrace-user-01"); const a = (await s.call("PUT", "/autopilot", cfg(s.ids))).j;
    s.clock.advance(16 * 60_000); await s.login(); s.block(a.state.currentRunId, 60); const step = s.q.autopilot.step(s.uid); await sleep(10);
    expect((await s.call("POST", "/autopilot/kill")).status).toBe(200); await step; await sleep(80);
    const ap = (await s.call("GET", "/autopilot")).j;
    expect({ killed: ap.killed, enabled: ap.enabled, tracked: ap.state.currentRunId, live: s.mine().length }).toEqual({ killed: true, enabled: false, tracked: null, live: 0 });
  });
  it("P1 disable racing a rotation → nothing live", async () => {
    const s = await setup("m451-ap-disrace-user-001"); const a = (await s.call("PUT", "/autopilot", cfg(s.ids))).j;
    s.clock.advance(16 * 60_000); await s.login(); s.block(a.state.currentRunId, 60); const step = s.q.autopilot.step(s.uid); await sleep(10);
    await s.call("PUT", "/autopilot", cfg(s.ids, { enabled: false })); await step; await sleep(80);
    expect({ enabled: (await s.call("GET", "/autopilot")).j.enabled, live: s.mine().length }).toEqual({ enabled: false, live: 0 });
  });
  it("P1 kill stops every run autopilot started (not only the tracked one)", async () => {
    const s = await setup("m451-ap-killall-user-001"); await s.call("PUT", "/autopilot", cfg(s.ids));
    for (let i = 0; i < 2; i++) { s.clock.advance(16 * 60_000); await s.q.autopilot.step(s.uid); }
    await s.login(); const manual = (await s.call("POST", "/runs", { strategyId: s.ids.find((id) => !s.mine().some((l) => l.run.strategyId === id)), mode: "paper" })).j;
    await s.call("POST", "/autopilot/kill"); expect(s.mine().map((l) => l.run.id)).toEqual([manual.id]); // user's own run untouched
  });
  it("P2 overlapping steps are single-flight: one live run, rotation counted once", async () => {
    const s = await setup("m451-ap-overlap-user-001"); const a = (await s.call("PUT", "/autopilot", cfg(s.ids))).j;
    s.clock.advance(16 * 60_000); await s.login(); s.block(a.state.currentRunId, 40);
    await Promise.all([s.q.autopilot.step(s.uid), s.q.autopilot.step(s.uid), s.q.autopilot.stepAll()]);
    expect(s.mine().length).toBe(1); expect((await s.call("GET", "/autopilot")).j.state.rotationsToday).toBe(1);
  });
  it("P2 a paused run is not rotated; logs skipped", async () => {
    const s = await setup("m451-ap-pause-user-00001"); const a = (await s.call("PUT", "/autopilot", cfg(s.ids))).j;
    await s.call("POST", `/runs/${a.state.currentRunId}/control`, { action: "pause" }); s.clock.advance(16 * 60_000); await s.q.autopilot.step(s.uid);
    expect(s.mine().map((l) => [l.run.id, l.run.status])).toEqual([[a.state.currentRunId, "paused"]]);
    const last = s.q.autopilot.users.get(s.uid)!.log.at(-1)!; expect(last.action).toBe("skipped"); expect(last.reason).toMatch(/paused/);
  });
  it("P2 a halted run is not rotated; logs skipped", async () => {
    const s = await setup("m451-ap-halt-user-000001"); const a = (await s.call("PUT", "/autopilot", cfg(s.ids))).j;
    s.q.runs.haltExternal(a.state.currentRunId, "geo_block", "probe"); s.clock.advance(16 * 60_000); await s.q.autopilot.step(s.uid);
    expect(s.mine().map((l) => l.run.id)).toEqual([a.state.currentRunId]); expect(s.q.autopilot.users.get(s.uid)!.log.at(-1)!.action).toBe("skipped");
  });
});

describe("M4.5.1 autopilot P3", () => {
  it("confirm_each is passed to the run (and shown in the view)", async () => {
    const s = await setup("m451-ap-confirm-user-001"); const a = (await s.call("PUT", "/autopilot", cfg(s.ids, { approvalMode: "confirm_each" }))).j;
    expect(a.approvalMode).toBe("confirm_each"); expect(s.q.store.runs.get(a.state.currentRunId)!.approvalMode).toBe("confirm_each");
  });
  it("external stop disables autopilot (no restart loop past the cap)", async () => {
    const s = await setup("m451-ap-extstop-user-001"); const a = (await s.call("PUT", "/autopilot", cfg(s.ids, { guardrails: { maxRotationsPerDay: 1 } }))).j;
    await s.q.runs.control(a.state.currentRunId, "stop");
    for (let i = 0; i < 20; i++) { s.clock.advance(30_000); await s.q.autopilot.step(s.uid); }
    const ap = (await s.call("GET", "/autopilot")).j; expect(ap.enabled).toBe(false); expect(s.mine().length).toBe(0); expect(ap.state.lastDecision.reason).toMatch(/outside autopilot/);
  });
  it("restart: settings + state persist, the run comes back tracked under guardrails", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "m451-")), "state.json"); const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
    const s = await setup("m451-ap-restart-user-001", path, clock); const a = (await s.call("PUT", "/autopilot", cfg(s.ids, { guardrails: { maxDrawdownPct: 1 } }))).j;
    await s.q.persist!.flush(); s.q.runs.shutdown();
    const q2 = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0, persistPath: path });
    await sleep(20); const st = q2.autopilot.users.get(s.uid)!;
    expect({ en: st.cfg.enabled, cur: st.currentRunId, dd: st.cfg.guardrails.maxDrawdownPct }).toEqual({ en: true, cur: a.state.currentRunId, dd: 1 });
    expect(q2.runs.live.has(a.state.currentRunId)).toBe(true); q2.runs.shutdown();
  });
  it("restart after kill: restored autopilot runs are stopped by reconcile", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "m451-")), "state.json"); const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
    const s = await setup("m451-ap-restart-user-002", path, clock); const a = (await s.call("PUT", "/autopilot", cfg(s.ids))).j;
    const st = s.q.autopilot.users.get(s.uid)!; st.killed = true; st.cfg.enabled = false; // simulate a kill persisted before its stop landed
    await s.q.persist!.flush(); s.q.runs.shutdown();
    const q2 = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0, persistPath: path });
    await sleep(50); expect(q2.runs.live.has(a.state.currentRunId)).toBe(false); q2.runs.shutdown();
  });
});

describe("M4.5.1 alerts P3", () => {
  const pub = async () => [{ address: "93.184.216.34", family: 4 }];
  const mk = (transport: Transport, resolve = pub) => { const svc = new AlertService({ provider: "webhook", now: () => Date.parse("2026-10-28T06:00:00Z"), resolve, transport });
    for (let i = 0; i < 30; i++) svc.users.set("u" + i, { webhookUrl: `https://hook-${i}.example.com/in`, secret: "whsec_m451_" + i } as any); return svc; };
  it("global limit of 8 holds across concurrent rounds", async () => {
    let cur = 0, peak = 0; const svc = mk(async () => { cur++; peak = Math.max(peak, cur); await sleep(20); cur--; return 200; });
    for (let i = 0; i < 30; i++) svc.enqueue("u" + i, null, null, "test", null, "x");
    const p1 = svc.process(); for (let i = 0; i < 30; i++) svc.enqueue("u" + i, null, null, "test", null, "y"); // new round while the first is busy
    await Promise.all([p1, svc.process(), svc.process()]); expect(peak).toBeLessThanOrEqual(8); expect(peak).toBeGreaterThan(1);
  });
  it("deliverNow sends only that delivery", async () => {
    const hits: string[] = []; const svc = mk(async (u) => { hits.push(u.hostname); return 200; });
    svc.enqueue("u1", null, null, "test", null, "other"); const d = svc.enqueue("u2", null, null, "test", null, "mine");
    await svc.deliverNow(d.id); expect(hits).toEqual(["hook-2.example.com"]); expect(d.status).toBe("delivered");
  });
  it("DNS lookup times out (~3s budget) and is retryable", async () => {
    const t0 = Date.now(); await expect(resolvePublic(new URL("https://slow.example.com/"), () => new Promise(() => {}), [], 100)).rejects.toBeInstanceOf(DnsTimeout); expect(Date.now() - t0).toBeLessThan(1000);
  });
});
