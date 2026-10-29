import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoCompile } from "../../src/compile/demo";
import { Strategy } from "../../contracts/src/strategy";
import { SignalValue } from "../../contracts/src/events";
import { hasErrors, validateStrategy } from "../../src/engine/validate";
import { MOCK_INSTRUMENTS } from "../../src/venues/registry";
import { exampleNotices } from "../../src/social/seed";
import { toSignalSource } from "../../src/venues/market";
import { env } from "../helpers";
const { registry } = env();

/** Landing page sample prompt (web/src/content/landing.ts SAMPLE_PROMPT), verbatim. */
const LANDING = "If Fed-cut odds on Polymarket pass 70% and NVDA trades under its 20-day average, buy $200 of NVDA on Robinhood Chain and open a 2× SOL long with $250 on Hyperliquid. Stop at −8%.";

describe("M3.2", () => {
  it("landing prompt matches the web copy (when the web repo is present)", () => {
    const f = new URL("../../../web/src/content/landing.ts", import.meta.url).pathname;
    if (existsSync(f)) expect(readFileSync(f, "utf8")).toContain(JSON.stringify(LANDING));
  });
  it("demo compiles the landing prompt into a 3-venue strategy, deterministically", () => {
    const r = demoCompile(LANDING, registry); if (!r.ok) throw new Error(r.message);
    Strategy.parse(r.strategy);
    expect(hasErrors(validateStrategy(r.strategy, { registry, stockTokensAllowed: true }).issues)).toBe(false);
    const s = r.strategy as any;
    const venues = new Set([...s.signals.filter((x: any) => x.params?.instrument).map((x: any) => registry.get(x.params.instrument)!.venue), ...s.actions.map((a: any) => registry.get(a.instrument)!.venue)]);
    expect([...venues].sort()).toEqual(["hyperliquid", "polymarket", "robinhood"]);
    expect(s.actions).toHaveLength(2);
    const [nv, sol] = s.actions;
    expect(nv).toMatchObject({ instrument: registry.bySymbol("NVDA")!.id, side: "buy", size: { unit: "usd", value: "200" }, leverage: 1, exits: { stopLoss: { unit: "pct", value: "8" } } });
    expect(sol).toMatchObject({ instrument: "hl:perp:SOL", side: "long", size: { unit: "usd", value: "250" }, leverage: 2, exits: { stopLoss: { unit: "pct", value: "8" } } });
    const w = s.triggers[0].when; expect(w.op).toBe("and");
    expect(w.args).toContainEqual({ op: "gt", left: { ref: "fed_odds.value" }, right: { lit: 0.7 } });
    expect(w.args.some((c: any) => c.op === "lt" && /nvda_sma20_1d/.test(c.right.ref))).toBe(true);
    expect(s.actions.every((a: any) => registry.get(a.instrument)!.venue !== "polymarket")).toBe(true); // PM is read-only
    expect(r.warnings.join(" ")).not.toMatch(/one market|Leverage only/);
    expect(JSON.stringify(demoCompile(LANDING, registry))).toBe(JSON.stringify(r));
  });
  it("single-market prompts keep the one-action behaviour", () => {
    const r = demoCompile("Buy $200 of NVDA if it drops below $120", registry); expect(r.ok && r.strategy.actions.length).toBe(1);
  });
  it("market display names never carry MOCK markers", () => {
    for (const m of MOCK_INSTRUMENTS) expect(m.name).not.toMatch(/MOCK|Stock Token,|placeholder/i);
  });
  it("SignalValue.source is the PriceSource-based enum; unknown sources fail closed to none", () => {
    expect(() => SignalValue.parse({ signalId: "x", field: "value", value: 1, observedAt: new Date().toISOString(), source: "computed", stale: false })).toThrow();
    expect(toSignalSource("chainlink_mainnet_readonly")).toBe("chainlink_mainnet_readonly");
    expect(toSignalSource("calendar")).toBe("calendar");
    expect(toSignalSource("whatever")).toBe("none");
  });
  it("example-data notices only mention mock mode when prices are mock", () => {
    const ro = exampleNotices("mainnet-readonly");
    for (const v of Object.values(ro)) { expect(v).toMatch(/^Example data\./); expect(v).not.toMatch(/mock mode/i); }
    expect(ro.leaderboard).toMatch(/Chainlink mainnet read-only/);
    expect(exampleNotices("mock").leaderboard).toMatch(/synthetic \(mock\) prices/);
  });
});
