import { describe, expect, it } from "vitest";
import { budgeted } from "../../src/compile";
import { callOpenRouter } from "../../src/compile/openrouter";
import { MemStore } from "../../src/store";
import { durableSnapshot, restoreDurable } from "../../src/storage/postgres";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

describe("provider setup and spending", () => {
  it("persists the reservation before the paid call, then persists the actual cost", async () => {
    const order: string[] = []; let settled = 0;
    const budget = { capUsd: 5, spentToday: () => 0, add: () => {}, reserve: () => { order.push("reserve"); return .5; }, settle: (_: number, n: number) => { order.push("settle"); settled = n; }, checkpoint: async () => { order.push("commit"); } };
    await budgeted(budget, async () => { order.push("provider"); return { costUsd: .002 }; });
    expect(order).toEqual(["reserve", "commit", "provider", "settle", "commit"]); expect(settled).toBe(.002);
  });
  it("retains a conservative cost when a paid call times out", async () => {
    let settled = 0;
    const budget = { capUsd: 5, spentToday: () => 0, add: () => {}, reserve: () => .5, settle: (_: number, n: number) => { settled = n; } };
    await expect(budgeted(budget, async () => { throw new Error("timeout"); })).rejects.toThrow("timeout"); expect(settled).toBe(.5);
  });
  it("restores daily usage and treats an interrupted reservation as spent", () => {
    const store = new MemStore(); store.llmDaily.set("2026-10-29", { day: "2026-10-29", usd: .3, reserved: .5, maxCall: .2 });
    const restored = new MemStore(); restoreDurable(restored, JSON.parse(JSON.stringify(durableSnapshot(store))));
    const q = createApp({ store: restored, autoTimers: false, clock: new ManualClock(Date.parse("2026-10-29T12:00:00Z")), config: loadConfig({}) });
    expect(restored.llmDaily.get("2026-10-29")).toEqual({ day: "2026-10-29", usd: .8, reserved: 0, maxCall: .2 }); q.runs.shutdown();
  });
  it("requires structured-output support and uses supported GPT-5 parameters", async () => {
    const original = globalThis.fetch; const bodies: any[] = [];
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return Response.json({ choices: [{ message: { content: "{}" } }], usage: { cost: .001 } }); }) as typeof fetch;
    try {
      for (const model of ["openai/gpt-4.1-mini", "openai/gpt-5-mini"]) await callOpenRouter({ apiKey: "test-placeholder", model, maxTokens: 4000, system: "rules", user: "idea" });
      expect(bodies[0].temperature).toBe(0); expect(bodies[0].provider.require_parameters).toBe(true);
      expect(bodies[1].temperature).toBeUndefined(); expect(bodies[1].reasoning).toEqual({ effort: "low", exclude: true });
    } finally { globalThis.fetch = original; }
  });
});
