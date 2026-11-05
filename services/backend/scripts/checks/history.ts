import assert from "node:assert/strict";
import { Workflow, type MarketCandidate } from "../../contracts/src/workflow";
import { Risk } from "../../contracts/src/strategy";
import { Registry, MOCK_INSTRUMENTS } from "../../src/venues/registry";
import { replayWorkflowHistory, type HistoryDeps } from "../../src/workflows/history";

const M = 60_000,
  start = Date.parse("2026-11-01T12:00:00Z"),
  now = start + 6 * 3_600_000;
const period = { from: start, to: start + 2 * M, timeframe: "1m" as const };
const limit = Risk.parse({ maxPositionPct: 100 });
function asset(
  id: string,
  market: Partial<MarketCandidate> & Pick<MarketCandidate, "id" | "symbol" | "kind" | "venue" | "source">,
): Workflow["assets"][number] {
  return {
    id,
    query: market.symbol,
    sourceText: market.symbol,
    venue: market.venue,
    kind: market.kind,
    outcome: market.outcome ?? null,
    resolution: {
      status: "matched",
      selectedId: market.id,
      checkedAt: new Date(start).toISOString(),
      message: "fixture",
      candidates: [
        {
          name: market.symbol,
          url: null,
          address: null,
          maxLeverage: 10,
          endDate: null,
          outcome: null,
          ...market,
        },
      ],
    },
  };
}
const btc = asset("btc", {
  id: "hl:perp:BTC",
  symbol: "BTC",
  kind: "perp",
  venue: "hyperliquid",
  source: "hyperliquid",
});
const fed = asset("fed", {
  id: "pm:outcome:345:YES",
  symbol: "Yes",
  kind: "outcome",
  venue: "polymarket",
  source: "polymarket",
  address: "897123",
  outcome: "Yes",
});
const aapl = asset("stock", {
  id: "robinhood:token:0x00000000000000000000000000000000000000a2",
  symbol: "AAPL",
  kind: "token",
  venue: "robinhood",
  source: "preview_catalog",
});
const sol = asset("sol", {
  id: "sol:token:So11111111111111111111111111111111111111112",
  symbol: "SOL",
  kind: "token",
  venue: "solana",
  source: "dexscreener",
  address: "So11111111111111111111111111111111111111112",
});
const w = Workflow.parse({
  version: 1,
  name: "Fed odds to BTC",
  summary: "",
  budgetUsd: 1000,
  assets: [btc, fed],
  signals: [
    {
      id: "watch",
      assetId: "fed",
      kind: "odds",
      description: "Exact Yes probability",
      indicator: null,
      schedule: null,
    },
  ],
  stages: [
    {
      id: "long",
      assetId: "btc",
      side: "long",
      sourceText: "Long BTC",
      conditionText: "",
      when: { op: "gt", left: { ref: "watch.value" }, right: { lit: 0.6 } },
      after: [],
      amount: { unit: "usd", value: 100 },
      leverage: 1,
      funding: { kind: "budget", from: [] },
      repeat: null,
      exits: {
        stopLossPct: null,
        takeProfitPct: null,
        trailingStopPct: null,
        timeExitHours: null,
        ladder: [],
        description: "",
      },
    },
  ],
  questions: [],
  assumptions: [],
});
function candle(at: number, close: number, sym = "BTC") {
  return { t: at - M, T: at - 1, i: "1m", s: sym, c: String(close), o: "100", h: "99999", l: "1", n: 14 };
}
const quotes = [
  candle(start + 2 * M, 90),
  candle(start, 100),
  candle(start + M, 110),
  candle(start + M, 110),
  candle(start + 3 * M, 99999),
];
const gamma = { id: "345", outcomes: '["Yes","No"]', clobTokenIds: '["897123","897124"]' };
const marketFixture = (bars: unknown, history: unknown) => async (url: string) =>
  url.includes("hyperliquid") ? bars : url.includes("gamma-api") ? gamma : history;
