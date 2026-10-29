// M4.5 autopilot: paper-only round-robin rotation with guardrails, kill switch and caps.
import { describe, expect, it } from "vitest";
import { Autopilot, AutopilotLog } from "../../contracts/src/autopilot";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup(w = "m45-autopilot-user-01") {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  const login = async (who = w) => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${who}` })).j.accessToken; };
  await login();
  const pubs = (await call("GET", "/public/strategies")).j.items; const ids: string[] = [];
  for (const p of pubs.slice(0, 3)) ids.push((await call("POST", `/public/strategies/${p.id}/fork`)).j.id);
  const uid = [...q.store.users.values()].find((u) => u.label === w)!.id;
  const advance = async (min: number) => { for (let i = 0; i < min; i++) { clock.advance(60_000); for (const l of [...q.runs.live.values()]) await q.runs.tick(l.run.id); await q.autopilot.step(uid); } await login(); };
  return { q, clock, call, login, ids, uid, advance, active: () => [...q.runs.live.values()].filter((l) => l.run.ownerId === uid) };
}
const cfg = (ids: string[], extra: Record<string, unknown> = {}) => ({ enabled: true, strategyIds: ids, rotateEveryMin: 15, ...extra });

describe("M4.5 autopilot", () => {
  it("starts the first strategy, rotates round-robin, one paper run at a time", async () => {
    const s = await setup(); expect(Autopilot.parse((await s.call("GET", "/autopilot")).j).configured).toBe(false);
    const a = Autopilot.parse((await s.call("PUT", "/autopilot", cfg(s.ids))).j);
    expect(a).toMatchObject({ enabled: true, killed: false, mode: "paper" }); expect(a.state.currentStrategyId).toBe(s.ids[0]);
    expect(s.q.store.runs.get(a.state.currentRunId!)!.mode).toBe("paper");
    await s.advance(15); const b = Autopilot.parse((await s.call("GET", "/autopilot")).j); expect(b.state.currentStrategyId).toBe(s.ids[1]); expect(b.state.rotationsToday).toBe(1);
    expect(s.q.store.runs.get(a.state.currentRunId!)!.status).toBe("stopped"); expect(s.active().length).toBe(1);
    await s.advance(30); expect(Autopilot.parse((await s.call("GET", "/autopilot")).j).state.currentStrategyId).toBe(s.ids[0]); // 1 → 2 → 0
    const log = AutopilotLog.parse((await s.call("GET", "/autopilot/log?limit=50")).j); expect(log.items.filter((x) => x.action === "rotated").length).toBe(3);
  });
  it("rotation cap: extra rotations skipped, run keeps going", async () => {
    const s = await setup(); await s.call("PUT", "/autopilot", cfg(s.ids, { guardrails: { maxRotationsPerDay: 1 } }));
    await s.advance(45); const a = Autopilot.parse((await s.call("GET", "/autopilot")).j);
    expect(a.state.rotationsToday).toBe(1); expect(a.state.currentStrategyId).toBe(s.ids[1]); expect(a.state.lastDecision?.action).toBe("skipped"); expect(a.enabled).toBe(true);
  });
  it("guardrails: drawdown stops+flattens and disables", async () => {
    const s = await setup(); const a = Autopilot.parse((await s.call("PUT", "/autopilot", cfg(s.ids, { rotateEveryMin: 1440, guardrails: { maxDrawdownPct: 1 } }))).j);
    const l = s.q.runs.live.get(a.state.currentRunId!)!; l.ex.acct.cash -= 500; // simulate a 5% paper loss
    await s.advance(1); const b = Autopilot.parse((await s.call("GET", "/autopilot")).j);
    expect(b.enabled).toBe(false); expect(b.state.currentRunId).toBeNull(); expect(b.state.lastDecision).toMatchObject({ action: "guardrail_stop" }); expect(b.state.lastDecision!.reason).toMatch(/drawdown/);
    expect(s.q.store.runs.get(a.state.currentRunId!)!.status).toBe("stopped"); expect(s.active().length).toBe(0);
  });
  it("guardrails: daily loss across today's runs", async () => {
    const s = await setup(); const a = Autopilot.parse((await s.call("PUT", "/autopilot", cfg(s.ids, { rotateEveryMin: 1440, guardrails: { maxDrawdownPct: 50, maxDailyLossUsd: 100 } }))).j);
    s.q.runs.live.get(a.state.currentRunId!)!.ex.acct.cash -= 150; await s.advance(1);
    const b = Autopilot.parse((await s.call("GET", "/autopilot")).j); expect(b.enabled).toBe(false); expect(b.state.lastDecision!.reason).toMatch(/daily loss/);
  });
  it("kill switch: stops the run, blocks re-enable until acknowledged; platform kill pauses scheduling", async () => {
    const s = await setup(); const a = Autopilot.parse((await s.call("PUT", "/autopilot", cfg(s.ids))).j);
    const k = Autopilot.parse((await s.call("POST", "/autopilot/kill")).j); expect(k).toMatchObject({ enabled: false, killed: true }); expect(s.q.store.runs.get(a.state.currentRunId!)!.status).toBe("stopped");
    expect((await s.call("PUT", "/autopilot", cfg(s.ids))).status).toBe(409);
    const re = Autopilot.parse((await s.call("PUT", "/autopilot", cfg(s.ids, { acknowledgeKill: true }))).j); expect(re.killed).toBe(false); expect(re.state.currentRunId).not.toBeNull();
    s.q.setKillSwitch(true); await s.advance(20); const p = Autopilot.parse((await s.call("GET", "/autopilot")).j); expect(p.state.platformKillSwitch).toBe(true); expect(p.state.rotationsToday).toBe(0);
    expect(Autopilot.parse((await s.call("PUT", "/autopilot", cfg(s.ids, { enabled: false }))).j)).toMatchObject({ enabled: false, state: { currentRunId: null } }); expect(s.active().length).toBe(0);
  });
  it("paper only, validation, ownership", async () => {
    const s = await setup();
    expect((await s.call("PUT", "/autopilot", cfg(s.ids, { mode: "live" }))).status).toBe(403);
    expect((await s.call("PUT", "/autopilot", cfg(s.ids, { mode: "testnet" }))).status).toBe(403);
    expect((await s.call("PUT", "/autopilot", cfg([]))).status).toBe(422);
    expect((await s.call("PUT", "/autopilot", cfg([s.ids[0], s.ids[0]]))).status).toBe(422);
    expect((await s.call("PUT", "/autopilot", cfg(s.ids, { rotateEveryMin: 5 }))).status).toBe(422);
    expect((await s.call("PUT", "/autopilot", cfg(s.ids, { guardrails: { maxDrawdownPct: 90 } }))).status).toBe(422);
    expect((await s.call("POST", "/autopilot/kill")).status).toBe(404);
    await s.login("m45-someone-else-user"); expect((await s.call("PUT", "/autopilot", cfg(s.ids))).status).toBe(404);
  });
});
