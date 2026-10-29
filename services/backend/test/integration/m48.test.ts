// M4.8 — public leaderboard (no auth, cached, rate-limited, opt-in only) + shareable result cards.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { CardShareRes, PublicCard, PublicLeaderboardRes } from "../../contracts/src/public";

async function setup(w = "m48-public-share-user-01", env: Record<string, string> = {}) {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock, autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const login = async (who = w) => (toks[who] = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:${who}` }) })).json() as any).accessToken);
  const call = async (m: string, p: string, b?: unknown, who: string | null = w, hdr: Record<string, string> = {}) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${toks[who] ?? (await login(who))}` } : {}), ...hdr }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => null) as any, h: r.headers }; };
  await login(); const pubs = (await call("GET", "/public/strategies")).j.items;
  const marco = (await call("POST", `/public/strategies/${pubs.find((x: any) => x.author.handle === "@demo_marco").id}/fork`)).j;
  return { q, clock, call, login, pubs, marco };
}
const LEAK = /usr_|run_|@[^"\s]*\.(com|org|net)|equityUsd|pnlUsd|startingEquityUsd|wallet|0x[0-9a-fA-F]{40}/;

describe("M4.8 public leaderboard", () => {
  it("no auth; ranked by return; minTrades; no leaks; opt-in only; cached", async () => {
    const s = await setup(); const r = await s.call("GET", "/public/leaderboard?period=30d&limit=50", undefined, null);
    expect(r.status).toBe(200); expect(r.h.get("cache-control")).toMatch(/public/);
    const lb = PublicLeaderboardRes.parse(r.j); expect(lb.items.length).toBeGreaterThan(0);
    for (let i = 1; i < lb.items.length; i++) expect(Number(lb.items[i - 1]!.returnPct)).toBeGreaterThanOrEqual(Number(lb.items[i]!.returnPct));
    expect(lb.items.every((x) => x.trades >= lb.minTrades)).toBe(true);
    expect(JSON.stringify(lb)).not.toMatch(LEAK);
    expect(lb.items.some((x) => x.publicStrategyId === s.marco.id)).toBe(false); // private fork is not listed
    // opt in → listed (cache: same asOf within 60 s; after TTL it rebuilds)
    expect(lb.items.some((x) => x.handle === "@demo_marco")).toBe(false); // 2 backtest trades < minTrades 3
    const ok = (await s.call("POST", `/public/strategies/${s.pubs.find((x: any) => x.author.handle === "@demo_okafor").id}/fork`)).j;
    expect(lb.items.some((x) => x.publicStrategyId === ok.id)).toBe(false); // private fork is not listed
    await s.call("POST", `/strategies/${ok.id}/publish`, { public: true });
    expect((await s.call("GET", "/public/leaderboard?period=30d&limit=50", undefined, null)).j.asOf).toBe(lb.asOf);
    s.clock.advance(61_000); const lb2 = PublicLeaderboardRes.parse((await s.call("GET", "/public/leaderboard?period=30d&limit=50", undefined, null)).j);
    const mine = lb2.items.find((x) => x.publicStrategyId === ok.id); expect(mine?.handle).toBe("@m48-public-share-user-01"); expect(mine?.basis).toBe("backtest");
    expect((await s.call("GET", "/public/leaderboard?limit=1", undefined, null)).j.items).toHaveLength(1);
    expect((await s.call("GET", "/public/leaderboard?period=1y", undefined, null)).status).toBe(422);
  });
  it("minTrades filters; email-like labels become @trader_<hash>; paper basis from the owner's paper run", async () => {
    const s = await setup("someone@example.com-label", { LEADERBOARD_MIN_TRADES: "1000" });
    expect(PublicLeaderboardRes.parse((await s.call("GET", "/public/leaderboard", undefined, null)).j).items).toEqual([]);
    const t = await setup("someone@example.com-label", { LEADERBOARD_MIN_TRADES: "1" });
    await t.call("POST", `/strategies/${t.marco.id}/publish`, { public: true });
    const run = (await t.call("POST", "/runs", { strategyId: t.marco.id, mode: "paper" })).j;
    for (let i = 0; i < 40 && !t.q.store.runs.get(run.id)!.events.some((e) => e.type === "fill"); i++) { t.clock.advance(60_000); await t.q.runs.tick(run.id); }
    const lb = PublicLeaderboardRes.parse((await t.call("GET", "/public/leaderboard?period=7d&limit=50", undefined, null)).j);
    const mine = lb.items.find((x) => x.publicStrategyId === t.marco.id)!; expect(mine.handle).toMatch(/^@trader_[0-9a-f]{8}$/); expect(mine.basis).toBe("paper");
    expect(JSON.stringify(lb)).not.toMatch(/example\.com/);
  });
  it("rate-limited per IP (30/min)", async () => {
    const s = await setup(); let last = 0;
    for (let i = 0; i < 31; i++) last = (await s.call("GET", "/public/leaderboard", undefined, null)).status;
    expect(last).toBe(429);
  });
});

describe("M4.8 share cards", () => {
  it("owner shares (idempotent), public reads sanitized card, others cannot share, revoke → 404", async () => {
    const s = await setup(); const run = (await s.call("POST", "/runs", { strategyId: s.marco.id, mode: "paper" })).j;
    for (let i = 0; i < 10; i++) { s.clock.advance(60_000); await s.q.runs.tick(run.id); } await s.login();
    const sh = await s.call("POST", `/runs/${run.id}/card/share`); expect(sh.status).toBe(201); const a = CardShareRes.parse(sh.j);
    expect((await s.call("POST", `/runs/${run.id}/card/share`)).j.token).toBe(a.token);
    expect((await s.call("POST", `/runs/${run.id}/card/share`, undefined, "m48-someone-else-user-01")).status).toBe(404);
    expect((await s.call("DELETE", `/runs/${run.id}/card/share`, undefined, "m48-someone-else-user-01")).status).toBe(404);
    const pub = await s.call("GET", `/public/cards/${a.token}`, undefined, null); expect(pub.status).toBe(200);
    const card = PublicCard.parse(pub.j); expect(card.strategyName).toBe(s.marco.name); expect(card.handle).toBe("@m48-public-share-user-01");
    expect(JSON.stringify(pub.j)).not.toMatch(LEAK); expect(Object.keys(pub.j)).not.toContain("runId");
    expect((await s.call("GET", "/public/cards/crd_nope", undefined, null)).status).toBe(404);
    expect((await s.call("DELETE", `/runs/${run.id}/card/share`)).j).toEqual({ revoked: 1 });
    expect((await s.call("GET", `/public/cards/${a.token}`, undefined, null)).status).toBe(404);
    const b = CardShareRes.parse((await s.call("POST", `/runs/${run.id}/card/share`)).j); expect(b.token).not.toBe(a.token); // new token after revoke
    expect(s.q.store.audit.filter((x) => x.action.startsWith("run.card.")).map((x) => x.action)).toEqual(["run.card.share", "run.card.revoke", "run.card.share"]);
  });
});
