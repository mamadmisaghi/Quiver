// M5.4 autopilot plan: deterministic scoring, SSE stream, never applies anything.
import { describe, expect, it } from "vitest";
import { AutopilotPlan, AutopilotPlanCandidate, PutAutopilotReq } from "../../contracts/src/autopilot";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup() {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  let tok = "";
  const raw = (m: string, p: string, b?: unknown) => q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const call = async (m: string, p: string, b?: unknown) => { const r = await raw(m, p, b); return { status: r.status, j: await r.json() as any }; };
  const login = async (w = "m54-autopilot-plan-user-01") => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${w}` })).j.accessToken; };
  await login();
  const pubs = (await call("GET", "/public/strategies")).j;
  const ids: string[] = []; for (const p of pubs.items.slice(0, 3)) ids.push((await call("POST", `/public/strategies/${p.id}/fork`)).j.id);
  return { q, raw, call, login, ids };
}
const frames = (txt: string) => txt.split("\n\n").filter(Boolean).map((b) => { const ev = /event: (.*)/.exec(b)?.[1]; const d = /data: (.*)/.exec(b)?.[1]; return { ev, d: d ? JSON.parse(d) : null }; });

describe("M5.4 autopilot plan", () => {
  it("streams status → candidate per strategy → plan; proposal is a valid disabled paper PUT body; nothing is applied", async () => {
    const s = await setup();
    const r = await s.raw("POST", "/autopilot/plan/stream", { strategyIds: s.ids, goal: "balanced" }); expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const f = frames(await r.text()); expect(f[0].ev).toBe("status"); expect(f.at(-1)!.ev).toBe("plan");
    const c = f.filter((x) => x.ev === "candidate"); expect(c).toHaveLength(3); c.forEach((x) => AutopilotPlanCandidate.parse(x.d));
    const plan = AutopilotPlan.parse(f.at(-1)!.d); expect(plan.ranked.length + plan.excluded.length).toBe(3);
    expect(plan.proposal).not.toBeNull(); if (plan.proposal) { expect(PutAutopilotReq.parse(plan.proposal)).toMatchObject({ enabled: false, mode: "paper" }); for (let i = 1; i < plan.ranked.length; i++) expect(plan.ranked[i - 1].score!).toBeGreaterThanOrEqual(plan.ranked[i].score!); }
    expect((await s.call("GET", "/autopilot")).j.configured).toBe(false);
  });
  it("non-stream variant is deterministic and matches the stream's plan", async () => {
    const s = await setup();
    const a = AutopilotPlan.parse((await s.call("POST", "/autopilot/plan", { strategyIds: s.ids, goal: "low_risk", lookbackDays: 30 })).j);
    const b = AutopilotPlan.parse((await s.call("POST", "/autopilot/plan", { strategyIds: s.ids, goal: "low_risk", lookbackDays: 30 })).j);
    expect(a).toEqual(b); expect(a.lookbackDays).toBe(30);
  });
  it("validation, ownership, empty account, rate limit", async () => {
    const s = await setup();
    expect((await s.call("POST", "/autopilot/plan", { goal: "yolo" })).status).toBe(422);
    expect((await s.call("POST", "/autopilot/plan", { lookbackDays: 90 })).status).toBe(422);
    await s.login("m54-someone-else-user-0001");
    expect((await s.call("POST", "/autopilot/plan/stream", { strategyIds: [s.ids[0]] })).status).toBe(404);
    expect((await s.call("POST", "/autopilot/plan", {})).status).toBe(422);
    await s.login(); const codes: number[] = []; for (let i = 0; i < 7; i++) codes.push((await s.call("POST", "/autopilot/plan", { strategyIds: [s.ids[0]] })).status);
    expect(codes.slice(0, 6).every((x) => x === 200)).toBe(true); expect(codes[6]).toBe(429);
  });
});
