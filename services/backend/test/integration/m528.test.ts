// M5.28: amount validated before account lookups; too_many_decimals reason at schema level; guest-readable public strategies; seed ids resolve.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { SEED_PUBLIC } from "../../src/social/seed";

const FROM = "0x" + "ab".repeat(20); // placeholder, never linked
function mk() {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock: new ManualClock(Date.parse("2026-10-28T12:00:00Z")), autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const call = async (who: string | null, m: string, p: string, b?: unknown, h: Record<string, string> = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...h };
    if (who) { toks[who] ??= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m528-${who}-user-label-xx` }) })).json()).accessToken; headers.authorization = `Bearer ${toks[who]}`; }
    const r = await q.app.request("/v1" + p, { method: m, headers, body: b === undefined ? undefined : JSON.stringify(b) });
    const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* not json */ }
    return { s: r.status, j, t, h: r.headers };
  };
  return { q, call };
}

describe("M5.28 deposit amount checked first", () => {
  it("bad decimals / out-of-range amount → 422 even with no linked wallet or smart account", async () => {
    const { call } = mk();
    const dep = (asset: string, amount: string) => call("a", "POST", "/testnet/deposit/prepare", { chainId: 46630, asset, amount, from: FROM });
    let r = await dep("tUSDG", "1.0000001"); expect([r.s, r.j.error.details.reason]).toEqual([422, "too_many_decimals"]);
    r = await dep("ETH", "1.000000000000000001"); expect([r.s, r.j.error.details.reason]).toEqual([422, "amount_out_of_range"]);
    r = await dep("tNVDA", "0"); expect([r.s, r.j.error.details.reason]).toEqual([422, "amount_out_of_range"]);
    r = await dep("tUSDG", "5"); expect([r.s, r.j.error.details.reason]).toEqual([409, "wallet_not_linked"]); // valid amount → account checks follow
  });
  it("schema-level >18 decimals → 422 details.reason too_many_decimals on deposit, quote and swap", async () => {
    const { call } = mk(); const a19 = "1." + "1".repeat(19);
    const rs = [await call("a", "POST", "/testnet/deposit/prepare", { chainId: 46630, asset: "ETH", amount: a19, from: FROM }),
      await call("a", "GET", `/testpool/quote?side=buy&amount=${a19}`),
      await call("a", "POST", "/testpool/swap/prepare", { chainId: 46630, side: "sell", amount: a19, from: FROM })];
    for (const r of rs) { expect(r.s).toBe(422); expect(r.j.error.code).toBe("validation_failed"); expect(r.j.error.details.reason).toBe("too_many_decimals"); expect(Array.isArray(r.j.error.details.issues)).toBe(true); }
    const bad = await call("a", "POST", "/testnet/deposit/prepare", { chainId: 46630, asset: "ETH", amount: "abc", from: FROM });
    expect(bad.s).toBe(422); expect(Array.isArray(bad.j.error.details)).toBe(true); // other failures keep the issue array
  });
});

describe("M5.28 guest GET /public/strategies/:id", () => {
  it("guest reads seed + user-published strategies; public fields only; fork still needs auth", async () => {
    const { call } = mk();
    for (const sp of SEED_PUBLIC) { const r = await call(null, "GET", `/public/strategies/${sp.id}`);
      expect(r.s).toBe(200); expect(r.j.id).toBe(sp.id); expect(r.j.author).toEqual({ handle: sp.handle, isYou: false }); expect(r.j.strategy).toBeTruthy();
      expect(r.h.get("cache-control")).toBe("public, max-age=30"); expect(r.h.get("x-robots-tag")).toBe("noindex"); }
    const f = await call("owner", "POST", `/public/strategies/${SEED_PUBLIC[0].id}/fork`, {}, { "idempotency-key": "m528-fork-0001" }); expect(f.s).toBe(201);
    const sid = f.j.id ?? f.j.strategy?.id; expect(sid).toMatch(/^stg_/);
    expect((await call("owner", "POST", `/strategies/${sid}/publish`, { public: true })).s).toBe(200);
    const me = await call("owner", "GET", "/me");
    const g = await call(null, "GET", `/public/strategies/${sid}`); expect(g.s).toBe(200);
    expect(Object.keys(g.j).sort()).toEqual(["author", "forkedFrom", "forks", "humanized", "id", "mock", "name", "nodes", "paperReturn30dPct", "publishedAt", "spark", "strategy", "thesis", "venues"]);
    for (const k of ["ownerId", "email", "linkedWallets", "sessionKey", "versions", me.j.id]) expect(g.t).not.toContain(String(k));
    expect(g.j.author.isYou).toBe(false);
    const own = await call("owner", "GET", `/public/strategies/${sid}`); expect(own.j.author.isYou).toBe(true); expect(own.h.get("cache-control")).toBe("private, no-store");
    expect((await call(null, "GET", "/public/strategies/stg_nope")).s).toBe(404);
    expect((await call(null, "POST", `/public/strategies/${sid}/fork`, {}, { "idempotency-key": "m528-fork-0002" })).s).toBe(401);
    expect((await call(null, "GET", "/public/strategies")).s).toBe(401); // list stays signed-in
  });
  it("per-IP rate limit: 60/min then 429", async () => {
    const { call } = mk(); const id = SEED_PUBLIC[0].id; let last = 0;
    for (let i = 0; i < 61; i++) last = (await call(null, "GET", `/public/strategies/${id}`)).s;
    expect(last).toBe(429);
  });
});

describe("M5.28 search + profile ids resolve via the public strategy route", () => {
  it("every seed id from search and profiles resolves for guests", async () => {
    const { call } = mk(); const ids = new Set<string>();
    for (const q of ["SOL", "BTC", "ETH", "NVDA", "Fed", "a", "e"]) { const r = await call("a", "GET", `/search?q=${q}&limit=10`); expect(r.s).toBe(200); for (const s of r.j.strategies) ids.add(s.publicStrategyId); }
    for (const sp of SEED_PUBLIC) { const p = await call("a", "GET", `/profiles/${encodeURIComponent(sp.handle)}`); expect(p.s).toBe(200); for (const s of p.j.strategies) ids.add(s.id); }
    for (const sp of SEED_PUBLIC) expect(ids.has(sp.id)).toBe(true);
    for (const id of ids) expect([id, (await call(null, "GET", `/public/strategies/${id}`)).s]).toEqual([id, 200]);
  });
});
