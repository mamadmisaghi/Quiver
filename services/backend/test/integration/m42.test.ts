// M4.2 approvals: approval-required (confirm_each) paper runs propose opening orders; user approves/rejects within a TTL.
import { describe, expect, it } from "vitest";
import { Approval, ApprovalList, Run } from "../../contracts/src/api";
import { RunEvent } from "../../contracts/src/events";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup(extra: Record<string, unknown> = { approvalMode: "confirm_each" }, w = "m42-approvals-user-1") {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  const login = async (who = w) => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${who}` })).j.accessToken; };
  await login();
  const pubs = (await call("GET", "/public/strategies")).j; const marco = pubs.items.find((x: any) => x.author.handle === "@demo_marco");
  const fork = (await call("POST", `/public/strategies/${marco.id}/fork`)).j; const run = (await call("POST", "/runs", { strategyId: fork.id, mode: "paper", ...extra })).j;
  const tickUntilPending = async (max = 30) => { for (let i = 0; i < max; i++) { clock.advance(60_000); await q.runs.tick(run.id); if ([...q.runs.live.get(run.id)!.ex.approvals.values()].some((x) => x.status === "pending")) break; } await login(); };
  return { q, clock, call, login, run, tickUntilPending, ex: () => q.runs.live.get(run.id)!.ex, evs: () => q.store.runs.get(run.id)!.events };
}

describe("M4.2 approvals", () => {
  it("auto mode never proposes", async () => {
    const s = await setup({}); for (let i = 0; i < 20; i++) { s.clock.advance(60_000); await s.q.runs.tick(s.run.id); }
    expect(s.evs().some((e) => e.type === "approval_requested")).toBe(false); expect(s.evs().some((e) => e.type === "fill")).toBe(true);
  });
  it("confirm_each: opening order waits (no intent) then approve fills with the same orderId", async () => {
    const s = await setup(); expect(Run.parse(s.run).approvalMode).toBe("confirm_each");
    await s.tickUntilPending(); expect(s.evs().some((e) => e.type === "fill")).toBe(false);
    const list = ApprovalList.parse((await s.call("GET", "/approvals?status=pending")).j); expect(list.items.length).toBeGreaterThan(0);
    const a = list.items[0]!; expect(a).toMatchObject({ status: "pending", runId: s.run.id, resolvedAt: null, result: null });
    expect(Date.parse(a.expiresAt) - Date.parse(a.createdAt)).toBe(300_000);
    expect((await s.call("GET", `/runs/${s.run.id}`)).j.pendingApprovals).toBeGreaterThan(0);
    const r = await s.call("POST", `/approvals/${a.id}`, { decision: "approve" }); expect(r.status).toBe(200);
    const b = Approval.parse(r.j); expect(b.status).toBe("approved"); expect(b.result?.status).toBe("filled");
    const mine = s.evs().filter((e) => (e as any).orderId === a.orderId); expect(mine.map((e) => e.type)).toEqual(["approval_requested", "approval_resolved", "intent", "fill"]); mine.forEach((e) => RunEvent.parse(e));
    expect((await s.call("POST", `/approvals/${a.id}`, { decision: "approve" })).status).toBe(409);
  });
  it("reject, expiry (TTL), validation, ownership", async () => {
    const s = await setup({ approvalMode: "confirm_each", approvalTtlSec: 60 }); await s.tickUntilPending();
    const a = ApprovalList.parse((await s.call("GET", "/approvals?status=pending")).j).items[0]!;
    expect((await s.call("POST", `/approvals/${a.id}`, { decision: "maybe" })).status).toBe(422);
    await s.login("m42-someone-else-user"); expect((await s.call("POST", `/approvals/${a.id}`, { decision: "reject" })).status).toBe(404); await s.login();
    expect(Approval.parse((await s.call("POST", `/approvals/${a.id}`, { decision: "reject" })).j).status).toBe("rejected");
    expect(s.evs().filter((e) => (e as any).orderId === a.orderId).some((e) => e.type === "fill")).toBe(false);
    const s2 = await setup({ approvalMode: "confirm_each", approvalTtlSec: 60 }, "m42-approvals-user-2"); await s2.tickUntilPending(); const p = ApprovalList.parse((await s2.call("GET", "/approvals?status=pending")).j).items[0]!;
    s2.clock.advance(61_000); await s2.login();
    expect((await s2.call("POST", `/approvals/${p.id}`, { decision: "approve" })).status).toBe(409);
    expect(Approval.parse((await s2.call("GET", `/approvals/${p.id}`)).j).status).toBe("expired");
    s.clock.advance(1); await s.login();
    expect((await s.call("POST", "/runs", { strategyId: s.run.strategyId, mode: "paper", approvalMode: "confirm_each", approvalTtlSec: 5 })).status).toBe(422);
  });
  it("paused run: 409 on approve; stop cancels pending", async () => {
    const s = await setup(); await s.tickUntilPending(); const a = ApprovalList.parse((await s.call("GET", "/approvals?status=pending")).j).items[0]!;
    await s.call("POST", `/runs/${s.run.id}/control`, { action: "pause" });
    expect((await s.call("POST", `/approvals/${a.id}`, { decision: "approve" })).status).toBe(409);
    await s.call("POST", `/runs/${s.run.id}/control`, { action: "stop" });
    expect(Approval.parse((await s.call("GET", `/approvals/${a.id}`)).j).status).toBe("canceled");
    expect(s.evs().some((e) => e.type === "approval_resolved" && e.decision === "canceled")).toBe(true);
  });
  it("queue cap: excess proposals are rejected with approval_queue_full", async () => {
    const s = await setup({ approvalMode: "confirm_each", approvalTtlSec: 3600 }); s.ex().d.approval!.maxPending = 1;
    for (let i = 0; i < 60; i++) { s.clock.advance(60_000); await s.q.runs.tick(s.run.id); }
    const n = [...s.ex().approvals.values()].filter((x) => x.status === "pending").length; expect(n).toBe(1);
    const full = s.evs().filter((e) => e.type === "rejected" && e.code === "approval_queue_full"); expect(full.length).toBeGreaterThan(0);
    full.forEach((e) => RunEvent.parse(e)); expect((full[0] as any).message).toMatch(/max 1/);
    expect(s.evs().some((e) => e.type === "intent")).toBe(false); // nothing placed while waiting
  });
});
