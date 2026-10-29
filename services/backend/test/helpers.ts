import fixture from "../contracts/fixtures/strategy.nvda-fed.json";
import { Strategy } from "../contracts/src/strategy";
import { mockAdapters } from "../src/venues/adapters";
import { MockMarket } from "../src/venues/market";
import { MOCK_INSTRUMENTS, Registry } from "../src/venues/registry";

export const fixtureStrategy = () => Strategy.parse((({ _comment, ...r }) => r)(structuredClone(fixture) as any));
export const env = () => { const registry = new Registry(MOCK_INSTRUMENTS); const mkt = new MockMarket(registry); return { registry, mkt, adapters: mockAdapters(mkt, registry) }; };
export const T0 = Date.parse("2026-10-27T15:00:00Z"); // Tuesday 11:00 New York (NYSE open)
/** BTC perp: buy when price > threshold. */
export const btcStrategy = (over: Record<string, unknown> = {}) => Strategy.parse({
  schemaVersion: 1, name: "BTC breakout", thesis: "Long BTC when it breaks 100k",
  signals: [{ id: "btc", kind: "price", maxAgeSeconds: 120, params: { instrument: "hl:perp:BTC" } }],
  triggers: [{ id: "t1", forMinutes: 0, cooldownMinutes: 0, maxFires: 1, when: { op: "gt", left: { ref: "btc.value" }, right: { lit: 100000 } } }],
  actions: [{ id: "a1", type: "open", on: ["t1"], instrument: "hl:perp:BTC", side: "long", size: { unit: "usd", value: "1000" }, leverage: 2, order: { type: "market", maxSlippageBps: 100, maxPriceImpactBps: 200 }, exits: { stopLoss: { unit: "pct", value: "5" } } }],
  risk: { maxPositionPct: 25, maxTotalExposurePct: 100, maxDailyLossPct: 10, maxOrdersPerDay: 20, equityWhenFeedStale: "skip" },
  ...over,
});
