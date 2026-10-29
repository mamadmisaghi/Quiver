// M5.24d: deposit prepare checks the smart account has code on 46630 when an RPC is available.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { DepositPrepareRes } from "../../contracts/src/testnet";
import type { PoolReader } from "../../src/testpool";
import { T0 } from "../helpers";

const W = "0x1111111111111111111111111111111111111111", SA = "0x2222222222222222222222222222222222222222";
async function setup(reader?: PoolReader) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0, ...(reader ? { testPool: { reader } } : {}) });
  const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m524d-code-user-label-xx" }) })).json() as any).accessToken;
  const me = (await (await q.app.request("/v1/me", { headers: { authorization: `Bearer ${tok}` } })).json() as any).id;
  q.store.users.get(me)!.linkedWallets = [{ address: W, linkedAt: T0 } as any];
  q.store.sessionKeys.set("sk_m524d00000", { id: "sk_m524d00000", ownerId: me, status: "active", policy: { chainId: 46630 } as any, address: W, smartAccount: SA, typedData: {}, createdAt: T0, spent: { day: "", usd: 0 }, revokeTx: null });
  return () => q.app.request("/v1/testnet/deposit/prepare", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ chainId: 46630, asset: "ETH", amount: "0.01", from: W }) });
}
const rd = (chainId: number, code: () => Promise<string | undefined>): PoolReader => ({ getChainId: async () => chainId, getCode: code, readContract: async () => { throw new Error("n/a"); } });

describe("M5.24d smart-account code check", () => {
  it("no RPC → unchecked", async () => { expect(DepositPrepareRes.parse(await (await (await setup())()).json()).recipientCode).toBe("unchecked"); });
  it("code present → verified", async () => { expect(DepositPrepareRes.parse(await (await (await setup(rd(46630, async () => "0x6080")))()).json()).recipientCode).toBe("verified"); });
  it("no code → 409 smart_account_not_deployed", async () => {
    for (const c of ["0x", undefined]) { const r = await (await setup(rd(46630, async () => c)))(); expect(r.status).toBe(409);
      const j = await r.json() as any; expect(j.error.details).toMatchObject({ reason: "smart_account_not_deployed", recipient: SA }); }
  });
  it("M5.25: RPC configured but wrong chain / failing / unreachable → 503 recipient_check_unavailable (fail closed)", async () => {
    for (const r0 of [rd(4663, async () => "0x6080"), rd(46630, async () => { throw new Error("timeout"); }),
      { getChainId: async () => { throw new Error("ECONNREFUSED"); }, getCode: async () => "0x6080", readContract: async () => { throw new Error("n/a"); } } as PoolReader]) {
      const r = await (await setup(r0))(); expect(r.status).toBe(503);
      expect(((await r.json()) as any).error.details).toMatchObject({ reason: "recipient_check_unavailable" }); }
  });
});
