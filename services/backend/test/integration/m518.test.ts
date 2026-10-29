// M5.18 optional Tiingo history (mocked HTTP only) + external-wallet copy "coming soon" (501 not_available).
import { afterEach, describe, expect, it, vi } from "vitest";
import * as A from "../../contracts/src/api";
import { MarketHistoryRes } from "../../contracts/src/market";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { fetchTiingoHttp, TiingoHistory, TiingoTooLarge, type TiingoHttp } from "../../src/venues/tiingo";
import { btcStrategy } from "../helpers";

const KEY = "tk_TEST_not_a_real_key_123";
const NOW = Date.parse("2026-10-27T15:00:00Z");
const NVDA = "robinhood:token:0x00000000000000000000000000000000000000a1";
type Req = Parameters<TiingoHttp>[0];
/** Mock Tiingo: daily → one adjusted bar per weekday; IEX → bars every resampleFreq, `date` = bar start. */
function mockTiingo(fail?: "500" | "throw" | "big") {
  const calls: Req[] = [];
  const http: TiingoHttp = async (q) => {
    calls.push(q);
    if (fail === "500") return { status: 500, text: "oops" };
    if (fail === "throw") throw new Error(`network down for ${q.headers.Authorization}`);
    if (fail === "big") throw new TiingoTooLarge();
    const u = new URL(q.url); const from = Date.parse(u.searchParams.get("startDate")!), to = Date.parse(u.searchParams.get("endDate")!) + 86_400_000;
    const rows: unknown[] = [];
    if (u.pathname.startsWith("/tiingo/daily/")) {
      for (let d = from; d < to; d += 86_400_000) { const wd = new Date(d).getUTCDay(); if (wd === 0 || wd === 6) continue; const p = 100 + (d - from) / 86_400_000;
        rows.push({ date: new Date(d).toISOString(), open: 1, high: 1, low: 1, close: 1, adjOpen: p, adjHigh: p + 1, adjLow: p - 1, adjClose: p + 0.5 }); }
    } else {
      const step = { "15min": 900_000, "1hour": 3_600_000, "4hour": 14_400_000 }[u.searchParams.get("resampleFreq")!]!;
      for (let t = from; t < to; t += step) rows.push({ date: new Date(t).toISOString(), open: 200, high: 201, low: 199, close: 200.5 });
    }
    return { status: 200, text: JSON.stringify(rows) };
  };
  return { http, calls };
}

async function setup(o: { key?: string; fail?: "500" | "throw" | "big" } = {}) {
  const t = mockTiingo(o.fail);
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...(o.key ? { TIINGO_API_KEY: o.key } : {}) }), clock: new ManualClock(NOW), autoTimers: false, compileDelayMs: 0, tiingoHttp: t.http });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => {
    tok ||= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m518-ana-user-label-xx" }) })).json() as any).accessToken;
    const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: r.status, j: await r.json() as any };
  };
  return { q, call, calls: t.calls };
}
const hist = (s: Awaited<ReturnType<typeof setup>>, id: string, qs: string) => s.call("GET", `/markets/${encodeURIComponent(id)}/history?${qs}`);
afterEach(() => vi.restoreAllMocks());