let requests = 0;
const mixed = await replayWorkflowHistory(w, period, limit, {
  now,
  getJson: async (url, req) => {
    requests++;
    if (url === "https://api.hyperliquid.xyz/info") {
      assert.equal(req?.method, "POST");
      const body = JSON.parse(req!.body as string);
      assert.equal(body.type, "candleSnapshot");
      assert.equal(body.req.coin, "BTC");
      assert.equal(body.req.interval, "1m");
      assert.equal(body.req.endTime, period.to);
      return quotes;
    }
    if (url === "https://gamma-api.polymarket.com/markets/345") return gamma;
    const p = new URL(url);
    assert.equal(p.origin, "https://clob.polymarket.com");
    assert.equal(p.pathname, "/prices-history");
    assert.equal(p.searchParams.get("market"), "897123");
    assert.equal(p.searchParams.get("fidelity"), "1");
    assert.equal(p.searchParams.has("interval"), false);
    assert.equal(Number(p.searchParams.get("startTs")), start / 1000 - 1);
    return {
      history: [
        { t: (start + 90_000) / 1000, p: 0.7 },
        { t: (start + 30_000) / 1000, p: 0.5 },
        { t: (start + 3 * M) / 1000, p: 1 },
      ],
    };
  },
});
assert.equal(requests, 3);
assert.equal(mixed.status, "partial");
assert(mixed.coverage.every((c) => c.status === "observed"));
assert.equal(mixed.stageCoverage[0].usableFrames, 4);
assert.equal(mixed.stageCoverage[0].missingFrames, 1);
assert.equal(mixed.result!.steps, 5);
assert.equal(mixed.result!.fills.length, 1);
assert.equal(mixed.result!.fills[0].at, start + 90_000);
assert.equal(mixed.result!.fills[0].price, 110);
assert.equal(mixed.result!.modeledFeesUsd, 0.1);
assert.equal(mixed.coverage[0].observations, 3);
assert.equal(mixed.coverage[1].observations, 2);
assert(
  mixed.result!.endingEquityUsd !== null &&
    Math.abs(mixed.result!.endingEquityUsd - (1000 - 0.1 - 100 * (20 / 110))) < 1e-8,
);
console.log(
  "PASS chronological exact token + perpetual, no lookahead, future boundary, deduped bars, real fill fee, modeled P&L",
);

const single = structuredClone(w);
single.assets = [btc];
single.signals[0] = { ...single.signals[0], kind: "price", assetId: "btc" };
single.stages[0].when = { op: "gt", left: { ref: "watch.value" }, right: { lit: 500 } };
const intrabar = await replayWorkflowHistory(single, period, limit, { now, getJson: async () => quotes });
assert.equal(intrabar.result!.fillsTotal, 0);
const changed = structuredClone(single);
changed.signals[0] = {
  ...changed.signals[0],
  kind: "price_change",
  change: { reference: "lookback", lookbackMinutes: 2 },
};
changed.stages[0].when = { op: "gt", left: { ref: "watch.value" }, right: { lit: 40 } };
const hist = [
  candle(start - 2 * M, 80),
  candle(start - M, 100),
  candle(start, 140),
  candle(start + M, 140),
  candle(start + 2 * M, 140),
];
const warm = await replayWorkflowHistory(changed, period, limit, { now, getJson: async () => hist });
assert.equal(warm.coverage[0].warmupBars, 2);
assert.equal(warm.coverage[0].warmupShort, false);
assert.equal(warm.result!.fills[0].at, start);
assert.equal(warm.result!.fills[0].price, 140);
changed.signals[0].change = { reference: "start", lookbackMinutes: null };
const startRelative = await replayWorkflowHistory(changed, period, limit, { now, getJson: async () => hist });
assert.equal(startRelative.result!.fillsTotal, 0);
const ma = structuredClone(single);
ma.signals[0] = {
  ...ma.signals[0],
  kind: "indicator",
  indicator: { name: "sma", period: 2, timeframe: "1m" },
};
ma.stages[0].when = { op: "gt", left: { ref: "watch.value" }, right: { lit: 100 } };
const warmIndicator = await replayWorkflowHistory(ma, period, limit, {
  now,
  getJson: async () => [candle(start - 3 * M, 20), candle(start - 2 * M, 50), ...hist.slice(1)],
});
assert.equal(warmIndicator.result!.fills[0].at, start);
assert.equal(warmIndicator.coverage[0].warmupShort, false);
console.log(
  "PASS completed closes only, capped input warm-up without early orders or shifted starting anchor, no intrabar high/low fill",
);

