/** M3.5 regressions for Robin's QA gate on a1b0510 (qa/poc/flows.mjs). Each test asserts the PoC no longer works. */
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { MockMarket } from "../../src/venues/market";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { btcStrategy, T0 } from "../helpers";

const clock = new ManualClock(T0);
const mk = (env: Record<string, string> = {}) => { const registry = new Registry(MOCK_INSTRUMENTS); const market = new MockMarket(registry);
  return { market, q: createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", MAX_ACTIVE_RUNS_PER_USER: "2", MAX_SSE_PER_USER: "3", ...env }), clock, registry, market, autoTimers: false, compileDelayMs: 0 }) }; };
const { q, market } = mk();
const off = mk({ DEV_LOGIN_ENABLED: "" }); // env unset -> default
afterAll(() => { q.runs.shutdown(); off.q.runs.shutdown(); });
const iso = (t: number) => new Date(t).toISOString(); const DAY = 86_400_000;
const call = async (app: typeof q, method: string, path: string, body?: unknown, token = "", headers: Record<string, string> = {}) => {
  const res = await app.app.request("/v1" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
};
const login = async (app: typeof q, label: string, headers: Record<string, string> = {}) => call(app, "POST", "/auth/exchange", { provider: "privy", idToken: `dev:${label}` }, "", headers);

describe("M3.5 API regressions (Robin flows.mjs)", () => {
  let tok = "", sid = "";
  it("setup", async () => {
    tok = (await login(q, "m35-regression-user-01")).json.accessToken; expect(tok).toBeTruthy();
    const s = await call(q, "POST", "/strategies", { strategy: btcStrategy() }, tok); expect(s.status).toBe(201); sid = s.json.id;
  });
  const bt = (b: Record<string, unknown>) => call(q, "POST", "/backtests", { strategyId: sid, resolution: "1h", ...b }, tok);

  it("btFuture: to > now rejected with backtest_range_invalid (reason future)", async () => {
    const r = await bt({ from: iso(T0 + DAY), to: iso(T0 + 2 * DAY) });
    expect(r.status).toBe(422); expect(r.json.error.code).toBe("backtest_range_invalid"); expect(r.json.error.details.reason).toBe("future");
    expect((await bt({ from: iso(T0 - DAY), to: iso(T0 + 3_600_000) })).json.error.details.reason).toBe("future");
  });
  it("btEpoch: range before the history window rejected (reason before_data)", async () => {
    const r = await bt({ from: "1970-01-01T00:00:00Z", to: "1970-12-31T00:00:00Z", resolution: "1d" });
    expect(r.status).toBe(422); expect(r.json.error.code).toBe("backtest_range_invalid"); expect(r.json.error.details.reason).toBe("before_data");
    expect(Date.parse(r.json.error.details.earliestFrom)).toBeLessThanOrEqual(T0 - 365 * DAY);
  });
  it("valid past range still accepted (202)", async () => { expect((await bt({ from: iso(T0 - 7 * DAY), to: iso(T0) })).status).toBe(202); });
  it("btZeroEquity / btNegEquity / btHugeEquity rejected (422 validation_failed)", async () => {
    for (const v of ["0", "-5", "1e30", "999999999999999999999999", "99.99", "10000000.01"]) {
      const r = await bt({ from: iso(T0 - 7 * DAY), to: iso(T0), startingEquityUsd: v }); expect([v, r.status, r.json.error?.code]).toEqual([v, 422, "validation_failed"]);
    }
    expect((await bt({ from: iso(T0 - 7 * DAY), to: iso(T0), startingEquityUsd: "100" })).status).toBe(202);
  });
  it("raw internal backtest error text is not returned to the client", async () => {
    market.overrides.set("hl:perp:BTC", () => { throw new Error("ECONNREFUSED 10.0.0.7:5432 /srv/secret/path"); });
    const r = await bt({ from: iso(T0 - 3 * DAY), to: iso(T0 - 2 * DAY), idemSalt: undefined });
    let res = r.json; for (let i = 0; i < 50 && (res.status === "queued" || res.status === "running"); i++) { await new Promise((x) => setTimeout(x, 20)); res = (await call(q, "GET", `/backtests/${r.json.id}`, undefined, tok)).json; }
    market.overrides.delete("hl:perp:BTC");
    expect(JSON.stringify(res)).not.toMatch(/ECONNREFUSED|10\.0\.0\.7|secret/);
    expect(res.status).toBe("failed"); expect(res.error).toBe("Backtest failed. Try again or change the range.");
  });
  it("versionNaN: /versions/abc, /versions/0, /versions/99 -> 404 (never the latest)", async () => {
    for (const v of ["abc", "0", "99", "1.5", "-1"]) { const r = await call(q, "GET", `/strategies/${sid}/versions/${v}`, undefined, tok); expect([v, r.status]).toEqual([v, 404]); }
    expect((await call(q, "GET", `/strategies/${sid}/versions/1`, undefined, tok)).status).toBe(200);
  });
  it("notFound: unknown routes 404 (not 401), with or without auth; known routes still 401 without auth", async () => {
    for (const p of ["/nope", "/strategies/x/nope", "/admin"]) { expect((await call(q, "GET", p)).status).toBe(404); expect((await call(q, "GET", p, undefined, tok)).status).toBe(404); }
    expect((await call(q, "GET", "/me")).status).toBe(401); expect((await call(q, "GET", "/strategies/abc")).status).toBe(401);
  });
  it("secHeaders: nosniff, frame-ancestors 'none', DENY, referrer-policy", async () => {
    for (const p of ["/status", "/me", "/nope"]) {
      const h = (await call(q, "GET", p)).headers;
      expect(h.get("x-content-type-options")).toBe("nosniff"); expect(h.get("x-frame-options")).toBe("DENY");
      expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'"); expect(h.get("referrer-policy")).toBe("no-referrer");
    }
  });
  it("refresh cookie: Secure unless localhost dev", async () => {
    expect((await login(q, "m35-regression-cookie-01", { host: "preview.quiver.example" })).headers.get("set-cookie")).toMatch(/;\s*Secure/i);
    expect((await login(q, "m35-regression-cookie-01", { host: "localhost:8787" })).headers.get("set-cookie")).not.toMatch(/;\s*Secure/i);
  });
  it("devLoginImpersonate: dev login is OFF by default and refused with NODE_ENV=production", async () => {
    const r = await login(off.q, "robinqa1xxxxxxxxxxxxxx"); expect(r.status).toBe(401); expect(r.json.accessToken).toBeUndefined();
    expect(loadConfig({ QUIVR_MODE: "mock" }).DEV_LOGIN_ENABLED).toBe(false);
    expect(() => loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", NODE_ENV: "production" })).toThrow();
  });

  let runId = "";
  it("run cap: MAX_ACTIVE_RUNS_PER_USER active runs, then 429 limit_exceeded; stopping frees a slot", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await call(q, "POST", "/strategies", { strategy: btcStrategy({ name: `cap ${i}` }) }, tok);
      const r = await call(q, "POST", "/runs", { strategyId: s.json.id, mode: "paper" }, tok);
      if (i < 2) { expect(r.status).toBe(201); ids.push(r.json.id); } else { expect(r.status).toBe(429); expect(r.json.error.code).toBe("limit_exceeded"); expect(r.json.error.details).toMatchObject({ limit: 2, kind: "active_runs" }); }
    }
    runId = ids[0];
    expect(loadConfig({ QUIVR_MODE: "mock" }).MAX_ACTIVE_RUNS_PER_USER).toBe(5); expect(loadConfig({ QUIVR_MODE: "mock" }).MAX_SSE_PER_USER).toBe(10);
  });
  const ticket = async () => (await call(q, "POST", "/stream-tickets", { runId }, tok)).json.ticket as string;
  it("sseTicketReuse: a stream ticket works once, then 401", async () => {
    const t = await ticket();
    const a = await q.app.request(`/v1/runs/${runId}/events/stream?ticket=${t}`); expect(a.status).toBe(200); await a.body?.cancel();
    const b = await q.app.request(`/v1/runs/${runId}/events/stream?ticket=${t}`); expect(b.status).toBe(401);
    expect((await b.json()).error.message).toMatch(/already used/);
    const c = await q.app.request(`/v1/runs/${runId}/events?ticket=${t}`); expect(c.status).toBe(401); // alias route shares the same ticket store
  });
  it("SSE cap: MAX_SSE_PER_USER concurrent streams, then 429 limit_exceeded; closing frees a slot", async () => {
    await new Promise((r) => setTimeout(r, 50)); // let the previous test's cancel release its slot
    const open: Response[] = [];
    for (let i = 0; i < 3; i++) { const r = await q.app.request(`/v1/runs/${runId}/events/stream?ticket=${await ticket()}`); expect(r.status).toBe(200); open.push(r); }
    const over = await q.app.request(`/v1/runs/${runId}/events/stream?ticket=${await ticket()}`); expect(over.status).toBe(429);
    const j = await over.json(); expect(j.error.code).toBe("limit_exceeded"); expect(j.error.details).toMatchObject({ limit: 3, kind: "streams" });
    await open[0].body!.cancel(); await new Promise((r) => setTimeout(r, 50));
    const again = await q.app.request(`/v1/runs/${runId}/events/stream?ticket=${await ticket()}`); expect(again.status).toBe(200);
    for (const r of [...open.slice(1), again]) await r.body!.cancel();
  });
});

describe("M3.5 bounded rate-limit map", () => {
  it("expired rate-limit buckets are pruned; the map has a hard cap", async () => {
    const { q: a } = mk(); try {
      await login(a, "m35-regression-rl-user-01"); await call(a, "POST", "/compile", { thesis: "buy BTC when RSI under 30" });
      expect(a.rateLimit.size()).toBeGreaterThan(0); expect(a.rateLimit.max).toBe(50_000);
      clock.advance(2 * DAY); a.rateLimit.prune(); expect(a.rateLimit.size()).toBe(0);
    } finally { a.runs.shutdown(); }
  });
});
