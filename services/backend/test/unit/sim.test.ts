import { describe, expect, it } from "vitest";
import { RunEvent } from "../../contracts/src/events";
import { runBacktest } from "../../src/backtest/backtest";
import { PaperAccount } from "../../src/sim/account";
import { Executor, type EventBody } from "../../src/sim/executor";
import { newId } from "../../src/lib/ids";
import { gate, inTradingHours } from "../../src/sim/risk";
import { btcStrategy, env, T0 } from "../helpers";

const base = { killSwitch: false, stockTokensAllowed: true, isEquity: false, reducing: false, tradingHoursOk: true, ordersToday: 0, maxOrdersPerDay: 10, positionUsdAfter: 100, equity: 10_000, maxPositionPct: 25, exposureAfter: 100, maxTotalExposurePct: 100, cashNeeded: 100, freeCash: 10_000 };
describe("risk gate order", () => {
  it("passes a normal order", () => expect(gate(base)).toBeNull());
  it("kill switch first", () => expect(gate({ ...base, killSwitch: true, ordersToday: 99 })?.code).toBe("kill_switch"));
  it("geo before limits; closes allowed", () => {
    expect(gate({ ...base, isEquity: true, stockTokensAllowed: false, positionUsdAfter: 1e9 })?.code).toBe("geo_restricted");
    expect(gate({ ...base, isEquity: true, stockTokensAllowed: false, reducing: true })).toBeNull();
  });
  it("max position, exposure, funds, session key caps", () => {
    expect(gate({ ...base, positionUsdAfter: 2600 })?.code).toBe("max_position");
    expect(gate({ ...base, exposureAfter: 10_001 })?.code).toBe("max_total_exposure");
    expect(gate({ ...base, freeCash: 50 })?.code).toBe("insufficient_funds");
    expect(gate({ ...base, sessionKey: { perTxCapUsd: 50, dailyCapUsd: 1000, spentTodayUsd: 0, notional: 100 } })?.code).toBe("session_key_cap");
    expect(gate({ ...base, sessionKey: { perTxCapUsd: 500, dailyCapUsd: 150, spentTodayUsd: 100, notional: 100 } })?.code).toBe("session_key_cap");
  });
  it("trading hours incl. overnight", () => {
    const r: any = { tradingHours: { tz: "UTC", days: ["tue"], from: "22:00", to: "02:00" } };
    expect(inTradingHours(r, Date.parse("2026-10-27T23:00:00Z"))).toBe(true);
    expect(inTradingHours(r, Date.parse("2026-10-27T12:00:00Z"))).toBe(false);
  });
});
describe("paper account", () => {
  it("spot buy then sell realizes PnL", () => {
    const { registry } = env(); const m = registry.get("hl:perp:BTC")!; const spot = { ...m, kind: "token" as const, id: "x" };
    const a = new PaperAccount(1000); a.apply(spot, 1, 100, 0, 0, "a", 1); expect(a.cash).toBe(900);
    const r = a.apply(spot, -1, 110, 0, 1, "a", 1); expect(r).toBeCloseTo(10); expect(a.cash).toBeCloseTo(1010);
  });
  it("perp reserves margin not notional", () => {
    const { registry } = env(); const m = registry.get("hl:perp:BTC")!;
    const a = new PaperAccount(1000); a.apply(m, 0.01, 100_000, 1, 0, "a", 2);
    expect(a.cash).toBe(999); expect(a.marginUsed()).toBeCloseTo(500); expect(a.equity(() => 101_000)).toBeCloseTo(1009);
  });
});
function harness(strategy = btcStrategy()) {
  const e = env(); const events: EventBody[] = [];
  const ex = new Executor({ strategy, ...e, startingEquity: 10_000, stockTokensAllowed: () => true, killSwitch: () => false, fillModel: "quote", emit: (b) => events.push(b) });
  return { ...e, ex, events };
}
describe("executor (paper)", () => {
  it("fires, fills once, emits schema-valid events", async () => {
    const h = harness(); h.mkt.overrides.set("hl:perp:BTC", () => 101_000);
    await h.ex.cycle(T0); await h.ex.cycle(T0 + 15_000);
    const fills = h.events.filter((e) => e.type === "fill"); expect(fills).toHaveLength(1);
    const f: any = fills[0]; expect(f.side).toBe("long"); expect(Number(f.notionalUsd)).toBeCloseTo(2000, -1); expect(f.simulated).toBe(true);
    h.events.forEach((b, i) => RunEvent.parse({ v: 1, seq: i, runId: newId("run"), mode: "paper", ts: new Date(T0).toISOString(), ...b }));
  });
  it("stop loss closes the position", async () => {
    const h = harness(); let px = 101_000; h.mkt.overrides.set("hl:perp:BTC", () => px);
    await h.ex.cycle(T0); px = 90_000; await h.ex.cycle(T0 + 15_000);
    expect(h.events.some((e) => e.type === "warning" && e.code === "stop_loss")).toBe(true);
    expect(h.ex.acct.positions.get("hl:perp:BTC")?.qty ?? 0).toBe(0);
  });
  it("stale feed => no trade + one stale warning", async () => {
    const h = harness(); h.mkt.overrides.set("hl:perp:BTC", () => null);
    await h.ex.cycle(T0); await h.ex.cycle(T0 + 15_000);
    expect(h.events.filter((e) => e.type === "fill")).toHaveLength(0);
    expect(h.events.filter((e) => e.type === "warning" && e.code === "signal_stale")).toHaveLength(1);
  });
  it("daily loss halts the run", async () => {
    const s = btcStrategy({ risk: { maxPositionPct: 100, maxTotalExposurePct: 100, maxDailyLossPct: 1, maxOrdersPerDay: 20, equityWhenFeedStale: "skip" } });
    (s.actions[0] as any).exits = undefined; (s.actions[0] as any).size.value = "5000";
    const h = harness(s); let px = 101_000; h.mkt.overrides.set("hl:perp:BTC", () => px);
    await h.ex.cycle(T0); px = 95_000; await h.ex.cycle(T0 + 15_000);
    expect(h.events.some((e) => e.type === "risk_halt" && e.rule === "max_daily_loss")).toBe(true); expect(h.ex.halted).toBe(true);
  });
  it("Polymarket orders are rejected read-only", async () => {
    const h = harness(); const ok = await h.ex.submit({ id: "x", type: "open", on: ["t1"], instrument: "pm:outcome:fed-cut-december:YES", side: "buy", size: { unit: "usd", value: "10" }, leverage: 1, order: { type: "market", maxSlippageBps: 50, maxPriceImpactBps: 100 } } as any, "ord_1", T0);
    expect(ok).toBe(false); expect(h.events.at(-1)).toMatchObject({ type: "rejected", code: "venue_read_only" });
  });
});
describe("backtest", () => {
  it("no look-ahead: decision at T-1 cannot see a jump at T; fill uses next-bar open", async () => {
    const e = env(); const jump = T0 + 3_600_000; e.mkt.overrides.set("hl:perp:BTC", (t) => (t >= jump ? 150_000 : 90_000));
    const out = await runBacktest({ strategy: btcStrategy(), from: T0, to: T0 + 4 * 3_600_000 + 1, resolution: "1h", startingEquity: 10_000, feeModel: "zero" }, { ...e, stockTokensAllowed: true });
    const trades = out!.result.fills as any[];
    expect(trades.length).toBeGreaterThan(0);
    // fired at the bar ending jump+1h (decided at jump+1h-1ms when price 150k is visible), filled at the open >= jump+1h
    expect(Date.parse(trades[0].ts)).toBeGreaterThanOrEqual(jump + 3_600_000);
    expect(out!.result.caveats.join(" ")).toMatch(/SYNTHETIC/);
  });
  it("is deterministic", async () => {
    const e = env(); const i = { strategy: btcStrategy({ triggers: [{ id: "t1", cooldownMinutes: 60, maxFires: null, when: { op: "gt", left: { ref: "btc.value" }, right: { lit: 0 } } }] }), from: T0 - 30 * 86_400_000, to: T0, resolution: "1h" as const, startingEquity: 10_000, feeModel: "default" as const };
    const a = await runBacktest(i, { ...e, stockTokensAllowed: true }), b = await runBacktest(i, { ...e, stockTokensAllowed: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
