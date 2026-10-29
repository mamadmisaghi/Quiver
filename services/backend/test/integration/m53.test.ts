// M5.3 write-off of a stuck paper position.
import { describe, expect, it } from "vitest";
import { WriteOffPreviewRes, WriteOffRes } from "../../contracts/src/writeoff";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import type { MockVenueAdapter } from "../../src/venues/adapters";

async function setup() {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock, autoTimers: false, compileDelayMs: 0 });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  const login = async (w = "m53-write-off-user-0001") => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${w}` })).j.accessToken; };
  await login();
  const pubs = (await call("GET", "/public/strategies")).j; const marco = pubs.items.find((x: any) => x.author.handle === "@demo_marco");
  const fork = (await call("POST", `/public/strategies/${marco.id}/fork`)).j; const run = (await call("POST", "/runs", { strategyId: fork.id, mode: "paper", startingEquityUsd: "10000" })).j;
  for (let i = 0; i < 20; i++) { clock.advance(60_000); await q.runs.tick(run.id); }
  await login(); const hl = q.adapters.hyperliquid as MockVenueAdapter;
  return { q, call, login, run, hl, acct: () => q.runs.live.get(run.id)!.ex.acct };
}
const SOL = "hl:perp:SOL";

describe("M5.3 write-off", () => {
  it("refuses while the position can still be closed normally (409), preview says why", async () => {
    const s = await setup(); expect(s.acct().positions.has(SOL)).toBe(true);
    const p = WriteOffPreviewRes.parse((await s.call("GET", `/runs/${s.run.id}/positions/write-off?instrument=${SOL}`)).j);
    expect(p).toMatchObject({ eligible: false, reasons: [], basis: "zero_recovery" }); expect(Number(p.lossUsd)).toBeGreaterThan(0);
    expect((await s.call("POST", `/runs/${s.run.id}/positions/write-off`, { instrument: SOL, confirm: true })).status).toBe(409);
    expect(s.acct().positions.has(SOL)).toBe(true);
  });
  it("venue down + rejected close -> eligible; writes off at zero recovery, books the loss, logs a warning and audit", async () => {
    const s = await setup(); s.hl.down = true;
    const pos = s.acct().positions.get(SOL)!; const margin = Math.abs(pos.qty) * pos.avgEntry / pos.leverage; const cash0 = s.acct().cash; const r0 = s.acct().realized;
    const cl = await s.call("POST", `/runs/${s.run.id}/positions/close`, { instrument: SOL, pct: 100 }); expect(cl.j.status).not.toBe("filled");
    const p = WriteOffPreviewRes.parse((await s.call("GET", `/runs/${s.run.id}/positions/write-off?instrument=${SOL}`)).j);
    expect(p.eligible).toBe(true); expect(p.reasons).toEqual(expect.arrayContaining(["venue_down", "close_rejected"]));
    expect((await s.call("POST", `/runs/${s.run.id}/positions/write-off`, { instrument: SOL })).status).toBe(422); // confirm required
    const r = await s.call("POST", `/runs/${s.run.id}/positions/write-off`, { instrument: SOL, confirm: true }); expect(r.status).toBe(200);
    const b = WriteOffRes.parse(r.j); expect(Number(b.lossUsd)).toBeCloseTo(margin, 2);
    expect(s.acct().positions.has(SOL)).toBe(false); expect(s.acct().cash).toBeCloseTo(cash0 - margin, 6); expect(s.acct().realized).toBeCloseTo(r0 - margin, 6);
    const evs = s.q.store.runs.get(s.run.id)!.events; expect(evs.some((e: any) => e.type === "warning" && e.code === "position_written_off")).toBe(true);
    expect(s.q.store.audit.some((a) => a.action === "run.write_off")).toBe(true);
    expect((await s.call("POST", `/runs/${s.run.id}/positions/write-off`, { instrument: SOL, confirm: true })).status).toBe(404);
  });
  it("ownership, unknown instrument, validation", async () => {
    const s = await setup(); s.hl.down = true; const u = `/runs/${s.run.id}/positions/write-off`;
    expect((await s.call("POST", u, { instrument: "hl:perp:BTC", confirm: true })).status).toBe(404);
    expect((await s.call("POST", u, { instrument: "not an id", confirm: true })).status).toBe(422);
    await s.login("m53-someone-else-user-01"); expect((await s.call("POST", u, { instrument: SOL, confirm: true })).status).toBe(404);
    expect((await s.call("GET", `${u}?instrument=${SOL}`)).status).toBe(404);
  });
});
