/** M3.6 regressions for Robin's gate on 19e4ba1 (P2s: backtest skew, dev-login NODE_ENV casing, RL overflow, CORS credentials). */
import { afterAll, describe, expect, it } from "vitest";
import { createApp, BACKTEST_MAX_FUTURE_SKEW_MS } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { MockMarket } from "../../src/venues/market";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { btcStrategy, T0 } from "../helpers";

const clock = new ManualClock(T0);
const mk = (env: Record<string, string> = {}, extra: Record<string, unknown> = {}) => { const registry = new Registry(MOCK_INSTRUMENTS); const market = new MockMarket(registry);
  return createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock, registry, market, autoTimers: false, compileDelayMs: 0, ...extra }); };
const q = mk(); const small = mk({ TRUST_PROXY: "true" }, { rlMax: 3 });
afterAll(() => { q.runs.shutdown(); small.runs.shutdown(); });
const iso = (t: number) => new Date(t).toISOString(); const DAY = 86_400_000;
const call = async (app: typeof q, method: string, path: string, body?: unknown, token = "", headers: Record<string, string> = {}) => {
  const res = await app.app.request("/v1" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
};

describe("M3.6 backtest clock skew", () => {
  let tok = "", sid = "";
  it("setup", async () => {
    tok = (await call(q, "POST", "/auth/exchange", { provider: "privy", idToken: "dev:m36-regression-user-01" })).json.accessToken;
    sid = (await call(q, "POST", "/strategies", { strategy: btcStrategy() }, tok)).json.id;
  });
  const bt = (to: number) => call(q, "POST", "/backtests", { strategyId: sid, resolution: "1h", from: iso(T0 - 7 * DAY), to: iso(to) }, tok);
  it("to = now + 4m59s is accepted (clamped to now); exactly +5m accepted; +5m+1s → 422 future", async () => {
    expect(BACKTEST_MAX_FUTURE_SKEW_MS).toBe(300_000);
    expect((await bt(T0 + 299_000)).status).toBe(202);
    expect((await bt(T0 + 300_000)).status).toBe(202);
    const bad = await bt(T0 + 301_000); expect(bad.status).toBe(422); expect(bad.json.error.details.reason).toBe("future");
  });
});

describe("M3.6 dev login guard", () => {
  for (const ne of ["production", "Production", "PRODUCTION", " production "]) it(`NODE_ENV=${JSON.stringify(ne)} + dev login → config error`, () => {
    expect(() => loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", NODE_ENV: ne })).toThrow();
  });
  it("mainnet mode refuses dev login; mock/testnet allow it", () => {
    expect(() => loadConfig({ QUIVR_MODE: "mainnet", DEV_LOGIN_ENABLED: "true" })).toThrow();
    expect(loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", NODE_ENV: "development" }).DEV_LOGIN_ENABLED).toBe(true);
    expect(loadConfig({ QUIVR_MODE: "testnet", DEV_LOGIN_ENABLED: "true", QUIVR_JWT_SECRET: "x".repeat(48) }).DEV_LOGIN_ENABLED).toBe(true);
  });
});

describe("M3.6 rate-limit map overflow refuses new keys", () => {
  it("full map → 429 for a new key; existing counters are kept, not evicted", async () => {
    const hit = (ip: string) => call(small, "POST", "/auth/exchange", { provider: "privy", idToken: "dev:m36-ratelimit-user-" + ip.split(".").join("") }, "", { "x-forwarded-for": ip });
    for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) expect((await hit(ip)).status).toBe(200);
    expect(small.rateLimit.size()).toBe(3);
    const r = await hit("10.0.0.4"); expect(r.status).toBe(429); expect(r.json.error.code).toBe("rate_limited");
    expect(small.rateLimit.size()).toBe(3);
    expect((await hit("10.0.0.1")).status).toBe(200); // existing key still counted
    clock.advance(2 * 60_000); expect((await hit("10.0.0.4")).status).toBe(200); // expired entries pruned → room again
  });
});

describe("M3.6 CORS credentials", () => {
  it("allow-credentials only for an allowed Origin", async () => {
    const ok = await call(q, "GET", "/status", undefined, "", { origin: "http://localhost:3000" });
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    for (const h of [{ origin: "https://evil.example" }, {}] as Record<string, string>[]) expect((await call(q, "GET", "/status", undefined, "", h)).headers.get("access-control-allow-credentials")).toBeNull();
    const pre = await q.app.request("/v1/status", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(pre.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("M3.6.1 HTTP: session-key defaults + Retry-After on 429", () => {
  it("GET /session-keys/defaults", async () => {
    const tok = (await call(q, "POST", "/auth/exchange", { provider: "privy", idToken: "dev:m361-defaults-user-01" })).json.accessToken;
    const r = await call(q, "GET", "/session-keys/defaults", undefined, tok);
    expect(r.status).toBe(200); expect(r.json).toEqual({ perTradeCapUsd: 250, dailyCapUsd: 1000, minSwapUsd: 15.63, maxSlippagePct: 1, defaultExpiryHours: 24, maxExpiryHours: 168, maxDailyToPerTradeRatio: 64 });
  });
  it("every 429 has Retry-After equal to error.retryAfterSec (whole seconds)", async () => {
    const app = mk({ TRUST_PROXY: "true" }, { rlMax: 1 }); let saw = 0;
    try {
      for (let i = 0; i < 4; i++) {
        const r = await call(app, "POST", "/auth/exchange", { provider: "privy", idToken: `dev:m361-ra-user-${i}x` }, "", { "x-forwarded-for": `10.9.0.${i}` });
        if (r.status === 429) { saw++; const h = r.headers.get("retry-after"); expect(h).toMatch(/^\d+$/); expect(Number(h)).toBeGreaterThanOrEqual(1); expect(Number(h)).toBe(r.json.error.retryAfterSec); }
      }
    } finally { app.runs.shutdown(); }
    expect(saw).toBeGreaterThan(0);
  });
  it("429 without a natural window (active-run cap) still sends Retry-After", async () => {
    const app = mk({ MAX_ACTIVE_RUNS_PER_USER: "1" });
    try {
      const tok = (await call(app, "POST", "/auth/exchange", { provider: "privy", idToken: "dev:m361-cap-user-01" })).json.accessToken;
      const s1 = (await call(app, "POST", "/strategies", { strategy: btcStrategy() }, tok)).json.id;
      const s2 = (await call(app, "POST", "/strategies", { strategy: btcStrategy() }, tok)).json.id;
      expect((await call(app, "POST", "/runs", { strategyId: s1, mode: "paper" }, tok)).status).toBe(201);
      const r = await call(app, "POST", "/runs", { strategyId: s2, mode: "paper" }, tok);
      expect(r.status).toBe(429); expect(r.json.error.code).toBe("limit_exceeded"); expect(r.headers.get("retry-after")).toBe("60"); expect(r.json.error.retryAfterSec).toBe(60);
    } finally { app.runs.shutdown(); }
  });
});
