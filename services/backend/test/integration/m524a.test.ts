// M5.24a: validation rejects (422/413) refund rate-limit + quota charges; invalid requests have their own 120/min/IP cap.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { T0 } from "../helpers";

const W = "0x1111111111111111111111111111111111111111", SA = "0x2222222222222222222222222222222222222222";
async function setup() {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0 });
  const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m524a-refund-label-xx" }) })).json() as any).accessToken;
  const me = (await (await q.app.request("/v1/me", { headers: { authorization: `Bearer ${tok}` } })).json() as any).id;
  q.store.users.get(me)!.linkedWallets = [{ address: W, linkedAt: T0 } as any];
  q.store.sessionKeys.set("sk_m524a00000", { id: "sk_m524a00000", ownerId: me, status: "active", policy: { chainId: 46630 } as any, address: W, smartAccount: SA, typedData: {}, createdAt: T0, spent: { day: "", usd: 0 }, revokeTx: null });
  const post = (path: string, b: any) => q.app.request(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(b) });
  const me2 = async () => (await (await q.app.request("/v1/me", { headers: { authorization: `Bearer ${tok}` } })).json() as any);
  return { post, me2 };
}
const ok = { chainId: 46630, asset: "ETH", amount: "0.05", from: W };

describe("M5.24a refunds on validation rejects", () => {
  it("25 invalid deposit-prepare calls don't consume the 20/min limit", async () => {
    const { post } = await setup();
    for (let i = 0; i < 25; i++) expect((await post("/v1/testnet/deposit/prepare", { ...ok, chainId: 1 })).status).toBe(422);
    for (let i = 0; i < 20; i++) expect((await post("/v1/testnet/deposit/prepare", ok)).status).toBe(200);
    expect((await post("/v1/testnet/deposit/prepare", ok)).status).toBe(429); // valid calls still count
  });
  it("non-validation errors (409) still count", async () => {
    const { post } = await setup(); const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await post("/v1/testnet/deposit/prepare", { ...ok, from: SA })).status);
    expect(codes[19]).toBe(409); expect(codes[20]).toBe(429);
  });
  it("invalid compile bodies don't use the daily compile quota", async () => {
    const { post, me2 } = await setup(); const before = (await me2()).quotas.compilesUsedToday;
    for (let i = 0; i < 3; i++) expect((await post("/v1/compile", { nope: 1 })).status).toBe(422);
    expect((await me2()).quotas.compilesUsedToday).toBe(before);
  });
  it("invalid requests are capped separately (120/min per IP)", async () => {
    const { post } = await setup(); let last = 0;
    for (let i = 0; i < 121; i++) last = (await post("/v1/testnet/deposit/prepare", { ...ok, chainId: 1 })).status;
    expect(last).toBe(429);
  });
});
