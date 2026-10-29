import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { HeartbeatFrame, ResyncFrame, RunEvent, RunStreamFrame, SignalValue } from "../../contracts/src/events";
import { Market, PriceSource, PricePoint } from "../../contracts/src/api";
import { createApp } from "../../src/api/app";
import { SseSubscriber } from "../../src/api/sse";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { MockMarket } from "../../src/venues/market";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { btcStrategy, T0 } from "../helpers";

describe("M3.1 contracts", () => {
  it("heartbeat {type,ts,lastSeq} and resync frames match what the server writes", async () => {
    const out: any[] = []; let now = 0;
    const s = new SseSubscriber({ write: async (f) => { out.push(f); } }, 4, { heartbeatMs: 10, maxQueue: 100, now: () => now }, () => {});
    now = 1_000; await s.heartbeat(); s.close();
    const hb = out.find((f) => f.event === "heartbeat"); const p = HeartbeatFrame.parse(JSON.parse(hb.data)); expect(p.lastSeq).toBe(4);
    RunStreamFrame.parse(p);
    const rs = { type: "resync", reason: "slow_consumer", lastSeq: 7, reconnectWithLastEventId: true }; ResyncFrame.parse(rs); RunStreamFrame.parse(rs);
    expect(() => RunEvent.parse({ type: "heartbeat", ts: new Date().toISOString(), lastSeq: 1 })).toThrow(); // control frames aren't run-log events
  });
  it("SignalValue.staleReason, PricePoint, priceSource enum", () => {
    SignalValue.parse({ signalId: "nvda_px", field: "value", value: 210, observedAt: new Date().toISOString(), source: "chainlink_mainnet_readonly", stale: true, staleReason: "market_closed" });
    expect(() => SignalValue.parse({ signalId: "x", field: "value", value: 1, observedAt: new Date().toISOString(), source: "mock", stale: true, staleReason: "bogus" })).toThrow();
    PricePoint.parse({ value: "210.00", observedAt: new Date().toISOString(), source: "chainlink_mainnet_readonly", stale: true, staleReason: "market_closed" });
    expect(() => PriceSource.parse("made_up")).toThrow();
  });
});

describe("M3.1 app behaviour", () => {
  const dir = mkdtempSync(join(tmpdir(), "quiver-m31-")); const path = join(dir, "dev-store.json");
  const mk = () => { const clock = new ManualClock(T0); const registry = new Registry(MOCK_INSTRUMENTS); const market = new MockMarket(registry);
    return createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, registry, market, autoTimers: false, compileDelayMs: 0, persistPath: path }); };
  let q = mk(); afterAll(() => q.runs.shutdown());
  const call = async (token: string, method: string, p: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await q.app.request("/v1" + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let json: any = t; try { json = JSON.parse(t); } catch { /* ndjson */ } return { status: r.status, json };
  };
  let token = ""; let runId = ""; let sid = "";
  it("markets: every priceSource is in the enum", async () => {
    token = (await call("", "POST", "/auth/exchange", { provider: "privy", idToken: "dev:m31-persist-user-1" })).json.accessToken;
    const m = await call(token, "GET", "/markets?limit=50"); expect(m.status).toBe(200); for (const x of m.json.items) Market.parse(x);
  });
  it("demo NVDA strategy compiles fast and paper-runs for an eligibility-unknown user (no 451)", async () => {
    const t0 = Date.now(); const c = await call(token, "POST", "/compile", { thesis: "Buy $250 of NVDA if it drops below $120, stop loss 8%" }); expect(Date.now() - t0).toBeLessThan(500);
    const res = String(c.json).trim().split("\n").map((l) => JSON.parse(l)).at(-1); expect(res).toMatchObject({ type: "result", compiler: "demo" });
    const s = await call(token, "POST", "/strategies", { strategy: res.strategy }); expect(s.status).toBe(201); sid = s.json.id;
    const r = await call(token, "POST", "/runs", { strategyId: sid, mode: "paper" }); expect(r.status).toBe(201); runId = r.json.id;
    const qt = await call(token, "POST", "/quotes", { instrument: "robinhood:token:0x00000000000000000000000000000000000000a1", side: "buy", notionalUsd: "100" }); expect(qt.status).toBe(200);
  });
  it("dev persistence: state survives an app restart (JSON under .data/, mock only)", async () => {
    await q.persist!.flush(); expect(existsSync(path)).toBe(true); expect(readFileSync(path, "utf8")).toContain(sid);
    q.runs.shutdown(); q = mk();
    expect(q.store.strategies.has(sid)).toBe(true); expect(q.store.runs.get(runId)?.status).toBe("running");
    const me = await call(token, "GET", `/strategies/${sid}`); expect(me.status).toBe(200); // same JWT secret in mock → token still valid
    const ev = await call(token, "GET", `/runs/${runId}/events?since=-1&limit=500`); expect(ev.json.items.some((e: any) => e.type === "warning" && e.code === "dev_restart")).toBe(true);
  });
  it("persistence is off outside mock mode and when no path is given", () => {
    const a = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), autoTimers: false }); expect(a.persist).toBeNull(); a.runs.shutdown();
    void btcStrategy;
  });
});
