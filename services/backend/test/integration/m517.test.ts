// M5.17 global search: markets, public strategies, public traders only.
import { describe, expect, it } from "vitest";
import { SearchRes } from "../../contracts/src/social";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup() {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock: new ManualClock(Date.parse("2026-10-27T15:00:00Z")), autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const call = async (who: string | null, m: string, p: string, b?: unknown) => {
    if (who) toks[who] ??= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m517-${who}-user-label-xx` }) })).json() as any).accessToken;
    const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${toks[who]}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any };
  };
  return { q, call };
}
const s4 = (s: any, qs: string) => s.call("ben", "GET", "/search?q=" + encodeURIComponent(qs));

describe("M5.17 search", () => {
  it("finds markets by symbol (exact first), public strategies and demo traders", async () => {
    const s = await setup(); const m = s.q.registry.all()[0];
    const r = SearchRes.parse((await s4(s, m.symbol.toLowerCase())).j); expect(r.markets[0].id).toBe(m.id);
    const pub = (await s.call("ben", "GET", "/public/strategies")).j.items[0];
    const st = SearchRes.parse((await s4(s, pub.name.slice(0, 5))).j); expect(st.strategies.map((x) => x.publicStrategyId)).toContain(pub.id);
    const tr = SearchRes.parse((await s4(s, pub.author.handle.slice(1, 5))).j); expect(tr.traders.map((x) => x.handle)).toContain(pub.author.handle);
  });
  it("private strategies and limited traders never appear; own published strategy does", async () => {
    const s = await setup(); const seed = (await s.call("ana", "GET", "/public/strategies")).j.items[0];
    const f = (await s.call("ana", "POST", `/public/strategies/${seed.id}/fork`)).j; const cur = (await s.call("ana", "GET", `/strategies/${f.id}`)).j;
    await s.call("ana", "PUT", `/strategies/${f.id}`, { strategy: { ...cur.strategy, name: "Zebrafish secret" }, expectedVersion: cur.version });
    const ana = (await s.call("ana", "GET", "/me/profile")).j.handle as string;
    let r = SearchRes.parse((await s4(s, "zebrafish")).j); expect(r.strategies).toEqual([]);
    r = SearchRes.parse((await s4(s, ana.slice(1))).j); expect(r.traders).toEqual([]);
    expect((await s.call("ana", "POST", `/strategies/${f.id}/publish`, { public: true })).status).toBe(200);
    r = SearchRes.parse((await s4(s, "zebrafish")).j); expect(r.strategies).toEqual([{ publicStrategyId: f.id, name: "Zebrafish secret", handle: ana }]);
    r = SearchRes.parse((await s4(s, ana.slice(1))).j); expect(r.traders).toEqual([{ handle: ana, strategies: 1, isYou: false }]);
    expect(JSON.stringify(r)).not.toMatch(/usr_|did:privy/);
  });
  it("validation, limit and auth", async () => {
    const s = await setup();
    expect((await s.call("ben", "GET", "/search?q=")).status).toBe(422);
    expect((await s.call("ben", "GET", "/search?q=" + "a".repeat(81))).status).toBe(422);
    expect((await s.call(null, "GET", "/search?q=a")).status).toBe(401);
    const r = SearchRes.parse((await s.call("ben", "GET", "/search?q=a&limit=2")).j); expect(r.markets.length).toBeLessThanOrEqual(2);
  });
});
