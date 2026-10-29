import { describe, expect, it } from "vitest";
import { RunManager } from "../../src/runs/manager";
import { ManualClock } from "../../src/lib/clock";
import { btcStrategy, env, T0 } from "../helpers";

const mk = () => {
  const { registry, mkt, adapters } = env(); const clock = new ManualClock(T0);
  const m = new RunManager({ clock, mkt, adapters, registry, cycleMs: 15_000, killSwitch: () => false, validateEvents: false, autoTimers: false });
  const run = { id: "r1", ownerId: "u", strategyId: "s1", strategyVersion: 1, mode: "paper", status: "starting", startedAt: T0, stoppedAt: null, startingEquity: 10_000, events: [] as any[] } as any;
  m.start(run, btcStrategy(), () => true);
  // slow venue: the in-flight tick is parked in checkExits for 300 ms
  (m.live.get("r1")!.ex as any).checkExits = () => new Promise((r) => setTimeout(r, 300));
  return { m, run, clock };
};

describe("M3.6 stop cancels immediately", () => {
  for (const action of ["stop", "stop_and_flatten"] as const) it(`${action}: no wait on the in-flight tick, no events after 'stopped'`, async () => {
    const { m, run, clock } = mk(); const seen: string[] = []; m.subscribe("r1", (e) => seen.push(e.type));
    clock.advance(15_000); const inflight = m.tick("r1");
    const t0 = Date.now(); await m.control("r1", action);
    if (action === "stop") expect(Date.now() - t0).toBeLessThan(100);
    expect(run.status).toBe("stopped"); const n = run.events.length;
    expect(run.events.at(-1)).toMatchObject({ type: "status", status: "stopped" });
    await inflight; await new Promise((r) => setTimeout(r, 350));
    expect(run.events.length).toBe(n); // nothing (no tick / "Checked signals") after the stop event
    expect(run.events.some((e: any) => e.type === "tick")).toBe(false);
    await m.tick("r1"); await m.runWave(); expect(run.events.length).toBe(n);
  });
});