describe("M5.18 Tiingo market history", () => {
  it("uses Tiingo daily bars for a stock when the key is set; key only in the auth header; cached", async () => {
    const s = await setup({ key: KEY });
    const r = await hist(s, NVDA, "tf=1d&range=30d"); expect(r.status).toBe(200);
    const h = MarketHistoryRes.parse(r.j);
    expect(h.dataSource).toBe("tiingo"); expect(h.synthetic).toBe(false); expect(h.notice).toBeNull();
    expect(h.coverage).toEqual([expect.objectContaining({ source: "tiingo_daily", synthetic: false })]);
    expect(h.bars.length).toBeGreaterThan(15); expect(h.bars.every((b) => b.t.endsWith("T21:00:00.000Z"))).toBe(true);
    expect(Date.parse(h.bars.at(-1)!.t)).toBeLessThanOrEqual(NOW);
    expect(s.calls).toHaveLength(1); expect(s.calls[0].url).toMatch(/^https:\/\/api\.tiingo\.com\/tiingo\/daily\/nvda\/prices\?startDate=/);
    expect(s.calls[0].url).not.toContain(KEY); expect(s.calls[0].headers.Authorization).toBe(`Token ${KEY}`);
    expect(s.calls[0].timeoutMs).toBeGreaterThan(0); expect(s.calls[0].maxBytes).toBeGreaterThan(0);
    await hist(s, NVDA, "tf=1d&range=30d"); expect(s.calls).toHaveLength(1); // cache hit
  });
  it("uses IEX intraday bars for 1h/4h/15m (bar stamped at end, no unfinished bar)", async () => {
    const s = await setup({ key: KEY });
    const h = MarketHistoryRes.parse((await hist(s, NVDA, "tf=1h&range=7d")).j);
    expect(h.dataSource).toBe("tiingo"); expect(h.coverage[0].source).toBe("tiingo_iex");
    expect(s.calls[0].url).toContain("/iex/nvda/prices?"); expect(s.calls[0].url).toContain("resampleFreq=1hour");
    expect(h.bars.at(-1)!.t).toBe("2026-10-27T15:00:00.000Z"); expect(h.bars.length).toBeLessThanOrEqual(168);
    await hist(s, NVDA, "tf=4h&range=30d"); expect(s.calls[1].url).toContain("resampleFreq=4hour");
  });
  it("falls back to the current source on any failure, never logging the key", async () => {
    for (const fail of ["500", "throw", "big"] as const) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const s = await setup({ key: KEY, fail });
      const h = MarketHistoryRes.parse((await hist(s, NVDA, "tf=1h&range=7d")).j);
      expect(h.dataSource).toBe("fallback"); expect(h.synthetic).toBe(true); expect(h.bars.length).toBe(168);
      expect(warn).toHaveBeenCalled(); expect(warn.mock.calls.flat().join(" ")).not.toContain(KEY);
      warn.mockRestore();
    }
  });
  it("key unset or non-stock instrument → fallback without any HTTP call", async () => {
    const a = await setup();
    expect((await hist(a, NVDA, "tf=1h&range=7d")).j.dataSource).toBe("fallback"); expect(a.calls).toHaveLength(0);
    const b = await setup({ key: KEY });
    expect((await hist(b, "hl:perp:BTC", "tf=1h&range=7d")).j.dataSource).toBe("fallback"); expect(b.calls).toHaveLength(0);
  });
});

describe("M5.18 TiingoHistory client", () => {
  it("rate-limits per hour, dedupes in-flight calls and rejects bad symbols/timeframes", async () => {
    let now = NOW; const t = mockTiingo(); const c = new TiingoHistory({ key: KEY, http: t.http, now: () => now, maxPerHour: 2, log: () => {} });
    const [x, y] = await Promise.all([c.bars("AAPL", 86_400_000, NOW - 10 * 86_400_000, NOW), c.bars("AAPL", 86_400_000, NOW - 10 * 86_400_000, NOW)]);
    expect(x).toBe(y); expect(t.calls).toHaveLength(1);
    expect(await c.bars("TSLA", 86_400_000, NOW - 5 * 86_400_000, NOW)).not.toBeNull();
    expect(await c.bars("SPY", 86_400_000, NOW - 5 * 86_400_000, NOW)).toBeNull(); expect(c.stats.rateLimited).toBe(1); expect(t.calls).toHaveLength(2);
    now += 3_600_001; expect(await c.bars("SPY", 86_400_000, NOW - 5 * 86_400_000, NOW)).not.toBeNull();
    expect(await c.bars("../x", 86_400_000, NOW - 86_400_000, NOW)).toBeNull(); expect(await c.bars("SPY", 120_000, NOW - 86_400_000, NOW)).toBeNull();
    expect(await new TiingoHistory({ key: "" , http: t.http }).bars("SPY", 86_400_000, NOW - 86_400_000, NOW)).toBeNull();
  });
  it("default fetch hook: redirect=error, timeout signal, size cap (mocked fetch)", async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => { expect(init.redirect).toBe("error"); expect(init.signal).toBeDefined(); return new Response("x".repeat(5000)); });
    vi.stubGlobal("fetch", f);
    await expect(fetchTiingoHttp({ url: "https://api.tiingo.com/x", headers: {}, timeoutMs: 1000, maxBytes: 1000 })).rejects.toBeInstanceOf(TiingoTooLarge);
    expect((await fetchTiingoHttp({ url: "https://api.tiingo.com/x", headers: {}, timeoutMs: 1000, maxBytes: 10_000 })).text.length).toBe(5000);
    vi.unstubAllGlobals();
  });
});

