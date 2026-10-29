// M4.9.1 — autopilot kill keeps going past a failing stop (partial result); stepAll is parallel + per-user bounded.
import { describe, expect, it } from "vitest";
import { AutopilotService, type AutopilotDeps } from "../../src/autopilot/service";
import { PutAutopilotReq } from "../../contracts/src/autopilot";

const cfg = (enabled = true) => PutAutopilotReq.parse({ enabled, strategyIds: ["stg_aaaaaaaaaaaaaaaa"], startingEquityUsd: "1000", guardrails: { maxDrawdownPct: 20, maxDailyLossUsd: 100, maxRotationsPerDay: 5 } } as any);
function mk(over: Partial<AutopilotDeps> = {}) {
  const stopped = new Set<string>(); const logs: unknown[] = []; let n = 0;
  const d: AutopilotDeps = { now: () => Date.parse("2026-10-27T15:00:00Z"), platformKill: () => false, start: () => `run_${String(++n).padStart(16, "0")}`,
    stop: async (id) => { stopped.add(id); }, stats: (id) => ({ equity: 1000, peak: 1000, starting: 1000, stopped: stopped.has(id), status: "running" }), logError: (m, x) => logs.push({ m, ...x }), ...over };
  return { ap: new AutopilotService(d), stopped, logs };
}

describe("M4.9.1 autopilot kill partial result", () => {
  it("one throwing stop is logged, the rest still stop, and the result lists the failure", async () => {
    const stopped = new Set<string>();
    const { ap, logs } = mk({ stop: async (id) => { if (id === "run_bad") throw Object.assign(new Error("boom"), { code: "venue_down" }); stopped.add(id); }, stats: (id) => ({ equity: 1, peak: 1, starting: 1, stopped: stopped.has(id), status: "running" }) });
    await ap.put("u1", cfg()); ap.users.get("u1")!.owned.push("run_a", "run_bad", "run_c");
    const r = await ap.disable("u1", "killed", "kill switch");
    expect(r).toEqual({ stopped: 2, failed: [{ runId: "run_bad", reason: "venue_down" }] });
    expect([...stopped].sort()).toEqual(["run_a", "run_c"]); expect(logs).toHaveLength(1); expect(JSON.stringify(logs)).not.toMatch(/boom/);
    expect(ap.users.get("u1")!.killed).toBe(true); expect(ap.users.get("u1")!.log.at(-1)!.reason).toMatch(/1 failed to stop/);
  });
});

describe("M4.9.1 stepAll", () => {
  it("runs users in parallel up to the cap, and a stuck user times out without blocking the others", async () => {
    let active = 0, peak = 0; const started: string[] = [];
    const { ap, logs } = mk({ concurrency: 3, userTimeoutMs: 50, start: (uid) => { started.push(uid); return `run_${uid}`; } });
    for (let i = 0; i < 7; i++) await ap.put(`u${i}`, cfg());
    const orig = ap.step.bind(ap);
    (ap as any).step = (u: string) => { active++; peak = Math.max(peak, active); return (u === "u0" ? new Promise<void>(() => {}) : new Promise<void>((r) => setTimeout(r, 5)).then(() => orig(u))).finally(() => active--); };
    const t0 = Date.now(); await ap.stepAll(); const dt = Date.now() - t0;
    expect(peak).toBe(3); expect(started.sort()).toEqual(["u1", "u2", "u3", "u4", "u5", "u6"]); expect(dt).toBeLessThan(1000);
    expect(logs).toEqual([expect.objectContaining({ m: "autopilot pass timed out", userId: "u0" })]);
  });
});

import { budgeted, type LlmBudget } from "../../src/compile/index";
describe("M4.9.1 LLM cost reservation (B1)", () => {
  it("concurrent calls reserve before running, so the daily cap cannot be overshot by parallel calls", async () => {
    const d = { usd: 0, reserved: 0, maxCall: 0 }; const cap = 0.12, estBase = 0.05;
    const b: LlmBudget = { capUsd: cap, spentToday: () => d.usd + d.reserved, add: (u) => { d.usd += u; },
      reserve: () => { const est = Math.max(estBase, d.maxCall); if (d.usd + d.reserved + est > cap) return null; d.reserved += est; return est; },
      settle: (est, a) => { d.reserved -= est; d.usd += a; d.maxCall = Math.max(d.maxCall, a); } };
    let ran = 0; const call = () => budgeted(b, async () => { ran++; await new Promise((r) => setTimeout(r, 5)); return { costUsd: 0.05 }; });
    const rs = await Promise.all([call(), call(), call(), call()]);
    expect(ran).toBe(2); expect(rs.filter((r) => r === null)).toHaveLength(2); expect(d.usd).toBeCloseTo(0.1); expect(d.reserved).toBe(0);
    const failing = await budgeted(b, async () => { throw new Error("x"); }).catch(() => "threw"); expect(failing).toBe(null); // no room left: refused, never called
  });
});
