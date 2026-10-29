// M4.9.2 — a flatten that resolves after the 5 s stop cap must not change paper positions (blocked + counted).
import { describe, expect, it } from "vitest";
import { RunManager } from "../../src/runs/manager";
import { ManualClock } from "../../src/lib/clock";
import { btcStrategy, env, T0 } from "../helpers";

describe("M4.9.2 late flatten fill", () => {
  it("is blocked after the stop timeout; positions and cash are unchanged", async () => {
    const { registry, mkt, adapters } = env(); const clock = new ManualClock(T0);
    const m = new RunManager({ clock, mkt, adapters, registry, cycleMs: 15_000, killSwitch: () => false, validateEvents: false, autoTimers: false, stopTimeoutMs: 30 });
    const run = { id: "r1", ownerId: "u", strategyId: "s1", strategyVersion: 1, mode: "paper", status: "starting", startedAt: T0, stoppedAt: null, startingEquity: 10_000, events: [] as any[] } as any;
    m.start(run, btcStrategy({ triggers: [{ id: "t1", forMinutes: 0, cooldownMinutes: 0, maxFires: 1, when: { op: "gt", left: { ref: "btc.value" }, right: { lit: 1 } } }] }), () => true); const ex = m.live.get("r1")!.ex;
    for (let i = 0; i < 40 && ex.acct.positions.size === 0; i++) { clock.advance(15_000); await m.tick("r1"); }
    expect(ex.acct.positions.size).toBeGreaterThan(0);
    const before = JSON.stringify([...ex.acct.positions.values()]); const fills = ex.fills.length;
    for (const ad of Object.values(adapters) as any[]) { const q = ad.quote.bind(ad); ad.quote = async (...a: any[]) => { await new Promise((r) => setTimeout(r, 150)); return q(...a); }; }
    const t0 = Date.now(); await m.control("r1", "stop_and_flatten"); expect(Date.now() - t0).toBeLessThan(140);
    expect(run.status).toBe("stopped"); expect(run.events.some((e: any) => e.type === "warning" && e.code === "flatten_timeout")).toBe(true);
    const n = run.events.length; await new Promise((r) => setTimeout(r, 300)); // the late quote resolves now
    expect(JSON.stringify([...ex.acct.positions.values()])).toBe(before); expect(ex.fills.length).toBe(fills);
    expect(ex.blockedFills).toBeGreaterThan(0); expect(run.events.length).toBe(n);
  });
});
