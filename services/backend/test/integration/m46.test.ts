// M4.6 — Wren's API gaps: approve-409 details, autopilot names, positions endpoint, approval titles; M3.9 config audit.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { Approval, ApproveConflictDetails, PositionsRes } from "../../contracts/src/api";
import { Autopilot, AutopilotLog } from "../../contracts/src/autopilot";

async function setup(w = "m46-wren-gaps-user-00001") {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const login = async (who = w) => (toks[who] = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:${who}` }) })).json() as any).accessToken);
  const call = async (m: string, p: string, b?: unknown, who = w) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who] ?? (await login(who))}` }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => null) as any }; };
  await login(); const pubs = (await call("GET", "/public/strategies")).j.items;
  const marco = (await call("POST", `/public/strategies/${pubs.find((x: any) => x.author.handle === "@demo_marco").id}/fork`)).j;
  const tickUntil = async (runId: string, f: () => boolean, max = 60) => { for (let i = 0; i < max && !f(); i++) { clock.advance(60_000); await q.runs.tick(runId); } for (const k of Object.keys(toks)) await login(k); };
  return { q, clock, call, login, pubs, marco, tickUntil };
}
const pend = (q: any, runId: string) => [...q.runs.approvalsOf(runId).values()].filter((x: any) => x.status === "pending") as any[];

describe("M4.6 approvals", () => {
  it("approval items carry strategyId, strategyName, actionTitle", async () => {
    const s = await setup(); const run = (await s.call("POST", "/runs", { strategyId: s.marco.id, mode: "paper", approvalMode: "confirm_each" })).j;
    await s.tickUntil(run.id, () => pend(s.q, run.id).length > 0);
    const a = Approval.parse((await s.call("GET", `/approvals?runId=${run.id}`)).j.items[0]);
    expect(a.strategyId).toBe(s.marco.id); expect(a.strategyName).toBe(s.marco.name); expect(a.actionTitle).toMatch(/^(Buy|Sell|Long|Short|Close) /);
  });
  it("409 details: paused → {runStatus:paused}; halted → {runStatus:halted, haltReason}; message kept", async () => {
    const s = await setup(); const run = (await s.call("POST", "/runs", { strategyId: s.marco.id, mode: "paper", approvalMode: "confirm_each" })).j;
    await s.tickUntil(run.id, () => pend(s.q, run.id).length > 0); const a = pend(s.q, run.id)[0];
    await s.call("POST", `/runs/${run.id}/control`, { action: "pause" });
    let r = await s.call("POST", `/approvals/${a.id}`, { decision: "approve" });
    expect(r.status).toBe(409); expect(r.j.error.message).toBe("Run is paused; resume it before approving."); expect(ApproveConflictDetails.parse(r.j.error.details)).toEqual({ runStatus: "paused" });
    await s.call("POST", `/runs/${run.id}/control`, { action: "resume" }); s.q.runs.haltExternal(run.id, "geo_block", "probe halt");
    r = await s.call("POST", `/approvals/${a.id}`, { decision: "approve" });
    expect(r.status).toBe(409); expect(r.j.error.details).toEqual({ runStatus: "halted", haltReason: "geo_block: probe halt" });
  });
});

describe("M4.6 autopilot names", () => {
  it("state.currentStrategyName and log strategyName/fromStrategyName/toStrategyName", async () => {
    const s = await setup("m46-ap-names-user-000001"); const ids: string[] = []; const names: string[] = [];
    for (const p of s.pubs.slice(0, 2)) { const f = (await s.call("POST", `/public/strategies/${p.id}/fork`)).j; ids.push(f.id); names.push(f.name); }
    const a = Autopilot.parse((await s.call("PUT", "/autopilot", { enabled: true, strategyIds: ids, rotateEveryMin: 15 })).j);
    expect(a.state.currentStrategyName).toBe(names[0]); expect(a.state.lastDecision!.strategyName).toBe(names[0]); expect(a.state.lastDecision!.toStrategyName).toBe(names[0]);
    s.clock.advance(16 * 60_000); const uid = [...s.q.store.users.values()].find((u) => u.label === "m46-ap-names-user-000001")!.id; await s.q.autopilot.step(uid); await s.login();
    const rot = AutopilotLog.parse((await s.call("GET", "/autopilot/log")).j).items.find((x) => x.action === "rotated")!;
    expect({ s: rot.strategyName, f: rot.fromStrategyName, t: rot.toStrategyName }).toEqual({ s: names[1], f: names[0], t: names[1] });
  });
});

describe("M4.6 positions", () => {
  it("GET /positions and /runs/:id/positions: shape, filter, IDOR 404", async () => {
    const s = await setup("m46-positions-user-00001"); const run = (await s.call("POST", "/runs", { strategyId: s.marco.id, mode: "paper" })).j;
    await s.tickUntil(run.id, () => (s.q.runs.live.get(run.id)?.ex.acct.positions.size ?? 0) > 0);
    const all = PositionsRes.parse((await s.call("GET", "/positions?mode=paper")).j); expect(all.items.length).toBeGreaterThan(0);
    for (const p of all.items) { expect(p.runId).toBe(run.id); expect(p.strategyName).toBe(s.marco.name); expect(Number(p.qty)).toBeGreaterThan(0);
      if (p.markPrice) expect(Math.abs(Number(p.notionalUsd) - Number(p.qty) * Number(p.markPrice))).toBeLessThan(0.02); }
    expect((await s.call("GET", `/positions?runId=${run.id}`)).j.items).toEqual(all.items);
    expect(PositionsRes.parse((await s.call("GET", `/runs/${run.id}/positions`)).j).items).toEqual(all.items);
    expect((await s.call("GET", "/positions?mode=testnet")).j.items).toEqual([]);
    const B = "m46-positions-other-0001"; expect((await s.call("GET", `/runs/${run.id}/positions`, undefined, B)).status).toBe(404);
    expect((await s.call("GET", `/positions?runId=${run.id}`, undefined, B)).status).toBe(404); expect((await s.call("GET", "/positions", undefined, B)).j.items).toEqual([]);
    expect((await s.call("GET", "/positions?mode=hax")).status).toBe(422);
    await s.call("POST", `/runs/${run.id}/control`, { action: "stop" }); expect((await s.call("GET", `/runs/${run.id}/positions`)).j.items).toEqual([]);
  });
});

describe("M4.6 M3.9 audit: session-key defaults must pass prepare's rules", () => {
  it("refuses default expiry > max, and default daily outside [perTx, 64×perTx]", () => {
    expect(() => loadConfig({ QUIVR_MODE: "mock", SK_DEFAULT_EXPIRY_HOURS: "200", SK_MAX_EXPIRY_HOURS: "168" })).toThrow(/SK_DEFAULT_EXPIRY_HOURS/);
    expect(() => loadConfig({ QUIVR_MODE: "mock", SK_DEFAULT_PER_TX_USD: "10", SK_DEFAULT_DAILY_USD: "1000" })).toThrow(/SK_DEFAULT_DAILY_USD/);
    expect(() => loadConfig({ QUIVR_MODE: "mock", SK_DEFAULT_PER_TX_USD: "10", SK_DEFAULT_DAILY_USD: "640" })).not.toThrow();
  });
});
