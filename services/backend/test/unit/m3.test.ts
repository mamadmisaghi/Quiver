import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/backtest/metrics";
import { runBacktest } from "../../src/backtest/backtest";
import { closedSince, nyseSession } from "../../src/venues/calendar";
import { COSTS, modelFill } from "../../src/sim/costs";
import { ReadonlyMarket } from "../../src/venues/readonly-market";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { ChainlinkReader, dropOutliers, type ReadClient } from "../../src/venues/chainlink";
import { TiingoEod } from "../../src/venues/eod-vendor";
import { SseSubscriber } from "../../src/api/sse";
import { Executor, type EventBody } from "../../src/sim/executor";
import { RunManager } from "../../src/runs/manager";
import { ManualClock } from "../../src/lib/clock";
import { Verified } from "../../src/verify/loader";
import { btcStrategy, env, fixtureStrategy, T0 } from "../helpers";
import type { RunEvent } from "../../contracts/src/events";

const H = 3_600_000, D = 24 * H;
const NVDA = "robinhood:token:0x00000000000000000000000000000000000000a1";

describe("metrics", () => {
  it("hand-computed return, drawdown, Sharpe, Sortino, win rate, profit factor", () => {
    const curve: [number, number][] = [[0, 100], [D, 110], [2 * D, 99], [3 * D, 121]];
    const m = computeMetrics(curve, 100, [5, -2, 3]);
    expect(m.returnPct).toBeCloseTo(21);
    expect(m.maxDrawdownPct).toBeCloseTo(10); // 110 → 99
    expect(m.maxDrawdownDurationMs).toBe(D);
    const r = [0.1, -0.1, 121 / 99 - 1]; const mean = r.reduce((a, b) => a + b) / 3;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / 2);
    expect(m.sharpe!).toBeCloseTo((mean / sd) * Math.sqrt(365), 8);
    expect(m.sortino!).toBeCloseTo((mean / Math.sqrt(0.01 / 2)) * Math.sqrt(365), 8);
    expect(m.winRatePct).toBeCloseTo(66.667, 2); expect(m.profitFactor).toBeCloseTo(4); expect(m.avgLossUsd).toBe(-2);
  });
  it("loss on the first bar counts (start prepended); flat curve → Sharpe null; no trades → win rate null", () => {
    expect(computeMetrics([[D, 90]], 100, []).maxDrawdownPct).toBeCloseTo(10);
    const flat = computeMetrics([[0, 100], [H, 100], [2 * H, 100], [3 * H, 100]], 100, []);
    expect(flat.sharpe).toBeNull(); expect(flat.winRatePct).toBeNull(); expect(flat.profitFactor).toBeNull();
  });
  it("annualization follows sample spacing (hourly = √8760)", () => {
    const c: [number, number][] = [[0, 100], [H, 101], [2 * H, 100.5], [3 * H, 102]];
    const r = [0.01, 100.5 / 101 - 1, 102 / 100.5 - 1]; const mean = r.reduce((a, b) => a + b) / 3; const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / 2);
    expect(computeMetrics(c, 100, []).sharpe!).toBeCloseTo((mean / sd) * Math.sqrt(8760), 8);
  });
});

describe("NYSE calendar", () => {
  it("holidays, early close, weekends, DST", () => {
    expect(nyseSession(Date.parse("2026-11-26T15:00:00Z"))).toBe("closed"); // Thanksgiving
    expect(nyseSession(Date.parse("2026-11-27T17:30:00Z"))).toBe("open"); // 12:30 ET early-close day
    expect(nyseSession(Date.parse("2026-11-27T19:00:00Z"))).toBe("post"); // 14:00 ET after 13:00 close
    expect(nyseSession(Date.parse("2026-11-27T22:30:00Z"))).toBe("closed"); // 17:30 ET, late session ended 17:00
    expect(nyseSession(Date.parse("2026-10-31T15:00:00Z"))).toBe("closed"); // Saturday
    expect(nyseSession(Date.parse("2026-03-09T14:00:00Z"))).toBe("open"); // 10:00 EDT after DST
    expect(nyseSession(Date.parse("2026-03-06T14:00:00Z"))).toBe("pre"); // 09:00 EST before DST
  });
  it("closedSince finds the start of the weekend", () => {
    const s = closedSince(Date.parse("2026-11-01T12:00:00Z"))!; // Sunday
    expect(new Date(s).toISOString()).toBe("2026-10-31T00:00:00.000Z"); // Fri 20:00 EDT
    expect(closedSince(Date.parse("2026-10-27T15:00:00Z"))).toBeNull();
  });
});

