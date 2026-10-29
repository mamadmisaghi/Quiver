/** M3.7: Robin's P3s on 7f3c831: ops routes (OPS_TOKEN), graceful shutdown helper. */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig, ConfigError } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { MockMarket } from "../../src/venues/market";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { makeGracefulStop, installShutdownSignals, SHUTDOWN_SIGNALS } from "../../src/shutdown";
import * as O from "../../contracts/src/ops";
import { btcStrategy, T0 } from "../helpers";

const OPS = "ops-test-token-0123456789abcdef0123456789";
const clock = new ManualClock(T0);
const apps: any[] = [];
const mk = (env: Record<string, string> = {}, extra: Record<string, unknown> = {}) => { const registry = new Registry(MOCK_INSTRUMENTS);
  const a = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock, registry, market: new MockMarket(registry), autoTimers: false, compileDelayMs: 0, ...extra }); apps.push(a); return a; };
afterAll(() => apps.forEach((a) => a.runs.shutdown()));
const call = async (app: any, method: string, path: string, body?: unknown, token = "") => {
  const res = await app.app.request("/v1" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = text; } return { status: res.status, json };
};
const startRun = async (a: any, label: string) => {
  const tok = (await call(a, "POST", "/auth/exchange", { provider: "privy", idToken: `dev:${label}` })).json.accessToken;
  const sid = (await call(a, "POST", "/strategies", { strategy: btcStrategy() }, tok)).json.id;
  const run = (await call(a, "POST", "/runs", { strategyId: sid, mode: "paper" }, tok)).json; return { tok, run };
};

describe("M3.7 OPS_TOKEN config", () => {
  it("is optional and must be ≥32 chars", () => {
    expect(loadConfig({ QUIVR_MODE: "mock" }).OPS_TOKEN).toBeUndefined();
    expect(() => loadConfig({ QUIVR_MODE: "mock", OPS_TOKEN: "short" })).toThrow(ConfigError);
  });
});

describe("M3.7 ops routes", () => {
  it("all ops routes are 404 when OPS_TOKEN is unset", async () => {
    const a = mk();
    for (const [m, p] of [["POST", "/ops/shutdown"], ["GET", "/ops/runs"], ["POST", "/ops/runs/run_x/stop"]]) expect((await call(a, m, p, m === "POST" ? {} : undefined, OPS)).status).toBe(404);
  });
  it("wrong / missing token → 401; user JWT is not an ops token", async () => {
    const a = mk({ OPS_TOKEN: OPS }); const { tok } = await startRun(a, "m37-ops-user-aaaa-01");
    expect((await call(a, "GET", "/ops/runs")).status).toBe(401);
    expect((await call(a, "GET", "/ops/runs", undefined, OPS + "x")).status).toBe(401);
    expect((await call(a, "GET", "/ops/runs", undefined, tok)).status).toBe(401);
    expect((await call(a, "POST", "/ops/shutdown", {}, tok)).status).toBe(401);
  });
  it("lists active paper runs and stops an orphan by id (idempotent, audited)", async () => {
    const a = mk({ OPS_TOKEN: OPS }); const { tok, run } = await startRun(a, "m37-ops-user-bbbb-01");
    const list = await call(a, "GET", "/ops/runs", undefined, OPS); expect(list.status).toBe(200);
    expect(O.OpsRunsRes.parse(list.json).items.map((r) => [r.id, r.ownerLabel])).toEqual([[run.id, "m37-ops-user-bbbb-01"]]);
    const s = await call(a, "POST", `/ops/runs/${run.id}/stop`, {}, OPS); expect(s.status).toBe(200);
    expect(O.OpsStopRes.parse(s.json)).toMatchObject({ alreadyStopped: false, run: { id: run.id, status: "stopped" } });
    expect(a.runs.live.has(run.id)).toBe(false);
    expect((await call(a, "GET", `/runs/${run.id}`, undefined, tok)).json.status).toBe("stopped");
    expect((await call(a, "POST", `/ops/runs/${run.id}/stop`, {}, OPS)).json.alreadyStopped).toBe(true);
    expect((await call(a, "GET", "/ops/runs", undefined, OPS)).json.items).toEqual([]);
    expect((await call(a, "GET", "/ops/runs?status=all", undefined, OPS)).json.items).toHaveLength(1);
    expect(a.store.audit.some((e: any) => e.action === "ops.run.stop" && e.target === run.id)).toBe(true);
    expect((await call(a, "POST", "/ops/runs/run_01M5Z5Z4HNP5DNHYYQDD/stop", {}, OPS)).status).toBe(404);
  });
  it("run list/stop are 404 when NODE_ENV=production or mainnet; shutdown stays available", async () => {
    const prod = mk({ OPS_TOKEN: OPS, NODE_ENV: " Production ", DEV_LOGIN_ENABLED: "false" });
    expect((await call(prod, "GET", "/ops/runs", undefined, OPS)).status).toBe(404);
    expect((await call(prod, "POST", "/ops/runs/run_x/stop", {}, OPS)).status).toBe(404);
  });
  it("POST /ops/shutdown answers 202 then calls onShutdown once", async () => {
    vi.useFakeTimers(); try {
      const onShutdown = vi.fn(); const a = mk({ OPS_TOKEN: OPS }, { onShutdown });
      const r = await call(a, "POST", "/ops/shutdown", {}, OPS); expect(r.status).toBe(202); expect(O.OpsShutdownRes.parse(r.json).shuttingDown).toBe(true);
      await call(a, "POST", "/ops/shutdown", {}, OPS);
      vi.advanceTimersByTime(100); expect(onShutdown).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});

describe("M3.7 graceful shutdown", () => {
  it("stops runs, then flushes, then closes and exits 0; idempotent", () => {
    const order: string[] = []; const exit = vi.fn();
    const stop = makeGracefulStop({ stopRuns: () => order.push("runs"), flush: () => order.push("flush"), closeServer: (done) => { order.push("close"); done(); }, exit, log: () => {} });
    expect(stop("SIGBREAK")).toBe(true); expect(stop("SIGINT")).toBe(false);
    expect(order).toEqual(["runs", "flush", "close"]); expect(exit).toHaveBeenCalledTimes(1); expect(exit).toHaveBeenCalledWith(0);
  });
  it("a failing step does not skip the flush; a hung close still exits", () => {
    vi.useFakeTimers(); try {
      const order: string[] = []; const exit = vi.fn();
      const stop = makeGracefulStop({ stopRuns: () => { throw new Error("boom"); }, flush: () => order.push("flush"), closeServer: () => {}, exit, log: () => {}, timeoutMs: 3000 });
      stop("SIGTERM"); expect(order).toEqual(["flush"]); expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1500); expect(exit).toHaveBeenCalledWith(0); expect(exit).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("hooks SIGINT, SIGTERM, SIGHUP (Windows console close) and SIGBREAK", () => {
    const hooked: string[] = []; const fake = { on: (s: string, _f: () => void) => { hooked.push(s); return fake; } } as any; const stop = vi.fn();
    installShutdownSignals(stop, fake); expect(hooked).toEqual([...SHUTDOWN_SIGNALS]); expect(hooked).toEqual(["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]);
  });
});
