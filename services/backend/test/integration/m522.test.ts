// M5.22 Slice A: machine-readable warmup on history/backtest + HealthRes contract.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { Warmup, WARMUP_NOTICE } from "../../src/warmup";
import { HealthRes } from "../../contracts/src/ops";
import { MarketHistoryRes } from "../../contracts/src/market";
import { BacktestRes } from "../../contracts/src/api";
import { btcStrategy, T0 } from "../helpers";

const mk = (w?: Warmup) => createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0, warmup: w });
const login = async (q: ReturnType<typeof mk>) => (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m522-user-label-xx" }) })).json() as any).accessToken as string;
const W = { code: "warming_up", message: WARMUP_NOTICE };

async function backtest(q: ReturnType<typeof mk>, tok: string) {
  const h = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
  const r = await (await q.app.request("/v1/backtests", { method: "POST", headers: h, body: JSON.stringify({ strategy: btcStrategy(), from: new Date(T0 - 3 * 86_400_000).toISOString(), to: new Date(T0).toISOString(), resolution: "1h" }) })).json() as any;
  let b: any; for (let i = 0; i < 100; i++) { b = await (await q.app.request(`/v1/backtests/${r.id}`, { headers: h })).json(); if (b.status === "done") break; await new Promise((x) => setTimeout(x, 20)); }
  return b;
}

describe("M5.22 Slice A", () => {
  it("/health matches HealthRes (strict) warming and ready", async () => {
    const w = new Warmup(); const q = mk(w);
    const h = HealthRes.parse(await (await q.app.request("/v1/health")).json()); expect(h).toMatchObject({ ready: false, notice: W });
    expect(HealthRes.parse(await (await mk().app.request("/v1/health")).json()).notice).toBeNull();
  });
  it("history: warmup true + warmupNotice while warming; false/null after", async () => {
    const w = new Warmup(); const q = mk(w); const tok = await login(q); const id = q.registry.all()[0].id;
    const get = async () => MarketHistoryRes.parse(await (await q.app.request(`/v1/markets/${encodeURIComponent(id)}/history?tf=1d&range=30d`, { headers: { authorization: `Bearer ${tok}` } })).json());
    expect(await get()).toMatchObject({ warmup: true, warmupNotice: W, notice: WARMUP_NOTICE });
    await w.start(async () => {}, 1000); expect(await get()).toMatchObject({ warmup: false, warmupNotice: null });
  });
  it("backtest: warmup flag set when it finished during warmup; cleared otherwise", async () => {
    const q = mk(new Warmup()); const b = BacktestRes.parse(await backtest(q, await login(q)));
    expect(b).toMatchObject({ status: "done", warmup: true, warmupNotice: W }); expect(b.result!.caveats[0]).toBe(WARMUP_NOTICE);
    const q2 = mk(); const b2 = BacktestRes.parse(await backtest(q2, await login(q2))); expect(b2).toMatchObject({ warmup: false, warmupNotice: null });
  });
});
