// M4.1 partial close of a paper position.
import { describe, expect, it } from "vitest";
import { ClosePositionRes } from "../../contracts/src/api";
import { RunEvent } from "../../contracts/src/events";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup() {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  const login = async (w = "m41-partial-close-user") => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${w}` })).j.accessToken; };
  await login();
  const pubs = (await call("GET", "/public/strategies")).j; const marco = pubs.items.find((x: any) => x.author.handle === "@demo_marco");
  const fork = (await call("POST", `/public/strategies/${marco.id}/fork`)).j; const run = (await call("POST", "/runs", { strategyId: fork.id, mode: "paper", startingEquityUsd: "10000" })).j;
  for (let i = 0; i < 20; i++) { clock.advance(60_000); await q.runs.tick(run.id); }
  await login();
  return { q, clock, call, login, run, acct: () => q.runs.live.get(run.id)!.ex.acct };
}
const SOL = "hl:perp:SOL";

describe("M4.1 partial close", () => {
  it("closes X% of the current qty, emits intent+fill on the run log, realizes P&L pro rata", async () => {
    const s = await setup(); const before = s.acct().positions.get(SOL)!; const q0 = before.qty; const r0 = s.acct().realized; const n0 = s.run.events?.length;
    const r = await s.call("POST", `/runs/${s.run.id}/positions/close`, { instrument: SOL, pct: 25 }); expect(r.status).toBe(200);
    const b = ClosePositionRes.parse(r.j); expect(b).toMatchObject({ status: "filled", closedFully: false, requestedPct: 25, rejection: null });
    expect(Number(b.remaining!.qty)).toBeCloseTo(q0 * 0.75, 8); expect(Math.abs(Number(b.fill?.type === "fill" ? b.fill.qty : NaN))).toBeCloseTo(Math.abs(q0) * 0.25, 8);
    expect(s.acct().positions.get(SOL)!.avgEntry).toBe(before.avgEntry); expect(s.acct().realized).not.toBe(r0);
    const evs = s.q.store.runs.get(s.run.id)!.events; const mine = evs.filter((e) => (e as any).orderId === b.orderId); expect(mine.map((e) => e.type)).toEqual(["intent", "fill"]); mine.forEach((e) => RunEvent.parse(e)); void n0;
  });
  it("100% (or a sub-$1 remainder) closes fully; then 404", async () => {
    const s = await setup();
    const r = ClosePositionRes.parse((await s.call("POST", `/runs/${s.run.id}/positions/close`, { instrument: SOL, pct: 99.99 })).j); expect(r).toMatchObject({ closedFully: true, remaining: null, status: "filled" });
    expect(s.acct().positions.has(SOL)).toBe(false);
    expect((await s.call("POST", `/runs/${s.run.id}/positions/close`, { instrument: SOL, pct: 100 })).status).toBe(404);
  });
  it("validation, ownership, stopped run", async () => {
    const s = await setup(); const u = `/runs/${s.run.id}/positions/close`;
    for (const pct of [0, -5, 100.5, 12.345]) expect((await s.call("POST", u, { instrument: SOL, pct })).status).toBe(422);
    expect((await s.call("POST", u, { instrument: "hl:perp:BTC", pct: 10 })).status).toBe(404);
    await s.login("m41-someone-else-user"); expect((await s.call("POST", u, { instrument: SOL, pct: 10 })).status).toBe(404); await s.login();
    expect((await s.call("POST", `/runs/${s.run.id}/control`, { action: "pause" })).status).toBe(200);
    expect(ClosePositionRes.parse((await s.call("POST", u, { instrument: SOL, pct: 50 })).j).status).toBe("filled"); // paused runs may still reduce
    await s.call("POST", `/runs/${s.run.id}/control`, { action: "stop" }); expect((await s.call("POST", u, { instrument: SOL, pct: 10 })).status).toBe(409);
  });
});
