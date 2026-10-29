/** M3.8: backend for Weft-style sections the web mocked: landing, settings, stop-all, run result card. */
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { MockMarket } from "../../src/venues/market";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import * as X from "../../contracts/src/ext";
import { btcStrategy, T0 } from "../helpers";

const clock = new ManualClock(T0);
const registry = new Registry(MOCK_INSTRUMENTS);
const a = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", MAX_ACTIVE_RUNS_PER_USER: "3" }), clock, registry, market: new MockMarket(registry), autoTimers: false, compileDelayMs: 0 });
afterAll(() => a.runs.shutdown());
const call = async (method: string, path: string, body?: unknown, token = "") => {
  const res = await a.app.request("/v1" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = text; } return { status: res.status, json, headers: res.headers };
};
const login = async (label: string) => (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${label}` })).json.accessToken as string;
const newRun = async (tok: string) => { const sid = (await call("POST", "/strategies", { strategy: btcStrategy() }, tok)).json.id; return (await call("POST", "/runs", { strategyId: sid, mode: "paper" }, tok)).json; };

describe("M3.8 GET /public/landing (guest)", () => {
  it("is public, contract-valid, and honest about unsupported signals", async () => {
    const r = await call("GET", "/public/landing"); expect(r.status).toBe(200);
    const d = X.LandingRes.parse(r.json);
    expect(d.mock).toBe(true); expect(d.notice).toMatch(/Example data/); expect(r.headers.get("cache-control")).toMatch(/max-age=60/);
    expect(d.trades.find((t) => t.id === "odds")!.status).toBe("watch_only"); expect(d.trades.find((t) => t.id === "stocks")!.status).toBe("paper");
    expect(d.signals.filter((s) => !s.supported).map((s) => s.id).sort()).toEqual(["earnings", "premium", "volume"]);
    for (const s of d.signals) expect(s.supported ? s.signalKinds.length > 0 : s.signalKinds.length === 0).toBe(true);
    expect(d.featured.length).toBeGreaterThan(0); expect(d.featured.every((f) => !f.author.isYou)).toBe(true);
    expect(d.preview).not.toBeNull(); expect(d.preview!.synthetic).toBe(true); expect(d.preview!.points.length).toBeGreaterThan(1);
    expect(JSON.stringify(d)).not.toMatch(/fixture-|usr_/); // no user ids leak to guests
  });
  it("is rate limited per IP (60/min)", async () => {
    let last = 0; for (let i = 0; i < 61; i++) last = (await call("GET", "/public/landing")).status;
    expect(last).toBe(429); clock.advance(61_000); expect((await call("GET", "/public/landing")).status).toBe(200);
  });
});

describe("M3.8 settings, stop-all, run card", () => {
  it("GET /settings: limits, usage, defaults, no live, alerts not configured", async () => {
    const tok = await login("m38-settings-user-0001"); await newRun(tok);
    const d = X.AccountSettingsRes.parse((await call("GET", "/settings", undefined, tok)).json);
    expect(d.limits.maxActiveRuns).toBe(3); expect(d.usage).toMatchObject({ activeRuns: 1, strategies: 1 });
    expect(d.trading).toEqual({ enabledModes: ["paper"], liveEnabled: false, killSwitch: false }); expect(d.alerts.configured).toBe(false);
    expect((await call("GET", "/settings")).status).toBe(401);
  });
  it("POST /runs/stop-all stops only my active runs, idempotent", async () => {
    const tok = await login("m38-stopall-user-00001"); const other = await login("m38-stopall-other-0001");
    const r1 = await newRun(tok); const r2 = await newRun(tok); const ro = await newRun(other);
    const s = X.StopAllRes.parse((await call("POST", "/runs/stop-all", {}, tok)).json);
    expect(s.stopped.sort()).toEqual([r1.id, r2.id].sort()); expect(s.alreadyStopped).toBe(0);
    expect(a.runs.live.has(ro.id)).toBe(true); expect(a.runs.live.has(r1.id)).toBe(false);
    expect(X.StopAllRes.parse((await call("POST", "/runs/stop-all", {}, tok)).json)).toEqual({ stopped: [], alreadyStopped: 2 });
    expect((await call("POST", "/runs/stop-all", { flatten: "yes" }, tok)).status).toBe(422);
  });
  it("GET /runs/:id/card: owner only, numbers match the run summary", async () => {
    const tok = await login("m38-card-user-0000001"); const run = await newRun(tok);
    for (let i = 0; i < 5; i++) { clock.advance(60_000); await a.runs.tick(run.id); }
    const r = await call("GET", `/runs/${run.id}/card`, undefined, tok); expect(r.status).toBe(200);
    const card = X.RunCard.parse(r.json); const sm = (await call("GET", `/runs/${run.id}`, undefined, tok)).json;
    expect([card.equityUsd, card.pnlUsd, card.pnlPct, card.status]).toEqual([sm.equityUsd, sm.pnlUsd, sm.pnlPct, sm.status]);
    expect(card.name).toBe(btcStrategy().name); expect(card.durationSec).toBeGreaterThanOrEqual(300); expect(card.disclaimer).toMatch(/Paper/);
    const other = await login("m38-card-other-000001"); expect((await call("GET", `/runs/${run.id}/card`, undefined, other)).status).toBe(404);
  });
});
