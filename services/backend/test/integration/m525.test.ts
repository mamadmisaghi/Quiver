// M5.25: optional per-user cap on invalid requests (default 60/min) alongside the 120/min per-IP cap.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { T0 } from "../helpers";

async function mk(env: Record<string, string> = {}) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0 });
  const login = async (l: string) => { const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:${l}` }) })).json() as any).accessToken;
    return () => q.app.request("/v1/testnet/deposit/prepare", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ chainId: 1, asset: "ETH", amount: "1", from: "0x1111111111111111111111111111111111111111" }) }); };
  return login;
}
describe("M5.25 per-user invalid cap", () => {
  it("61st invalid request from one user → 429; another user on the same IP is unaffected", async () => {
    const login = await mk(); const a = await login("m525-user-a-label-xxxx"), b = await login("m525-user-b-label-xxxx");
    for (let i = 0; i < 60; i++) expect((await a()).status).toBe(422);
    const r = await a(); expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await b()).status).toBe(422);
  });
  it("INVALID_PER_USER_PER_MIN=0 turns it off (per-IP 120 still applies)", async () => {
    const a = await (await mk({ INVALID_PER_USER_PER_MIN: "0" }))("m525-user-c-label-xxxx");
    for (let i = 0; i < 120; i++) expect((await a()).status).toBe(422);
    expect((await a()).status).toBe(429);
  });
});
