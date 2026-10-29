// M5.21: listen before warmup (B6), internal web-proxy bucket (W1/B1), TRUST_PROXY loopback peers (B2).
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { Warmup, listenThenWarm, WARMUP_NOTICE } from "../../src/warmup";

const TOK = "internal_placeholder_token_for_tests_0123456789";
const mk = (env: Record<string, string> = {}, warmup?: Warmup) => createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock: new ManualClock(Date.parse("2026-10-27T15:00:00Z")), autoTimers: false, compileDelayMs: 0, warmup });
const peer = (a: string) => ({ incoming: { socket: { remoteAddress: a } } });
const get = (q: ReturnType<typeof mk>, p: string, h: Record<string, string> = {}, from = "203.0.113.9") => q.app.request("/v1" + p, { headers: h }, peer(from));

describe("M5.21 B6 warmup", () => {
  it("listen() happens before the history load finishes; health reports warming then ready", async () => {
    const order: string[] = []; let finish!: () => void; const w = new Warmup();
    const done = listenThenWarm(() => order.push("listen"), w, () => new Promise<void>((r) => { finish = () => { order.push("loaded"); r(); }; }), 30_000);
    expect(order).toEqual(["listen"]); expect(w.state).toBe("warming");
    const q = mk({}, w); let h = await (await get(q, "/health")).json() as any;
    expect(h).toMatchObject({ ok: true, ready: false, warmup: { state: "warming" }, notice: { code: "warming_up", message: WARMUP_NOTICE } });
    expect((await (await get(q, "/status")).json() as any).warmingUp).toBe(true);
    finish(); await done; expect(order).toEqual(["listen", "loaded"]);
    h = await (await get(q, "/health")).json() as any; expect(h).toMatchObject({ ready: true, warmup: { state: "ready" }, notice: null });
  });
  it("a hung load is capped; errors give partial; no warmup = off/ready", async () => {
    const w = new Warmup(); let listened = false;
    await listenThenWarm(() => { listened = true; }, w, () => new Promise(() => {}), 1000);
    expect(listened).toBe(true); expect(w.state).toBe("timeout"); expect(w.message).toMatch(/1s/);
    const w2 = new Warmup(); await w2.start(async () => { throw new Error("rpc down"); }, 1000); expect(w2.state).toBe("partial");
    const w3 = new Warmup(); await w3.start(async () => ({ errors: 2 }), 1000); expect(w3).toMatchObject({ state: "partial", errors: 2 });
    expect(await (await get(mk(), "/health")).json()).toMatchObject({ ok: true, ready: true, warmup: { state: "off" } });
  });
  it("while warming, market history carries the warmup notice", async () => {
    const q = mk({}, new Warmup()); const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m521-user-label-xx" }) })).json() as any).accessToken;
    const id = q.registry.all()[0].id;
    const r = await (await q.app.request(`/v1/markets/${encodeURIComponent(id)}/history?tf=1d&range=30d`, { headers: { authorization: `Bearer ${tok}` } })).json() as any;
    expect(r.notice).toBe(WARMUP_NOTICE);
  });
});

describe("M5.21 W1/B1 internal proxy bucket", () => {
  const H = (s: string) => `/public/profiles/${encodeURIComponent(s)}`;
  it("loopback + correct token uses its own larger bucket; others stay per-IP", async () => {
    const q = mk({ INTERNAL_PROXY_TOKEN: TOK }); const h = "@nobody_zz";
    for (let i = 0; i < 60; i++) await get(q, H(h), {}, "127.0.0.1");
    expect((await get(q, H(h), {}, "127.0.0.1")).status).toBe(429); // plain loopback caller: normal 60/min
    for (let i = 0; i < 100; i++) expect((await get(q, H(h), { "x-quiver-internal-token": TOK }, "127.0.0.1")).status).toBe(404);
    expect((await get(q, H(h), { "x-quiver-internal-token": TOK }, "::ffff:127.0.0.1")).status).toBe(404);
  });
  it("token from a non-loopback peer, wrong token, or token unset: normal per-IP limit", async () => {
    for (const [env, hdr, from] of [[{ INTERNAL_PROXY_TOKEN: TOK }, TOK, "203.0.113.5"], [{ INTERNAL_PROXY_TOKEN: TOK }, TOK.slice(0, -1) + "x", "127.0.0.1"], [{}, TOK, "127.0.0.1"]] as const) {
      const q = mk(env as Record<string, string>); for (let i = 0; i < 60; i++) await get(q, H("@nobody_zz"), { "x-quiver-internal-token": hdr }, from);
      expect((await get(q, H("@nobody_zz"), { "x-quiver-internal-token": hdr }, from)).status).toBe(429);
    }
  });
  it("short INTERNAL_PROXY_TOKEN is refused by config", () => { expect(() => loadConfig({ QUIVR_MODE: "mock", INTERNAL_PROXY_TOKEN: "short" })).toThrow(); });
});

describe("M5.21 B2 TRUST_PROXY peers", () => {
  it("XFF is honoured only from a loopback peer by default", async () => {
    const q = mk({ TRUST_PROXY: "true" }); const p = "/public/profiles/%40nobody_zz";
    for (let i = 0; i < 60; i++) await get(q, p, { "x-forwarded-for": "198.51.100.1" }, "127.0.0.1");
    expect((await get(q, p, { "x-forwarded-for": "198.51.100.1" }, "127.0.0.1")).status).toBe(429);
    expect((await get(q, p, { "x-forwarded-for": "198.51.100.2" }, "127.0.0.1")).status).toBe(404); // via Caddy: per real client
    for (let i = 0; i < 60; i++) await get(q, p, { "x-forwarded-for": `198.51.100.${10 + i}` }, "203.0.113.7");
    expect((await get(q, p, { "x-forwarded-for": "198.51.100.99" }, "203.0.113.7")).status).toBe(429); // direct peer: XFF ignored
    const any = mk({ TRUST_PROXY: "true", TRUST_PROXY_PEERS: "any" });
    for (let i = 0; i < 61; i++) expect((await get(any, p, { "x-forwarded-for": `198.51.100.${i}` }, "203.0.113.7")).status).toBe(404);
  });
});
