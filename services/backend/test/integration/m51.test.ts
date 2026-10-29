// M5.1 — market detail page: history bars + stats, no look-ahead, bar cap, 404, auth.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { MarketDetailRes, MarketHistoryRes } from "../../contracts/src/market";

const NVDA = "robinhood:token:0x00000000000000000000000000000000000000a1";
async function setup() {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  const tok = ((await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m51-market-user-aaaaaaaa" }) })).json()) as { accessToken: string }).accessToken;
  const get = async (p: string, auth = true) => { const r = await q.app.request("/v1" + p, { headers: auth ? { authorization: `Bearer ${tok}` } : {} }); return { status: r.status, j: (await r.json()) as any }; };
  return { clock, get };
}
const enc = encodeURIComponent;

describe("M5.1 market detail", () => {
  it("history defaults to 1h × 7d: 168 bars, oldest first, none after now, stats consistent", async () => {
    const s = await setup(); const r = await s.get(`/markets/${enc(NVDA)}/history`);
    expect(r.status).toBe(200); const h = MarketHistoryRes.parse(r.j);
    expect(h).toMatchObject({ tf: "1h", range: "7d", synthetic: true }); expect(h.notice).toContain("Example data");
    expect(h.bars.length).toBeGreaterThan(100); expect(h.bars.length).toBeLessThanOrEqual(168);
    const ts = h.bars.map((b) => Date.parse(b.t)); expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    expect(Math.max(...ts)).toBeLessThanOrEqual(s.clock.now());
    expect(h.stats.bars).toBe(h.bars.length); expect(h.stats.last).toBe(h.bars.at(-1)!.c);
    expect(Number(h.stats.high)).toBeGreaterThanOrEqual(Math.max(...h.bars.map((b) => Number(b.h))) - 1e-6);
    expect(Number(h.stats.low)).toBeLessThanOrEqual(Number(h.stats.high));
  });
  it("other tf/range combos; > 500 bars → 422; bad enum → 422", async () => {
    const s = await setup();
    expect(MarketHistoryRes.parse((await s.get(`/markets/${enc(NVDA)}/history?tf=1d&range=1y`)).j).bars.length).toBeLessThanOrEqual(365);
    const big = await s.get(`/markets/${enc(NVDA)}/history?tf=15m&range=30d`); expect(big.status).toBe(422); expect(big.j.error.message).toContain("500");
    expect((await s.get(`/markets/${enc(NVDA)}/history?tf=2m`)).status).toBe(422);
  });
  it("detail returns market view + returns/30d stats; unknown market 404; signed out 401", async () => {
    const s = await setup(); const d = MarketDetailRes.parse((await s.get(`/markets/${enc(NVDA)}/detail`)).j);
    expect(d.market.symbol).toBe("NVDA"); expect(d.returns["1d"]).not.toBeNull(); expect(Number(d.high30d)).toBeGreaterThanOrEqual(Number(d.low30d));
    expect((await s.get(`/markets/${enc("robinhood:token:0xdead")}/detail`)).status).toBe(404);
    expect((await s.get(`/markets/${enc(NVDA)}/history`, false)).status).toBe(401);
  });
});