const nvdaStrategy = () => btcStrategy({ name: "NVDA", signals: [{ id: "nv", kind: "price", maxAgeSeconds: 120, params: { instrument: NVDA } }],
  triggers: [{ id: "t1", forMinutes: 0, cooldownMinutes: 0, maxFires: 100, when: { op: "gt", left: { ref: "nv.value" }, right: { lit: 0 } } }],
  actions: [{ id: "a1", type: "open", on: ["t1"], instrument: NVDA, side: "buy", size: { unit: "usd", value: "1000" }, order: { type: "market", maxSlippageBps: 100, maxPriceImpactBps: 200 } }] });
async function backtest(s: Awaited<ReturnType<typeof setup>>, strategy: unknown, resolution = "1d") {
  const r = await s.call("POST", "/backtests", { strategy, from: resolution === "1d" ? "2026-09-01T00:00:00Z" : "2026-10-13T00:00:00Z", to: "2026-10-27T00:00:00Z", resolution, startingEquityUsd: "10000" });
  expect(r.status, JSON.stringify(r.j).slice(0, 600)).toBe(202); expect(r.j.dataSource).toBe("fallback");
  let b: any; for (let i = 0; i < 100; i++) { b = (await s.call("GET", `/backtests/${r.j.id}`)).j; if (b.status === "done" || b.status === "failed") break; await new Promise((x) => setTimeout(x, 20)); }
  return A.BacktestRes.parse(b);
}
describe("M5.18 Tiingo backtests", () => {
  it("stock backtest uses Tiingo daily bars when available and says so", async () => {
    const s = await setup({ key: KEY }); const b = await backtest(s, nvdaStrategy());
    expect(b.status).toBe("done"); expect(b.dataSource).toBe("tiingo");
    expect(b.dataCoverage.map((c) => c.source)).toContain("tiingo_daily");
    expect(b.result!.caveats.join(" ")).toContain("Tiingo"); expect(s.calls).toHaveLength(1);
    const h = await backtest(s, nvdaStrategy(), "1h"); // IEX intraday: decisions in market hours → the buy fills at a Tiingo price
    expect(h.dataSource).toBe("tiingo"); expect(h.dataCoverage.map((c) => c.source)).toContain("tiingo_iex"); expect(s.calls[1].url).toContain("resampleFreq=1hour");
    expect(h.result!.fills.length).toBeGreaterThan(0); expect(h.result!.fills.every((f) => Number(f.price) > 199 && Number(f.price) < 202)).toBe(true); // Tiingo price ±modeled costs
  });
  it("falls back on failure, without key, and for non-stock strategies", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = await setup({ key: KEY, fail: "500" }); const b1 = await backtest(f, nvdaStrategy());
    expect(b1.status).toBe("done"); expect(b1.dataSource).toBe("fallback"); expect(b1.dataCoverage.map((c) => c.source)).not.toContain("tiingo_daily");
    const n = await setup(); expect((await backtest(n, nvdaStrategy())).dataSource).toBe("fallback"); expect(n.calls).toHaveLength(0);
    const c = await setup({ key: KEY }); expect((await backtest(c, btcStrategy())).dataSource).toBe("fallback"); expect(c.calls).toHaveLength(0);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(KEY);
  });
});

describe("M5.18 external-wallet copy is coming soon", () => {
  it("returns 501 not_available on wallet copy routes and on POST /copy with a wallet address", async () => {
    const s = await setup();
    for (const [m, p, b] of [["GET", "/copy/wallet"], ["POST", "/copy/wallet", { address: "0x" + "1".repeat(40) }], ["GET", "/copy/wallet/0xabc"], ["POST", "/copy", { address: "0x" + "1".repeat(40) }], ["POST", "/copy", { walletAddress: "0x" + "2".repeat(40), publicStrategyId: "x" }]] as const) {
      const r = await s.call(m, p, b); expect(r.status, `${m} ${p} ${JSON.stringify(r.j)}`).toBe(501); expect(r.j.error.code).toBe("not_available"); expect(r.j.error.message).toMatch(/coming soon/i);
    }
    expect((await s.call("GET", "/copy")).status).toBe(200);
  });
});