describe("cost model", () => {
  it("spread widens 3x pre/post for equities; fee + gas; zero fee model", () => {
    const base = { venue: "robinhood" as const, ref: 100, side: 1 as const, notional: 1000, depthUsd: 400_000, isEquity: true };
    const o = modelFill({ ...base, session: "open" }), p = modelFill({ ...base, session: "pre" });
    expect(p.spreadBps).toBe(3 * o.spreadBps);
    expect(o.impactBps).toBeCloseTo(100 * Math.sqrt(1000 / 400_000));
    expect(o.price).toBeCloseTo(100 * (1 + (o.spreadBps + o.impactBps) / 1e4));
    expect(o.feeUsd).toBeCloseTo(1000 * COSTS.robinhood.feeBps / 1e4); expect(o.gasUsd).toBe(COSTS.robinhood.gasUsd);
    expect(modelFill({ ...base, session: "open", feeModel: "zero" }).feeUsd).toBe(0);
    expect(modelFill({ ...base, side: -1, session: "open" }).price).toBeLessThan(100);
  });
});

function roMarket(rounds: Record<string, { t: number; v: number }[]>) {
  const reg = new Registry(MOCK_INSTRUMENTS);
  const m = new ReadonlyMarket(reg, { gaps: new Map() } as unknown as ChainlinkReader, (s) => s in rounds);
  for (const [s, r] of Object.entries(rounds)) { (m as any).rounds.set(s, r.map((x, i) => ({ roundId: BigInt(i + 1), answer: x.v, updatedAt: x.t }))); (m as any).latest.set(s, { value: 1 }); }
  return { m, reg };
}
describe("staleness + market hours (mainnet-readonly)", () => {
  const fri = Date.parse("2026-10-30T19:59:00Z"); // Fri 15:59 ET, last NVDA round
  it("weekend: equity carries the Friday close as stale(market_closed); Monday open with no new round → null", () => {
    const { m } = roMarket({ NVDA: [{ t: fri - D, v: 200 }, { t: fri, v: 210 }] });
    const sat = m.price(NVDA, Date.parse("2026-11-01T15:00:00Z"))!;
    expect(sat.value).toBe(210); expect(sat.stale).toBe(true); expect(sat.staleReason).toBe("market_closed");
    expect(m.price(NVDA, fri + H)!.stale).toBeUndefined(); // within heartbeat: fresh
    expect(m.price(NVDA, Date.parse("2026-11-03T15:00:00Z"))).toBeNull(); // Tue open, 3+ days old
  });
  it("crypto feed has no market-closed carry: older than heartbeat → null", () => {
    const { m, reg } = roMarket({ ETH: [{ t: fri, v: 2300 }] });
    const weth = reg.all().find((x) => x.venue === "robinhood" && x.symbol === "WETH");
    if (weth) expect(m.price(weth.id, fri + 2 * D)).toBeNull();
  });
  it("executor rejects Stock Token orders while the market is closed", async () => {
    const { registry, mkt, adapters } = env(); const ev: EventBody[] = [];
    const s = btcStrategy({ signals: [{ id: "n", kind: "price", maxAgeSeconds: 600, params: { instrument: NVDA } }],
      triggers: [{ id: "t1", forMinutes: 0, cooldownMinutes: 0, maxFires: 1, when: { op: "gt", left: { ref: "n.value" }, right: { lit: 0 } } }],
      actions: [{ id: "a1", type: "open", on: ["t1"], instrument: NVDA, side: "buy", size: { unit: "usd", value: "200" }, leverage: 1, order: { type: "market", maxSlippageBps: 300, maxPriceImpactBps: 300 } }] });
    const ex = new Executor({ strategy: s, mkt, adapters, registry, startingEquity: 10_000, stockTokensAllowed: () => true, killSwitch: () => false, fillModel: "quote", emit: (b) => ev.push(b) });
    await ex.cycle(Date.parse("2026-10-31T15:00:00Z")); // Saturday
    expect(ev.some((e) => e.type === "rejected" && (e as any).code === "market_closed")).toBe(true);
    expect(ev.some((e) => e.type === "fill")).toBe(false);
  });
});

