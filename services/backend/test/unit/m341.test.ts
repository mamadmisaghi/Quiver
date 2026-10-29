import { describe, expect, it } from "vitest";
import { runBacktest } from "../../src/backtest/backtest";
import { nyseSession } from "../../src/venues/calendar";
import { Strategy } from "../../contracts/src/strategy";
import { Executor, type EventBody } from "../../src/sim/executor";
import type { MarketData } from "../../src/venues/market";
import { btcStrategy, env } from "../helpers";

const NVDA = "robinhood:token:0x00000000000000000000000000000000000000a1";
const nvdaBuy = () => Strategy.parse({ ...btcStrategy(), name: "NVDA now", thesis: "Buy NVDA right away",
  signals: [{ id: "n", kind: "price", maxAgeSeconds: 86_400, params: { instrument: NVDA } }],
  triggers: [{ id: "t1", forMinutes: 0, cooldownMinutes: 0, maxFires: 1, when: { op: "gt", left: { ref: "n.value" }, right: { lit: 0 } } }],
  actions: [{ id: "a1", type: "open", on: ["t1"], instrument: NVDA, side: "buy", size: { unit: "usd", value: "200" }, order: { type: "market", maxSlippageBps: 100, maxPriceImpactBps: 200 } }] });
const ET = (s: string) => Date.parse(s); // explicit offsets below (EDT -04:00 / EST -05:00)

describe("M3.4.1 NYSE session boundaries are [start, end)", () => {
  it.each([
    ["2026-10-22T19:59:59.999-04:00", "post"], ["2026-10-22T20:00:00-04:00", "closed"],
    ["2026-10-22T03:59:59.999-04:00", "closed"], ["2026-10-22T04:00:00-04:00", "pre"],
    ["2026-10-22T09:30:00-04:00", "open"], ["2026-10-22T16:00:00-04:00", "post"],
    ["2026-11-26T12:00:00-05:00", "closed"], // Thanksgiving holiday
    ["2026-11-27T12:59:59.999-05:00", "open"], ["2026-11-27T13:00:00-05:00", "post"], // early close
    ["2026-11-27T16:59:59.999-05:00", "post"], ["2026-11-27T17:00:00-05:00", "closed"],
    ["2026-10-24T12:00:00-04:00", "closed"], // Saturday
  ])("%s → %s", (t, s) => expect(nyseSession(ET(t))).toBe(s));
});

async function oneBar(fromIso: string, mkt?: MarketData) {
  const e = env(); const from = ET(fromIso);
  const evs: EventBody[] = [];
  const m = mkt ?? e.mkt;
  const ex = new Executor({ strategy: nvdaBuy(), mkt: m, adapters: e.adapters, registry: e.registry, startingEquity: 10_000, stockTokensAllowed: () => true, killSwitch: () => false, fillModel: "next_bar", feeModel: "default", emit: (b) => evs.push(b) });
  await ex.cycle(from + 3_600_000 - 1, { emitTick: false }); ex.settlePending(from + 3_600_000);
  return { fills: ex.fills, rejects: evs.filter((x: any) => x.type === "rejected").map((x: any) => x.code) };
}
describe("M3.4.1 Stock Token fills need an active session at the fill time", () => {
  it("decision 19:59:59.999 ET, fill bar opens exactly 20:00 ET → rejected market_closed", async () => {
    const r = await oneBar("2026-10-22T19:00:00-04:00"); expect(r.fills).toHaveLength(0); expect(r.rejects).toEqual(["market_closed"]);
  });
  it("decision 03:59:59.999 ET is closed → rejected at placement; decision 04:59:59.999 ET (pre) fills at 05:00 ET", async () => {
    expect((await oneBar("2026-10-22T03:00:00-04:00")).rejects).toEqual(["market_closed"]);
    const ok = await oneBar("2026-10-22T04:00:00-04:00"); expect(ok.fills).toHaveLength(1); expect(ok.rejects).toEqual([]);
  });
  it("early close: decision 16:59:59.999 ET fills at 17:00 ET → rejected; holiday → rejected", async () => {
    expect((await oneBar("2026-11-27T16:00:00-05:00")).rejects).toEqual(["market_closed"]);
    expect((await oneBar("2026-11-26T11:00:00-05:00")).rejects).toEqual(["market_closed"]);
  });
  it("normal core hours fill", async () => { expect((await oneBar("2026-10-22T10:00:00-04:00")).fills).toHaveLength(1); });
  it("all-stale window: every NVDA price stale → no fills, market_closed rejects, honest caveat", async () => {
    const e = env(); const base = e.mkt;
    const stale: MarketData = { synthetic: true, closes: base.closes.bind(base), bars: base.bars.bind(base), funding: base.funding.bind(base), session: base.session.bind(base),
      price: (id, t) => { const p = base.price(id, t); return p && id === NVDA ? { ...p, stale: true, staleReason: "market_closed" } : p; } };
    const r = (await runBacktest({ strategy: nvdaBuy(), from: ET("2026-10-21T00:00:00Z"), to: ET("2026-10-23T00:00:00Z"), resolution: "1h", startingEquity: 10_000, feeModel: "default" },
      { mkt: stale, adapters: e.adapters, registry: e.registry, stockTokensAllowed: true }))!;
    expect(r.result.trades).toBe(0); expect(Number(r.result.returnPct)).toBe(0); expect(r.result.caveats.join(" ")).toMatch(/No trades/);
  });
});