const mixedMissing = await replayWorkflowHistory(w, period, limit, {
  now,
  getJson: marketFixture(quotes, { history: [] }),
});
assert.equal(mixedMissing.result, null);
assert.equal(mixedMissing.coverage[1].status, "unavailable");
const noOverlap = await replayWorkflowHistory(w, { ...period, to: start + 7 * M }, limit, {
  now,
  getJson: marketFixture([candle(start, 100)], { history: [{ t: (start + 7 * M) / 1000, p: 0.7 }] }),
});
assert.equal(noOverlap.result, null);
assert.equal(noOverlap.stageCoverage[0].usableFrames, 0);
assert(noOverlap.coverage.every((c) => c.observations === 1));
const wrongToken = structuredClone(w);
wrongToken.assets[1].resolution!.candidates[0].address = "897124";
const wrongOutcome = await replayWorkflowHistory(wrongToken, period, limit, {
  now,
  getJson: marketFixture(quotes, { history: [] }),
});
assert.equal(wrongOutcome.result, null);
assert.match(wrongOutcome.coverage[1].issue!, /token registered for this event/);
const waiting = structuredClone(w);
waiting.assets[1] = sol;
waiting.signals[0].assetId = "sol";
waiting.signals[0].kind = "price";
const unsupported = await replayWorkflowHistory(waiting, period, limit, { now, getJson: async () => quotes });
assert.equal(unsupported.result, null);
assert.match(unsupported.coverage[1].issue!, /Historical data is unavailable/);
const conflict = await replayWorkflowHistory(single, period, limit, {
  now,
  getJson: async () => [candle(start, 100), candle(start, 101)],
});
assert.equal(conflict.result, null);
assert.match(conflict.coverage[0].issue!, /conflicting/);
const wrong = await replayWorkflowHistory(single, period, limit, {
  now,
  getJson: async () => [candle(start, 1, "ETH")],
});
assert.equal(wrong.result, null);
assert.match(wrong.coverage[0].issue!, /did not match/);
const zero = await replayWorkflowHistory(w, period, limit, {
  now,
  getJson: marketFixture(quotes, { history: [{ t: start / 1000, p: 0 }] }),
});
assert.equal(zero.result, null);
assert.match(zero.coverage[1].issue!, /does not establish settlement/);
const funding = structuredClone(single);
funding.signals[0].kind = "funding";
let called = false;
const noFetch: HistoryDeps = {
  now,
  getJson: async () => {
    called = true;
    return [];
  },
};
assert.equal((await replayWorkflowHistory(funding, period, limit, noFetch)).result, null);
assert.equal(called, false);
const settlement = structuredClone(single);
settlement.stages.push({
  ...structuredClone(settlement.stages[0]),
  id: "follow",
  after: [{ stageId: "long", event: "resolved_profit" }],
});
const noSettlement = await replayWorkflowHistory(settlement, period, limit, noFetch);
assert.equal(noSettlement.result, null);
assert.match(noSettlement.issues[0], /resolution event/);
assert.equal(called, false);
assert.equal(
  (await replayWorkflowHistory(single, { ...period, from: start - 1000 * M }, limit, noFetch)).result,
  null,
);
assert.equal(called, false);
const withoutLookahead = structuredClone(single);
withoutLookahead.stages[0].when = { op: "gt", left: { ref: "watch.value" }, right: { lit: 1 } };
const short = await replayWorkflowHistory(withoutLookahead, { ...period, to: start + 7 * M }, limit, {
  now,
  getJson: async () => [candle(start, 100)],
});
assert.equal(short.status, "partial");
assert.equal(short.result!.endingEquityUsd, null);
console.log(
  "PASS gaps, missing sources, foreign symbol and conflicting duplicates fail closed; funding/settlement not inferred; stale final valuation withheld",
);

const equity = structuredClone(single);
equity.assets = [aapl];
equity.stages[0].assetId = "stock";
equity.stages[0].side = "buy";
equity.signals[0].assetId = "stock";
const registry = new Registry(MOCK_INSTRUMENTS);
const stocks = await replayWorkflowHistory(equity, period, limit, {
  now,
  ownerId: "owner",
  registry,
  tiingo: {
    bars: async (symbol, ms, _from, _to, owner) => {
      assert.equal(symbol, "AAPL");
      assert.equal(ms, M);
      assert.equal(owner, "owner");
      return [start - M, start, start + M, start + 2 * M, start + 3 * M].map((t, i) => ({
        t,
        c: 600 + i,
        o: 600 + i,
        h: 600 + i,
        l: 600 + i,
      }));
    },
  },
});
assert.equal(stocks.coverage[0].source, "tiingo_iex_underlying");
assert.equal(stocks.coverage[0].observations, 3);
assert.equal(stocks.result!.fills[0].price, 601);
const spoof = structuredClone(equity);
spoof.assets[0].resolution!.candidates[0].symbol = "NVDA";
const rejected = await replayWorkflowHistory(spoof, period, limit, { ...noFetch, registry });
assert.equal(rejected.result, null);
assert.match(rejected.coverage[0].issue!, /symbol mapping/);
console.log(
  "PASS verified underlying symbol on existing Tiingo interface, owner rate-limit forwarded, out-of-range bars ignored",
);

// The issuer-backed mainnet token can have a different id to the legacy paper catalogue.
const issuerEquity = structuredClone(equity);
const address = "0x" + "41".repeat(20);
const candidate = issuerEquity.assets[0].resolution!.candidates[0];
Object.assign(candidate,{id:"robinhood:token:"+address,source:"robinhood_registry",address});
issuerEquity.assets[0].resolution!.selectedId=candidate.id;
const issuerDeps = {
  now, getJson: async () => ({ assets: [{tokenSymbol:"AAPL",status:"ASSET_STATUS_ACTIVE",deployments:[{chainId:4663,contractAddress:address}]}] }),
  tiingo:{ bars: async () => [start,start+M,start+2*M].map(t=>({t,o:1,c:1,h:1,l:1})) },
};
assert.equal((await replayWorkflowHistory(issuerEquity,period,limit,issuerDeps)).coverage[0].observations,3);
candidate.address = "0x" + "42".repeat(20);
assert.match((await replayWorkflowHistory(issuerEquity,period,limit,issuerDeps)).coverage[0].issue!,/symbol mapping/);