describe("Chainlink history robustness", () => {
  it("retries transient failures, skips persistent ones as gaps, drops mis-scaled rounds", async () => {
    const v = Verified.load("config/verified/4663-readonly.json"); const f = v.feed("NVDA")!;
    const NOW = Date.parse("2026-10-27T10:00:00Z"); const tries = new Map<bigint, number>();
    const round = (i: bigint) => [(1n << 64n) | i, (i === 1n ? 2_000_000_000n : 200n) * 10n ** 8n, 0n, BigInt(Math.floor((NOW - Number(120n - i) * H) / 1000)), 0n] as const;
    const client = { async getCode() { return "0x" as const; }, async readContract(a: any) {
      if (a.functionName === "latestRoundData") return round(120n);
      const id = a.args[0] & ((1n << 64n) - 1n); const n = (tries.get(id) ?? 0) + 1; tries.set(id, n);
      if (id === 60n) throw new Error("rpc 429"); // always fails
      if (id % 7n === 0n && n === 1) throw new Error("rpc 429"); // fails once
      return round(id);
    } } as unknown as ReadClient;
    const r = new ChainlinkReader(client, v, () => NOW); (r as any).checked.add(f.proxy);
    const h = await r.history("NVDA", 0);
    expect(r.gaps.get("NVDA")).toBe(1);
    expect(h.length).toBe(120 - 1 - 1); // minus the gap, minus the mis-scaled round 1
    expect(h.every((x) => x.answer === 200)).toBe(true);
    expect(dropOutliers([{ roundId: 1n, answer: 1, updatedAt: 1 }])).toHaveLength(1);
  }, 20_000);
});

describe("modeled EOD history (optional vendor)", () => {
  it("Tiingo: token header, close stamped 21:00Z (no look-ahead), used only before the first on-chain round", async () => {
    let seen: any;
    const fetchFn = async (url: string, init: any) => { seen = { url, init }; return { ok: true, status: 200, json: async () => [{ date: "2026-06-01T00:00:00.000Z", adjClose: 150, close: 151 }, { date: "2026-06-02T00:00:00.000Z", adjClose: 152 }] }; };
    const vend = new TiingoEod("k_test", fetchFn as any);
    const bars = await vend.daily("NVDA", Date.parse("2026-06-01"), Date.parse("2026-06-03"));
    expect(seen.init.headers.Authorization).toBe("Token k_test"); expect(seen.url).not.toContain("k_test");
    expect(bars[0]).toEqual({ t: Date.parse("2026-06-01T21:00:00Z"), close: 150 });
    const first = Date.parse("2026-06-22T00:00:43Z");
    const { m } = roMarket({ NVDA: [{ t: first, v: 208 }, { t: first + H, v: 209 }] });
    await m.loadModeled(vend, Date.parse("2026-05-01"));
    expect(m.price(NVDA, Date.parse("2026-06-01T20:00:00Z"))).toBeNull(); // before that close existed
    expect(m.price(NVDA, Date.parse("2026-06-02T12:00:00Z"))!.source).toBe("modeled_eod_tiingo");
    const cov = m.coverage(NVDA, Date.parse("2026-06-01"), first + 2 * H);
    expect(cov.map((c) => c.source)).toEqual(["modeled_eod_tiingo", "chainlink_mainnet_readonly"]);
  });
});

