// M5.19 daily stock/ETF backtests: decide on the bar's close, fill at the next session's open (+ modeled slippage).
import { describe, expect, it } from "vitest";
import { Strategy } from "../../contracts/src/strategy";
import { runBacktest } from "../../src/backtest/backtest";
import { TiingoOverlay } from "../../src/venues/tiingo";
import { btcStrategy, env } from "../helpers";

const NVDA = "robinhood:token:0x00000000000000000000000000000000000000a1";
const DAY = 86_400_000;
const at = (d: string, hm = "21:00") => Date.parse(`${d}T${hm}:00Z`);
/** Daily bars (end 21:00Z) for the given trading dates; missing dates = no data (weekends/holidays). */
const series = (days: Record<string, { o: number; c: number }>) => Object.entries(days).map(([d, x]) => ({ o: x.o, h: Math.max(x.o, x.c), l: Math.min(x.o, x.c), c: x.c, t: at(d) }));
const buyAbove = (lit: number) => Strategy.parse({ ...btcStrategy(), name: "NVDA daily", thesis: "Buy NVDA on a close above a level",
  signals: [{ id: "n", kind: "price", maxAgeSeconds: 120, params: { instrument: NVDA } }],
  triggers: [{ id: "t1", forMinutes: 0, cooldownMinutes: 0, maxFires: 1, when: { op: "gt", left: { ref: "n.value" }, right: { lit } } }],
  actions: [{ id: "a1", type: "open", on: ["t1"], instrument: NVDA, side: "buy", size: { unit: "usd", value: "1000" }, order: { type: "market", maxSlippageBps: 100, maxPriceImpactBps: 200 } }] });
async function bt(days: Record<string, { o: number; c: number }>, from: string, to: string, lit = 150, resolution: "1d" | "1h" = "1d") {
  const e = env(); const m = new TiingoOverlay(e.mkt, new Map([[NVDA, { tfMs: resolution === "1d" ? DAY : 3_600_000, bars: series(days), source: "tiingo_daily" }]]));
  return (await runBacktest({ strategy: buyAbove(lit), from: Date.parse(from), to: Date.parse(to), resolution, startingEquity: 10_000, feeModel: "default" }, { mkt: m, adapters: e.adapters, registry: e.registry, stockTokensAllowed: true }))!.result;
}
const flat = (dates: string[], v = 100) => Object.fromEntries(dates.map((d) => [d, { o: v, c: v }]));

describe("M5.19 daily stock backtests fill at the next open", () => {
  it("decided on Monday's close, filled at Tuesday's open (09:30 ET) with slippage", async () => {
    const r = await bt({ ...flat(["2026-10-15", "2026-10-16"]), "2026-10-19": { o: 100, c: 160 }, "2026-10-20": { o: 170, c: 175 }, "2026-10-21": { o: 175, c: 175 } }, "2026-10-17T00:00:00Z", "2026-10-22T00:00:00Z");
    expect(r.fills).toHaveLength(1); const f = r.fills[0];
    expect(f.ts).toBe("2026-10-20T13:30:00.000Z"); // 09:30 EDT
    expect(Number(f.price)).toBeGreaterThan(170); expect(Number(f.price)).toBeLessThan(170 * 1.01); // open + modeled spread/impact, buy pays up
    expect(r.caveats.join(" ")).toMatch(/fill at the next session's open/); expect(r.caveats.join(" ")).not.toMatch(/not placed while the US market is closed/);
  });
  it("weekend gap: Friday's decision fills at Monday's open; holiday: Wednesday before Thanksgiving fills Friday", async () => {
    const w = await bt({ "2026-10-22": { o: 100, c: 100 }, "2026-10-23": { o: 100, c: 160 }, "2026-10-26": { o: 180, c: 181 }, "2026-10-27": { o: 181, c: 181 } }, "2026-10-23T00:00:00Z", "2026-10-28T00:00:00Z");
    expect(w.fills.map((f) => f.ts)).toEqual(["2026-10-26T13:30:00.000Z"]); expect(Number(w.fills[0].price)).toBeGreaterThan(180); expect(Number(w.fills[0].price)).toBeLessThan(181.8);
    const h = await bt({ "2026-11-24": { o: 100, c: 100 }, "2026-11-25": { o: 100, c: 160 }, "2026-11-27": { o: 190, c: 190 }, "2026-11-30": { o: 190, c: 190 } }, "2026-11-25T00:00:00Z", "2026-12-01T00:00:00Z");
    expect(h.fills.map((f) => f.ts)).toEqual(["2026-11-27T14:30:00.000Z"]); expect(Number(h.fills[0].price)).toBeGreaterThan(190); // 09:30 EST, after the Nov 26 holiday
  });
  it("no look-ahead: a high open does not trigger; the close does, and the fill uses the NEXT open, not that close", async () => {
    const r = await bt({ "2026-10-19": { o: 100, c: 100 }, "2026-10-20": { o: 300, c: 100 }, "2026-10-21": { o: 100, c: 200 }, "2026-10-22": { o: 120, c: 400 }, "2026-10-23": { o: 400, c: 400 } }, "2026-10-19T00:00:00Z", "2026-10-24T00:00:00Z");
    expect(r.fills).toHaveLength(1); expect(r.fills[0].ts).toBe("2026-10-22T13:30:00.000Z");
    expect(Number(r.fills[0].price)).toBeGreaterThan(120); expect(Number(r.fills[0].price)).toBeLessThan(121.5); // the 22nd's open, not its 400 close
  });
  it("an order decided on the last bar stays pending and is not filled", async () => {
    const r = await bt({ ...flat(["2026-10-19", "2026-10-20"]), "2026-10-21": { o: 100, c: 160 }, "2026-10-22": { o: 170, c: 170 } }, "2026-10-19T00:00:00Z", "2026-10-22T00:00:00Z");
    expect(r.fills).toHaveLength(0); expect(r.caveats.join(" ")).toMatch(/1 order\(s\) decided near the end of the range were still waiting for the next open and were not filled/);
    expect(Number(r.endingEquityUsd ?? 10_000)).toBe(10_000);
  });
});
