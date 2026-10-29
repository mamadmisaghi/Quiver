import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { MockMarket } from "../../src/venues/market";

const registry = new Registry(MOCK_INSTRUMENTS);
const a = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", CORS_ORIGINS: "http://localhost:3000" }), registry, market: new MockMarket(registry), autoTimers: false, compileDelayMs: 0 });
const req = (p: string, init: RequestInit = {}) => a.app.request("/v1" + p, init);
const PUBLIC = new Set(["/public/landing", "/public/leaderboard", "/public/cards/:token", /* M4.8 intentionally public */ "/public/replays/:token", /* M5.7 */ "/public/replays/:token/video.mp4", "/public/replays/:token/poster.png", /* M5.15 rendered media */ "/public/profiles/:handle", /* M5.20 */ "/public/strategies/:id", /* M5.28 guest read-only */ "/health", "/ready", /* M5.21 */ "/testpool/status", /* M5.23 public, addresses only */ "/ops/shutdown", "/ops/runs", "/ops/runs/:id/stop", "/status", "/auth/exchange", "/auth/config", /* M5.2 public */ "/auth/refresh", "/auth/logout", "/compile", "/runs/:id/events", "/runs/:id/events/stream"]);

describe("M3.4 security self-review", () => {
  afterAll(() => a.runs.shutdown());
  it("every non-public route requires auth", async () => {
    const routes = (a.app as any).routes.filter((r: any) => r.method !== "ALL").map((r: any) => ({ m: r.method, p: String(r.path).replace(/^\/v1/, "") }));
    expect(routes.length).toBeGreaterThan(40);
    for (const r of routes) {
      if (PUBLIC.has(r.p)) continue;
      const res = await req(r.p.replace(/:[a-zA-Z]+/g, "x"), { method: r.m, headers: { "content-type": "application/json" }, body: ["GET", "HEAD"].includes(r.m) ? undefined : "{}" });
      expect([r.m, r.p, res.status]).toEqual([r.m, r.p, 401]);
    }
  });
  it("CORS allowlist: known origin echoed, unknown origin gets no ACAO", async () => {
    const ok = await req("/status", { headers: { origin: "http://localhost:3000" } }); expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const bad = await req("/status", { headers: { origin: "https://evil.example" } }); expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("body size limits: 64 KB general, compile larger; 413 payload_too_large", async () => {
    const big = JSON.stringify({ provider: "privy", idToken: "dev:" + "x".repeat(70_000) });
    const r = await req("/auth/exchange", { method: "POST", headers: { "content-type": "application/json", "content-length": String(big.length) }, body: big });
    expect(r.status).toBe(413); expect((await r.json()).error.code).toBe("payload_too_large");
    const c = await req("/compile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ thesis: "x".repeat(70_000) }) });
    expect(c.status).toBe(422); // passes the size cap, then fails validation (thesis ≤ 2000)
  });
  it("guest compile is rate limited per client (3/day) and auth exchange per IP", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await req("/compile", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `9.9.9.${i}` }, body: JSON.stringify({ thesis: "buy BTC when RSI under 30" }) })).status);
    expect(codes.slice(0, 3).every((s) => s === 200)).toBe(true); expect(codes[3]).toBe(429); // XFF ignored without TRUST_PROXY
    let last = 0; for (let i = 0; i < 21; i++) last = (await req("/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m34-rate-user-${String(i).padStart(6, "0")}` }) })).status;
    expect(last).toBe(429);
  });
});
