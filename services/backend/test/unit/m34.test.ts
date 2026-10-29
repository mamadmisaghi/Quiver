import { describe, expect, it } from "vitest";
import { runBacktest } from "../../src/backtest/backtest";
import { demoCompile } from "../../src/compile/demo";
import { JupiterPrice } from "../../src/venues/jupiter";
import { ReadonlyMarket } from "../../src/venues/readonly-market";
import { redact } from "../../src/lib/redact";
import { loadConfig } from "../../src/config";
import { btcStrategy, env, T0 } from "../helpers";

const LANDING = "If Fed-cut odds on Polymarket pass 70% and NVDA trades under its 20-day average, buy $200 of NVDA on Robinhood Chain and open a 2× SOL long with $250 on Hyperliquid. Stop at −8%.";
const D = 86_400_000;
const bt = (e: ReturnType<typeof env>, strategy: any, from: number, to: number, mkt: any = e.mkt) =>
  runBacktest({ strategy, from, to, resolution: "1h", startingEquity: 10_000, feeModel: "default" }, { mkt, adapters: e.adapters, registry: e.registry, stockTokensAllowed: true });

describe("M3.4 backtest polish", () => {
  it("landing-prompt backtest is deterministic and matches the regression snapshot", async () => {
    const e = env(); const d = demoCompile(LANDING, e.registry); if (!d.ok) throw new Error("compile");
    const a = (await bt(e, d.strategy, T0 - 30 * D, T0))!, b = (await bt(env(), d.strategy, T0 - 30 * D, T0))!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const r = a.result;
    expect({ trades: r.trades, endingEquityUsd: r.endingEquityUsd, returnPct: r.returnPct, maxDrawdownPct: r.maxDrawdownPct, sharpe: r.sharpe, feesUsd: r.feesUsd,
      fires: r.triggerFires.length, fills: r.fills, coverage: a.coverage.map((c) => `${c.instrument}:${c.source}`) }).toMatchSnapshot();
  });
  it("range shorter than one bar is rejected", async () => {
    await expect(bt(env(), btcStrategy(), T0 - 3_000_000, T0)).rejects.toThrow(/at least one full bar/);
  });
  it("exactly one bar works", async () => {
    const r = (await bt(env(), btcStrategy(), T0 - 3_600_000, T0))!; expect(r.result.equityCurve.length).toBe(1); expect(r.result.sharpe).toBeNull();
  });
  it("zero trades and all-no-data windows get honest caveats, not 'real data'", async () => {
    const e = env(); const d = demoCompile(LANDING, e.registry); if (!d.ok) throw new Error("compile");
    const ro = new ReadonlyMarket(e.registry, {} as any, () => false); // no verified feeds → NVDA has no data
    const r = (await bt(e, d.strategy, T0 - 3 * D, T0, ro))!;
    expect(r.result.trades).toBe(0); expect(Number(r.result.returnPct)).toBe(0);
    expect(r.result.caveats.join(" ")).toMatch(/No price data for NVDA/); expect(r.result.caveats.join(" ")).toMatch(/No trades/);
    expect(r.result.caveats.join(" ")).toMatch(/SYNTHETIC/); expect(r.result.caveats.join(" ")).not.toMatch(/Chainlink mainnet feed rounds/);
  });
});
describe("M3.4 JUP 24h change", () => {
  it("uses Jupiter priceChange24h (vendor), null when absent", async () => {
    const j = new JupiterPrice("M", "u", async () => ({ M: { usdPrice: 0.27, priceChange24h: -0.79 } })); await j.refresh(1e9);
    expect(j.price(1e9)?.change24hPct).toBe(-0.79);
    const k = new JupiterPrice("M", "u", async () => ({ M: { usdPrice: 0.27 } })); await k.refresh(1e9); expect(k.price(1e9)?.change24hPct).toBeUndefined();
  });
});
describe("M3.4 security helpers", () => {
  it("redacts secrets from log strings", () => {
    const s = redact("Bearer abc.def-ghi https://u:p@h.x/?token=SECRET123&x=1 sk-or-v1-abcdef123456 0x" + "a".repeat(64) + " eyJhbGciOiJI.eyJzdWIiOiJ1.c2ln");
    for (const bad of ["abc.def", "u:p@", "SECRET123", "sk-or-v1", "a".repeat(64), "eyJhbGciOiJI"]) expect(s).not.toContain(bad);
  });
  it("CORS_ORIGINS must be exact origins", () => {
    expect(() => loadConfig({ QUIVR_MODE: "mock", CORS_ORIGINS: "*" })).toThrow();
    expect(() => loadConfig({ QUIVR_MODE: "mock", CORS_ORIGINS: "https://*.x.com" })).toThrow();
    expect(loadConfig({ QUIVR_MODE: "mock", CORS_ORIGINS: "http://localhost:3000, https://quiver.app" }).CORS_ORIGINS).toBeTruthy();
  });
});