const ev = (seq: number): RunEvent => ({ v: 1, seq, runId: "run_x", mode: "paper", ts: new Date(0).toISOString(), type: "status", status: "running" } as unknown as RunEvent);
describe("SSE subscriber", () => {
  it("resume replays only seq > cursor, then live in order without duplicates", async () => {
    const out: string[] = []; const s = new SseSubscriber({ write: async (f) => { out.push(f.id ?? f.event); await new Promise((r) => setTimeout(r, 1)); } }, 2, { heartbeatMs: 60_000, maxQueue: 100, now: Date.now }, () => {});
    await s.start([], [ev(0), ev(1), ev(2), ev(3), ev(4)]);
    s.push(ev(4)); s.push(ev(5)); s.push(ev(6)); s.push(ev(5));
    await new Promise((r) => setTimeout(r, 30)); s.close();
    expect(out).toEqual(["3", "4", "5", "6"]);
  });
  it("slow consumer: queue overflow → resync {lastSeq} and close (no unbounded memory)", async () => {
    const out: { event: string; data: string }[] = []; let closed = false;
    const s = new SseSubscriber({ write: (f) => { out.push(f); return f.event === "resync" ? Promise.resolve() : new Promise(() => {}); } }, -1, { heartbeatMs: 60_000, maxQueue: 5, now: Date.now }, () => { closed = true; });
    await s.start([], []);
    for (let i = 0; i < 10; i++) s.push(ev(i));
    await new Promise((r) => setTimeout(r, 20));
    expect(closed).toBe(true); expect(s.overflowed).toBe(true);
    expect(JSON.parse(out.find((x) => x.event === "resync")!.data)).toMatchObject({ lastSeq: -1, reconnectWithLastEventId: true });
  });
  it("heartbeat only after idle; write timeout closes the stream", async () => {
    let now = 0; const out: string[] = [];
    const s = new SseSubscriber({ write: async (f) => { out.push(f.event); } }, -1, { heartbeatMs: 1000, maxQueue: 10, now: () => now }, () => {});
    await s.start([], []); await s.heartbeat(); expect(out).toEqual([]);
    now = 1500; await s.heartbeat(); expect(out).toEqual(["heartbeat"]); s.close();
    let closed = false;
    const t = new SseSubscriber({ write: () => new Promise(() => {}) }, -1, { heartbeatMs: 1000, maxQueue: 10, writeTimeoutMs: 20, now: Date.now }, () => { closed = true; });
    await t.start([], []); t.push(ev(0)); await new Promise((r) => setTimeout(r, 60)); expect(closed).toBe(true);
  });
});

describe("engine waves", () => {
  it("1000 runs: one wave within budget, shared reads cached, overlapping waves/ticks skipped", async () => {
    const { registry, mkt, adapters } = env(); const clock = new ManualClock(T0);
    const m = new RunManager({ clock, mkt, adapters, registry, cycleMs: 15_000, killSwitch: () => false, validateEvents: false, autoTimers: false, concurrency: 64 });
    for (let i = 0; i < 1000; i++) m.start({ id: "r" + i, ownerId: "u", strategyId: "s" + i, strategyVersion: 1, mode: "paper", status: "starting", startedAt: T0, stoppedAt: null, startingEquity: 10_000, events: [] } as any, i % 2 ? fixtureStrategy() : btcStrategy(), () => true);
    clock.advance(15_000);
    const memo = (m as any).memo; memo.hits = 0;
    const a = m.runWave(), b = m.runWave(); await Promise.all([a, b]);
    expect(m.stats.overruns).toBe(1); expect(m.stats.lastWaveRuns).toBe(1000);
    expect(m.stats.lastWaveMs).toBeLessThan(5000); // budget: well under the 15 s cycle
    expect(memo.hits).toBeGreaterThan(memo.misses);
  }, 30_000);
});

describe("backtest result (M3 fields)", () => {
  it("returns stats + cost breakdown consistent with the curve", async () => {
    const { registry, mkt, adapters } = env();
    const r = (await runBacktest({ strategy: btcStrategy(), from: T0 - 7 * D, to: T0, resolution: "1h", startingEquity: 10_000, feeModel: "default" }, { mkt, adapters, registry, stockTokensAllowed: true }))!;
    expect(r.result.stats!.conventions).toMatch(/365 days/);
    const c = r.result.costs!; expect(Number(c.feesUsd) + Number(c.gasUsd)).toBeCloseTo(Number(r.result.feesUsd), 1);
    const mdd = Math.max(...r.result.equitySeries.map((p) => Number(p.drawdownPct))); expect(Number(r.result.maxDrawdownPct)).toBeGreaterThanOrEqual(mdd - 0.01);
    expect(r.result.caveats.join(" ")).toMatch(/SYNTHETIC/);
  });
});
